import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import "./App.css";

function App() {
  const [step, setStep] = useState("code");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [players, setPlayers] = useState([]);
  const [word, setWord] = useState(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(null);

  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io("https://imposter-014f.onrender.com", {
      autoConnect: false,
    });

    const socket = socketRef.current;

    socket.on("players", setPlayers);
    socket.on("round", ({ word }) => setWord(word));
    socket.on("started", () => setStarted(true));
    socket.on("ended", () => window.location.reload());
    socket.on("error", (err) => {
      setError(err.message);
      setStep("code");
    });

    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinRoom = () => {
    setError(null);
    socketRef.current.emit("join", { code, name });
  };

  const startGame = () => {
    setError(null);
    socketRef.current.emit("start");
  };

  const nextRound = () => socketRef.current.emit("next");
  const endGame = () => socketRef.current.emit("end");

  return (
    <div className="container">
      {step === "code" && (
        <div className="login-box">
          <input
            className="input"
            placeholder="Kod dostępu"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            className="input"
            placeholder="Imię"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn" onClick={joinRoom}>Dołącz</button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {step === "game" && (
        <div className="game-box">
          <h2>Pokój gry</h2>
          <div className="players-box">
            <strong>Gracze:</strong>
            <ul>
              {players.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          </div>

          {!started ? (
            <button className="btn" onClick={startGame} disabled={started}>
              Start gry
            </button>
          ) : (
            <div>
              <h1 className="word-display">{word}</h1>
              <button className="btn" onClick={nextRound}>Kolejna runda</button>
              <button className="btn end" onClick={endGame}>Koniec gry</button>
            </div>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default App;
