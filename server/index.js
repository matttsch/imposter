const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const cors = require("cors");
const { MongoClient } = require('mongodb');

// Uzyskaj URI połączenia z MongoDB z zmiennej środowiskowej
const uri = process.env.MONGODB_URI;  // Render automatycznie załaduje zmienną środowiskową

// Skonfiguruj klienta MongoDB
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
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
    playerRoles: {}
  }
};

// Odczyt słów z pliku
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
  const players = room.players;

  let word;
  
  // Funkcja losująca słowo i sprawdzająca, czy jest już w kolekcji
  async function getUniqueWord() {
    const availableWords = nouns.filter(w => !room.usedWords.has(w));
    if (availableWords.length === 0) {
      io.to(GAME_ROOM).emit("error", { message: "Skończyły się słowa!" });
      return;
    }

    // Losowanie słowa
    word = availableWords[Math.floor(Math.random() * availableWords.length)];

    // Połączenie z MongoDB i sprawdzenie, czy słowo już istnieje w kolekcji
    const database = client.db('imposter_game');
    const wordsCollection = database.collection('used_words');
    
    // Sprawdzanie, czy słowo już jest w bazie danych
    const existingWord = await wordsCollection.findOne({ word: word });
    
    // Jeśli słowo już jest w bazie danych, losujemy inne
    if (existingWord) {
      console.log(`Słowo ${word} już istnieje w bazie danych. Losowanie nowego...`);
      await getUniqueWord();
    } else {
      // Jeśli słowo nie istnieje, dodajemy je do bazy danych i do użytych słów
      await wordsCollection.insertOne({ word: word });
      room.usedWords.add(word);
      room.currentWord = word;
      room.votes = {};
      room.voteHistory = [];
      room.lastResult = null;
      room.currentMap = {};
      
      players.forEach((player, i) => {
        const isImposter = i === room.imposterIndex;
        const toSend = isImposter ? "IMPOSTER" : word;
        room.currentMap[player.id] = toSend;
        room.playerRoles[player.name] = toSend;
        io.to(player.id).emit("round", {
          word: toSend,
          remaining: nouns.length - room.usedWords.size
        });
      });
    }
  }

  // Uruchomienie funkcji sprawdzającej unikalność słowa
  getUniqueWord().catch(console.error);
}

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

  socket.on("join", ({ code, name }) => {
    const room = rooms[GAME_ROOM];
    if (code !== ACCESS_CODE) {
      socket.emit("error", { message: "Nieprawidłowy kod dostępu." });
      return;
    }

    const existingPlayer = room.players.find(p => p.name === name);
    if (existingPlayer) {
      existingPlayer.id = socket.id; // aktualizacja ID
    } else {
      room.players.push({ id: socket.id, name });
    }

    socket.join(GAME_ROOM);
    room.scores[socket.id] = room.scores[socket.id] || 0;
    sendPlayersList();

    // Jeśli gra trwa, to wyślij stan
    if (room.started) {
      socket.emit("started");

      // Jeśli gracz był impostorem, przypisz mu rolę "IMPOSTER"
      const currentWord = room.playerRoles[name] || room.currentWord;
      const actualWord = currentWord === "IMPOSTER" ? "IMPOSTER" : currentWord;

      socket.emit("joined", { currentWord: actualWord });
    } else {
      sock
