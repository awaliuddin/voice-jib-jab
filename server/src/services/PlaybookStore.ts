/**
 * PlaybookStore — JSON-persisted conversation playbook entries.
 *
 * A playbook entry is a named script for a specific scenario (greeting,
 * escalation, closing, FAQ, custom). Entries can be auto-suggested based
 * on keyword matching against live conversation text.
 *
 * Usage:
 *   const store = initPlaybookStore("/path/to/playbooks.json");
 *   const entry = store.createEntry({ name: "Welcome", scenario: "greeting", ... });
 *   const hints = store.suggestEntries("I need help with billing");
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

/** Supported conversation scenario categories for playbook entries. */
export type PlaybookScenario = "greeting" | "escalation" | "closing" | "faq" | "custom";

/** A named scripted response for a specific conversation scenario. */
export interface PlaybookEntry {
  entryId: string;
  name: string;
  scenario: PlaybookScenario;
  script: string;
  keywords: string[];
  tenantId: string | null;
  enabled: boolean;
  createdAt: string;
}

// ── PlaybookStore ──────────────────────────────────────────────────────

/** JSON-persisted CRUD store for conversation playbook entries with keyword-based suggestion. */
export class PlaybookStore {
  private entries: Map<string, PlaybookEntry> = new Map();
  private storageFile: string;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.loadFromDisk();
  }

  // ── Private persistence helpers ────────────────────────────────────

  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      const entries = JSON.parse(raw) as PlaybookEntry[];
      for (const entry of entries) {
        this.entries.set(entry.entryId, entry);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const entries = Array.from(this.entries.values());
    writeFileSync(this.storageFile, JSON.stringify(entries, null, 2), "utf-8");
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Get a single entry by id. */
  getEntry(entryId: string): PlaybookEntry | undefined {
    return this.entries.get(entryId);
  }

  /** List entries with optional filters. */
  listEntries(opts?: {
    tenantId?: string;
    scenario?: PlaybookScenario;
    enabled?: boolean;
  }): PlaybookEntry[] {
    let results = Array.from(this.entries.values());

    if (opts?.tenantId !== undefined) {
      results = results.filter(
        (e) => e.tenantId === opts.tenantId || e.tenantId === null,
      );
    }

    if (opts?.scenario !== undefined) {
      results = results.filter((e) => e.scenario === opts.scenario);
    }

    if (opts?.enabled !== undefined) {
      results = results.filter((e) => e.enabled === opts.enabled);
    }

    return results;
  }

  /** Create a new playbook entry. Persists immediately. */
  createEntry(
    opts: Omit<PlaybookEntry, "entryId" | "createdAt" | "enabled"> & { enabled?: boolean },
  ): PlaybookEntry {
    const entry: PlaybookEntry = {
      ...opts,
      entryId: randomUUID(),
      enabled: opts.enabled ?? true,
      createdAt: new Date().toISOString(),
    };

    this.entries.set(entry.entryId, entry);
    this.saveToDisk();
    return entry;
  }

  /** Patch an existing entry. Returns undefined if not found. */
  updateEntry(
    entryId: string,
    patch: Partial<Omit<PlaybookEntry, "entryId" | "createdAt">>,
  ): PlaybookEntry | undefined {
    const existing = this.entries.get(entryId);
    if (!existing) {
      return undefined;
    }

    const updated: PlaybookEntry = {
      ...existing,
      ...patch,
      entryId,
      createdAt: existing.createdAt,
    };

    this.entries.set(entryId, updated);
    this.saveToDisk();
    return updated;
  }

  /** Delete an entry. Returns false if not found. */
  deleteEntry(entryId: string): boolean {
    if (!this.entries.has(entryId)) {
      return false;
    }

    this.entries.delete(entryId);
    this.saveToDisk();
    return true;
  }

  /**
   * Auto-suggest playbook entries relevant to a conversation snippet.
   *
   * Matches entries where ANY keyword appears as a case-insensitive substring
   * of `text`. Only enabled entries are considered. When `tenantId` is provided,
   * entries are restricted to those belonging to that tenant OR global entries
   * (tenantId === null). Results are sorted by match count (descending) and
   * the top 3 are returned.
   */
  suggestEntries(
    text: string,
    opts?: { tenantId?: string; scenario?: PlaybookScenario },
  ): PlaybookEntry[] {
    const lower = text.toLowerCase();

    let candidates = Array.from(this.entries.values()).filter((e) => e.enabled);

    if (opts?.tenantId !== undefined) {
      candidates = candidates.filter(
        (e) => e.tenantId === opts.tenantId || e.tenantId === null,
      );
    }

    if (opts?.scenario !== undefined) {
      candidates = candidates.filter((e) => e.scenario === opts.scenario);
    }

    const scored: Array<{ entry: PlaybookEntry; count: number }> = candidates
      .map((entry) => {
        const count = entry.keywords.filter((kw) =>
          lower.includes(kw.toLowerCase()),
        ).length;
        return { entry, count };
      })
      .filter(({ count }) => count > 0);

    scored.sort((a, b) => b.count - a.count);

    return scored.slice(0, 3).map(({ entry }) => entry);
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

let _store: PlaybookStore | null = null;

/** Module-level singleton. Access after calling initPlaybookStore(). */
export const playbookStore: PlaybookStore = new Proxy(
  {} as PlaybookStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "PlaybookStore not initialized. Call initPlaybookStore() first.",
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

/** Initialize the module-level singleton with a storage file path. */
export function initPlaybookStore(storageFile: string): PlaybookStore {
  _store = new PlaybookStore(storageFile);
  return _store;
}
