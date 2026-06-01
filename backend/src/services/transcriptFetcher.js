// src/services/transcriptFetcher.js
import { execFile } from "child_process";
import { promisify } from "util";
import { createReadStream, unlink } from "fs";
import { readdir } from "fs/promises";
import path from "path";
import os from "os";
import { YoutubeTranscript } from "youtube-transcript";
import Groq from "groq-sdk";

const execFileAsync = promisify(execFile);
const unlinkAsync   = promisify(unlink);

let _groq = null;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set");
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// ── YouTube ───────────────────────────────────────────────
export async function fetchYouTubeTranscript(url) {
  // Clean URL — strip extra params that confuse yt-dlp
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // 1. youtube-transcript npm
  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript");
    console.log(`   ✅ youtube-transcript: ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn(`   youtube-transcript failed: ${err.message}`);
  }

  // 2. Supadata API
  const supKey = process.env.SUPADATA_API_KEY;
  if (supKey) {
    try {
      console.log(`   Trying Supadata for ${videoId}...`);

      const res = await fetch(
        `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=en&text=true`,
        { headers: { "x-api-key": supKey } }
      );

      console.log(`   Supadata status: ${res.status}`);
      const raw = await res.text();
      console.log(`   Supadata raw response: ${raw.slice(0, 300)}`);

      if (!res.ok) throw new Error(`Supadata ${res.status}: ${raw}`);

      let data;
      try { data = JSON.parse(raw); } catch { data = null; }

      let text = "";
      if (typeof raw === "string" && !raw.startsWith("{") && !raw.startsWith("[")) {
        // Plain text response
        text = raw.trim();
      } else if (data) {
        if (typeof data.content === "string") text = data.content;
        else if (Array.isArray(data.content)) text = data.content.map((c) => c.text || "").join(" ");
        else if (typeof data.transcript === "string") text = data.transcript;
        else if (typeof data.text === "string") text = data.text;
        else text = JSON.stringify(data);
      }

      text = text.trim();
      if (!text || text.length < 10) throw new Error("Supadata returned empty/invalid transcript");

      console.log(`   ✅ Supadata transcript: ${text.length} chars`);
      return text;

    } catch (err) {
      console.warn(`   Supadata failed: ${err.message}`);
    }
  } else {
    console.warn("   SUPADATA_API_KEY not set");
  }

  // 3. Nothing worked
  throw new Error(
    `Cannot get transcript for ${videoId}. ` +
    `Video may have no captions and server IP is blocked by YouTube. ` +
    `Add SUPADATA_API_KEY env var (free at supadata.ai) to fix this.`
  );
}

// ── Instagram ─────────────────────────────────────────────
export async function fetchInstagramTranscript(url) {
  const tmpDir  = os.tmpdir();
  const tmpBase = path.join(tmpDir, `reel_${Date.now()}`);

  console.log("   Downloading Instagram audio...");

  try {
    await execFileAsync(
      "yt-dlp",
      ["-f", "bestaudio", "-o", `${tmpBase}.%(ext)s`,
       "--no-playlist", "--no-warnings", url],
      { timeout: 180_000 }
    );

    const audioFile = await findDownloadedFile(tmpBase);
    if (!audioFile) throw new Error("No audio file created");

    console.log(`   Downloaded: ${path.basename(audioFile)}`);

    const transcription = await getGroq().audio.transcriptions.create({
      file: createReadStream(audioFile),
      model: "whisper-large-v3-turbo",
    });

    const text = transcription.text?.trim() || "";
    if (!text) throw new Error("Whisper returned empty transcription");
    console.log(`   ✅ Instagram transcript: ${text.length} chars`);
    return text;

  } finally {
    await cleanupTempFiles(tmpBase);
  }
}

// ── Helpers ───────────────────────────────────────────────
async function findDownloadedFile(tmpBase) {
  const dir  = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  try {
    const files = await readdir(dir);
    const match = files.find((f) => f.startsWith(base) && !f.endsWith(".part"));
    return match ? path.join(dir, match) : null;
  } catch { return null; }
}

async function cleanupTempFiles(tmpBase) {
  const dir  = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith(base)) {
        try { await unlinkAsync(path.join(dir, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

function extractYouTubeId(url) {
  for (const p of [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}