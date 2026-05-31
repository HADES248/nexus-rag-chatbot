// Why not ChromaDB?
// Chroma versions often have compatibility issues.
// MemoryVectorStore is:
// - Fast (no server needed)
// - Simple (no extra setup)
// - Reliable (fewer errors)
//
// Trade-off:
// Data is stored in RAM and is lost when the app restarts.
//
// For production:
// Replace MemoryVectorStore with Qdrant or Pinecone.
// No other code changes are needed.
//
// Embeddings:
// Uses HuggingFace all-MiniLM-L6-v2
// Runs locally with @xenova/transformers.
// Free to use.
// Model size: ~23MB and cached after first download.

import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";

// ── Singleton embeddings ──────────────────────────────────
let _embeddings = null;
function getEmbeddings() {
  if (!_embeddings) {
    _embeddings = new HuggingFaceTransformersEmbeddings({
      modelName: "Xenova/all-MiniLM-L6-v2",
    });
  }
  return _embeddings;
}

// ── In-memory vector store ────────────────────────────────
// One shared store for the whole server process.
// Keyed chunks by video_id metadata so we can filter per video.
let _store = null;

async function getStore() {
  if (!_store) {
    _store = new MemoryVectorStore(getEmbeddings());
  }
  return _store;
}

// ── Public API ────────────────────────────────────────────

/**
 * Chunk a transcript and embed it into the in-memory store.
 * Clears any previous chunks for this video_id first.
 *
 * @param {string} transcript
 * @param {object} metadata  — { videoId, platform, creator, url, ... }
 * @returns {Promise<number>} chunks stored
 */
export async function chunkAndEmbed(transcript, metadata) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,
    chunkOverlap: 80,
    separators: ["\n\n", "\n", ". ", "? ", "! ", " ", ""],
  });

  const rawChunks = await splitter.splitText(transcript);

  if (rawChunks.length === 0) {
    throw new Error(`No chunks generated for Video ${metadata.videoId} — transcript may be empty`);
  }

  const documents = rawChunks.map((chunk, i) =>
    new Document({
      pageContent: chunk,
      metadata: {
        video_id:        metadata.videoId,       // "A" or "B"
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

  // Clear previous chunks for this video and rebuild the store
  // MemoryVectorStore has no delete API, so we rebuild from scratch
  // keeping the other video's chunks intact.
  await rebuildStoreWithout(metadata.videoId, documents);

  console.log(`✅ Embedded ${documents.length} chunks for Video ${metadata.videoId}`);
  return documents.length;
}

/**
 * Rebuild the store: keep all chunks NOT belonging to videoId,
 * then add the new documents for that videoId.
 * This is how we "update" a video without a delete API.
 */
async function rebuildStoreWithout(videoId, newDocs) {
  const oldStore = _store;
  const kept = [];

  if (oldStore) {
    // Pull all existing docs and keep the ones from the OTHER video
    const all = oldStore.memoryVectors || [];
    for (const mv of all) {
      if (mv.metadata?.video_id !== videoId) {
        kept.push(new Document({
          pageContent: mv.content,
          metadata:    mv.metadata,
        }));
      }
    }
  }

  // Fresh store with kept docs + new docs
  _store = new MemoryVectorStore(getEmbeddings());
  const allDocs = [...kept, ...newDocs];
  if (allDocs.length > 0) {
    await _store.addDocuments(allDocs);
  }
}

/**
 * Retrieve top-k relevant chunks for a query.
 * Optionally filter to a specific video_id.
 *
 * @param {string}      query
 * @param {number}      k
 * @param {string|null} videoIdFilter  — "A", "B", or null for both
 * @returns {Promise<Array<{doc, score}>>}
 */
export async function retrieveChunks(query, k = 8, videoIdFilter = null) {
  const store = await getStore();

  // Fetch more than k so we have room to filter by video_id
  const fetchK = videoIdFilter ? k * 4 : k;
  const results = await store.similaritySearchWithScore(query, fetchK);

  const filtered = videoIdFilter
    ? results.filter(([doc]) => doc.metadata.video_id === videoIdFilter)
    : results;

  return filtered.slice(0, k).map(([doc, score]) => ({ doc, score }));
}

export { getEmbeddings };