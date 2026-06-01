// src/services/transcriptFetcher.js
import { execFile } from "child_process";
import { promisify } from "util";
import { createReadStream, unlink, existsSync } from "fs";
import { readdir } from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { YoutubeTranscript } from "youtube-transcript";
import Groq from "groq-sdk";

const execFileAsync = promisify(execFile);
const unlinkAsync   = promisify(unlink);
const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE  = path.join(__dirname, "../../cookies/youtube_cookies.txt");

let _groq = null;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set");
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// Returns cookies args only if the file exists
function cookiesArgs() {
  return existsSync(COOKIES_FILE) ? ["--cookies", COOKIES_FILE] : [];
}

// ── YouTube ───────────────────────────────────────────────
export async function fetchYouTubeTranscript(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

  // Primary: youtube-transcript npm — instant, no download needed
  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript");
    console.log(`   ✅ YouTube transcript via subtitles: ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn(`   Subtitles unavailable: ${err.message}`);
    console.log(`   Falling back to audio download + Whisper...`);
  }

  // Fallback: download audio → Groq Whisper
  return downloadAndTranscribe(url, true);
}

// ── Instagram ─────────────────────────────────────────────
export async function fetchInstagramTranscript(url) {
  console.log("   Downloading Instagram audio...");
  return downloadAndTranscribe(url, false);
}

// ── Core: download audio → Whisper ────────────────────────
async function downloadAndTranscribe(url, isYouTube) {
  const tmpDir  = os.tmpdir();
  const tmpBase = path.join(tmpDir, `audio_${Date.now()}`);

  // Build args cleanly — no spreading format strings as positional args
  const args = [
    "-f", "bestaudio",
    "-o", `${tmpBase}.%(ext)s`,
    "--no-playlist",
    "--no-warnings",
  ];

  // YouTube needs cookies on server IPs to bypass bot detection
  if (isYouTube) {
    args.push(...cookiesArgs());
  }

  // URL always goes last
  args.push(url);

  console.log(`   yt-dlp args: ${args.join(" ")}`);

  try {
    await execFileAsync("yt-dlp", args, { timeout: 180_000 });

    const audioFile = await findDownloadedFile(tmpBase);
    if (!audioFile) throw new Error("yt-dlp ran but no audio file was created");

    console.log(`   Downloaded: ${path.basename(audioFile)}, transcribing...`);

    const transcription = await getGroq().audio.transcriptions.create({
      file:  createReadStream(audioFile),
      model: "whisper-large-v3-turbo",
    });

    const text = transcription.text?.trim() || "";
    if (!text) throw new Error("Whisper returned empty transcription");
    console.log(`   ✅ Whisper transcript: ${text.length} chars`);
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