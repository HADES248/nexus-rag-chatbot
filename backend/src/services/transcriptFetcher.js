// src/services/transcriptFetcher.js
import { execFile } from "child_process";
import { promisify } from "util";
import { createReadStream, createWriteStream, unlink } from "fs";
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
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript");
    console.log(`YouTube transcript via subtitles: ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn(`   Subtitles unavailable: ${err.message}`);
    console.log(`   Falling back to ytdl-core + Whisper...`);
  }

  const tmpFile = path.join(os.tmpdir(), `yt_audio_${Date.now()}.webm`);
  try {
    await downloadWithYtdlCore(url, tmpFile);
    return await transcribeFile(tmpFile);
  } catch (ytdlErr) {
    console.warn(`ytdl-core failed: ${ytdlErr.message}`);
    console.log(`Last resort: yt-dlp fallback...`);
    return await downloadWithYtdlp(url, true);
  } finally {
    try { await unlinkAsync(tmpFile); } catch (_) {}
  }
}

// ── Instagram ─────────────────────────────────────────────
export async function fetchInstagramTranscript(url) {
  console.log("Downloading Instagram audio via yt-dlp...");
  return await downloadWithYtdlp(url, false);
}

// ── ytdl-core download (pure Node, no bot detection) ──────
async function downloadWithYtdlCore(url, tmpFile) {
  // Dynamic import so server still starts even if package has issues
  const { default: ytdl } = await import("@distube/ytdl-core");

  if (!ytdl.validateURL(url)) throw new Error(`Invalid YouTube URL: ${url}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("ytdl-core download timed out after 3 minutes"));
    }, 180_000);

    const stream = ytdl(url, {
      quality: "highestaudio",
      filter:  "audioonly",
    });

    const file = createWriteStream(tmpFile);

    stream.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`ytdl-core stream error: ${err.message}`));
    });

    file.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`File write error: ${err.message}`));
    });

    file.on("finish", () => {
      clearTimeout(timeout);
      resolve();
    });

    stream.pipe(file);
  });
}

async function downloadWithYtdlp(url, isYouTube) {
  const tmpBase = path.join(os.tmpdir(), `audio_${Date.now()}`);

  const args = [
    "-f", "bestaudio",
    "-o", `${tmpBase}.%(ext)s`,
    "--no-playlist",
    "--no-warnings",
    url,
  ];

  try {
    await execFileAsync("yt-dlp", args, { timeout: 180_000 });
    const audioFile = await findDownloadedFile(tmpBase);
    if (!audioFile) throw new Error("No audio file created by yt-dlp");
    console.log(`   Downloaded: ${path.basename(audioFile)}`);
    return await transcribeFile(audioFile);
  } finally {
    await cleanupTempFiles(tmpBase);
  }
}

// ── Groq Whisper transcription ────────────────────────────
async function transcribeFile(filePath) {
  console.log(`   Transcribing with Groq Whisper...`);
  const transcription = await getGroq().audio.transcriptions.create({
    file:  createReadStream(filePath),
    model: "whisper-large-v3-turbo",
  });
  const text = transcription.text?.trim() || "";
  if (!text) throw new Error("Whisper returned empty transcription");
  console.log(`Transcript: ${text.length} chars`);
  return text;
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