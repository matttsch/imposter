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
  const [justJoined, setJustJoined] = useState(false);
  const [remaining, setRemaining] = useState(null);

  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io("https://imposter-014f.onrender.com", {
      autoConnect: false,
    });

    const socket = socketRef.current;

    socket.on("players", setPlayers);
    socket.on("round", ({ word, remaining }) => {
      setWord(word);
      setRemaining(remaining);
      setVoted(false);
      setResult(null);
      setJustJoined(false);
    });
    socket.on("started", () => setStarted(true));
    socket.on("ended", () => window.location.reload());
    socket.on("joined", ({ currentWord }) => {
      setStep("game");
      if (currentWord) {
        setWord(currentWord);
        setJustJoined(true);
      }
    });
    socket.on("error", (err) => {
      setError(err.message);
      setStep("code");
    });
    socket.on("scores", setScores);
    socket.on("result", setResult);

    socket.connect();
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    document.body.className = theme;
    document.documentElement.className = theme;
  }, [theme]);

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

  const leaveGame = () => {
    socketRef.current.emit("leave");
    window.location.reload();
  };

  const removePlayer = (id) => {
    socketRef.current.emit("kick", id);
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const themeLabel = theme === "dark" ? "Tryb jasny" : "Tryb ciemny";

  return (
    <div className={`container ${theme}`}>
      <h1 className="logo">
        IMPOSTER <span>by @matttsch</span>
      </h1>
      <button className="theme-toggle" onClick={toggleTheme}>
        {themeLabel}
      </button>

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
          <button className="btn" onClick={joinRoom}>
            Dołącz
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {step === "game" && (
        <div className="game-box">
          <div className="players-box">
            <strong>Gracze:</strong>
            <ul className="player-list">
              {players.map((p) => (
                <li key={p.id} className="player-row">
                  <div className="player-info">
                    <span
                      className="remove-btn"
                      onClick={() => removePlayer(p.id)}
                    >
                      ❌
                    </span>
                    <span className="player-name">{p.name}</span>
                  </div>
                  <div className="player-actions">
                    {started &&
                      !voted &&
                      !result &&
                      p.id !== socketRef.current.id &&
                      !justJoined &&
                      !players.find((pl) => pl.id === p.id && justJoined) && (
                        <button
                          className="vote-btn"
                          onClick={() => voteImposter(p.id)}
                        >
                          Głosuj
                        </button>
                      )}
                    {voted &&
                      result?.voteHistory.some(
                        (v) => v.from === name && v.to === p.name
                      ) && (
                        <em className="voted-note">
                          Zagłosowałeś na {p.name}
                        </em>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {!started ? (
            <button className="btn" onClick={startGame}>
              Start gry
            </button>
          ) : (
            <div className="round-box">
              <h2 className="word-display">{word}</h2>

              {result && (
                <div className="result-box">
                  {Array.isArray(result.votedOut) ? (
                    <h3>
                      Gracze wytypowali na IMPOSTERA:{" "}
                      {result.votedOut.join(", ")}
                    </h3>
                  ) : (
                    <h3>
                      Gracze wytypowali na IMPOSTERA: {result.votedOut}
                    </h3>
                  )}
                  <p>
                    Rzeczywisty imposter:{" "}
                    <strong>{result.imposterName}</strong>
                  </p>
                  <table className="vote-table">
                    <thead>
                      <tr>
                        <th>Gracz</th>
                        <th>Zagłosował na</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.voteHistory.map((v, idx) => {
                        const correct =
                          v.to === result.imposterName ||
                          (Array.isArray(result.imposterName) &&
                            result.imposterName.includes(v.to));
                        return (
                          <tr key={idx} className={correct ? "highlight" : ""}>
                            <td>{v.from}</td>
                            <td>{v.to}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button className="btn" onClick={nextRound}>
                    Kolejna runda
                  </button>
                </div>
              )}

              {!result && (
                <p>
                  {!voted
                    ? "Oddaj swój głos"
                    : "Czekamy na pozostałych graczy..."}
                </p>
              )}

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="btn end" onClick={endGame}>
                  Koniec gry
                </button>
                {remaining !== null && (
                  <small style={{ alignSelf: "center" }}>
                    Pozostało słów: {remaining}
                  </small>
                )}
              </div>
            </div>
          )}

          <button className="leave-btn" onClick={leaveGame}>
            Opuść grę
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
