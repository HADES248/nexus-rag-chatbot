// src/services/transcriptFetcher.js
// ─────────────────────────────────────────────────────────
// YouTube:
//   1st try → youtube-transcript npm (fastest, no download needed)
//   2nd try → yt-dlp download audio → Groq Whisper (handles any video)
//
// Instagram:
//   yt-dlp download audio → Groq Whisper
//
// This means ANY video works — even ones with transcripts disabled.
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
export async function fetchYouTubeTranscript(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

  // Primary: youtube-transcript — instant, no download
  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript");
    console.log(`   ✅ YouTube transcript via subtitles: ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn(`   Subtitles unavailable (${err.message})`);
    console.log(`   Falling back to audio download + Whisper...`);
  }

  // Fallback: download audio → Groq Whisper
  // Works for ANY YouTube video regardless of caption settings
  return transcribeViaWhisper(
    url,
    ["bestaudio", "--no-playlist", "--no-warnings"]
  );
}

// ── Instagram ─────────────────────────────────────────────
export async function fetchInstagramTranscript(url) {
  console.log("   Downloading Instagram audio...");
  return transcribeViaWhisper(
    url,
    ["-f", "bestaudio", "--no-playlist", "--no-warnings"]
  );
}

// ── Shared: download audio → Groq Whisper ─────────────────
async function transcribeViaWhisper(url, extraArgs = []) {
  const tmpDir  = os.tmpdir();
  const tmpBase = path.join(tmpDir, `audio_${Date.now()}`);

  try {
    await execFileAsync(
      "yt-dlp",
      ["-f", "bestaudio", "-o", `${tmpBase}.%(ext)s`, ...extraArgs, url],
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