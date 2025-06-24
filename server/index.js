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

let nouns = [...new Set(fs.readFileSync("polish_nouns.txt", "utf-8").split("\n").map(w => w.trim()).filter(Boolean))];

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

io.on("connection", (socket) => {
  let currentName = null;

  socket.on("join", ({ code, name }) => {
    const room = rooms[GAME_ROOM];

    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    if (room.players.find(p => p.name === name)) {
      socket.emit("error", { message: "Gracz o tym imieniu już istnieje." });
      return;
    }

    const player = { id: socket.id, name, canVote: true };
    currentName = name;

    if (room.started) {
      player.canVote = false;
    }

    room.players.push(player);
    room.scores[socket.id] = room.scores[socket.id] || 0;

    socket.join(GAME_ROOM);
    socket.emit("joined");
    io.to(GAME_ROOM).emit("players", room.players);

    if (room.started) {
      socket.emit("started");

      if (room.currentWord) {
        const isImposter = false;
        socket.emit("round", {
          word: isImposter ? "IMPOSTER" : room.currentWord,
          remaining: nouns.length
        });
      }
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

    const word = nouns[Math.floor(Math.random() * nouns.length)];
    nouns = nouns.filter(w => w !== word); // usuń użyte słowo

    const imposterIndex = Math.floor(Math.random() * players.length);
    room.imposterIndex = imposterIndex;
    room.currentWord = word;
    room.votes = {};
    room.voteHistory = [];
    room.lastResult = null;

    players.forEach((player, i) => {
      const isImposter = i === imposterIndex;
      player.canVote = true; // reset uprawnień do głosowania
      io.to(player.id).emit("round", {
        word: isImposter ? "IMPOSTER" : word,
        remaining: nouns.length
      });
    });
  }

  socket.on("vote", (votedId) => {
    const room = rooms[GAME_ROOM];
    const voter = room.players.find(p => p.id === socket.id);

    if (!voter || !voter.canVote) return;

    room.votes[socket.id] = votedId;
    room.voteHistory.push({ from: socket.id, to: votedId });

    voter.canVote = false;

    const totalEligibleVoters = room.players.filter(p => p.canVote !== false).length;
    const totalVotes = Object.keys(room.votes).length;

    if (totalVotes === totalEligibleVoters) {
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
      currentWord: null
    };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("kick", (id) => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== id);
    delete room.votes[id];
    delete room.scores[id];
    io.to(id).emit("ended");
    io.to(GAME_ROOM).emit("players", room.players);
  });

  socket.on("leave", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.votes[socket.id];
    delete room.scores[socket.id];
    io.to(GAME_ROOM).emit("players", room.players);
  });

  socket.on("disconnect", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.votes[socket.id];
    delete room.scores[socket.id];
    io.to(GAME_ROOM).emit("players", room.players);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
