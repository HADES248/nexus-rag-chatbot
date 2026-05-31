// FREE stack — no OpenAI needed:
//   YouTube  → youtube-transcript npm (free, no API key)
//   Instagram → yt-dlp downloads audio → Groq Whisper API (free tier)
//
// Groq also provides a free Whisper transcription endpoint.
// 7200 seconds of audio/day free — more than enough for demos.

import { execFile, exec } from "child_process";
import { promisify } from "util";
import { createReadStream, unlink } from "fs";
import path from "path";
import os from "os";
import { YoutubeTranscript } from "youtube-transcript";
import Groq from "groq-sdk";

const execFileAsync = promisify(execFile);
const execAsync    = promisify(exec);
const unlinkAsync  = promisify(unlink);

// Lazy Groq client — only created when needed
let _groq = null;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not set — get a free key at console.groq.com");
    }
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// ── ffmpeg auto-detection ─────────────────────────────────
let _ffmpegPath = null;
async function resolveFfmpegPath() {
  if (_ffmpegPath) return _ffmpegPath;
  if (process.env.FFMPEG_PATH) {
    _ffmpegPath = process.env.FFMPEG_PATH;
    console.log(`   ffmpeg: FFMPEG_PATH = ${_ffmpegPath}`);
    return _ffmpegPath;
  }
  try {
    const cmd = process.platform === "win32" ? "where.exe ffmpeg" : "which ffmpeg";
    const { stdout } = await execAsync(cmd);
    const detected = stdout.trim().split(/\r?\n/)[0].trim();
    if (detected) {
      _ffmpegPath = detected;
      console.log(`   ffmpeg: auto-detected = ${_ffmpegPath}`);
      return _ffmpegPath;
    }
  } catch (_) {}
  _ffmpegPath = "ffmpeg";
  console.warn("   ffmpeg: falling back to 'ffmpeg' on PATH");
  return _ffmpegPath;
}

// ── YouTube ───────────────────────────────────────────────
export async function fetchYouTubeTranscript(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript");
    console.log(`   YouTube transcript: ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn(`youtube-transcript failed (${err.message}), trying yt-dlp subtitles...`);
    return fetchTranscriptViaYtdlp(url);
  }
}

// ── Instagram ─────────────────────────────────────────────
export async function fetchInstagramTranscript(url) {
  const tmpDir  = os.tmpdir();
  const tmpBase = path.join(tmpDir, `reel_${Date.now()}`);
  const tmpMp3  = `${tmpBase}.mp3`;
  const ffmpegPath = await resolveFfmpegPath();

  console.log(`   Downloading Instagram audio...`);

  try {
    await execFileAsync(
      "yt-dlp",
      [
        "-x",
        "--audio-format",   "mp3",
        "--audio-quality",  "5",
        "--ffmpeg-location", ffmpegPath,
        "-o",               `${tmpBase}.%(ext)s`,
        "--no-playlist",
        url,
      ],
      { timeout: 180_000 }
    );

    // Use Groq's free Whisper endpoint instead of OpenAI's paid one
    console.log(`   Transcribing with Groq Whisper...`);
    const transcription = await getGroq().audio.transcriptions.create({
      file:  createReadStream(tmpMp3),
      model: "whisper-large-v3-turbo", // Groq's fast free Whisper model
    });

    const text = transcription.text?.trim() || "";
    console.log(`   Transcription: ${text.length} chars`);
    return text;

  } finally {
    for (const ext of ["mp3", "m4a", "webm", "opus", "part"]) {
      try { await unlinkAsync(`${tmpBase}.${ext}`); } catch (_) {}
    }
  }
}

// ── yt-dlp subtitle fallback for YouTube ─────────────────
async function fetchTranscriptViaYtdlp(url) {
  const tmpDir = os.tmpdir();
  const out    = path.join(tmpDir, `yt_sub_${Date.now()}`);

  await execFileAsync(
    "yt-dlp",
    ["--write-auto-sub", "--sub-lang", "en", "--sub-format", "vtt",
     "--skip-download", "-o", out, "--no-playlist", url],
    { timeout: 60_000 }
  );

  const { readFile } = await import("fs/promises");
  const vttPath = `${out}.en.vtt`;
  const vtt     = await readFile(vttPath, "utf8");
  try { await unlinkAsync(vttPath); } catch (_) {}
  return parseVttToText(vtt);
}

function parseVttToText(vtt) {
  const seen = new Set();
  const out  = [];
  for (const line of vtt.split("\n")) {
    const s = line.trim();
    if (!s || s === "WEBVTT" || /^\d{2}:\d{2}/.test(s) ||
        /^<\d{2}:\d{2}/.test(s) || /^\d+$/.test(s)) continue;
    const clean = s.replace(/<[^>]+>/g, "").trim();
    if (clean && !seen.has(clean)) { seen.add(clean); out.push(clean); }
  }
  return out.join(" ");
}

function extractYouTubeId(url) {
  for (const p of [/[?&]v=([a-zA-Z0-9_-]{11})/, /youtu\.be\/([a-zA-Z0-9_-]{11})/, /\/shorts\/([a-zA-Z0-9_-]{11})/]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}