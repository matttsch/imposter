// client/src/App.js
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
  const [result, setResult] = useState(null);
  const [theme, setTheme] = useState("dark");

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
      setResult(null);
    });
    socket.on("started", () => setStarted(true));
    socket.on("ended", () => window.location.reload());
    socket.on("joined", () => setStep("game"));
    socket.on("error", (err) => {
      setError(err.message);
      setStep("code");
    });
    socket.on("scores", setScores);
    socket.on("result", setResult);

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

  const nextRound = () => {
    setResult(null);
    socketRef.current.emit("next");
  };

  const endGame = () => socketRef.current.emit("end");

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <div className={`container ${theme}`}>
      <h1 className="logo">IMPOSTER <span>by @matttsch</span></h1>
      <button className="btn" onClick={toggleTheme}>Przełącz motyw</button>

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
                  {started && !voted && !result && p.id !== socketRef.current.id && (
                    <button className="vote-btn" onClick={() => voteImposter(p.id)}>Głosuj</button>
                  )}
                  {voted && result?.voteHistory.some(v => v.from === name && v.to === p.name) && (
                    <em> — zagłosowałeś na {p.name}</em>
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

              {result && (
                <div className="result-box">
                  <h3>Gracze wytypowali na IMPOSTERA: {result.votedOut}</h3>
                  <p>Rzeczywisty imposter: <strong>{result.imposterName}</strong></p>
                  <ul>
                    {result.voteHistory.map((v, idx) => (
                      <li key={idx}>{v.from} → {v.to}</li>
                    ))}
                  </ul>
                  <button className="btn" onClick={nextRound}>Kolejna runda</button>
                </div>
              )}

              {!result && <p>{!voted ? "Oddaj swój głos" : "Czekamy na pozostałych graczy..."}</p>}

              <button className="btn end" onClick={endGame}>Koniec gry</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
