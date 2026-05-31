// POST /api/chat { message, sessionId }
// 
// STREAMING (SSE):
// Why SSE? Simple, one-way (server→client), no handshake, 
// auto-reconnects, bypasses restrictive proxies, & perfect for LLM tokens.
//
// EVENT FORMAT:
// data: {"type":"token","content":"..."} // Next token
// data: {"type":"sources","content":[...]} // Citations/Sources
// data: {"type":"done"} // Stream finished
// data: [DONE] // Close connection
import { Router } from "express";
import { ragChat, getOrCreateSession } from "../services/ragGraph.js";

const router = Router();

router.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ error: "Required: message, sessionId" });
  }

  const session = getOrCreateSession(sessionId);
  if (!session.videoMetadata || Object.keys(session.videoMetadata).length === 0) {
    return res.status(400).json({
      error: "No videos ingested for this session. Call /api/ingest first.",
    });
  }

  // ── Set up SSE headers ────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering if proxied
  res.flushHeaders(); // Send headers immediately so client knows stream started

  // Helper to send an SSE event
  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // res.flush() if using compression middleware — call if tokens appear batched
  };

  try {
    const { sources } = await ragChat(sessionId, message, (token) => {
      sendEvent({ type: "token", content: token });
    });
    sendEvent({ type: "sources", content: sources });

    sendEvent({ type: "done" });
    res.write("data: [DONE]\n\n");
    res.end();

  } catch (err) {
    console.error("Chat error:", err);
    sendEvent({ type: "error", content: err.message || "Chat failed" });
    res.end();
  }
});

// GET /api/session/:sessionId — check if session has videos loaded
router.get("/session/:sessionId", (req, res) => {
  const session = getOrCreateSession(req.params.sessionId);
  const hasVideos = Object.keys(session.videoMetadata || {}).length > 0;
  res.json({
    sessionId: req.params.sessionId,
    hasVideos,
    messageCount: session.messages?.length || 0,
    videos: hasVideos
      ? {
          A: session.videoMetadata.A
            ? {
                title: session.videoMetadata.A.title,
                creator: session.videoMetadata.A.creator,
                platform: session.videoMetadata.A.platform,
                engagementRate: session.videoMetadata.A.engagementRate,
              }
            : null,
          B: session.videoMetadata.B
            ? {
                title: session.videoMetadata.B.title,
                creator: session.videoMetadata.B.creator,
                platform: session.videoMetadata.B.platform,
                engagementRate: session.videoMetadata.B.engagementRate,
              }
            : null,
        }
      : null,
  });
});

export default router;