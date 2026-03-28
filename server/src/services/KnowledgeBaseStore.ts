/**
 * KnowledgeBaseStore — Per-tenant knowledge base persistence.
 *
 * Stores FAQ-style question/answer entries per tenant, with text similarity
 * search and hit-count tracking. Each tenant gets its own JSON file:
 * {storageDir}/{tenantId}.json
 *
 * Usage:
 *   const store = initKnowledgeBaseStore("/path/to/kb");
 *   store.addEntry({ tenantId: "org_acme", question: "How do I reset?", answer: "Click Settings > Reset" });
 *   const results = store.search("org_acme", "reset password");
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────

/** A knowledge base FAQ entry with question, answer, tags, and hit-count tracking. */
export interface KbEntry {
  id: string;
  tenantId: string;
  question: string;
  answer: string;
  tags: string[];
  source: "manual" | "extracted";
  sessionId?: string;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Stopwords (local copy — no cross-import from ConversationSummarizer) ──

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else",
  "with", "without", "for", "to", "of", "in", "on", "at", "by",
  "from", "is", "it", "be", "as", "do", "so", "we", "he", "she",
  "me", "my", "no", "not", "up", "am", "are", "was", "were", "been",
  "has", "had", "did", "its", "his", "her", "our", "you", "your",
  "can", "may", "will", "shall", "could", "would", "should",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "how", "when", "where", "why", "there", "here",
]);

// ── Helpers ───────────────────────────────────────────────────────────

/** Tokenize a string into lowercase words, removing stopwords and words < 3 chars. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// ── KnowledgeBaseStore ────────────────────────────────────────────────

/** Per-tenant FAQ knowledge base with text similarity search and hit-count ranking. */
export class KnowledgeBaseStore {
  /** In-memory cache: tenantId -> KbEntry[] */
  private cache: Map<string, KbEntry[]> = new Map();

  /** Reverse index: entryId -> tenantId (for cross-tenant lookups by id) */
  private idIndex: Map<string, string> = new Map();

  constructor(private storageDir: string) {}

  // ── Private persistence helpers ───────────────────────────────────

  /** Resolve the JSON file path for a given tenant. */
  private filePath(tenantId: string): string {
    return join(this.storageDir, `${tenantId}.json`);
  }

  /** Ensure the storage directory exists. */
  private ensureDir(): void {
    mkdirSync(this.storageDir, { recursive: true });
  }

  /** Load entries for a tenant into cache (lazy, only if not already cached). */
  private loadTenant(tenantId: string): KbEntry[] {
    if (this.cache.has(tenantId)) {
      return this.cache.get(tenantId)!;
    }

    let entries: KbEntry[] = [];
    const path = this.filePath(tenantId);
    try {
      const raw = readFileSync(path, "utf-8");
      entries = JSON.parse(raw) as KbEntry[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    this.cache.set(tenantId, entries);
    for (const entry of entries) {
      this.idIndex.set(entry.id, tenantId);
    }
    return entries;
  }

  /** Persist current cache for a tenant to disk. */
  private saveTenant(tenantId: string): void {
    this.ensureDir();
    const entries = this.cache.get(tenantId) ?? [];
    writeFileSync(this.filePath(tenantId), JSON.stringify(entries, null, 2), "utf-8");
  }

  // ── Public API ────────────────────────────────────────────────────

  /** Add a new knowledge base entry. Persists immediately. */
  addEntry(opts: {
    tenantId: string;
    question: string;
    answer: string;
    tags?: string[];
    source?: "manual" | "extracted";
    sessionId?: string;
  }): KbEntry {
    const now = new Date().toISOString();
    const entry: KbEntry = {
      id: randomUUID(),
      tenantId: opts.tenantId,
      question: opts.question,
      answer: opts.answer,
      tags: opts.tags ?? [],
      source: opts.source ?? "manual",
      sessionId: opts.sessionId,
      hitCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const entries = this.loadTenant(opts.tenantId);
    entries.push(entry);
    this.idIndex.set(entry.id, opts.tenantId);
    this.saveTenant(opts.tenantId);
    return entry;
  }

  /** Get a single entry by id (across all loaded tenants). */
  getEntry(id: string): KbEntry | undefined {
    const tenantId = this.idIndex.get(id);
    if (!tenantId) {
      return undefined;
    }
    const entries = this.loadTenant(tenantId);
    return entries.find((e) => e.id === id);
  }

  /** List entries for a tenant with optional tag and source filters. */
  listEntries(
    tenantId: string,
    opts?: { tag?: string; source?: "manual" | "extracted" },
  ): KbEntry[] {
    let entries = this.loadTenant(tenantId);

    if (opts?.tag) {
      entries = entries.filter((e) => e.tags.includes(opts.tag!));
    }
    if (opts?.source) {
      entries = entries.filter((e) => e.source === opts.source);
    }

    return entries;
  }

  /** Patch an entry's question, answer, or tags. Returns undefined if not found. */
  updateEntry(
    id: string,
    patch: Partial<Pick<KbEntry, "question" | "answer" | "tags">>,
  ): KbEntry | undefined {
    const tenantId = this.idIndex.get(id);
    if (!tenantId) {
      return undefined;
    }

    const entries = this.loadTenant(tenantId);
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return undefined;
    }

    if (patch.question !== undefined) entry.question = patch.question;
    if (patch.answer !== undefined) entry.answer = patch.answer;
    if (patch.tags !== undefined) entry.tags = patch.tags;
    entry.updatedAt = new Date().toISOString();

    this.saveTenant(tenantId);
    return entry;
  }

  /** Delete an entry by id. Returns true if found and removed. */
  deleteEntry(id: string): boolean {
    const tenantId = this.idIndex.get(id);
    if (!tenantId) {
      return false;
    }

    const entries = this.loadTenant(tenantId);
    const index = entries.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }

    entries.splice(index, 1);
    this.idIndex.delete(id);
    this.saveTenant(tenantId);
    return true;
  }

  /** Increment the hit count for an entry and update its timestamp. */
  incrementHit(id: string): void {
    const tenantId = this.idIndex.get(id);
    if (!tenantId) {
      return;
    }

    const entries = this.loadTenant(tenantId);
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return;
    }

    entry.hitCount += 1;
    entry.updatedAt = new Date().toISOString();
    this.saveTenant(tenantId);
  }

  /**
   * Text similarity search within a tenant's entries.
   *
   * Tokenizes the query (removing stopwords, min 3 chars), then returns
   * entries whose question text contains any query token. Results are
   * sorted by hitCount descending, limited to topN (default 3).
   */
  search(tenantId: string, query: string, topN: number = 3): KbEntry[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const entries = this.loadTenant(tenantId);
    const matches = entries.filter((entry) => {
      const questionTokens = tokenize(entry.question);
      return queryTokens.some((qt) => questionTokens.includes(qt));
    });

    matches.sort((a, b) => b.hitCount - a.hitCount);
    return matches.slice(0, topN);
  }

  /** Remove all entries for a tenant. */
  clearTenant(tenantId: string): void {
    const entries = this.cache.get(tenantId) ?? [];
    for (const entry of entries) {
      this.idIndex.delete(entry.id);
    }
    this.cache.delete(tenantId);

    const path = this.filePath(tenantId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────

let _store: KnowledgeBaseStore | null = null;

/** Module-level singleton. Access after calling initKnowledgeBaseStore(). */
export const knowledgeBaseStore: KnowledgeBaseStore = new Proxy(
  {} as KnowledgeBaseStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "KnowledgeBaseStore not initialized. Call initKnowledgeBaseStore() first.",
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
export function initKnowledgeBaseStore(dir: string): KnowledgeBaseStore {
  _store = new KnowledgeBaseStore(dir);
  return _store;
}
