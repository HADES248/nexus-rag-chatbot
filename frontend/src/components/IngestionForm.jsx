// src/components/IngestionForm.jsx
import React, { useState } from "react";

export default function IngestionForm({ onIngestComplete, onIngestStart, sessionId }) {
  const [urlA, setUrlA] = useState("");
  const [urlB, setUrlB] = useState("");
  const [status, setStatus] = useState({ msg: "", type: "" });
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const isYT = (u) => /youtube\.com|youtu\.be/.test(u);
    const isIG = (u) => /instagram\.com/.test(u);
    if (!urlA.trim() || !urlB.trim()) return "Both URLs are required";
    if (!isYT(urlA) && !isIG(urlA)) return "Video A must be a YouTube or Instagram URL";
    if (!isYT(urlB) && !isIG(urlB)) return "Video B must be a YouTube or Instagram URL";
    if ((isYT(urlA) && isYT(urlB)) || (isIG(urlA) && isIG(urlB))) {
      return "One URL must be YouTube and the other Instagram (per spec)";
    }
    return null;
  };

  const handleIngest = async () => {
    const err = validate();
    if (err) {
      setStatus({ msg: err, type: "error" });
      return;
    }

    setLoading(true);
    setStatus({ msg: "Pulling metadata + transcripts... this takes ~30-60s", type: "" });
    onIngestStart();

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urlA: urlA.trim(), urlB: urlB.trim(), sessionId }),
      });

      // CRITICAL FIX: read raw text first, never call res.json() directly.
      // If the server crashes mid-request, res.json() throws the misleading
      // "Unexpected end of JSON input" error with no useful context.
      const raw = await res.text();

      if (!raw || raw.trim() === "") {
        throw new Error(
          "Server returned an empty response. Check your backend terminal for the crash reason."
        );
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        // Not JSON — show raw so user can diagnose
        throw new Error(`Server error (not JSON): ${raw.slice(0, 300)}`);
      }

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status} — ingest failed`);
      }

      setStatus({
        msg: `Done — A: ${data.videos.A.chunksStored} chunks, B: ${data.videos.B.chunksStored} chunks`,
        type: "success",
      });
      onIngestComplete(data.videos);
    } catch (e) {
      setStatus({ msg: e.message, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !loading) handleIngest();
  };

  return (
    <div className="ingest-form">
      <h2>// Load Videos</h2>

      <div className="input-row">
        <label className="input-label">
          <span className="a">A</span> YouTube URL
        </label>
        <input
          type="url"
          value={urlA}
          onChange={(e) => setUrlA(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://youtube.com/watch?v=..."
          disabled={loading}
        />
      </div>

      <div className="input-row">
        <label className="input-label">
          <span className="b">B</span> Instagram Reel URL
        </label>
        <input
          type="url"
          value={urlB}
          onChange={(e) => setUrlB(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://instagram.com/reel/..."
          disabled={loading}
        />
      </div>

      {loading && <div className="loading-bar" style={{ marginTop: 12 }} />}

      <button
        className="btn-ingest"
        onClick={handleIngest}
        disabled={loading}
      >
        {loading ? "Ingesting..." : "→ Ingest + Embed"}
      </button>

      {status.msg && (
        <div className={`ingest-status ${status.type}`}>{status.msg}</div>
      )}
    </div>
  );
}