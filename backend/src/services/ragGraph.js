// Using Groq (free) instead of OpenAI for the LLM
// Groq runs Llama 3.3 70B — excellent for analysis, completely free tier

import { ChatGroq } from "@langchain/groq";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { retrieveChunks } from "./embedder.js";

// In-memory session store: sessionId → { messages, videoMetadata }
const sessions = new Map();

export function getOrCreateSession(sessionId, videoMetadata = null) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], videoMetadata: videoMetadata || {} });
  } else if (videoMetadata) {
    sessions.get(sessionId).videoMetadata = videoMetadata;
  }
  return sessions.get(sessionId);
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}

function getLLM() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set in .env — get a free key at console.groq.com");
  }
  return new ChatGroq({
    // llama-3.3-70b-versatile: best free model for reasoning + analysis
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    streaming: true,
    apiKey: process.env.GROQ_API_KEY,
  });
}

function buildSystemPrompt(videoMetadata) {
  const vids = Object.values(videoMetadata);
  const metaBlocks = vids.map((v) => `
VIDEO ${v.videoId}:
  Platform: ${v.platform}
  Title: ${v.title}
  Creator: ${v.creator} (@${v.creatorHandle})
  Follower Count: ${v.followerCount != null ? v.followerCount.toLocaleString() : "N/A"}
  Views: ${v.views.toLocaleString()}
  Likes: ${v.likes.toLocaleString()}
  Comments: ${v.comments.toLocaleString()}
  Engagement Rate: ${v.engagementRate}%
  Duration: ${v.duration}s
  Upload Date: ${v.uploadDate || "Unknown"}
  Hashtags: ${v.hashtags.join(", ") || "None"}
  URL: ${v.url}`.trim()).join("\n\n");

  return `You are an expert social media analyst helping a content creator understand their video performance.

You have access to two videos (A and B) and their transcripts stored in a vector database.

== GROUND TRUTH METADATA ==
${metaBlocks}

== YOUR INSTRUCTIONS ==
1. Answer questions using the retrieved transcript chunks AND the metadata above.
2. Cite sources inline like: [Video A, chunk N] or [Video B].
3. For engagement rate questions, always use the exact figures from the metadata above.
4. When comparing hooks, look at the first transcript chunks (lowest chunk_index).
5. When suggesting improvements, be specific — reference exact moments from transcripts.
6. Keep responses focused and useful to a creator who wants to grow.
7. Always end comparative responses with a one-sentence "Bottom Line" summary.`;
}

export async function ragChat(sessionId, userMessage, onToken) {
  const session = getOrCreateSession(sessionId);
  const { messages, videoMetadata } = session;

  // Step 1: Retrieve relevant chunks from ChromaDB
  const allChunks = await retrieveChunks(userMessage, 8);

  const contextBlock = allChunks
    .map(({ doc, score }) =>
      `[Video ${doc.metadata.video_id}, chunk ${doc.metadata.chunk_index}] (relevance: ${(1 - score).toFixed(3)})\n${doc.pageContent}`
    )
    .join("\n\n---\n\n");

  const sources = allChunks.map(({ doc, score }) => ({
    videoId: doc.metadata.video_id,
    chunkIndex: doc.metadata.chunk_index,
    platform: doc.metadata.platform,
    creator: doc.metadata.creator,
    relevance: parseFloat((1 - score).toFixed(3)),
    excerpt: doc.pageContent.slice(0, 120) + "...",
  }));

  // Step 2: Build messages with history + retrieved context
  const systemPrompt = buildSystemPrompt(videoMetadata);

  const historyMessages = messages.map((m) =>
    m.role === "human" ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  const augmentedUserMessage = `RETRIEVED TRANSCRIPT CONTEXT:
${contextBlock || "(no relevant chunks found)"}

USER QUESTION:
${userMessage}`;

  const promptMessages = [
    new SystemMessage(systemPrompt),
    ...historyMessages,
    new HumanMessage(augmentedUserMessage),
  ];

  // Step 3: Stream response from Groq
  const llm = getLLM();
  let fullAnswer = "";

  const stream = await llm.stream(promptMessages);
  for await (const chunk of stream) {
    const token = chunk.content || "";
    if (token) {
      fullAnswer += token;
      onToken(token);
    }
  }

  // Step 4: Save to session memory (keep last 20 messages)
  messages.push({ role: "human", content: userMessage });
  messages.push({ role: "assistant", content: fullAnswer });
  if (messages.length > 20) messages.splice(0, messages.length - 20);

  return { answer: fullAnswer, sources };
}