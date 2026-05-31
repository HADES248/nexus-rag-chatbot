// src/components/ChatPanel.jsx
// ─────────────────────────────────────────────────────────
// Handles:
//  - SSE streaming from /api/chat
//  - Rendering tokens as they arrive (typing effect)
//  - Citation chips below each assistant message
//  - Suggested starter questions
//  - Disabled state when no videos loaded
// ─────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from "react";

const SUGGESTIONS = [
  "Why did Video A get more engagement than Video B?",
  "What's the engagement rate of each video?",
  "Compare the hooks in the first 5 seconds.",
  "Who's the creator of Video B and what's their follower count?",
  "Suggest improvements for B based on what worked in A.",
];

function SourceChip({ source }) {
  const cls = source.videoId.toLowerCase();
  return (
    <div className={`source-chip ${cls}`} title={source.excerpt}>
      Video {source.videoId} · chunk {source.chunkIndex}
      <span style={{ opacity: 0.6 }}> {(source.relevance * 100).toFixed(0)}%</span>
    </div>
  );
}

// Simple markdown-ish renderer: bold **text**, inline `code`
function renderText(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`message ${isUser ? "user" : "assistant"}`}>
      <div className="message-bubble">
        {msg.content.split("\n").map((line, i) => (
          <p key={i} style={{ marginBottom: i < msg.content.split("\n").length - 1 ? 6 : 0 }}>
            {renderText(line)}
          </p>
        ))}
        {msg.streaming && <span className="typing-cursor" />}
      </div>

      {/* Citation chips — shown after stream completes */}
      {!msg.streaming && msg.sources && msg.sources.length > 0 && (
        <div className="sources">
          {msg.sources.map((s, i) => (
            <SourceChip key={i} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({ sessionId, videosLoaded }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (text) => {
      const userText = (text || input).trim();
      if (!userText || isStreaming || !videosLoaded) return;

      setInput("");
      setIsStreaming(true);

      // Add user message
      setMessages((prev) => [
        ...prev,
        { role: "user", content: userText, id: Date.now() },
      ]);

      // Add empty assistant message that we'll fill token by token
      const assistantId = Date.now() + 1;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true, sources: [], id: assistantId },
      ]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userText, sessionId }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Chat failed");
        }

        // Read SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") break;

            let event;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event.type === "token") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.content }
                    : m
                )
              );
            } else if (event.type === "sources") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, sources: event.content } : m
                )
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, streaming: false } : m
                )
              );
            } else if (event.type === "error") {
              throw new Error(event.content);
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Error: ${err.message}`,
                  streaming: false,
                  error: true,
                }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        // Ensure cursor is removed on finish
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.streaming
              ? { ...m, streaming: false }
              : m
          )
        );
      }
    },
    [input, isStreaming, sessionId, videosLoaded]
  );

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="chat-panel">
      {/* Messages */}
      <div className="messages-area">
        {isEmpty && (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <div className="empty-title">
              {videosLoaded
                ? "Ask anything about your videos"
                : "Load two videos to start"}
            </div>
            {!videosLoaded && (
              <div style={{ fontSize: 12, color: "var(--text3)", maxWidth: 280 }}>
                Paste a YouTube and Instagram URL in the left panel, then click Ingest.
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips — shown only when videos loaded + no messages yet */}
      {videosLoaded && isEmpty && (
        <div style={{ padding: "0 24px 12px" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            Suggested questions
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="suggestion-chip"
                onClick={() => sendMessage(s)}
                disabled={isStreaming}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="chat-input-area">
        {isStreaming && <div className="loading-bar" />}
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              videosLoaded
                ? "Ask about the videos... (Enter to send, Shift+Enter for newline)"
                : "Ingest videos first..."
            }
            disabled={!videosLoaded || isStreaming}
            rows={1}
          />
          <button
            className="btn-send"
            onClick={() => sendMessage()}
            disabled={!videosLoaded || isStreaming || !input.trim()}
          >
            Send →
          </button>
        </div>
      </div>
    </div>
  );
}