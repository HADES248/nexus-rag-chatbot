// ───────────────────────────────
// METADATA EXTRACTION
//
// Why use yt-dlp?
// - Works with YouTube and Instagram
// - No API keys needed
// - One tool for both platforms
// - Called from Node using child_process
//
// Metadata fetched:
// - Title
// - Creator name & ID
// - Views, likes, comments
// - Upload date
// - Duration
// - Description
// - Tags/hashtags
// - Thumbnail
// - Video URL
// ───────────────────────────────
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Detect platform from URL
 * @param {string} url
 * @returns {"youtube"|"instagram"|"unknown"}
 */
export function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/instagram\.com/.test(url)) return "instagram";
  return "unknown";
}

/**
 * Extract metadata from a video URL using yt-dlp.
 * Returns a structured metadata object with engagement metrics.
 *
 * @param {string} url - YouTube or Instagram URL
 * @param {"A"|"B"} videoId - Label for this video in our system
 * @returns {Promise<VideoMetadata>}
 */
export async function extractMetadata(url, videoId) {
  const platform = detectPlatform(url);

  // yt-dlp --dump-json returns a single JSON blob with everything we need.
  // --no-playlist ensures we only get the single video, not a whole channel.
  // --skip-download means we never actually download the video file.
  const args = [
    "--dump-json",
    "--no-playlist",
    "--skip-download",
    url,
  ];

  let rawJson;
  try {
    const { stdout } = await execFileAsync("yt-dlp", args, {
      timeout: 60_000, // 60s timeout — Instagram can be slow
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large JSON
    });
    rawJson = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(
      `yt-dlp failed for ${url}: ${err.message}\n` +
        "Make sure yt-dlp is installed: pip install yt-dlp"
    );
  }

  // Parse + normalise
  const views = rawJson.view_count || 0;
  const likes = rawJson.like_count || 0;
  const comments = rawJson.comment_count || 0;

  // Engagement rate formula from the spec:
  //   (likes + comments) / views × 100
  // Guard against division by zero (live streams, private videos)
  const engagementRate =
    views > 0 ? (((likes + comments) / views) * 100).toFixed(4) : "0.0000";

  // Extract hashtags — YouTube puts them in tags[], Instagram in description
  const hashtags = extractHashtags(
    rawJson.tags || [],
    rawJson.description || ""
  );

  return {
    videoId,          // "A" or "B" — our internal label
    platform,
    url,
    title: rawJson.title || "Unknown",
    creator: rawJson.uploader || rawJson.channel || "Unknown",
    creatorHandle: rawJson.uploader_id || rawJson.channel_id || "Unknown",
    followerCount: rawJson.channel_follower_count || rawJson.uploader_follower_count || null,
    views,
    likes,
    comments,
    engagementRate: parseFloat(engagementRate),
    duration: rawJson.duration || 0,         // seconds
    uploadDate: rawJson.upload_date || null, // YYYYMMDD string
    description: rawJson.description || "",
    hashtags,
    thumbnail: rawJson.thumbnail || null,
    rawDump: rawJson, // keep full dump for debugging during demo
  };
}

/**
 * Pull hashtags from yt-dlp tags array + description text.
 * De-duplicates across both sources.
 */
function extractHashtags(tags, description) {
  const fromTags = tags
    .filter((t) => t.startsWith("#"))
    .map((t) => t.toLowerCase());

  const fromDesc = (description.match(/#\w+/g) || []).map((h) =>
    h.toLowerCase()
  );

  return [...new Set([...fromTags, ...fromDesc])];
}