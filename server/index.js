const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3001;
const ACCESS_CODE = "Kebsiary14";
const GAME_ROOM = "main-room";

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
    disconnectTimers: {}
  }
};

let nouns = Array.from(new Set(
  fs.readFileSync("polish_nouns.txt", "utf-8")
    .split("\n")
    .map(word => word.trim())
    .filter(Boolean)
));

function sendPlayersList() {
  io.to(GAME_ROOM).emit("players", rooms[GAME_ROOM].players);
}

function sendNewRound() {
  const room = rooms[GAME_ROOM];
  const availableWords = nouns.filter(w => !room.usedWords.has(w));
  if (availableWords.length === 0) {
    io.to(GAME_ROOM).emit("error", { message: "Skończyły się słowa!" });
    return;
  }

  const word = availableWords[Math.floor(Math.random() * availableWords.length)];
  room.usedWords.add(word);
  room.currentWord = word;
  room.votes = {};
  room.voteHistory = [];
  room.lastResult = null;

  room.imposterIndex = Math.floor(Math.random() * room.players.length);
  room.players.forEach((player, i) => {
    const isImposter = i === room.imposterIndex;
    io.to(player.id).emit("round", {
      word: isImposter ? "IMPOSTER" : word,
      remaining: nouns.length - room.usedWords.size
    });
  });
}

io.on("connection", (socket) => {
  socket.on("join", ({ code, name, clientId }) => {
    const room = rooms[GAME_ROOM];
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    const existing = room.players.find(p => p.clientId === clientId);
    if (existing) {
      // reconnect
      clearTimeout(room.disconnectTimers[clientId]);
      existing.id = socket.id;
      socket.join(GAME_ROOM);
      sendPlayersList();
      socket.emit("joined", room.started && room.currentWord ? { currentWord: room.currentWord } : {});
      if (room.started) socket.emit("started");
      return;
    }

    if (room.players.find(p => p.name === name)) {
      socket.emit("error", { message: "Imię jest już zajęte." });
      return;
    }

    const player = { id: socket.id, name, clientId };
    room.players.push(player);
    room.scores[socket.id] = room.scores[socket.id] || 0;

    socket.join(GAME_ROOM);
    sendPlayersList();
    socket.emit("joined", room.started && room.currentWord ? { currentWord: room.currentWord } : {});
    if (room.started) socket.emit("started");
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

  socket.on("vote", (votedId) => {
    const room = rooms[GAME_ROOM];
    room.votes[socket.id] = votedId;
    room.voteHistory.push({ from: socket.id, to: votedId });

    const totalVotes = Object.keys(room.votes).length;
    const totalPlayers = room.players.length;

    if (totalVotes === totalPlayers) {
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
      disconnectTimers: {}
    };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("leave", () => {
    const room = rooms[GAME_ROOM];
    const index = room.players.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      const player = room.players[index];
      room.players.splice(index, 1);
      delete room.scores[player.id];
      delete room.votes[player.id];
      delete room.disconnectTimers[player.clientId];
      sendPlayersList();
    }
  });

  socket.on("disconnect", () => {
    const room = rooms[GAME_ROOM];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    room.disconnectTimers[player.clientId] = setTimeout(() => {
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.scores[socket.id];
      delete room.votes[socket.id];
      delete room.disconnectTimers[player.clientId];
      sendPlayersList();
    }, 5 * 60 * 1000); // 5 minut
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
