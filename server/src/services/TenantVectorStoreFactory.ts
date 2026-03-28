/**
 * Factory for per-tenant ChromaDB vector stores.
 * Each tenant gets an isolated ChromaDB collection named `${prefix}_${tenantId}`.
 */

import { ChromaDbVectorStore } from "../retrieval/ChromaDbVectorStore.js";

export { type AsyncVectorStore } from "../retrieval/ChromaDbVectorStore.js";

export interface TenantVectorStoreFactoryConfig {
  /** ChromaDB server URL. Default: http://localhost:8000 */
  url?: string;
  /**
   * Collection name prefix. Default: "knowledge".
   * Tenant collection = `${prefix}_${tenantId}`.
   * The "default" tenant maps to `${prefix}_default`.
   */
  collectionPrefix?: string;
}

/** Factory that provisions and caches isolated ChromaDB vector stores per tenant. */
export class TenantVectorStoreFactory {
  private readonly stores = new Map<string, ChromaDbVectorStore<unknown>>();
  private readonly url: string;
  private readonly collectionPrefix: string;

  constructor(config: TenantVectorStoreFactoryConfig = {}) {
    this.url = config.url ?? process.env.CHROMADB_URL ?? "http://localhost:8000";
    this.collectionPrefix = config.collectionPrefix ?? "knowledge";
  }

  /**
   * Returns the ChromaDB collection name for a tenant.
   * Always includes the tenantId suffix: `${prefix}_${tenantId}`.
   */
  getCollectionForTenant(tenantId: string): string {
    return `${this.collectionPrefix}_${tenantId}`;
  }

  /**
   * Get (or create) a ChromaDbVectorStore for the given tenant.
   * Instances are cached -- the same store is returned on subsequent calls.
   * Does NOT call connect() -- caller must call connect() before use.
   */
  getStoreForTenant<TMeta>(tenantId: string): ChromaDbVectorStore<TMeta> {
    if (!this.stores.has(tenantId)) {
      this.stores.set(
        tenantId,
        new ChromaDbVectorStore<TMeta>({
          url: this.url,
          collectionName: this.getCollectionForTenant(tenantId),
        }),
      );
    }
    return this.stores.get(tenantId) as ChromaDbVectorStore<TMeta>;
  }

  /** Returns true if a store has been created for the given tenantId. */
  hasStore(tenantId: string): boolean {
    return this.stores.has(tenantId);
  }

  /** Number of tenant stores currently cached. */
  get size(): number {
    return this.stores.size;
  }

  /**
   * Remove the cached store for a specific tenant, or clear all if no argument.
   * Does not call clear() on the underlying ChromaDB collection.
   */
  clear(tenantId?: string): void {
    if (tenantId !== undefined) {
      this.stores.delete(tenantId);
    } else {
      this.stores.clear();
    }
  }
}

/**
 * Module-level singleton.
 * URL read from CHROMADB_URL env var (default: http://localhost:8000).
 */
export const tenantVectorStoreFactory = new TenantVectorStoreFactory();
