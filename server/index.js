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
      existingPlayer.id = socket.id;  // aktualizacja ID
    } else {
      room.players.push({ id: socket.id, name });
    }

    socket.join(GAME_ROOM);
    room.scores[socket.id] = room.scores[socket.id] || 0;
    sendPlayersList();

    // Jeśli gra już się rozpoczęła, sprawdzamy stan głosowania
    if (room.started) {
      socket.emit("started");

      // Jeśli gracz był impostorem lub po zakończeniu głosowania
      const currentWord = room.playerRoles[name] || room.currentWord;
      const actualWord = currentWord === "IMPOSTER" ? "IMPOSTER" : currentWord;

      // Jeśli gra już zakończona, wyślij tabelę wyników
      if (room.lastResult) {
        socket.emit("result", room.lastResult);
        socket.emit("scores", room.scores);
      }

      socket.emit("joined", { currentWord: actualWord, playerState: room.playerStates[socket.id] });
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

  // Głosowanie
  socket.on("vote", (votedId) => {
    const room = rooms[GAME_ROOM];
    if (!room.players.some(p => p.id === socket.id)) return;
    if (!room.players.some(p => p.id === votedId)) return;

    // Sprawdzamy, czy gracz już zagłosował
    if (room.playerStates[socket.id] === "voted") {
      socket.emit("error", { message: "Już zagłosowałeś!" });
      return;
    }

    room.votes[socket.id] = votedId;
    room.voteHistory.push({ from: socket.id, to: votedId });
    room.playerStates[socket.id] = "voted";  // Zmiana stanu gracza na "voted"

    // Sprawdzamy, czy wszyscy zagłosowali
    const allVoted = Object.keys(room.votes).length === room.players.length;
    if (allVoted) {
      room.playerStates = {};  // Resetujemy stany graczy na "after_vote"
      room.players.forEach(player => room.playerStates[player.id] = "after_vote");

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
      playerStates: {}
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

// Połączenie z MongoDB
client.connect()
  .then(() => {
    console.log("Połączono z MongoDB!");
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch(console.error);
