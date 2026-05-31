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

// "nodejs" on Windows, "node" on Linux (Render)
const JS_RUNTIME = process.platform === "win32" ? "nodejs" : "node";

function getYouTubeArgs() {
  const args = ["--js-runtimes", JS_RUNTIME];
  if (existsSync(COOKIES_FILE)) args.push("--cookies", COOKIES_FILE);
  return args;
}

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

  // Primary: youtube-transcript npm — no yt-dlp, no bot detection issues
  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map((c) => c.text).join(" ").trim();
    if (!text) throw new Error("Empty transcript");
    console.log(`   ✅ YouTube transcript: ${text.length} chars`);
    return text;
  } catch (err) {
    console.warn(`   youtube-transcript failed: ${err.message}, trying yt-dlp...`);
  }

  // Fallback: yt-dlp with correct runtime + cookies
  const tmpDir = os.tmpdir();
  const out    = path.join(tmpDir, `yt_sub_${Date.now()}`);

  await execFileAsync(
    "yt-dlp",
    [
      "--write-auto-sub", "--sub-lang", "en",
      "--sub-format", "vtt", "--skip-download",
      ...getYouTubeArgs(),
      "-o", out, "--no-playlist", url,
    ],
    { timeout: 60_000 }
  );

  const { readFile } = await import("fs/promises");
  const vttPath = `${out}.en.vtt`;
  const vtt = await readFile(vttPath, "utf8");
  try { await unlinkAsync(vttPath); } catch (_) {}
  return parseVttToText(vtt);
}

// ── Instagram ─────────────────────────────────────────────
export async function fetchInstagramTranscript(url) {
  const tmpDir  = os.tmpdir();
  const tmpBase = path.join(tmpDir, `reel_${Date.now()}`);

  console.log("   Downloading Instagram audio...");

  await execFileAsync(
    "yt-dlp",
    ["-f", "bestaudio", "-o", `${tmpBase}.%(ext)s`,
     "--no-playlist", "--no-warnings", url],
    { timeout: 180_000 }
  );

  const audioFile = await findDownloadedFile(tmpBase);
  if (!audioFile) throw new Error("yt-dlp ran but no audio file was created");

  console.log(`   Transcribing ${path.basename(audioFile)} with Groq Whisper...`);

  const transcription = await getGroq().audio.transcriptions.create({
    file: createReadStream(audioFile),
    model: "whisper-large-v3-turbo",
  });

  const text = transcription.text?.trim() || "";
  console.log(`   ✅ Transcription: ${text.length} chars`);
  await cleanupTempFiles(tmpBase);
  return text;
}

// ── Helpers ───────────────────────────────────────────────
async function findDownloadedFile(tmpBase) {
  const dir = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  try {
    const files = await readdir(dir);
    const match = files.find((f) => f.startsWith(base) && !f.endsWith(".part"));
    return match ? path.join(dir, match) : null;
  } catch { return null; }
}

async function cleanupTempFiles(tmpBase) {
  const dir = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith(base)) try { await unlinkAsync(path.join(dir, f)); } catch (_) {}
    }
  } catch (_) {}
}

function parseVttToText(vtt) {
  const seen = new Set();
  const out = [];
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