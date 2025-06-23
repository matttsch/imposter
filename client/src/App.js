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
  const [scores, setScores] = useState({});
  const [voted, setVoted] = useState(false);

  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io("https://imposter-014f.onrender.com", {
      autoConnect: false,
    });

    const socket = socketRef.current;

    socket.on("players", setPlayers);
    socket.on("round", ({ word }) => {
      setWord(word);
      setVoted(false);
    });
    socket.on("started", () => setStarted(true));
    socket.on("ended", () => window.location.reload());
    socket.on("joined", () => setStep("game"));
    socket.on("error", (err) => {
      setError(err.message);
      setStep("code");
    });
    socket.on("scores", setScores);

    socket.connect();
    return () => socket.disconnect();
  }, []);

  const joinRoom = () => {
    setError(null);
    socketRef.current.emit("join", { code, name });
  };

  const startGame = () => {
    setError(null);
    socketRef.current.emit("start");
  };

  const voteImposter = (id) => {
    if (!voted) {
      socketRef.current.emit("vote", id);
      setVoted(true);
    }
  };

  const endGame = () => socketRef.current.emit("end");

  return (
    <div className="container dark">
      <h1 className="logo">IMPOSTER <span>by @matttsch</span></h1>

      {step === "code" && (
        <div className="login-box">
          <input className="input" placeholder="Kod dostępu" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="Imię" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={joinRoom}>Dołącz</button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {step === "game" && (
        <div className="game-box">
          <div className="players-box">
            <strong>Gracze:</strong>
            <ul>
              {players.map((p) => (
                <li key={p.id}>
                  {p.name} — <small>{scores[p.id] || 0} pkt</small>
                  {started && !voted && p.id !== socketRef.current.id && (
                    <button className="vote-btn" onClick={() => voteImposter(p.id)}>Głosuj</button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {!started ? (
            <button className="btn" onClick={startGame}>Start gry</button>
          ) : (
            <div className="round-box">
              <h2 className="word-display">{word}</h2>
              <button className="btn end" onClick={endGame}>Koniec gry</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
