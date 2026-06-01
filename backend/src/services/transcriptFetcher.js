// src/services/transcriptFetcher.js
// ─────────────────────────────────────────────────────────
// YouTube  → youtube-transcript npm (hits subtitle endpoint directly,
//            no yt-dlp, no bot detection, works on any server IP)
// Instagram → yt-dlp downloads raw audio → Groq Whisper (free)
// ─────────────────────────────────────────────────────────
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
// Uses youtube-transcript npm only — no yt-dlp, no cookies needed.
// This hits YouTube's subtitle/caption endpoint directly which is
// never blocked by YouTube's bot detection on server IPs.
export async function fetchYouTubeTranscript(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript returned");
    console.log(`   ✅ YouTube transcript: ${text.length} chars`);
    return text;
  } catch (err) {
    throw new Error(
      `Could not fetch YouTube transcript for ${videoId}: ${err.message}. ` +
      `Make sure the video has captions enabled (auto-generated counts).`
    );
  }
}

// ── Instagram ─────────────────────────────────────────────
// yt-dlp downloads raw audio (no ffmpeg conversion needed),
// then Groq Whisper transcribes it for free.
export async function fetchInstagramTranscript(url) {
  const tmpDir  = os.tmpdir();
  const tmpBase = path.join(tmpDir, `reel_${Date.now()}`);

  console.log("   Downloading Instagram audio via yt-dlp...");

  try {
    await execFileAsync(
      "yt-dlp",
      [
        "-f", "bestaudio",
        "-o", `${tmpBase}.%(ext)s`,
        "--no-playlist",
        "--no-warnings",
        url,
      ],
      { timeout: 180_000 }
    );

    const audioFile = await findDownloadedFile(tmpBase);
    if (!audioFile) throw new Error("yt-dlp ran but no audio file was created");

    console.log(`   Downloaded: ${path.basename(audioFile)}, transcribing...`);

    const transcription = await getGroq().audio.transcriptions.create({
      file:  createReadStream(audioFile),
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