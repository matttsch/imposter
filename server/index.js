// server/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3001;
const ACCESS_CODE = "Kebsiary14";
const GAME_ROOM = "main-room";

let allNouns = fs.readFileSync("polish_nouns.txt", "utf-8")
  .split("\n")
  .map(n => n.trim())
  .filter((v, i, a) => v && a.indexOf(v) === i);

const rooms = {
  [GAME_ROOM]: {
    players: [],
    started: false,
    votes: {},
    scores: {},
    imposterIndex: null,
    voteHistory: [],
    lastResult: null,
    usedWords: new Set(),
    currentWord: null,
    newcomers: new Set()
  },
};

function getRandomWord() {
  const availableWords = allNouns.filter(w => !rooms[GAME_ROOM].usedWords.has(w));
  if (availableWords.length === 0) return null;
  const word = availableWords[Math.floor(Math.random() * availableWords.length)];
  rooms[GAME_ROOM].usedWords.add(word);
  return word;
}

io.on("connection", (socket) => {
  let currentName = null;

  socket.on("join", ({ code, name }) => {
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }
    const room = rooms[GAME_ROOM];
    if (room.players.find(p => p.name === name)) {
      socket.emit("error", { message: "Gracz o tym imieniu już istnieje." });
      return;
    }

    currentName = name;
    socket.join(GAME_ROOM);
    room.players.push({ id: socket.id, name });
    room.scores[socket.id] = room.scores[socket.id] || 0;

    if (room.started) {
      room.newcomers.add(socket.id);
      socket.emit("joined", { currentWord: room.currentWord === "IMPOSTER" ? "" : room.currentWord });
    } else {
      socket.emit("joined", {});
    }
    io.to(GAME_ROOM).emit("players", room.players);
    if (room.started) {
      socket.emit("started");
    }
  });

  socket.on("start", () => {
    const room = rooms[GAME_ROOM];
    if (room.started) {
      socket.emit("error", { message: "Gra już została rozpoczęta." });
      return;
    }
    room.started = true;
    io.to(GAME_ROOM).emit("started");
    sendNewRound();
  });

  function sendNewRound() {
    const room = rooms[GAME_ROOM];
    const players = room.players;
    const word = getRandomWord();
    if (!word) return;

    const imposterIndex = Math.floor(Math.random() * players.length);
    room.imposterIndex = imposterIndex;
    room.votes = {};
    room.voteHistory = [];
    room.lastResult = null;
    room.currentWord = word;
    room.newcomers.clear();

    players.forEach((player, i) => {
      const isImposter = i === imposterIndex;
      io.to(player.id).emit("round", {
        word: isImposter ? "IMPOSTER" : word,
        remaining: allNouns.length - room.usedWords.size
      });
    });
  }

  socket.on("vote", (votedId) => {
    const room = rooms[GAME_ROOM];
    if (room.newcomers.has(socket.id) || room.newcomers.has(votedId)) return;

    room.votes[socket.id] = votedId;
    room.voteHistory.push({ from: socket.id, to: votedId });

    if (Object.keys(room.votes).length === room.players.filter(p => !room.newcomers.has(p.id)).length) {
      const voteCounts = {};
      Object.values(room.votes).forEach((id) => {
        voteCounts[id] = (voteCounts[id] || 0) + 1;
      });

      const maxVotes = Math.max(...Object.values(voteCounts));
      const topVotedIds = Object.entries(voteCounts)
        .filter(([_, v]) => v === maxVotes)
        .map(([id]) => id);

      const votedOutNames = topVotedIds.map(id => room.players.find(p => p.id === id)?.name);
      const imposter = room.players[room.imposterIndex];

      if (topVotedIds.includes(imposter.id)) {
        for (const [voterId, votedId] of Object.entries(room.votes)) {
          if (votedId === imposter.id) {
            room.scores[voterId]++;
          }
        }
      } else {
        room.scores[imposter.id]++;
      }

      room.lastResult = {
        votedOut: votedOutNames.length === 1 ? votedOutNames[0] : votedOutNames,
        imposterName: imposter.name,
        voteHistory: room.voteHistory.map(({ from, to }) => {
          const fromName = room.players.find(p => p.id === from)?.name;
          const toName = room.players.find(p => p.id === to)?.name;
          return { from: fromName, to: toName };
        })
      };

      io.to(GAME_ROOM).emit("result", room.lastResult);
      io.to(GAME_ROOM).emit("scores", room.scores);
    }
  });

  socket.on("next", () => {
    sendNewRound();
  });

  socket.on("end", () => {
    rooms[GAME_ROOM] = {
      players: [],
      started: false,
      votes: {},
      scores: {},
      imposterIndex: null,
      voteHistory: [],
      lastResult: null,
      usedWords: new Set(),
      currentWord: null,
      newcomers: new Set(),
    };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("kick", (id) => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== id);
    delete room.votes[id];
    delete room.scores[id];
    room.newcomers.delete(id);
    io.to(id).emit("ended");
    io.to(GAME_ROOM).emit("players", room.players);
  });

  socket.on("leave", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.votes[socket.id];
    delete room.scores[socket.id];
    room.newcomers.delete(socket.id);
    io.to(GAME_ROOM).emit("players", room.players);
  });

  socket.on("disconnect", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.votes[socket.id];
    delete room.scores[socket.id];
    room.newcomers.delete(socket.id);
    io.to(GAME_ROOM).emit("players", room.players);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
