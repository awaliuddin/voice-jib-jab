/**
 * ChromaDB-backed async vector store for external vector search.
 * Provides tenant-isolated collections via the AsyncVectorStore interface.
 */

import { ChromaClient, type Collection } from "chromadb";
import type { VectorDocument, VectorSearchResult } from "./VectorStore.js";

/** Async counterpart to the sync VectorStore interface, for external vector stores. */
export interface AsyncVectorStore<TMeta> {
  readonly collectionName: string;
  connect(): Promise<void>;
  index(documents: VectorDocument<TMeta>[]): Promise<void>;
  search(query: string, topK: number): Promise<VectorSearchResult<TMeta>[]>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

/** Configuration for connecting to a ChromaDB instance. */
export interface ChromaDbVectorStoreConfig {
  /** ChromaDB server URL. Default: http://localhost:8000 */
  url?: string;
  /** Collection name in ChromaDB. */
  collectionName: string;
}

/** ChromaDB-backed persistent vector store with tenant-isolated collections. */
export class ChromaDbVectorStore<TMeta> implements AsyncVectorStore<TMeta> {
  readonly collectionName: string;
  private client: ChromaClient;
  private collection: Collection | null = null;
  private connected = false;

  constructor(config: ChromaDbVectorStoreConfig) {
    this.collectionName = config.collectionName;
    this.client = new ChromaClient({
      path: config.url ?? "http://localhost:8000",
    });
  }

  /**
   * Connect to ChromaDB and get/create the collection with cosine distance metric.
   * Idempotent — safe to call multiple times.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    this.collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
      metadata: { "hnsw:space": "cosine" },
    });
    this.connected = true;
  }

  /**
   * Index documents into the ChromaDB collection.
   * Uses upsert to allow re-indexing without clearing first.
   */
  async index(documents: VectorDocument<TMeta>[]): Promise<void> {
    if (!this.connected || !this.collection) {
      throw new Error(
        "ChromaDbVectorStore: not connected. Call connect() first.",
      );
    }
    if (documents.length === 0) return;

    await this.collection.upsert({
      ids: documents.map((d) => d.id),
      documents: documents.map((d) => d.text),
      metadatas: documents.map((d) => ({
        _meta: JSON.stringify(d.metadata),
      })),
    });
  }

  /**
   * Search the collection. Returns up to topK results sorted by score descending.
   * Score is derived from cosine distance: score = 1 - distance (range 0-1).
   */
  async search(
    query: string,
    topK: number,
  ): Promise<VectorSearchResult<TMeta>[]> {
    if (!this.connected || !this.collection) {
      throw new Error(
        "ChromaDbVectorStore: not connected. Call connect() first.",
      );
    }
    if (!query.trim() || topK <= 0) return [];

    const response = await this.collection.query({
      queryTexts: [query],
      nResults: topK,
    });

    const ids = response.ids?.[0] ?? [];
    const texts = response.documents?.[0] ?? [];
    const metadatas = response.metadatas?.[0] ?? [];
    const distances = response.distances?.[0] ?? [];

    const results: VectorSearchResult<TMeta>[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const text = texts[i] ?? "";
      const rawMeta = metadatas[i] as Record<string, unknown> | null;
      const distance = distances[i] ?? 1;
      const score = Math.max(0, 1 - distance);

      let metadata: TMeta;
      try {
        metadata = JSON.parse(
          typeof rawMeta?._meta === "string" ? rawMeta._meta : "{}",
        ) as TMeta;
      } catch {
        metadata = {} as TMeta;
      }

      if (id && text !== null) {
        results.push({ doc: { id, text, metadata }, score });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /** Remove all documents from this collection by deleting and recreating it. */
  async clear(): Promise<void> {
    if (!this.connected || !this.collection) return;
    try {
      await this.client.deleteCollection({ name: this.collectionName });
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        metadata: { "hnsw:space": "cosine" },
      });
    } catch {
      // Ignore errors if collection doesn't exist
    }
  }

  /** Close the connection (resets internal state). */
  async close(): Promise<void> {
    this.connected = false;
    this.collection = null;
  }
}
