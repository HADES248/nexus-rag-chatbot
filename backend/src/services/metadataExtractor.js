// src/services/metadataExtractor.js
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, "../../cookies/youtube_cookies.txt");

// yt-dlp runtime name differs by OS:
//   Windows local: "nodejs"
//   Render (Linux): "node"
const JS_RUNTIME = process.platform === "win32" ? "nodejs" : "node";

function getYouTubeArgs() {
  const args = ["--js-runtimes", JS_RUNTIME];
  if (existsSync(COOKIES_FILE)) {
    args.push("--cookies", COOKIES_FILE);
    console.log(`   Using cookies: ${COOKIES_FILE}`);
  } else {
    console.warn("   No cookies file found — YouTube may block with 429");
  }
  return args;
}

export function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/instagram\.com/.test(url)) return "instagram";
  return "unknown";
}

export async function extractMetadata(url, videoId) {
  const platform = detectPlatform(url);

  const args = [
    "--dump-json",
    "--no-playlist",
    "--skip-download",
    ...(platform === "youtube" ? getYouTubeArgs() : []),
    url,
  ];

  let rawJson;
  try {
    const { stdout } = await execFileAsync("yt-dlp", args, {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    rawJson = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(
      `yt-dlp failed for ${url}: ${err.message}\n` +
      "Make sure yt-dlp is installed: pip install yt-dlp"
    );
  }

  const views    = rawJson.view_count    || 0;
  const likes    = rawJson.like_count    || 0;
  const comments = rawJson.comment_count || 0;

  const engagementRate = views > 0
    ? (((likes + comments) / views) * 100).toFixed(4)
    : "0.0000";

  return {
    videoId,
    platform,
    url,
    title:         rawJson.title       || "Unknown",
    creator:       rawJson.uploader    || rawJson.channel       || "Unknown",
    creatorHandle: rawJson.uploader_id || rawJson.channel_id    || "Unknown",
    followerCount: rawJson.channel_follower_count || rawJson.uploader_follower_count || null,
    views,
    likes,
    comments,
    engagementRate: parseFloat(engagementRate),
    duration:    rawJson.duration    || 0,
    uploadDate:  rawJson.upload_date || null,
    description: rawJson.description || "",
    hashtags:    extractHashtags(rawJson.tags || [], rawJson.description || ""),
    thumbnail:   rawJson.thumbnail   || null,
  };
}

function extractHashtags(tags, description) {
  const fromTags = tags.filter((t) => t.startsWith("#")).map((t) => t.toLowerCase());
  const fromDesc = (description.match(/#\w+/g) || []).map((h) => h.toLowerCase());
  return [...new Set([...fromTags, ...fromDesc])];
}