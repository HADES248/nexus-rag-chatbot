import "dotenv/config";
import express from "express";
import cors from "cors";
import ingestRouter from "./routes/ingest.js";
import chatRouter from "./routes/chat.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api", ingestRouter);
app.use("/api", chatRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    ts: new Date().toISOString(),
    groq: !!process.env.GROQ_API_KEY,
  });
});

app.use((err, req, res, _next) => {
  console.error("💥 Unhandled route error:", err.stack || err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled promise rejection:", reason);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Backend running at http://localhost:${PORT}`);
  console.log(`   GROQ_API_KEY:  ${process.env.GROQ_API_KEY ? "✅ set" : "❌ MISSING — get free key at console.groq.com"}`);
  console.log(`   FFMPEG_PATH:   ${process.env.FFMPEG_PATH || "(auto-detect)"}`);
  console.log(`   ChromaDB:      ${process.env.CHROMA_URL || "http://localhost:8000"}`);
  console.log(`   POST /api/ingest`);
  console.log(`   POST /api/chat\n`);
});