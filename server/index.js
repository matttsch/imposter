// Zmiany w kodzie serwera (index.js)

// Funkcja do sprawdzenia, czy wszyscy gracze zagłosowali
function allPlayersVoted() {
  const room = rooms[GAME_ROOM];
  const totalPlayers = room.players.length;
  const totalVotes = Object.keys(room.votes).length;

  // Zwraca true, jeśli wszyscy gracze zagłosowali
  return totalVotes === totalPlayers;
}

// Logika zakończenia głosowania
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
  room.playerStates[socket.id] = "voted"; // Ustawiamy stan na "voted"

  // Sprawdzamy, czy wszyscy zagłosowali
  if (allPlayersVoted()) {
    room.playerStates = {};  // Resetujemy stany na "after_vote"
    room.players.forEach(player => {
      room.playerStates[player.id] = "after_vote";
    });

    // Przetwarzamy wyniki głosowania
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

    // Nagroda za wskazanie impostera lub za pozostanie niewykrytym
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
