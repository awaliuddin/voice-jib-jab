/**
 * Disclaimer lookup tool
 * Loads disclaimer templates from knowledge/disclaimers.json
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export interface DisclaimerEntry {
  id: string;
  text: string;
  category?: string;
  required_for?: string[];
}

interface DisclaimerCatalog {
  disclaimers?: DisclaimerEntry[];
}

let cachedDisclaimerMap: Map<string, DisclaimerEntry> | null = null;
let cachedDisclaimerPath: string | null = null;
let loggedMissingCatalog = false;

function resolveDisclaimerPath(): string | null {
  if (cachedDisclaimerPath) {
    return cachedDisclaimerPath;
  }

  const candidates = [
    resolve(process.cwd(), "knowledge", "disclaimers.json"),
    resolve(process.cwd(), "..", "knowledge", "disclaimers.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedDisclaimerPath = candidate;
      return candidate;
    }
  }

  if (!loggedMissingCatalog) {
    console.warn(
      `[DisclaimerLookup] disclaimers.json not found. Looked in: ${candidates.join(
        ", ",
      )}`,
    );
    loggedMissingCatalog = true;
  }

  return null;
}

function loadDisclaimerCatalog(): Map<string, DisclaimerEntry> {
  if (cachedDisclaimerMap) {
    return cachedDisclaimerMap;
  }

  const catalogPath = resolveDisclaimerPath();
  if (!catalogPath) {
    cachedDisclaimerMap = new Map();
    return cachedDisclaimerMap;
  }

  try {
    const raw = readFileSync(catalogPath, "utf-8");
    const parsed = JSON.parse(raw) as DisclaimerCatalog;
    const entries = Array.isArray(parsed.disclaimers)
      ? parsed.disclaimers
      : [];

    const map = new Map<string, DisclaimerEntry>();
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || typeof entry.text !== "string") {
        console.warn(
          "[DisclaimerLookup] Skipping invalid disclaimer entry",
          entry,
        );
        continue;
      }
      map.set(entry.id, entry);
    }

    cachedDisclaimerMap = map;
    return map;
  } catch (error) {
    console.error("[DisclaimerLookup] Failed to load disclaimers:", error);
    cachedDisclaimerMap = new Map();
    return cachedDisclaimerMap;
  }
}

/**
 * Tool function: lookup a disclaimer by ID and return its text.
 * Returns null when the disclaimer is missing.
 */
export function lookupDisclaimer(disclaimerId: string): string | null {
  if (!disclaimerId) {
    return null;
  }

  const catalog = loadDisclaimerCatalog();
  const entry = catalog.get(disclaimerId);
  if (!entry) {
    console.warn(`[DisclaimerLookup] Unknown disclaimer id: ${disclaimerId}`);
    return null;
  }

  return entry.text;
}

// Spec-aligned alias (snake_case)
export function lookup_disclaimer(disclaimer_id: string): string | null {
  return lookupDisclaimer(disclaimer_id);
}

/**
 * Lookup multiple disclaimer IDs at once.
 * Returns the list of texts and any missing IDs.
 */
export function lookupDisclaimers(disclaimerIds: string[]): {
  texts: string[];
  missing: string[];
} {
  const texts: string[] = [];
  const missing: string[] = [];

  const uniqueIds = Array.from(new Set(disclaimerIds.filter((id) => id)));
  for (const id of uniqueIds) {
    const text = lookupDisclaimer(id);
    if (text) {
      texts.push(text);
    } else {
      missing.push(id);
    }
  }

  return { texts, missing };
}

/**
 * Format a disclaimer block suitable for appending to a response.
 */
export function formatDisclaimerBlock(
  disclaimerIds: string[],
  options?: { separator?: string },
): { text: string | null; missing: string[] } {
  const { texts, missing } = lookupDisclaimers(disclaimerIds);
  if (texts.length === 0) {
    return { text: null, missing };
  }

  return {
    text: texts.join(options?.separator ?? " "),
    missing,
  };
}

/**
 * Clear cached catalog (useful for tests or hot reload).
 */
export function resetDisclaimerCache(): void {
  cachedDisclaimerMap = null;
  cachedDisclaimerPath = null;
}
