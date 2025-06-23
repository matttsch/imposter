import React, { useState, useEffect } from "react";
import io from "socket.io-client";

const socket = io("https://imposter-014f.onrender.com");


function App() {
  const [step, setStep] = useState("code");
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [players, setPlayers] = useState([]);
  const [word, setWord] = useState(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    socket.on("players", setPlayers);
    socket.on("round", ({ word }) => setWord(word));
    socket.on("started", () => setStarted(true));
    socket.on("ended", () => window.location.reload());
    return () => socket.disconnect();
  }, []);

  const joinRoom = () => {
    socket.emit("join", { roomCode, name });
    setStep("game");
  };

  const startGame = () => socket.emit("start");
  const nextRound = () => socket.emit("next");
  const endGame = () => socket.emit("end");

  return (
    <div style={{ padding: 30 }}>
      {step === "code" && (
        <div>
          <input placeholder="Kod pokoju" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <input placeholder="Imię" value={name} onChange={e => setName(e.target.value)} />
          <button onClick={joinRoom}>Dołącz</button>
        </div>
      )}

      {step === "game" && (
        <div>
          <h2>Pokój: {roomCode}</h2>
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            <strong>Gracze:</strong>
            <ul>
              {players.map(p => <li key={p.id}>{p.name}</li>)}
            </ul>
          </div>

          {!started ? (
            <button onClick={startGame}>Start gry</button>
          ) : (
            <div>
              <h1>{word}</h1>
              <button onClick={nextRound}>Kolejna runda</button>
              <button onClick={endGame}>Koniec gry</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;