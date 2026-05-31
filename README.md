# Nexus — Creator Video Intelligence

A full-stack RAG chatbot that takes two social media videos (YouTube + Instagram) and lets a creator ask natural-language questions about them — why one performed better, what the hooks were, engagement breakdowns, improvement suggestions — all with streaming responses, inline citations, and memory across turns.

Built for a technical screening round. Every decision has a reason I can defend on a call.

---

## Demo

Paste a YouTube URL and an Instagram Reel URL. The system pulls transcripts and metadata, embeds everything into a vector store, then opens a chat interface where you can ask:

- *Why did Video A get more engagement than Video B?*
- *Compare the hooks in the first 5 seconds*
- *What's the engagement rate of each?*
- *Who's the creator of Video B and what's their follower count?*
- *Suggest specific improvements for B based on what worked in A*

Responses stream token by token, cite which video and chunk they came from, and remember previous turns.

---

## Architecture

```
YouTube URL + Instagram URL
        │
        ▼
  Node.js / Express
        │
  ┌─────┴──────────────────────┐
  │                            │
  ▼                            ▼
yt-dlp (metadata)     youtube-transcript npm
  +                       +
yt-dlp + ffmpeg       Groq Whisper (Instagram)
(audio download)
        │
        ▼
  RecursiveCharacterTextSplitter
  400 tokens / 80 overlap
        │
        ▼
  HuggingFace all-MiniLM-L6-v2
  (local embeddings, no API cost)
        │
        ▼
  ChromaDB v2  ──fallback──▶  MemoryVectorStore
        │
        ▼
  LangChain RAG chain
  Groq llama-3.3-70b-versatile
  streaming via SSE
        │
        ▼
  React + Vite frontend
  side-by-side video cards + chat panel
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | LangChain.js has Python-equivalent API; one language across the stack |
| LLM | Groq — Llama 3.3 70B | Free tier, fast inference (~500 tok/s), better than GPT-3.5 for analysis |
| Embeddings | HuggingFace all-MiniLM-L6-v2 | Runs locally via ONNX — zero API cost, no rate limits |
| Vector DB | ChromaDB v2 + MemoryVectorStore fallback | ChromaDB for persistence; auto-falls back to memory if server is down |
| Orchestration | LangChain.js | Native streaming, splitters, embeddings all in one lib |
| Transcripts — YT | youtube-transcript npm | Direct YouTube subtitle endpoint, no API key needed |
| Transcripts — IG | yt-dlp + Groq Whisper | yt-dlp handles Instagram auth; Groq Whisper is free (7200s/day) |
| Metadata | yt-dlp | Only tool that handles both YouTube and Instagram with one interface |
| Streaming | SSE (Server-Sent Events) | One-directional LLM token stream — simpler than WebSockets, works through CDN proxies |
| Frontend | React + Vite | Fast HMR in dev, clean build for Vercel |

---

## Chunking Strategy

```
Chunk size:  400 tokens
Overlap:     80 tokens (20%)
Separators:  \n\n → \n → ". " → "? " → "! " → " "
```

**Why 400?** Tested at 200 (fragments lose context, retrieval returns incomplete thoughts), 600 (too broad — comparisons like "first 5 seconds" need precision). 400 is the sweet spot for spoken-word transcripts.

**Why 80 overlap?** Speech-to-text transcripts don't have clean paragraph breaks. 20% overlap guarantees sentences split across boundaries appear complete in at least one chunk.

**Every chunk is tagged with:** `{ video_id, platform, creator, source_url, chunk_index, total_chunks, engagement_rate, upload_date }`

This metadata lets the RAG chain cite exactly `[Video A, chunk 3]` and lets us filter retrieval to a single video when the question is video-specific.

---

## Engagement Rate

```
engagement_rate = (likes + comments) / views × 100
```

Computed from yt-dlp metadata at ingest time. Injected directly into the LLM system prompt as ground truth so the model never needs to retrieve or guess this number — it's always accurate.

---

## Cost at Scale (1000 creators/day, 2 videos each)

| Component | Cost |
|---|---|
| Embeddings (all-MiniLM local) | $0.00 |
| Groq LLM (Llama 3.3 70B) | Free tier covers demos; ~$0.59/M tokens after |
| Groq Whisper (avg 60s reel) | Free (7200s/day free tier) |
| yt-dlp metadata + transcripts | $0.00 |
| ChromaDB (self-hosted) | $0.00 |
| **Total** | **~$0 at demo scale** |

**For 1000 creators/day in production:**
- Groq paid: ~$5/day at 10 questions avg per session
- Infrastructure: Render free tier for backend, Vercel free for frontend
- Total: ~$5/day = $0.005 per creator

**What breaks at 10,000 users:**
1. In-memory sessions → Redis with TTL
2. Single Express process → PM2 cluster or Docker + horizontal scaling
3. yt-dlp serial → BullMQ job queue + N workers
4. ChromaDB single node → Qdrant cluster (self-hosted Docker Compose)
5. No auth → JWT tied to user sessions

---

## Prerequisites

- Node.js ≥ 18
- Python 3 + yt-dlp: `pip install yt-dlp`
- ffmpeg installed and on PATH (or set `FFMPEG_PATH` in `.env`)
- ChromaDB v2: `pip install chromadb` then `chroma run --port 8000`
- Free Groq API key: console.groq.com

---

## Local Setup

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/nexus-rag-chatbot.git
cd nexus-rag-chatbot

# 2. Start ChromaDB (separate terminal, keep running)
chroma run --port 8000

# 3. Backend
cd backend
cp .env.example .env
# Fill in GROQ_API_KEY and FFMPEG_PATH in .env
npm install --legacy-peer-deps
npm run dev
# → http://localhost:3001

# 4. Frontend (separate terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Environment Variables

```bash
# backend/.env

GROQ_API_KEY=gsk_...              # Free at console.groq.com
FFMPEG_PATH=C:\path\to\ffmpeg.exe # From `where.exe ffmpeg` on Windows
                                  # From `which ffmpeg` on Mac/Linux
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=creator_videos
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

### Verify everything is up

```bash
curl http://localhost:3001/api/health
# → {"status":"ok","groq":true}

curl http://localhost:8000/api/v2/heartbeat
# → {"nanosecond heartbeat": ...}
```

---

## Deployment (Free)

### Backend → Render

1. Push to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, select the `backend` folder as root
4. Set:
   - **Build command:** `npm install --legacy-peer-deps`
   - **Start command:** `node src/index.js`
5. Add environment variables in the Render dashboard:
   - `GROQ_API_KEY` — your Groq key
   - `FFMPEG_PATH` — `ffmpeg` (Render has it on PATH already)
   - `CHROMA_URL` — `http://localhost:8000` (or your ChromaDB instance)
   - `CORS_ORIGIN` — your Vercel frontend URL (set after step below)
6. Deploy — Render gives you a URL like `https://nexus-rag-backend.onrender.com`

> **Note:** Render free tier spins down after 15min inactivity. For the demo, hit `/api/health` first to wake it up.

### Frontend → Vercel

1. Open `frontend/vercel.json` and replace `YOUR-BACKEND-URL` with your Render URL
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Set **Root Directory** to `frontend`
4. Deploy — Vercel gives you a URL like `https://nexus-rag.vercel.app`
5. Go back to Render → update `CORS_ORIGIN` to your Vercel URL → redeploy

### ChromaDB in production

For a persistent free ChromaDB:
- Spin up a free [Railway](https://railway.app) instance with the `chromadb/chroma` Docker image
- Or use the MemoryVectorStore fallback (already built in) — works fine for demos

---

## Project Structure

```
nexus-rag-chatbot/
├── backend/
│   ├── src/
│   │   ├── index.js                   # Express server, global error handler
│   │   ├── routes/
│   │   │   ├── ingest.js              # POST /api/ingest — metadata + transcript + embed
│   │   │   └── chat.js                # POST /api/chat  — SSE streaming RAG
│   │   └── services/
│   │       ├── metadataExtractor.js   # yt-dlp wrapper → views/likes/comments/ER
│   │       ├── transcriptFetcher.js   # YouTube subtitles + Groq Whisper for Instagram
│   │       ├── embedder.js            # Chunk → embed → ChromaDB (memory fallback)
│   │       └── ragGraph.js            # LangChain streaming chain + session memory
│   ├── package.json
│   ├── .env.example
│   └── render.yaml
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # Root — session ID, layout
│   │   ├── components/
│   │   │   ├── IngestionForm.jsx      # URL inputs + ingest trigger
│   │   │   ├── VideoCard.jsx          # Metrics display per video
│   │   │   └── ChatPanel.jsx          # SSE stream reader, citations, suggestions
│   │   └── index.css                  # Dark theme (Space Mono + DM Sans)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json
├── .gitignore
└── README.md
```

---

## API

### `POST /api/ingest`

```json
{
  "urlA": "https://youtube.com/watch?v=...",
  "urlB": "https://instagram.com/reel/...",
  "sessionId": "uuid-string"
}
```

Runs in parallel: metadata extraction → transcript fetch → chunk + embed. Returns full metadata for both videos including engagement rate and chunk count.

### `POST /api/chat`

```json
{
  "message": "Why did Video A get more engagement?",
  "sessionId": "uuid-string"
}
```

Returns an SSE stream:
```
data: {"type":"token","content":"Video A"}
data: {"type":"token","content":" outperformed..."}
data: {"type":"sources","content":[{"videoId":"A","chunkIndex":0,...}]}
data: {"type":"done"}
data: [DONE]
```

### `GET /api/health`

```json
{ "status": "ok", "groq": true, "ts": "2024-..." }
```

---

## Trade-offs I'd change in production

1. **Session memory is in-process RAM** — dies on restart, not shared across instances. Fix: Redis with 24h TTL.
2. **@xenova/transformers downloads model on first request** — cold start is slow. Fix: pre-download model in Docker image at build time.
3. **yt-dlp rate limits** — Instagram will throttle at scale. Fix: exponential backoff, IP rotation, cache results for duplicate URLs.
4. **No authentication** — any sessionId works. Fix: JWT or Clerk for user identity.
5. **ChromaDB memory fallback loses data on restart** — acceptable for demo, not for prod. Fix: always-on ChromaDB or Qdrant with persistence volume.
