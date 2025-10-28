import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);

// 🔐 CORS – erlaubt Anfragen von allen Domains
const io = new Server(server, {
  cors: {
    origin: "*", // Erlaube alle Origins (für Development und Production)
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"], // Beide Transports erlauben
  allowEIO3: true, // Kompatibilität
});

app.use(cors());
app.use(express.json());

// -> Datenhaltung
const matches = {}; // { matchId: { players: [], state: {...} } }

// Hilfsfunktion: Generiere eine 6-stellige Match-ID
function generateMatchId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne O, 0, I, 1
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// ✅ Testrouten
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Streamer Quiz Backend läuft 🚀",
    matches: Object.keys(matches).length
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    matches: Object.keys(matches).length
  });
});

// 🧩 Socket.io Logik
io.on("connection", (socket) => {
  console.log("🔌 Neuer Client verbunden:", socket.id);
  console.log("📊 Transport:", socket.conn.transport.name);
  console.log("📊 Aktive Matches:", Object.keys(matches).length);

  // Neues Match erstellen
  socket.on("createMatch", (config, callback) => {
    console.log("📥 createMatch Request von:", socket.id);
    console.log("📥 Config:", config);

    try {
      const matchId = generateMatchId();
      console.log("🎲 Generierte matchId:", matchId);

      matches[matchId] = {
        id: matchId,
        host: socket.id,
        players: [],
        config: config || {},
        state: {
          revealed: {},
          showAnswer: {},
          playerScores: Array(8).fill(0),
          teamScores: Array(4).fill(0),
          playerNames: Array.from({ length: 8 }, (_, i) => `Player ${i + 1}`),
          playerImages: Array(8).fill(null),
        },
        createdAt: new Date(),
      };

      socket.join(matchId);
      console.log(`✅ Match erstellt: ${matchId} von ${socket.id}`);
      console.log(`📊 Total Matches: ${Object.keys(matches).length}`);

      // WICHTIG: Callback aufrufen!
      if (typeof callback === "function") {
        callback({ success: true, matchId });
        console.log(`📤 Response gesendet an ${socket.id}`);
      } else {
        console.error("❌ Callback ist keine Funktion!");
      }
    } catch (error) {
      console.error("❌ Fehler beim Erstellen des Matches:", error);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  // Spieler tritt Match bei
  socket.on("joinMatch", (matchId, playerName, callback) => {
    console.log(`👥 ${playerName} möchte Match ${matchId} beitreten`);

    if (!matches[matchId]) {
      console.error(`❌ Match ${matchId} existiert nicht`);
      if (typeof callback === "function") {
        callback({ success: false, error: "Match nicht gefunden" });
      } else {
        socket.emit("error", { message: "Match nicht gefunden" });
      }
      return;
    }

    matches[matchId].players.push({
      id: socket.id,
      name: playerName || "Unbekannt"
    });
    socket.join(matchId);

    // Sende aktuellen Match State an den neuen Spieler
    if (typeof callback === "function") {
      callback({ success: true, match: matches[matchId] });
    }

    // Broadcast an alle Spieler
    io.to(matchId).emit("matchUpdate", matches[matchId]);
    console.log(`✅ ${playerName} ist Match ${matchId} beigetreten`);
  });

  // Punkte ändern
  socket.on("changeScore", ({ matchId, playerId, delta, newScore }) => {
    const match = matches[matchId];
    if (!match) {
      console.error(`❌ Match ${matchId} nicht gefunden`);
      return;
    }

    console.log(`🎯 Score Update: Match ${matchId}, Player ${playerId}, Delta ${delta}`);
    io.to(matchId).emit("scoreUpdate", { playerId, delta, newScore });
  });

  // Konfiguration aktualisieren (vom Host)
  socket.on("updateConfig", ({ matchId, config }) => {
    const match = matches[matchId];
    if (!match) {
      console.error(`❌ Match ${matchId} nicht gefunden`);
      return;
    }

    console.log(`⚙️ Config Update für Match ${matchId}:`, config);
    match.config = { ...match.config, ...config };

    // An alle Spieler broadcasten
    io.to(matchId).emit("matchUpdate", match);
  });

  // Spielzustand aktualisieren (revealed, showAnswer, scores)
  socket.on("updateGameState", ({ matchId, state }) => {
    const match = matches[matchId];
    if (!match) {
      console.error(`❌ Match ${matchId} nicht gefunden`);
      return;
    }

    console.log(`🎮 Game State Update für Match ${matchId}`);
    match.state = { ...match.state, ...state };

    // An alle Spieler broadcasten
    io.to(matchId).emit("matchUpdate", match);
  });

  // WebRTC Signaling
  socket.on("webrtc-offer", ({ matchId, targetSocketId, offer, slotIndex }) => {
    console.log(`📡 WebRTC Offer: ${socket.id} → ${targetSocketId} (slot ${slotIndex})`);
    io.to(targetSocketId).emit("webrtc-offer", {
      fromSocketId: socket.id,
      offer,
      slotIndex,
    });
  });

  socket.on("webrtc-answer", ({ matchId, targetSocketId, answer, slotIndex }) => {
    console.log(`📡 WebRTC Answer: ${socket.id} → ${targetSocketId} (slot ${slotIndex})`);
    io.to(targetSocketId).emit("webrtc-answer", {
      fromSocketId: socket.id,
      answer,
      slotIndex,
    });
  });

  socket.on("webrtc-ice-candidate", ({ matchId, targetSocketId, candidate, slotIndex }) => {
    console.log(`🧊 ICE Candidate: ${socket.id} → ${targetSocketId}`);
    io.to(targetSocketId).emit("webrtc-ice-candidate", {
      fromSocketId: socket.id,
      candidate,
      slotIndex,
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Client getrennt:", socket.id);

    // Spieler aus allen Matches entfernen
    for (const [matchId, match] of Object.entries(matches)) {
      const initialLength = match.players.length;
      match.players = match.players.filter((p) => p.id !== socket.id);

      if (match.players.length < initialLength) {
        console.log(`🔄 Spieler ${socket.id} aus Match ${matchId} entfernt`);
        io.to(matchId).emit("matchUpdate", match);

        // Notify others that this peer disconnected
        io.to(matchId).emit("peer-disconnected", { socketId: socket.id });
      }

      // Host verlässt? Match löschen
      if (match.host === socket.id) {
        console.log(`🗑️ Host hat Match ${matchId} verlassen - lösche Match`);
        delete matches[matchId];
      }
    }
  });
});

// Render stellt PORT als Umgebungsvariable bereit
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
