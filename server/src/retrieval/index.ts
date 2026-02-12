/**
 * Retrieval module exports and singleton initialization.
 */

import { RetrievalService } from "./RetrievalService.js";

function getEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

export const retrievalService = new RetrievalService({
  topK: getEnvNumber("RAG_TOP_K", 5),
  maxTokens: getEnvNumber("RAG_MAX_TOKENS", 600),
  maxBytes: getEnvNumber("RAG_MAX_BYTES", 4000),
});

export function retrieve_nxtg_facts(query: string, topK?: number) {
  return retrievalService.retrieveFactsPack(query, { topK });
}

export function lookup_disclaimer(disclaimerId: string) {
  return retrievalService.lookupDisclaimer(disclaimerId);
}

export { RetrievalService } from "./RetrievalService.js";
export { RAGPipeline } from "./RAGPipeline.js";
export { KnowledgePack } from "./KnowledgePack.js";
export { VectorStore } from "./VectorStore.js";
