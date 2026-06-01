import { Router } from "express";
import { extractMetadata, detectPlatform } from "../services/metadataExtractor.js";
import { fetchYouTubeTranscript, fetchInstagramTranscript } from "../services/transcriptFetcher.js";
import { chunkAndEmbed } from "../services/embedder.js";
import { getOrCreateSession } from "../services/ragGraph.js";

const router = Router();

router.post("/ingest", async (req, res) => {
  req.setTimeout(10 * 60 * 1000);
  res.setTimeout(10 * 60 * 1000);

  const { urlA, urlB, sessionId } = req.body;

  if (!urlA || !urlB || !sessionId) {
    return res.status(400).json({ error: "Required: urlA, urlB, sessionId" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not set in environment" });
  }

  if (!process.env.YOUTUBE_API_KEY) {
    return res.status(500).json({ error: "YOUTUBE_API_KEY not set in environment" });
  }

  const platformA = detectPlatform(urlA);
  const platformB = detectPlatform(urlB);

  if (platformA === "unknown" || platformB === "unknown") {
    return res.status(400).json({ error: "Both URLs must be YouTube or Instagram" });
  }

  console.log(`\n Ingest — session: ${sessionId}`);
  console.log(`   A (${platformA}): ${urlA}`);
  console.log(`   B (${platformB}): ${urlB}`);

  try {
    // Step 1: Metadata
    console.log("Extracting metadata...");
    const [metaA, metaB] = await Promise.all([
      extractMetadata(urlA, "A"),
      extractMetadata(urlB, "B"),
    ]);
    console.log(`   A: ${metaA.title}`);
    console.log(`   B: ${metaB.title}`);

    // Step 2: Transcripts — sequential to avoid memory spikes
    // (two simultaneous audio downloads can OOM on Render free tier)
    console.log("Fetching transcript A...");
    const fetchFn = (url, platform) =>
      platform === "youtube" ? fetchYouTubeTranscript(url) : fetchInstagramTranscript(url);

    const transcriptA = await fetchFn(urlA, platformA);
    console.log("Fetching transcript B...");
    const transcriptB = await fetchFn(urlB, platformB);

    console.log(`   A: ${transcriptA?.length ?? 0} chars`);
    console.log(`   B: ${transcriptB?.length ?? 0} chars`);

    if (!transcriptA || transcriptA.length < 20) {
      return res.status(422).json({ error: "Could not get transcript for Video A" });
    }
    if (!transcriptB || transcriptB.length < 20) {
      return res.status(422).json({ error: "Could not get transcript for Video B" });
    }

    // Step 3: Embed
    console.log("Chunking + embedding...");
    const [chunksA, chunksB] = await Promise.all([
      chunkAndEmbed(transcriptA, metaA),
      chunkAndEmbed(transcriptB, metaB),
    ]);

    // Step 4: Save session
    getOrCreateSession(sessionId, { A: metaA, B: metaB });

    console.log(`Done — A: ${chunksA} chunks, B: ${chunksB} chunks`);

    return res.json({
      success: true,
      sessionId,
      videos: {
        A: { ...metaA, transcriptPreview: transcriptA.slice(0, 200) + "...", chunksStored: chunksA },
        B: { ...metaB, transcriptPreview: transcriptB.slice(0, 200) + "...", chunksStored: chunksB },
      },
    });

  } catch (err) {
    // Log full stack — critical for debugging on Render
    console.error("Ingest failed:", err.stack || err.message);

    // Always return JSON — never let connection drop silently (causes ECONNRESET)
    if (!res.headersSent) {
      return res.status(500).json({
        error: err.message || "Ingest failed",
        hint: "Check Render logs for full stack trace",
      });
    }
  }
});

export default router;