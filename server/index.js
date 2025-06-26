const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const cors = require("cors");
const { MongoClient } = require('mongodb');

// Uzyskaj URI połączenia z MongoDB z zmiennej środowiskowej
const uri = process.env.MONGODB_URI;  // Render automatycznie załaduje zmienną środowiskową

// Skonfiguruj klienta MongoDB, wymuszając połączenie SSL
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  ssl: true  // Wymuś połączenie SSL
});

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 30000,
  pingInterval: 10000,
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
    playerRoles: {},
    playerStatuses: {}, // Dodajemy statusy graczy
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

async function getRemainingWordsCount() {
  const room = rooms[GAME_ROOM];
  const database = client.db('imposter_game');
  const wordsCollection = database.collection('used_words');
  const usedWordsCount = await wordsCollection.countDocuments();
  const remainingWordsCount = nouns.length - usedWordsCount;
  return remainingWordsCount;
}

async function sendNewRound() {
  const room = rooms[GAME_ROOM];
  const players = room.players;

  async function getUniqueWord() {
    const availableWords = nouns.filter(w => !room.usedWords.has(w));
    if (availableWords.length === 0) {
      io.to(GAME_ROOM).emit("error", { message: "Skończyły się słowa!" });
      return;
    }

    const word = availableWords[Math.floor(Math.random() * availableWords.length)];

    const database = client.db('imposter_game');
    const wordsCollection = database.collection('used_words');
    const existingWord = await wordsCollection.findOne({ word: word });
    
    if (existingWord) {
      console.log(`Słowo ${word} już istnieje w bazie danych. Losowanie nowego...`);
      await getUniqueWord(); // Losujemy inne
    } else {
      await wordsCollection.insertOne({ word: word });
      room.usedWords.add(word);  // Dodajemy słowo do użytych słów
      room.currentWord = word;
      room.votes = {};
      room.voteHistory = [];
      room.lastResult = null;
      room.currentMap = {};
      room.playerRoles = {}; // Resetujemy role graczy
      room.imposterIndex = Math.floor(Math.random() * players.length);  // Losowanie impostera

      const remainingWords = await getRemainingWordsCount();

      players.forEach((player, i) => {
        const isImposter = i === room.imposterIndex;
        const role = isImposter ? "IMPOSTER" : word;
        room.currentMap[player.id] = role;
        room.playerRoles[player.name] = role; // Przypisujemy rolę graczowi
        room.playerStatuses[player.id] = "ingame"; // Ustawiamy status "ingame"
        io.to(player.id).emit("round", {
          word: role,
          remaining: remainingWords
        });
      });
    }
  }

  await getUniqueWord().catch(console.error);
}

io.on("connection", (socket) => {
  console.log(`Gracz połączony: ${socket.id}`);

  socket.on("checkStatus", () => {
    const room = rooms[GAME_ROOM];
    if (room.started) {
      socket.emit("gameStatus", { status: "running" });
    } else {
      socket.emit("gameStatus", { status: "stopped" });
    }
  });

  socket.on("join", ({ code, name }) => {
    const room = rooms[GAME_ROOM];
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    const existingPlayer = room.players.find(p => p.name === name);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
    } else {
      room.players.push({ id: socket.id, name });
    }

    socket.join(GAME_ROOM);
    room.scores[socket.id] = room.scores[socket.id] || 0;
    sendPlayersList();

    if (room.started) {
      socket.emit("started");
      const currentWord = room.playerRoles[name] || room.currentWord;
      const actualWord = currentWord === "IMPOSTER" ? "IMPOSTER" : currentWord;

      socket.emit("joined", { currentWord: actualWord });
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
    if (!room.players.some(p => p.id === socket.id)) return;
    if (!room.players.some(p => p.id === votedId)) return;

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
            room.scores[voterId] = (room.scores[voterId] || 0) + 1;
          }
        }
      } else {
        room.scores[imposter.id] = (room.scores[imposter.id] || 0) + 1;
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

      room.players.forEach((player) => {
        room.playerStatuses[player.id] = "result"; // Ustawiamy status "result" po zakończeniu głosowania
      });

      io.to(GAME_ROOM).emit("result", room.lastResult);
      io.to(GAME_ROOM).emit("scores", room.scores);
    }
  });

  socket.on("next", () => {
    sendNewRound();
  });

  socket.on("leave", () => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];
    delete room.votes[socket.id];
    sendPlayersList();
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
      currentMap: {},
      playerRoles: {},
      playerStatuses: {} // Resetujemy statusy
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

  socket.on("disconnect", () => {
    // nie usuwamy z players, bo reconnect
  });
});

client.connect()
  .then(() => {
    console.log("Połączono z MongoDB!");
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch(console.error);
