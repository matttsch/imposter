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
const ACCESS_CODE = "kebsiary14";
const GAME_ROOM = "main-room";
const rooms = {
  [GAME_ROOM]: { players: [], started: false, votes: {}, scores: {}, imposterIndex: null }
};
const nouns = fs.readFileSync("polish_nouns.txt", "utf-8").split("\n").filter(Boolean);

io.on("connection", (socket) => {
  let currentName = null;

  socket.on("join", ({ code, name }) => {
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    currentName = name;
    socket.join(GAME_ROOM);
    rooms[GAME_ROOM].players.push({ id: socket.id, name });
    rooms[GAME_ROOM].scores[socket.id] = rooms[GAME_ROOM].scores[socket.id] || 0;
    io.to(GAME_ROOM).emit("players", rooms[GAME_ROOM].players);
    socket.emit("joined");
    if (rooms[GAME_ROOM].started) {
      socket.emit("started");
    }
  });

  socket.on("start", () => {
    if (rooms[GAME_ROOM].started) {
      socket.emit("error", { message: "Gra już została rozpoczęta." });
      return;
    }
    rooms[GAME_ROOM].started = true;
    io.to(GAME_ROOM).emit("started");
    sendNewRound();
  });

  function sendNewRound() {
    const players = rooms[GAME_ROOM].players;
    const word = nouns[Math.floor(Math.random() * nouns.length)].trim();
    const imposterIndex = Math.floor(Math.random() * players.length);
    rooms[GAME_ROOM].imposterIndex = imposterIndex;
    rooms[GAME_ROOM].votes = {}; // reset votes

    players.forEach((player, i) => {
      const isImposter = i === imposterIndex;
      io.to(player.id).emit("round", { word: isImposter ? "IMPOSTER" : word });
    });
  }

  socket.on("vote", (votedId) => {
    rooms[GAME_ROOM].votes[socket.id] = votedId;
    const totalVotes = Object.keys(rooms[GAME_ROOM].votes).length;
    const totalPlayers = rooms[GAME_ROOM].players.length;

    if (totalVotes === totalPlayers) {
      const voteCounts = {};
      Object.values(rooms[GAME_ROOM].votes).forEach((id) => {
        voteCounts[id] = (voteCounts[id] || 0) + 1;
      });

      const [mostVotedId] = Object.entries(voteCounts).sort((a, b) => b[1] - a[1])[0];
      const imposter = rooms[GAME_ROOM].players[rooms[GAME_ROOM].imposterIndex];

      if (mostVotedId === imposter.id) {
        // All correct voters get a point
        for (const [voterId, votedId] of Object.entries(rooms[GAME_ROOM].votes)) {
          if (votedId === mostVotedId) {
            rooms[GAME_ROOM].scores[voterId]++;
          }
        }
      } else {
        // Imposter gets a point
        rooms[GAME_ROOM].scores[imposter.id]++;
      }

      io.to(GAME_ROOM).emit("scores", rooms[GAME_ROOM].scores);
      sendNewRound();
    }
  });

  socket.on("next", () => {
    if (!rooms[GAME_ROOM].started) return;
    sendNewRound();
  });

  socket.on("end", () => {
    rooms[GAME_ROOM] = { players: [], started: false, votes: {}, scores: {}, imposterIndex: null };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("disconnect", () => {
    rooms[GAME_ROOM].players = rooms[GAME_ROOM].players.filter(p => p.id !== socket.id);
    delete rooms[GAME_ROOM].scores[socket.id];
    delete rooms[GAME_ROOM].votes[socket.id];
    io.to(GAME_ROOM).emit("players", rooms[GAME_ROOM].players);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
