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

const PORT = 3001;
const ACCESS_CODE = "kebsiary14";
const GAME_ROOM = "main-room";
const rooms = {
  [GAME_ROOM]: { players: [], started: false }
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
    rooms[GAME_ROOM].players.push({ id: socket.id, name });
    io.to(GAME_ROOM).emit("players", rooms[GAME_ROOM].players);
    socket.join(GAME_ROOM);
  });

  socket.on("start", () => {
    if (rooms[GAME_ROOM].started) return;
    rooms[GAME_ROOM].started = true;
    io.to(GAME_ROOM).emit("started");
    sendNewRound();
  });

  function sendNewRound() {
    const players = rooms[GAME_ROOM].players;
    const word = nouns[Math.floor(Math.random() * nouns.length)].trim();
    const imposterIndex = Math.floor(Math.random() * players.length);

    players.forEach((player, i) => {
      const isImposter = i === imposterIndex;
      io.to(player.id).emit("round", { word: isImposter ? "IMPOSTER" : word });
    });
  }

  socket.on("next", () => {
    sendNewRound();
  });

  socket.on("end", () => {
    io.to(GAME_ROOM).emit("ended");
    rooms[GAME_ROOM] = { players: [], started: false };
  });

  socket.on("disconnect", () => {
    rooms[GAME_ROOM].players = rooms[GAME_ROOM].players.filter(p => p.id !== socket.id);
    io.to(GAME_ROOM).emit("players", rooms[GAME_ROOM].players);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));