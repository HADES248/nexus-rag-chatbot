// src/services/metadataExtractor.js
// ─────────────────────────────────────────────────────────
// YouTube  → YouTube Data API v3 (free, 10k units/day, never 429'd)
// Instagram → yt-dlp (only tool that works for Instagram)
//
// WHY SWAP YOUTUBE TO DATA API?
//   Render's shared data center IPs are flagged by YouTube as bots.
//   yt-dlp + cookies doesn't reliably bypass IP-level blocking.
//   YouTube Data API v3 is an official API — no bot detection at all.
//   Free quota: 10,000 units/day. One video metadata call = 1 unit.
// ─────────────────────────────────────────────────────────
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/instagram\.com/.test(url)) return "instagram";
  return "unknown";
}

export async function extractMetadata(url, videoId) {
  const platform = detectPlatform(url);
  return platform === "youtube"
    ? extractYouTubeMetadata(url, videoId)
    : extractInstagramMetadata(url, videoId);
}

// ── YouTube — Data API v3 ─────────────────────────────────
async function extractYouTubeMetadata(url, videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "YOUTUBE_API_KEY is not set. Get a free key at console.cloud.google.com " +
      "→ Enable YouTube Data API v3 → Create Credentials → API Key"
    );
  }

  const ytVideoId = extractYouTubeId(url);
  if (!ytVideoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

  // Single API call gets everything: snippet + statistics + contentDetails
  // Cost: 1 unit (free quota = 10,000 units/day)
  const apiUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,statistics,contentDetails` +
    `&id=${ytVideoId}` +
    `&key=${apiKey}`;

  const res  = await fetch(apiUrl);
  const data = await res.json();

  if (data.error) {
    throw new Error(`YouTube API error: ${data.error.message}`);
  }

  if (!data.items || data.items.length === 0) {
    throw new Error(`Video not found or is private: ${ytVideoId}`);
  }

  const item       = data.items[0];
  const snippet    = item.snippet    || {};
  const stats      = item.statistics || {};
  const details    = item.contentDetails || {};

  const views    = parseInt(stats.viewCount    || "0", 10);
  const likes    = parseInt(stats.likeCount    || "0", 10);
  const comments = parseInt(stats.commentCount || "0", 10);

  const engagementRate = views > 0
    ? (((likes + comments) / views) * 100).toFixed(4)
    : "0.0000";

  // Parse ISO 8601 duration (PT4M13S → 253 seconds)
  const duration = parseISODuration(details.duration || "PT0S");

  // Extract hashtags from description
  const description = snippet.description || "";
  const hashtags = (description.match(/#\w+/g) || [])
    .map((h) => h.toLowerCase());

  // Channel stats — needs a separate call but is optional
  // We skip it to save API quota; followerCount shown as null
  console.log(`   ✅ YouTube metadata via API: ${snippet.title}`);

  return {
    videoId,
    platform: "youtube",
    url,
    title:         snippet.title          || "Unknown",
    creator:       snippet.channelTitle   || "Unknown",
    creatorHandle: snippet.channelId      || "Unknown",
    followerCount: null, // requires extra API call — skip for quota
    views,
    likes,
    comments,
    engagementRate: parseFloat(engagementRate),
    duration,
    uploadDate:  (snippet.publishedAt || "").slice(0, 10).replace(/-/g, ""),
    description,
    hashtags,
    thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null,
  };
}

// ── Instagram — yt-dlp ────────────────────────────────────
async function extractInstagramMetadata(url, videoId) {
  const args = [
    "--dump-json",
    "--no-playlist",
    "--skip-download",
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
    throw new Error(`yt-dlp failed for ${url}: ${err.message}`);
  }

  const views    = rawJson.view_count    || 0;
  const likes    = rawJson.like_count    || 0;
  const comments = rawJson.comment_count || 0;

  const engagementRate = views > 0
    ? (((likes + comments) / views) * 100).toFixed(4)
    : "0.0000";

  const hashtags = [
    ...(rawJson.tags || []).filter((t) => t.startsWith("#")).map((t) => t.toLowerCase()),
    ...(rawJson.description || "").match(/#\w+/g)?.map((h) => h.toLowerCase()) || [],
  ];

  console.log(`   ✅ Instagram metadata via yt-dlp: ${rawJson.title}`);

  return {
    videoId,
    platform: "instagram",
    url,
    title:         rawJson.title       || "Unknown",
    creator:       rawJson.uploader    || rawJson.channel    || "Unknown",
    creatorHandle: rawJson.uploader_id || rawJson.channel_id || "Unknown",
    followerCount: rawJson.channel_follower_count || null,
    views,
    likes,
    comments,
    engagementRate: parseFloat(engagementRate),
    duration:    rawJson.duration    || 0,
    uploadDate:  rawJson.upload_date || null,
    description: rawJson.description || "",
    hashtags:    [...new Set(hashtags)],
    thumbnail:   rawJson.thumbnail   || null,
  };
}

// ── Helpers ───────────────────────────────────────────────
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

// Parse ISO 8601 duration to seconds: PT1H2M3S → 3723
function parseISODuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) +
         (parseInt(m[2] || 0) * 60)   +
          parseInt(m[3] || 0);
}