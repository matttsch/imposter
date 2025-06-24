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
    voteHistory: [],
    lastResult: null,
    usedWords: new Set(),
    currentWord: null,
    wordByName: {},      // NEW: słowo przypisane do imienia
    imposterName: null,  // NEW: impostor wg imienia
    sessionMap: {},      // NEW: reconnect (name => socket.id)
  }
};

let nouns = Array.from(new Set(
  fs.readFileSync("polish_nouns.txt", "utf-8")
    .split("\n")
    .map(w => w.trim())
    .filter(Boolean)
));

function sendPlayersList() {
  const room = rooms[GAME_ROOM];
  io.to(GAME_ROOM).emit("players", room.players);
}

function sendNewRound() {
  const room = rooms[GAME_ROOM];
  const players = room.players;

  const availableWords = nouns.filter(w => !room.usedWords.has(w));
  if (availableWords.length === 0) {
    io.to(GAME_ROOM).emit("error", { message: "Skończyły się słowa!" });
    return;
  }

  const word = availableWords[Math.floor(Math.random() * availableWords.length)];
  room.usedWords.add(word);
  room.currentWord = word;

  // NEW
  room.wordByName = {};
  room.imposterName = players[Math.floor(Math.random() * players.length)].name;
  room.votes = {};
  room.voteHistory = [];
  room.lastResult = null;

  players.forEach((player) => {
    const wordToSend = player.name === room.imposterName ? "IMPOSTER" : word;
    room.wordByName[player.name] = wordToSend;

    io.to(player.id).emit("round", {
      word: wordToSend,
      remaining: nouns.length - room.usedWords.size
    });
  });
}

io.on("connection", (socket) => {
  let currentName = null;

  socket.on("join", ({ code, name }) => {
    const room = rooms[GAME_ROOM];
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    const existing = room.players.find(p => p.name === name);
    if (existing) {
      // reconnect
      existing.id = socket.id;
    } else {
      room.players.push({ id: socket.id, name });
      room.scores[socket.id] = 0;
    }

    currentName = name;
    room.sessionMap[name] = socket.id;
    socket.join(GAME_ROOM);
    sendPlayersList();

    if (room.started && room.currentWord && name in room.wordByName) {
      socket.emit("joined", { currentWord: room.wordByName[name] });
    } else {
      socket.emit("joined", {});
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
      const imposter = room.players.find(p => p.name === room.imposterName);

      if (imposter && topVotedIds.includes(imposter.id)) {
        for (const [voterId, votedId] of Object.entries(room.votes)) {
          if (votedId === imposter.id) {
            room.scores[voterId]++;
          }
        }
      } else if (imposter) {
        room.scores[imposter.id]++;
      }

      room.lastResult = {
        votedOut: votedOutNames.length === 1 ? votedOutNames[0] : votedOutNames,
        imposterName: imposter?.name,
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

  socket.on("next", () => sendNewRound());

  socket.on("end", () => {
    rooms[GAME_ROOM] = {
      players: [],
      started: false,
      votes: {},
      scores: {},
      voteHistory: [],
      lastResult: null,
      usedWords: new Set(),
      currentWord: null,
      wordByName: {},
      imposterName: null,
      sessionMap: {},
    };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("kick", (id) => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== id);
    delete room.scores[id];
    delete room.votes[id];
    io.to(id).emit("ended");
    sendPlayersList();
  });

  socket.on("leave", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];
    delete room.votes[socket.id];
    sendPlayersList();
  });

  socket.on("disconnect", () => {
    // Nie usuwamy z room.players – reconnect działa przez name
    sendPlayersList();
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
