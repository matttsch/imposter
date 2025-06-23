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
const rooms = {}; // { roomCode: { players: [], started: false, currentWord: '', imposter: '' } }
const nouns = fs.readFileSync("polish_nouns.txt", "utf-8").split("\n").filter(Boolean);

io.on("connection", (socket) => {
  let currentRoom = null;
  let currentName = null;

  socket.on("join", ({ roomCode, name }) => {
    currentRoom = roomCode;
    currentName = name;

    if (!rooms[roomCode]) {
      rooms[roomCode] = { players: [], started: false };
    }

    rooms[roomCode].players.push({ id: socket.id, name });
    io.to(roomCode).emit("players", rooms[roomCode].players);
    socket.join(roomCode);
  });

  socket.on("start", () => {
    if (!rooms[currentRoom] || rooms[currentRoom].started) return;

    rooms[currentRoom].started = true;
    io.to(currentRoom).emit("started");
    sendNewRound(currentRoom);
  });

  function sendNewRound(roomCode) {
    const players = rooms[roomCode].players;
    const word = nouns[Math.floor(Math.random() * nouns.length)].trim();
    const imposterIndex = Math.floor(Math.random() * players.length);

    players.forEach((player, i) => {
      const isImposter = i === imposterIndex;
      io.to(player.id).emit("round", { word: isImposter ? "IMPOSTER" : word });
    });
  }

  socket.on("next", () => {
    if (rooms[currentRoom]) {
      sendNewRound(currentRoom);
    }
  });

  socket.on("end", () => {
    if (rooms[currentRoom]) {
      io.to(currentRoom).emit("ended");
      delete rooms[currentRoom];
    }
  });

  socket.on("disconnect", () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== socket.id);
      io.to(currentRoom).emit("players", rooms[currentRoom].players);
      if (rooms[currentRoom].players.length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));