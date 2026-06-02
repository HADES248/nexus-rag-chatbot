# Nexus

AI-powered video intelligence platform that compares YouTube and Instagram videos using Retrieval-Augmented Generation (RAG).

Users can ingest two videos, extract transcripts and metadata, and ask natural-language questions about performance, engagement, hooks, content strategy, and improvement opportunities.

## Features

- YouTube + Instagram video ingestion
- Automatic transcript extraction
- Metadata analysis
- Vector search with ChromaDB
- AI-powered video comparison
- Real-time streaming responses (SSE)
- Source citations
- Session-based conversation memory

## Architecture

YouTube / Instagram URLs
        ↓
Metadata + Transcript Extraction
        ↓
Chunking & Embeddings
        ↓
ChromaDB
        ↓
LangChain RAG
        ↓
Groq Llama 3.3 70B
        ↓
React Frontend

## Tech Stack

| Layer | Technology |
|---------|------------|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| LLM | Groq Llama 3.3 70B |
| Embeddings | all-MiniLM-L6-v2 |
| Vector DB | ChromaDB |
| Orchestration | LangChain.js |
| Transcription | youtube-transcript, Groq Whisper |
| Streaming | Server-Sent Events |

## API

### POST /api/ingest

Processes two videos by:
1. Extracting metadata
2. Fetching transcripts
3. Generating embeddings
4. Storing vectors

### POST /api/chat

Retrieves relevant transcript chunks and streams AI responses with citations.

### GET /api/health

Health check endpoint.

## Setup

### Required Environment Variables
GROQ_API_KEY=

YOUTUBE_API_KEY=

CHROMA_URL=

PORT=

```bash
npm install
npm run dev
```
