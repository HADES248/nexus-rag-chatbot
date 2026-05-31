// src/components/VideoCard.jsx
// Displays video metadata: title, creator, metrics grid, engagement rate
import React from "react";

const fmt = (n) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
};

const fmtDate = (d) => {
  if (!d) return "—";
  // yt-dlp gives YYYYMMDD
  if (/^\d{8}$/.test(d)) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return d;
};

const fmtDuration = (secs) => {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function VideoCard({ label, data, loading }) {
  const cls = label.toLowerCase(); // "a" or "b"

  if (loading) {
    return (
      <div className="video-card">
        <div className="card-label">
          <span>{label}</span>
        </div>
        <div style={{ color: "var(--text3)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          Fetching metadata...
        </div>
        <div className="loading-bar" style={{ marginTop: 12, marginBottom: 0 }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="video-card">
        <div className={`card-label ${cls}`}>
          VIDEO {label}
        </div>
        <div style={{ color: "var(--text3)", fontSize: 12 }}>
          No video loaded yet
        </div>
      </div>
    );
  }

  return (
    <div className="video-card">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
        <div className={`card-label ${cls}`}>
          VIDEO {label}
          <span className="card-platform">{data.platform}</span>
        </div>
      </div>

      {/* Title + creator */}
      <div className="card-title">{data.title}</div>
      <div className="card-creator">
        {data.creator}
        {data.creatorHandle && data.creatorHandle !== data.creator && (
          <span style={{ color: "var(--text3)" }}> @{data.creatorHandle}</span>
        )}
      </div>

      {/* Metrics grid */}
      <div className="card-metrics">
        <div className="metric">
          <div className="metric-label">Eng. Rate</div>
          <div className={`metric-value highlight-${cls}`}>
            {data.engagementRate != null ? `${data.engagementRate}%` : "—"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Views</div>
          <div className="metric-value">{fmt(data.views)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Likes</div>
          <div className="metric-value">{fmt(data.likes)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Comments</div>
          <div className="metric-value">{fmt(data.comments)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Duration</div>
          <div className="metric-value">{fmtDuration(data.duration)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Followers</div>
          <div className="metric-value">{fmt(data.followerCount)}</div>
        </div>
      </div>

      {/* Hashtags */}
      {data.hashtags && data.hashtags.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {data.hashtags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text3)",
                background: "var(--bg2)",
                padding: "2px 6px",
                borderRadius: 3,
                border: "1px solid var(--border)",
              }}
            >
              {tag}
            </span>
          ))}
          {data.hashtags.length > 5 && (
            <span style={{ fontSize: 10, color: "var(--text3)" }}>
              +{data.hashtags.length - 5}
            </span>
          )}
        </div>
      )}

      {/* Uploaded */}
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
        {fmtDate(data.uploadDate)}
      </div>
    </div>
  );
}