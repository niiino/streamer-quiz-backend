import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);

// 🔐 CORS – erlaubt Anfragen von deiner Vercel-Domain
const io = new Server(server, {
  cors: {
    origin: ["https://streamer-quiz.vercel.app"], // <- dein Frontend-Link
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// ✅ Testroute
app.get("/", (req, res) => {
  res.send("Streamer Quiz Backend läuft 🚀");
});

// 🧩 Socket.io Logik
io.on("connection", (socket) => {
  console.log("🔌 Neuer Client verbunden:", socket.id);

  socket.on("disconnect", () => {
    console.log("❌ Client getrennt:", socket.id);
  });

  // Beispiel: Broadcast an alle Spieler
  socket.on("quiz-update", (data) => {
    io.emit("quiz-update", data);
  });
});

// Render stellt PORT als Umgebungsvariable bereit
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
