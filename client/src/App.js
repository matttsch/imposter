import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";

function App() {
  const [step, setStep] = useState("code");
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [players, setPlayers] = useState([]);
  const [word, setWord] = useState(null);
  const [started, setStarted] = useState(false);

  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io("https://imposter-014f.onrender.com", {
      autoConnect: false,
    });

    const socket = socketRef.current;

    console.log("Setting up socket event listeners");

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connect_error:", err);
    });

    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
    });

    socket.on("players", (data) => {
      console.log("Received players list:", data);
      setPlayers(data);
    });

    socket.on("round", ({ word }) => {
      console.log("Received round with word:", word);
      setWord(word);
    });

    socket.on("started", () => {
      console.log("Game started");
      setStarted(true);
    });

    socket.on("ended", () => {
      console.log("Game ended, reloading");
      window.location.reload();
    });

    socket.connect();

    return () => {
      console.log("Cleaning up socket");
      socket.disconnect();
    };
  }, []);

  const joinRoom = () => {
    console.log("Joining room:", roomCode, "with name:", name);
    socketRef.current.emit("join", { roomCode, name });
    setStep("game");
  };

  const startGame = () => {
    console.log("Starting game");
    socketRef.current.emit("start");
  };

  const nextRound = () => {
    console.log("Next round requested");
    socketRef.current.emit("next");
  };

  const endGame = () => {
    console.log("Ending game");
    socketRef.current.emit("end");
  };

  return (
    <div style={{ padding: 30 }}>
      {step === "code" && (
        <div>
          <input
            placeholder="Kod pokoju"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
          />
          <input
            placeholder="Imię"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={joinRoom}>Dołącz</button>
        </div>
      )}

      {step === "game" && (
        <div>
          <h2>Pokój: {roomCode}</h2>
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            <strong>Gracze:</strong>
            <ul>
              {players.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
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
