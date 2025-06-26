io.on("connection", (socket) => {
  console.log(`Gracz połączony: ${socket.id}`);

  // Dodajemy użytkownika do gry
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

    // Jeśli gra trwa, wyślij pełny stan gry
    if (room.started) {
      socket.emit("started");
      const currentWord = room.playerRoles[name] || room.currentWord;
      const actualWord = currentWord === "IMPOSTER" ? "IMPOSTER" : currentWord;
      const playerState = room.playerStates[socket.id] || "before_vote"; // Stan gracza
      socket.emit("joined", { currentWord: actualWord, playerState });
    } else {
      socket.emit("joined", {});
    }
  });

  // Głosowanie
  socket.on("vote", (votedId) => {
    const room = rooms[GAME_ROOM];
    if (!room.players.some(p => p.id === socket.id)) return;
    if (!room.players.some(p => p.id === votedId)) return;

    // Gracz nie może zagłosować, jeśli już to zrobił
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

  // Kolejna runda
  socket.on("next", () => {
    sendNewRound();
  });

  // Kończenie gry
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

  socket.on("disconnect", () => {
    // nie usuwamy z players, bo reconnect
  });
});
