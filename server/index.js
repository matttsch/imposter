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
  pingTimeout: 30000,  // Timeout ping
  pingInterval: 10000,  // Czas między pingami
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
    currentMap: {},
  }
};

io.on("connection", (socket) => {
  console.log(`Gracz połączony: ${socket.id}`);

  // Sprawdzanie statusu gry
  socket.on("checkStatus", () => {
    const room = rooms[GAME_ROOM];
    if (room.started) {
      socket.emit("gameStatus", { status: "running" });
    } else {
      socket.emit("gameStatus", { status: "stopped" });
    }
  });

  // Pozostała logika socketów (join, start, vote, etc.)

  socket.on("disconnect", () => {
    console.log(`Gracz rozłączony: ${socket.id}`);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
