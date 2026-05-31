import { Router } from "express";
import { extractMetadata, detectPlatform } from "../services/metadataExtractor.js";
import { fetchYouTubeTranscript, fetchInstagramTranscript } from "../services/transcriptFetcher.js";
import { chunkAndEmbed } from "../services/embedder.js";
import { getOrCreateSession } from "../services/ragGraph.js";

const router = Router();

const INGEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 mins

router.post("/ingest", async (req, res) => {
  req.setTimeout(INGEST_TIMEOUT_MS);
  res.setTimeout(INGEST_TIMEOUT_MS);

  const { urlA, urlB, sessionId } = req.body;

  if (!urlA || !urlB || !sessionId) {
    return res.status(400).json({ error: "Required fields: urlA, urlB, sessionId" });
  }

  // Early key check — fail fast with a clear message
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === "gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx") {
    return res.status(500).json({
      error: "GROQ_API_KEY is not set. Get a free key at console.groq.com and add it to backend/.env",
    });
  }

  const platformA = detectPlatform(urlA);
  const platformB = detectPlatform(urlB);

  if (platformA === "unknown" || platformB === "unknown") {
    return res.status(400).json({
      error: "Both URLs must be valid YouTube or Instagram URLs",
    });
  }

  console.log(`\n Ingest — session: ${sessionId}`);
  console.log(`   A (${platformA}): ${urlA}`);
  console.log(`   B (${platformB}): ${urlB}`);

  try {
    console.log(" Extracting metadata...");
    const [metaA, metaB] = await Promise.all([
      extractMetadata(urlA, "A"),
      extractMetadata(urlB, "B"),
    ]);
    console.log(`   metaA: ${metaA.title}`);
    console.log(`   metaB: ${metaB.title}`);

    console.log("Fetching transcripts...");
    const fetchTranscript = (url, platform) =>
      platform === "youtube"
        ? fetchYouTubeTranscript(url)
        : fetchInstagramTranscript(url);

    const [transcriptA, transcriptB] = await Promise.all([
      fetchTranscript(urlA, platformA),
      fetchTranscript(urlB, platformB),
    ]);

    console.log(`   transcriptA: ${transcriptA?.length ?? 0} chars`);
    console.log(`   transcriptB: ${transcriptB?.length ?? 0} chars`);

    if (!transcriptA || transcriptA.length < 20) {
      return res.status(422).json({
        error: "Could not get transcript for Video A. Make sure the video has captions or spoken audio.",
      });
    }
    if (!transcriptB || transcriptB.length < 20) {
      return res.status(422).json({
        error: "Could not get transcript for Video B. Make sure the reel has spoken audio.",
      });
    }

    console.log("Chunking + embedding...");
    const [chunksA, chunksB] = await Promise.all([
      chunkAndEmbed(transcriptA, metaA),
      chunkAndEmbed(transcriptB, metaB),
    ]);

    getOrCreateSession(sessionId, { A: metaA, B: metaB });

    const payload = {
      success: true,
      sessionId,
      videos: {
        A: { ...metaA, transcriptPreview: transcriptA.slice(0, 200) + "...", chunksStored: chunksA },
        B: { ...metaB, transcriptPreview: transcriptB.slice(0, 200) + "...", chunksStored: chunksB },
      },
    };

    console.log(`Ingest complete — A: ${chunksA} chunks, B: ${chunksB} chunks`);
    return res.json(payload);

  } catch (err) {
    console.error("Ingest failed:", err.stack || err.message);
    if (!res.headersSent) {
      return res.status(500).json({
        error: err.message || "Ingest failed",
        hint: "Check backend terminal for full error details.",
      });
    }
  }
});

export default router;