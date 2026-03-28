/**
 * IntentStore — JSON-persisted store for intent detection logs and
 * intent-to-template routing mappings.
 *
 * Persistence: single JSON file with shape { logs, mappings }.
 * Follows the PlaybookStore pattern: load on construction, save on every
 * mutation, ENOENT = empty, re-throw all other errors.
 *
 * Usage:
 *   const store = initIntentStore("/path/to/intents.json");
 *   const entry = store.logDetection({ tenantId: "t1", sessionId: null, ... });
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";
import type { CallerIntent } from "./IntentClassifier.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Persisted record of a single intent detection event. */
export interface IntentLogEntry {
  entryId: string;
  tenantId: string | null;
  sessionId: string | null;
  text: string;         // snippet of text that was classified (max 200 chars)
  intent: CallerIntent;
  confidence: number;
  detectedAt: string;   // ISO timestamp
}

/** Maps a caller intent to an agent template for routing. */
export interface IntentTemplateMapping {
  intent: CallerIntent;
  templateId: string;   // AgentTemplate id to route to
  tenantId: string | null;
  updatedAt: string;
}

interface StorageShape {
  logs: IntentLogEntry[];
  mappings: IntentTemplateMapping[];
}

// ── IntentStore ────────────────────────────────────────────────────────

/** JSON-persisted store for intent detection logs and intent-to-template mappings. */
export class IntentStore {
  private logs: IntentLogEntry[] = [];
  private mappings: IntentTemplateMapping[] = [];
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
      const data = JSON.parse(raw) as StorageShape;
      this.logs = Array.isArray(data.logs) ? data.logs : [];
      this.mappings = Array.isArray(data.mappings) ? data.mappings : [];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const data: StorageShape = { logs: this.logs, mappings: this.mappings };
    writeFileSync(this.storageFile, JSON.stringify(data, null, 2), "utf-8");
  }

  // ── Log methods ────────────────────────────────────────────────────

  /**
   * Record a new intent detection event.
   *
   * @param data - Detection data (entryId and detectedAt are auto-generated).
   * @returns The persisted IntentLogEntry with generated id and timestamp.
   */
  logDetection(
    data: Omit<IntentLogEntry, "entryId" | "detectedAt">,
  ): IntentLogEntry {
    const entry: IntentLogEntry = {
      ...data,
      text: data.text.slice(0, 200),
      entryId: randomUUID(),
      detectedAt: new Date().toISOString(),
    };

    this.logs.push(entry);
    this.saveToDisk();
    return entry;
  }

  /**
   * Count occurrences of each intent, optionally filtered by tenantId.
   *
   * @param tenantId - If provided, only logs for this tenant are counted.
   * @returns Map of intent → count for all CallerIntent values.
   */
  getFrequencies(tenantId?: string): Record<CallerIntent, number> {
    const frequencies: Record<CallerIntent, number> = {
      billing: 0,
      support: 0,
      sales: 0,
      complaint: 0,
      general: 0,
    };

    const source = tenantId !== undefined
      ? this.logs.filter((e) => e.tenantId === tenantId)
      : this.logs;

    for (const entry of source) {
      frequencies[entry.intent] = (frequencies[entry.intent] ?? 0) + 1;
    }

    return frequencies;
  }

  /**
   * List detection log entries, most recent first.
   *
   * @param tenantId - Optional filter for a specific tenant.
   * @param limit    - Maximum entries to return (default 50).
   * @returns Sorted array of IntentLogEntry.
   */
  listLogs(tenantId?: string, limit = 50): IntentLogEntry[] {
    let results = tenantId !== undefined
      ? this.logs.filter((e) => e.tenantId === tenantId)
      : [...this.logs];

    // Most recent first
    results.sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );

    return results.slice(0, limit);
  }

  // ── Mapping methods ────────────────────────────────────────────────

  /**
   * Create or update the template mapping for an intent+tenant combination.
   *
   * @param tenantId   - Tenant scope, or null for global mapping.
   * @param intent     - The CallerIntent to map.
   * @param templateId - AgentTemplate id to route to.
   * @returns The created/updated IntentTemplateMapping.
   */
  setMapping(
    tenantId: string | null,
    intent: CallerIntent,
    templateId: string,
  ): IntentTemplateMapping {
    const existing = this.mappings.findIndex(
      (m) => m.tenantId === tenantId && m.intent === intent,
    );

    const mapping: IntentTemplateMapping = {
      intent,
      templateId,
      tenantId,
      updatedAt: new Date().toISOString(),
    };

    if (existing >= 0) {
      this.mappings[existing] = mapping;
    } else {
      this.mappings.push(mapping);
    }

    this.saveToDisk();
    return mapping;
  }

  /**
   * Retrieve the template mapping for an intent+tenant combination.
   *
   * @param tenantId - Tenant scope, or null for global lookup.
   * @param intent   - The CallerIntent to look up.
   * @returns The matching IntentTemplateMapping, or undefined if not set.
   */
  getMapping(
    tenantId: string | null,
    intent: CallerIntent,
  ): IntentTemplateMapping | undefined {
    return this.mappings.find(
      (m) => m.tenantId === tenantId && m.intent === intent,
    );
  }

  /**
   * List all mappings for a given tenant scope plus global (null) mappings.
   *
   * @param tenantId - If provided, returns mappings for this tenant + global ones.
   *                   If omitted, returns all mappings.
   * @returns Array of IntentTemplateMapping.
   */
  listMappings(tenantId?: string): IntentTemplateMapping[] {
    if (tenantId === undefined) {
      return [...this.mappings];
    }
    return this.mappings.filter(
      (m) => m.tenantId === tenantId || m.tenantId === null,
    );
  }

  /**
   * Delete the template mapping for an intent+tenant combination.
   *
   * @param tenantId - Tenant scope, or null for global mapping.
   * @param intent   - The CallerIntent whose mapping to remove.
   * @returns true if a mapping was removed, false if none existed.
   */
  deleteMapping(tenantId: string | null, intent: CallerIntent): boolean {
    const idx = this.mappings.findIndex(
      (m) => m.tenantId === tenantId && m.intent === intent,
    );

    if (idx < 0) {
      return false;
    }

    this.mappings.splice(idx, 1);
    this.saveToDisk();
    return true;
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

let _store: IntentStore | null = null;

/** Module-level singleton. Access after calling initIntentStore(). */
export const intentStore: IntentStore = new Proxy(
  {} as IntentStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "IntentStore not initialized. Call initIntentStore() first.",
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
export function initIntentStore(storageFile: string): IntentStore {
  _store = new IntentStore(storageFile);
  return _store;
}
