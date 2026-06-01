// src/services/embedder.js
// ─────────────────────────────────────────────────────────
// MEMORY FIX for Render free tier (512MB RAM):
//   @xenova/transformers loads ~200MB model into RAM.
//   A 95K char transcript generates ~240 chunks × embeddings = OOM.
//   Fix: cap transcript at 15,000 chars before chunking.
//   That gives ~37 chunks — plenty for RAG, well under memory limit.
//
//   15,000 chars ≈ 10 mins of speech ≈ covers hooks, key moments,
//   conclusions — everything a creator needs to compare videos.
// ─────────────────────────────────────────────────────────
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import { ChromaClient } from "chromadb";

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || "creator_videos";
const CHROMA_URL      = process.env.CHROMA_URL        || "http://localhost:8000";

// Cap transcript length to stay within Render's 512MB RAM limit.
// 15K chars ≈ 37 chunks × ~384 dims embedding = well under limit.
const MAX_TRANSCRIPT_CHARS = 15_000;

let _embeddings = null;
function getEmbeddings() {
  if (!_embeddings) {
    _embeddings = new HuggingFaceTransformersEmbeddings({
      modelName: "Xenova/all-MiniLM-L6-v2",
    });
  }
  return _embeddings;
}

let _chroma = null;
function getChroma() {
  if (!_chroma) _chroma = new ChromaClient({ path: CHROMA_URL });
  return _chroma;
}

let _memStore = null;
let _useMemory = false;

export async function chunkAndEmbed(transcript, metadata) {
  // Truncate long transcripts to avoid OOM on Render free tier
  let text = transcript;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    console.log(`   Transcript truncated: ${text.length} → ${MAX_TRANSCRIPT_CHARS} chars (memory limit)`);
    text = text.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,
    chunkOverlap: 80,
    separators: ["\n\n", "\n", ". ", "? ", "! ", " ", ""],
  });

  const rawChunks = await splitter.splitText(text);
  if (rawChunks.length === 0) throw new Error(`No chunks for Video ${metadata.videoId}`);

  console.log(`   Embedding ${rawChunks.length} chunks for Video ${metadata.videoId}...`);

  const documents = rawChunks.map((chunk, i) =>
    new Document({
      pageContent: chunk,
      metadata: {
        video_id:        metadata.videoId,
        platform:        metadata.platform,
        creator:         metadata.creator,
        source_url:      metadata.url,
        chunk_index:     i,
        total_chunks:    rawChunks.length,
        engagement_rate: String(metadata.engagementRate ?? ""),
        upload_date:     metadata.uploadDate || "",
      },
    })
  );

  const embedder = getEmbeddings();
  const vectors  = await embedder.embedDocuments(rawChunks);

  const ids   = rawChunks.map((_, i) => `${metadata.videoId}_${i}_${Date.now()}`);
  const metas = documents.map((d) => d.metadata);

  try {
    const col = await getChroma().getOrCreateCollection({ name: COLLECTION_NAME });
    try { await col.delete({ where: { video_id: metadata.videoId } }); } catch (_) {}
    await col.add({ ids, embeddings: vectors, documents: rawChunks, metadatas: metas });
    _useMemory = false;
    console.log(`   ✅ [ChromaDB] ${rawChunks.length} chunks stored`);
  } catch (chromaErr) {
    console.warn(`   ChromaDB unavailable, using memory: ${chromaErr.message}`);
    _useMemory = true;
    await embedInMemory(documents, metadata.videoId);
    console.log(`   ✅ [Memory] ${rawChunks.length} chunks stored`);
  }

  return rawChunks.length;
}

async function embedInMemory(docs, videoId) {
  const kept = [];
  if (_memStore) {
    const all = _memStore.memoryVectors || [];
    for (const mv of all) {
      if (mv.metadata?.video_id !== videoId) {
        kept.push(new Document({ pageContent: mv.content, metadata: mv.metadata }));
      }
    }
  }
  _memStore = new MemoryVectorStore(getEmbeddings());
  await _memStore.addDocuments([...kept, ...docs]);
}

export async function retrieveChunks(query, k = 8, videoIdFilter = null) {
  if (_useMemory) return retrieveFromMemory(query, k, videoIdFilter);

  try {
    const queryVector = await getEmbeddings().embedQuery(query);
    const col         = await getChroma().getOrCreateCollection({ name: COLLECTION_NAME });
    const where       = videoIdFilter ? { video_id: videoIdFilter } : undefined;
    const results     = await col.query({
      queryEmbeddings: [queryVector],
      nResults: k,
      where,
    });

    return (results.documents[0] || []).map((text, i) => ({
      doc: new Document({
        pageContent: text,
        metadata: results.metadatas[0][i] || {},
      }),
      score: 1 - (results.distances[0][i] || 0),
    }));
  } catch (err) {
    console.warn(`ChromaDB query failed, using memory: ${err.message}`);
    return retrieveFromMemory(query, k, videoIdFilter);
  }
}

async function retrieveFromMemory(query, k, videoIdFilter) {
  if (!_memStore) return [];
  const fetchK  = videoIdFilter ? k * 4 : k;
  const results = await _memStore.similaritySearchWithScore(query, fetchK);
  const filtered = videoIdFilter
    ? results.filter(([doc]) => doc.metadata.video_id === videoIdFilter)
    : results;
  return filtered.slice(0, k).map(([doc, score]) => ({ doc, score }));
}

export { getEmbeddings };