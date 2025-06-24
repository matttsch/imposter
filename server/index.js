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
    currentWord: null
  }
};

function deduplicateAndSave(filename) {
  const words = fs.readFileSync(filename, "utf-8").split("\n").map(w => w.trim()).filter(Boolean);
  const unique = [...new Set(words)];
  fs.writeFileSync(filename, unique.join("\n"), "utf-8");
  return unique;
}

deduplicateAndSave("polish_nouns_backup.txt");
let nouns = deduplicateAndSave("polish_nouns.txt");

function reloadNounsIfEmpty() {
  if (nouns.length === 0) {
    nouns = deduplicateAndSave("polish_nouns_backup.txt");
    fs.writeFileSync("polish_nouns.txt", nouns.join("\n"), "utf-8");
    console.log("Lista słów została zresetowana.");
  }
}
function removeUsedWord(word) {
  nouns = nouns.filter(w => w.trim().toLowerCase() !== word.trim().toLowerCase());
  fs.writeFileSync("polish_nouns.txt", nouns.join("\n"), "utf-8");
}

let roundInProgress = false;

io.on("connection", (socket) => {
  let currentName = null;

  socket.on("join", ({ code, name }) => {
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    const room = rooms[GAME_ROOM];
    if (room.players.some(p => p.name === name)) {
      socket.emit("error", { message: "Imię jest już zajęte." });
      return;
    }

    currentName = name;
    socket.join(GAME_ROOM);
    const canVote = !room.started;
    room.players.push({ id: socket.id, name, canVote });
    room.scores[socket.id] = room.scores[socket.id] || 0;
    io.to(GAME_ROOM).emit("players", room.players);
    socket.emit("joined");

    if (room.started && room.currentWord) {
      socket.emit("round", { word: room.currentWord, remaining: nouns.length });
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
    if (roundInProgress) return;
    roundInProgress = true;

    const room = rooms[GAME_ROOM];
    const players = room.players;

    reloadNounsIfEmpty();
    const word = nouns[Math.floor(Math.random() * nouns.length)].trim();
    room.currentWord = word;

    const imposterIndex = Math.floor(Math.random() * players.length);
    room.imposterIndex = imposterIndex;
    room.votes = {};
    room.voteHistory = [];
    room.lastResult = null;

    players.forEach((p, i) => {
      const isImposter = i === imposterIndex;
      p.canVote = true;
      io.to(p.id).emit("round", {
        word: isImposter ? "IMPOSTER" : word,
        remaining: nouns.length - 1
      });
    });

    removeUsedWord(word);

    setTimeout(() => {
      roundInProgress = false;
    }, 1000);
  }

  socket.on("vote", (votedId) => {
    const room = rooms[GAME_ROOM];
    const voter = room.players.find(p => p.id === socket.id);

    if (!voter || !voter.canVote) return;

    room.votes[socket.id] = votedId;
    room.voteHistory.push({ from: socket.id, to: votedId });

    const totalVotes = Object.keys(room.votes).length;
    const eligibleVoters = room.players.filter(p => p.canVote).length;

    if (totalVotes === eligibleVoters) {
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

  socket.on("next", () => sendNewRound());

  socket.on("end", () => {
    rooms[GAME_ROOM] = {
      players: [],
      started: false,
      votes: {},
      scores: {},
      imposterIndex: null,
      voteHistory: [],
      lastResult: null,
      currentWord: null
    };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("kick", (id) => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== id);
    delete room.scores[id];
    delete room.votes[id];
    io.to(id).emit("ended");
    io.to(GAME_ROOM).emit("players", room.players);
  });

  socket.on("disconnect", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];
    delete room.votes[socket.id];
    io.to(GAME_ROOM).emit("players", room.players);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
