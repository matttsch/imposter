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
    players: [],  // Gracze będą przechowywani po nazwach
    started: false,
    votes: {}, // Głosy będą przypisane do nazw graczy
    scores: {},
    imposterIndex: null,
    voteHistory: [],
    lastResult: null,
    usedWords: new Set(),
    currentWord: null,
    currentMap: {},
    playerRoles: {},  // Roles przypisane do nazw graczy
    playerStatus: {},  // Statusy graczy (ingame, voted, result)
  }
};

// Przechowywanie danych graczy (np. socket.id, status)
const playersData = {};

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

  const usedWordsCount = await wordsCollection.countDocuments();  // Metoda do zliczania dokumentów w kolekcji
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
      await getUniqueWord(); // Jeśli słowo już istnieje, losujemy inne
    } else {
      await wordsCollection.insertOne({ word: word });
      room.usedWords.add(word); // Dodajemy słowo do użytych słów w pokoju
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
        room.currentMap[player.name] = role;
        room.playerRoles[player.name] = role; 
        room.playerStatus[player.name] = "ingame";  // Ustawiamy status gracza na 'ingame'
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

  // Reconnect: Sprawdzamy, czy gracz już istnieje po reconnect
  socket.on("reconnect", () => {
    const room = rooms[GAME_ROOM];
    const playerName = Object.keys(playersData).find(name => playersData[name].id === socket.id);
    
    if (playerName) {
      console.log(`Gracz połączony: ${socket.id}, Imię: ${playerName}, Status: ${playersData[playerName].status}`);
      socket.emit("reconnect", {
        playerStatus: playersData[playerName].status,
        playerVote: playersData[playerName].vote,
        scores: room.scores
      });
    } else {
      console.log(`Nowy gracz połączony: ${socket.id}`);
    }
  });

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

    // Sprawdzamy, czy gracz o danym imieniu już istnieje w pokoju
    const existingPlayer = room.players.find(p => p.name === name);
    if (existingPlayer) {
      existingPlayer.id = socket.id;  // Zaktualizowanie ID
    } else {
      room.players.push({ id: socket.id, name });
    }

    socket.join(GAME_ROOM);
    room.scores[name] = room.scores[name] || 0;
    room.playerStatus[name] = room.playerStatus[name] || "ingame";  // Przypisujemy domyślny status "ingame"
    playersData[name] = { id: socket.id, status: room.playerStatus[name], vote: null }; // Dodajemy dane gracza
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
    room.players.forEach((player) => {
      room.playerStatus[player.name] = "ingame";
    });

    io.to(GAME_ROOM).emit("started");
    sendNewRound();
  });

  socket.on("vote", (votedName) => {  
    const room = rooms[GAME_ROOM];
    const playerName = room.players.find(p => p.id === socket.id).name;

    room.votes[playerName] = { votedName, playerName };
    room.voteHistory.push({ from: playerName, to: votedName, playerName });

    room.playerStatus[playerName] = "voted";
    playersData[playerName].vote = votedName; // Przechowujemy głos gracza

    const totalVotes = Object.keys(room.votes).length;
    const totalPlayers = room.players.length;

    if (totalVotes === totalPlayers) {
      const voteCounts = {};

      Object.values(room.votes).forEach(({ votedName }) => {
        voteCounts[votedName] = (voteCounts[votedName] || 0) + 1;
      });

      const maxVotes = Math.max(...Object.values(voteCounts));
      const topVotedNames = Object.entries(voteCounts)
        .filter(([_, v]) => v === maxVotes)
        .map(([name]) => name);

      const votedOutNames = topVotedNames;
      const imposter = room.players[room.imposterIndex];

      if (topVotedNames.includes(imposter.name)) {
        for (const [voterName, votedName] of Object.entries(room.votes)) {
          if (votedName === imposter.name) {
            room.scores[voterName] = (room.scores[voterName] || 0) + 1;
          }
        }
      } else {
        room.scores[imposter.name] = (room.scores[imposter.name] || 0) + 1;
      }

      room.lastResult = {
        votedOut: votedOutNames.length === 1 ? votedOutNames[0] : votedOutNames,
        imposterName: imposter.name,
        voteHistory: room.voteHistory.map(({ from, to, playerName }) => {
          return { from, to, playerName };
        })
      };

      room.players.forEach((player) => {
        room.playerStatus[player.name] = "result";  // Ustawiamy status na 'result' po zakończeniu głosowania
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
      playerStatus: {}
    };
    io.to(GAME_ROOM).emit("ended");
  });

  socket.on("kick", (name) => {
    const room = rooms[GAME_ROOM];
    room.players = room.players.filter(p => p.name !== name);
    delete room.scores[name];
    delete room.votes[name];
    io.to(name).emit("ended");
    sendPlayersList();
  });

  socket.on("disconnect", () => {
    // nie usuwamy z players, bo reconnect
  });
});

// Połączenie z MongoDB
client.connect()
  .then(() => {
    console.log("Połączono z MongoDB!");
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch(console.error);
