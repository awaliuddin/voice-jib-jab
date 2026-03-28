/**
 * ConversationMemoryStore — Per-tenant cross-session memory persistence.
 *
 * Stores key facts shared across ALL sessions for a given tenant.
 * Each tenant gets its own JSON file: {storageDir}/{tenantId}.json
 *
 * Usage:
 *   const store = initConversationMemoryStore("/path/to/memory");
 *   store.add({ tenantId: "org_acme", fact: "Prefers formal tone", source: "manual" });
 *   const ctx = store.getContextString("org_acme");
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────

/** A persisted cross-session memory fact for a tenant. */
export interface MemoryEntry {
  id: string;
  tenantId: string;
  fact: string;
  tags?: string[];
  source: "manual" | "session";
  createdAt: string;
  sessionId?: string;
}

/** Fields required when adding a new entry (id and createdAt are generated). */
export type NewMemoryEntry = Omit<MemoryEntry, "id" | "createdAt">;

// ── ConversationMemoryStore ───────────────────────────────────────────

/** Per-tenant cross-session memory store backed by JSON files on disk. */
export class ConversationMemoryStore {
  private storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
  }

  /** Resolve the JSON file path for a given tenant. */
  private filePath(tenantId: string): string {
    return join(this.storageDir, `${tenantId}.json`);
  }

  /** Ensure the storage directory exists. */
  private ensureDir(): void {
    mkdirSync(this.storageDir, { recursive: true });
  }

  /** Load all entries for a tenant from disk. Returns [] if no file. */
  load(tenantId: string): MemoryEntry[] {
    const path = this.filePath(tenantId);
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as MemoryEntry[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /** Persist entries for a tenant to disk. */
  private save(tenantId: string, entries: MemoryEntry[]): void {
    this.ensureDir();
    writeFileSync(this.filePath(tenantId), JSON.stringify(entries, null, 2), "utf-8");
  }

  /** Add a memory entry. Persists immediately. Returns the created entry. */
  add(entry: NewMemoryEntry): MemoryEntry {
    const created: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    const existing = this.load(entry.tenantId);
    existing.push(created);
    this.save(entry.tenantId, existing);

    return created;
  }

  /** Get all entries for a tenant, sorted by createdAt descending (newest first). */
  getForTenant(tenantId: string): MemoryEntry[] {
    const entries = this.load(tenantId);
    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Build a context string from a tenant's most recent facts.
   *
   * Returns a formatted string suitable for injection into LLM context,
   * or an empty string if the tenant has no stored facts.
   *
   * @param tenantId - The tenant to retrieve facts for
   * @param maxFacts - Maximum number of facts to include (default 10)
   */
  getContextString(tenantId: string, maxFacts: number = 10): string {
    const entries = this.getForTenant(tenantId);
    if (entries.length === 0) {
      return "";
    }

    const facts = entries.slice(0, maxFacts);
    return "Tenant memory context:\n" + facts.map((f) => `- ${f.fact}`).join("\n");
  }

  /** Delete all entries for a tenant. */
  clearTenant(tenantId: string): void {
    const path = this.filePath(tenantId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  /**
   * Delete a specific entry by ID.
   *
   * @returns true if the entry was found and removed, false otherwise.
   */
  deleteEntry(tenantId: string, entryId: string): boolean {
    const entries = this.load(tenantId);
    const index = entries.findIndex((e) => e.id === entryId);
    if (index === -1) {
      return false;
    }

    entries.splice(index, 1);
    this.save(tenantId, entries);
    return true;
  }
}

// ── Module-level singleton ────────────────────────────────────────────

let _store: ConversationMemoryStore | null = null;

/** Module-level singleton. Access after calling initConversationMemoryStore(). */
export const conversationMemoryStore: ConversationMemoryStore = new Proxy(
  {} as ConversationMemoryStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "ConversationMemoryStore not initialized. Call initConversationMemoryStore() first.",
        );
      }
      const value = (_store as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_store);
      }
      return value;
    },
  },
);

/** Initialize the module-level singleton with a storage directory. */
export function initConversationMemoryStore(dir: string): ConversationMemoryStore {
  _store = new ConversationMemoryStore(dir);
  return _store;
}
