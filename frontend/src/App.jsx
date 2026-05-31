// src/App.jsx
import React, { useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import IngestionForm from "./components/IngestionForm.jsx";
import VideoCard from "./components/VideoCard.jsx";
import ChatPanel from "./components/ChatPannel.jsx";

// Session ID persists for the browser tab's lifetime.
// Each new tab = new session = isolated memory + vector store.
const SESSION_ID = uuidv4();

export default function App() {
  const [videos, setVideos] = useState({ A: null, B: null });
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [ingested, setIngested] = useState(false);

  const handleIngestStart = () => {
    setLoadingVideos(true);
    setIngested(false);
    setVideos({ A: null, B: null });
  };

  const handleIngestComplete = (videosData) => {
    setVideos({
      A: videosData.A,
      B: videosData.B,
    });
    setLoadingVideos(false);
    setIngested(true);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-dot" />
        <div className="header-logo">NEXUS</div>
        <div className="header-sub">// video intelligence</div>
        <div style={{ flex: 1 }} />
        {ingested && (
          <div className="status-badge ready">
            ● Ready — session {SESSION_ID.slice(0, 8)}
          </div>
        )}
      </header>

      {/* Main */}
      <div className="main-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Ingest form */}
          <IngestionForm
            sessionId={SESSION_ID}
            onIngestStart={handleIngestStart}
            onIngestComplete={handleIngestComplete}
          />

          {/* Video cards */}
          <VideoCard label="A" data={videos.A} loading={loadingVideos} />
          <VideoCard label="B" data={videos.B} loading={loadingVideos} />

          {/* Suggested questions (sidebar version) */}
          {ingested && (
            <div className="suggestions">
              <h3>// Quick Queries</h3>
              <div className="chunks-info">
                {videos.A && `Video A: ${videos.A.chunksStored} chunks`}
                {videos.A && videos.B && " · "}
                {videos.B && `Video B: ${videos.B.chunksStored} chunks`}
              </div>
            </div>
          )}
        </aside>

        {/* Chat panel */}
        <ChatPanel sessionId={SESSION_ID} videosLoaded={ingested} />
      </div>
    </div>
  );
}