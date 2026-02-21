/**
 * DisclaimerLookup Unit Tests
 *
 * Tests the disclaimer catalog loading, caching, lookup, and formatting
 * pipeline including:
 * - resolveDisclaimerPath: candidate path resolution with caching
 * - loadDisclaimerCatalog: JSON parsing, validation, error handling
 * - lookupDisclaimer / lookup_disclaimer: single-ID lookup
 * - lookupDisclaimers: batch lookup with deduplication
 * - formatDisclaimerBlock: text joining with separator options
 * - resetDisclaimerCache: cache invalidation
 *
 * Target Coverage: 100% of exported functions, ~95% branch coverage
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import {
  lookupDisclaimer,
  lookup_disclaimer,
  lookupDisclaimers,
  formatDisclaimerBlock,
  resetDisclaimerCache,
} from "../../retrieval/DisclaimerLookup.js";

// -- Mocks ------------------------------------------------------------------

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

// -- Helpers ----------------------------------------------------------------

const CANDIDATE_1 = resolve(process.cwd(), "knowledge", "disclaimers.json");
const CANDIDATE_2 = resolve(process.cwd(), "..", "knowledge", "disclaimers.json");

function makeCatalogJson(
  disclaimers: Array<{
    id: string;
    text: string;
    category?: string;
    required_for?: string[];
  }>,
): string {
  return JSON.stringify({ disclaimers });
}

const VALID_CATALOG = makeCatalogJson([
  { id: "DISC-001", text: "Past performance is not indicative of future results." },
  { id: "DISC-002", text: "Consult your physician before starting any program." },
  {
    id: "DISC-003",
    text: "Results may vary.",
    category: "general",
    required_for: ["health", "fitness"],
  },
]);

/**
 * Configure mocks so that the first candidate path exists and returns
 * the provided catalog JSON (or the default VALID_CATALOG).
 */
function setupValidCatalog(json: string = VALID_CATALOG): void {
  mockExistsSync.mockImplementation((p) => p === CANDIDATE_1);
  mockReadFileSync.mockReturnValue(json);
}

/**
 * Configure mocks so that no candidate path exists.
 */
function setupMissingCatalog(): void {
  mockExistsSync.mockReturnValue(false);
}

// -- Lifecycle --------------------------------------------------------------

let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  resetDisclaimerCache();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// -- Tests ------------------------------------------------------------------

// ── lookupDisclaimer ──────────────────────────────────────────────────────

describe("lookupDisclaimer", () => {
  it("returns null for an empty string id", () => {
    setupValidCatalog();
    expect(lookupDisclaimer("")).toBeNull();
  });

  it("returns null for a falsy id (empty after coercion)", () => {
    setupValidCatalog();
    // The guard is `if (!disclaimerId)` so any falsy string triggers it
    expect(lookupDisclaimer("")).toBeNull();
    // Filesystem should not be touched for falsy IDs
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns disclaimer text when the id exists in the catalog", () => {
    setupValidCatalog();
    const text = lookupDisclaimer("DISC-001");
    expect(text).toBe("Past performance is not indicative of future results.");
  });

  it("returns disclaimer text for a different valid id", () => {
    setupValidCatalog();
    const text = lookupDisclaimer("DISC-003");
    expect(text).toBe("Results may vary.");
  });

  it("returns null and logs a warning for an unknown id", () => {
    setupValidCatalog();
    const text = lookupDisclaimer("DISC-UNKNOWN");
    expect(text).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown disclaimer id: DISC-UNKNOWN"),
    );
  });

  it("uses the cached catalog on subsequent calls (reads file only once)", () => {
    setupValidCatalog();

    lookupDisclaimer("DISC-001");
    lookupDisclaimer("DISC-002");
    lookupDisclaimer("DISC-003");

    // readFileSync should have been called exactly once despite three lookups
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

// ── lookup_disclaimer (snake_case alias) ──────────────────────────────────

describe("lookup_disclaimer", () => {
  it("delegates to lookupDisclaimer and returns the same result", () => {
    setupValidCatalog();
    expect(lookup_disclaimer("DISC-001")).toBe(
      "Past performance is not indicative of future results.",
    );
  });

  it("returns null for an unknown id, matching lookupDisclaimer behavior", () => {
    setupValidCatalog();
    expect(lookup_disclaimer("DISC-NOPE")).toBeNull();
  });

  it("returns null for empty string, matching lookupDisclaimer behavior", () => {
    setupValidCatalog();
    expect(lookup_disclaimer("")).toBeNull();
  });
});

// ── lookupDisclaimers ─────────────────────────────────────────────────────

describe("lookupDisclaimers", () => {
  it("returns texts for found IDs and missing for unknown IDs", () => {
    setupValidCatalog();
    const result = lookupDisclaimers(["DISC-001", "DISC-MISSING"]);
    expect(result.texts).toEqual([
      "Past performance is not indicative of future results.",
    ]);
    expect(result.missing).toEqual(["DISC-MISSING"]);
  });

  it("deduplicates IDs so each is looked up only once", () => {
    setupValidCatalog();
    const result = lookupDisclaimers(["DISC-001", "DISC-001", "DISC-001"]);
    expect(result.texts).toEqual([
      "Past performance is not indicative of future results.",
    ]);
    expect(result.missing).toEqual([]);
  });

  it("filters out empty and falsy IDs", () => {
    setupValidCatalog();
    const result = lookupDisclaimers(["", "", "DISC-002", ""]);
    expect(result.texts).toEqual([
      "Consult your physician before starting any program.",
    ]);
    expect(result.missing).toEqual([]);
  });

  it("returns all IDs in missing when none are found", () => {
    setupValidCatalog();
    const result = lookupDisclaimers(["NOPE-1", "NOPE-2"]);
    expect(result.texts).toEqual([]);
    expect(result.missing).toEqual(["NOPE-1", "NOPE-2"]);
  });

  it("returns all texts when every ID is found", () => {
    setupValidCatalog();
    const result = lookupDisclaimers(["DISC-001", "DISC-002", "DISC-003"]);
    expect(result.texts).toHaveLength(3);
    expect(result.missing).toEqual([]);
  });

  it("handles an empty input array", () => {
    setupValidCatalog();
    const result = lookupDisclaimers([]);
    expect(result.texts).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

// ── formatDisclaimerBlock ─────────────────────────────────────────────────

describe("formatDisclaimerBlock", () => {
  it("returns null text when no disclaimers are found", () => {
    setupValidCatalog();
    const result = formatDisclaimerBlock(["NOPE-1", "NOPE-2"]);
    expect(result.text).toBeNull();
    expect(result.missing).toEqual(["NOPE-1", "NOPE-2"]);
  });

  it("joins texts with default separator (space)", () => {
    setupValidCatalog();
    const result = formatDisclaimerBlock(["DISC-001", "DISC-002"]);
    expect(result.text).toBe(
      "Past performance is not indicative of future results. " +
        "Consult your physician before starting any program.",
    );
    expect(result.missing).toEqual([]);
  });

  it("joins texts with a custom separator", () => {
    setupValidCatalog();
    const result = formatDisclaimerBlock(["DISC-001", "DISC-003"], {
      separator: "\n\n",
    });
    expect(result.text).toBe(
      "Past performance is not indicative of future results.\n\nResults may vary.",
    );
  });

  it("returns missing IDs alongside joined text for partial matches", () => {
    setupValidCatalog();
    const result = formatDisclaimerBlock(["DISC-001", "DISC-MISSING"]);
    expect(result.text).toBe(
      "Past performance is not indicative of future results.",
    );
    expect(result.missing).toEqual(["DISC-MISSING"]);
  });

  it("returns null text when given an empty array", () => {
    setupValidCatalog();
    const result = formatDisclaimerBlock([]);
    expect(result.text).toBeNull();
    expect(result.missing).toEqual([]);
  });

  it("returns null text when given only empty-string IDs", () => {
    setupValidCatalog();
    const result = formatDisclaimerBlock(["", ""]);
    expect(result.text).toBeNull();
    expect(result.missing).toEqual([]);
  });
});

// ── resetDisclaimerCache ──────────────────────────────────────────────────

describe("resetDisclaimerCache", () => {
  it("clears cached map and path so subsequent lookups reload from disk", () => {
    setupValidCatalog();
    // Prime the cache
    expect(lookupDisclaimer("DISC-001")).toBe(
      "Past performance is not indicative of future results.",
    );
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);

    // Reset cache
    resetDisclaimerCache();

    // Provide a different catalog after reset
    const updatedCatalog = makeCatalogJson([
      { id: "DISC-001", text: "Updated disclaimer text." },
    ]);
    mockReadFileSync.mockReturnValue(updatedCatalog);

    // The module should re-read from disk and get the new text
    expect(lookupDisclaimer("DISC-001")).toBe("Updated disclaimer text.");
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  it("allows path resolution to re-run after reset", () => {
    // First: only candidate 2 exists
    mockExistsSync.mockImplementation((p) => p === CANDIDATE_2);
    mockReadFileSync.mockReturnValue(VALID_CATALOG);
    lookupDisclaimer("DISC-001");
    expect(mockExistsSync).toHaveBeenCalledWith(CANDIDATE_1);
    expect(mockExistsSync).toHaveBeenCalledWith(CANDIDATE_2);

    resetDisclaimerCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();

    // After reset: candidate 1 now exists
    mockExistsSync.mockImplementation((p) => p === CANDIDATE_1);
    mockReadFileSync.mockReturnValue(
      makeCatalogJson([{ id: "DISC-NEW", text: "New disclaimer." }]),
    );
    expect(lookupDisclaimer("DISC-NEW")).toBe("New disclaimer.");
  });
});

// ── resolveDisclaimerPath (tested indirectly through lookupDisclaimer) ────

describe("resolveDisclaimerPath (indirect)", () => {
  it("returns the first candidate path when it exists", () => {
    mockExistsSync.mockImplementation((p) => p === CANDIDATE_1);
    mockReadFileSync.mockReturnValue(VALID_CATALOG);

    lookupDisclaimer("DISC-001");

    expect(mockReadFileSync).toHaveBeenCalledWith(CANDIDATE_1, "utf-8");
  });

  it("falls back to the second candidate when the first does not exist", () => {
    mockExistsSync.mockImplementation((p) => {
      if (p === CANDIDATE_1) return false;
      if (p === CANDIDATE_2) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(VALID_CATALOG);

    lookupDisclaimer("DISC-001");

    expect(mockReadFileSync).toHaveBeenCalledWith(CANDIDATE_2, "utf-8");
  });

  it("returns null (empty catalog) when no candidate paths exist", () => {
    setupMissingCatalog();

    const text = lookupDisclaimer("DISC-001");

    expect(text).toBeNull();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("caches the resolved path so existsSync is not called again", () => {
    setupValidCatalog();

    lookupDisclaimer("DISC-001");
    const callsAfterFirst = mockExistsSync.mock.calls.length;

    lookupDisclaimer("DISC-002");
    // existsSync should not have been called again
    expect(mockExistsSync.mock.calls.length).toBe(callsAfterFirst);
  });

  it("logs missing catalog warning only once across repeated lookups (isolated)", () => {
    // loggedMissingCatalog is module-level state not cleared by resetDisclaimerCache,
    // so we need an isolated module to test the "only once" semantics.
    let isolatedLookup: typeof lookupDisclaimer;
    let isolatedReset: typeof resetDisclaimerCache;

    jest.isolateModules(() => {
      const mod = require("../../retrieval/DisclaimerLookup.js");
      isolatedLookup = mod.lookupDisclaimer;
      isolatedReset = mod.resetDisclaimerCache;
    });

    mockExistsSync.mockReturnValue(false);
    consoleWarnSpy.mockClear();

    // First lookup: triggers the "not found" warning
    isolatedLookup!("DISC-001");
    const firstRound = consoleWarnSpy.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("disclaimers.json not found"),
    );
    expect(firstRound).toHaveLength(1);

    // Reset cache (but NOT loggedMissingCatalog) and look up again
    isolatedReset!();
    consoleWarnSpy.mockClear();

    isolatedLookup!("DISC-002");
    const secondRound = consoleWarnSpy.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("disclaimers.json not found"),
    );
    expect(secondRound).toHaveLength(0);
  });
});

// ── loggedMissingCatalog branch (requires module isolation) ───────────────

describe("loggedMissingCatalog (isolated module)", () => {
  it("logs the missing catalog warning on first load, suppresses on second", async () => {
    // Use isolateModules to get a fresh module with loggedMissingCatalog = false
    let isolatedLookup: typeof lookupDisclaimer;
    let isolatedReset: typeof resetDisclaimerCache;

    jest.isolateModules(() => {
      // The fs mock is already in place from the top-level jest.mock
      const mod = require("../../retrieval/DisclaimerLookup.js");
      isolatedLookup = mod.lookupDisclaimer;
      isolatedReset = mod.resetDisclaimerCache;
    });

    mockExistsSync.mockReturnValue(false);

    // First call: should log the missing catalog warning
    isolatedLookup!("DISC-001");
    const firstCallWarnings = consoleWarnSpy.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("disclaimers.json not found"),
    );
    expect(firstCallWarnings).toHaveLength(1);

    // Reset cache to force re-resolution, but loggedMissingCatalog stays true
    isolatedReset!();
    consoleWarnSpy.mockClear();

    // Second call: should NOT log the missing catalog warning again
    isolatedLookup!("DISC-001");
    const secondCallWarnings = consoleWarnSpy.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("disclaimers.json not found"),
    );
    expect(secondCallWarnings).toHaveLength(0);
  });
});

// ── loadDisclaimerCatalog (tested indirectly through lookupDisclaimer) ────

describe("loadDisclaimerCatalog (indirect)", () => {
  it("loads and parses valid JSON with multiple entries", () => {
    setupValidCatalog();

    expect(lookupDisclaimer("DISC-001")).toBe(
      "Past performance is not indicative of future results.",
    );
    expect(lookupDisclaimer("DISC-002")).toBe(
      "Consult your physician before starting any program.",
    );
    expect(lookupDisclaimer("DISC-003")).toBe("Results may vary.");
  });

  it("returns empty catalog when JSON has no disclaimers key", () => {
    setupValidCatalog(JSON.stringify({}));

    const text = lookupDisclaimer("DISC-001");
    expect(text).toBeNull();
  });

  it("returns empty catalog when disclaimers value is not an array", () => {
    setupValidCatalog(JSON.stringify({ disclaimers: "not-an-array" }));

    const text = lookupDisclaimer("DISC-001");
    expect(text).toBeNull();
  });

  it("returns empty catalog when disclaimers value is null", () => {
    setupValidCatalog(JSON.stringify({ disclaimers: null }));

    const text = lookupDisclaimer("DISC-001");
    expect(text).toBeNull();
  });

  it("skips entries with missing id field", () => {
    const catalog = JSON.stringify({
      disclaimers: [
        { text: "No id here" },
        { id: "DISC-OK", text: "Has both fields." },
      ],
    });
    setupValidCatalog(catalog);

    expect(lookupDisclaimer("DISC-OK")).toBe("Has both fields.");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping invalid disclaimer entry"),
      expect.objectContaining({ text: "No id here" }),
    );
  });

  it("skips entries with missing text field", () => {
    const catalog = JSON.stringify({
      disclaimers: [
        { id: "DISC-NO-TEXT" },
        { id: "DISC-OK", text: "Valid entry." },
      ],
    });
    setupValidCatalog(catalog);

    expect(lookupDisclaimer("DISC-NO-TEXT")).toBeNull();
    expect(lookupDisclaimer("DISC-OK")).toBe("Valid entry.");
  });

  it("skips null entries in the disclaimers array", () => {
    const catalog = JSON.stringify({
      disclaimers: [null, { id: "DISC-OK", text: "Still works." }],
    });
    setupValidCatalog(catalog);

    expect(lookupDisclaimer("DISC-OK")).toBe("Still works.");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping invalid disclaimer entry"),
      null,
    );
  });

  it("skips entries where id is not a string", () => {
    const catalog = JSON.stringify({
      disclaimers: [
        { id: 123, text: "Numeric id" },
        { id: "DISC-OK", text: "String id." },
      ],
    });
    setupValidCatalog(catalog);

    expect(lookupDisclaimer("DISC-OK")).toBe("String id.");
  });

  it("skips entries where text is not a string", () => {
    const catalog = JSON.stringify({
      disclaimers: [
        { id: "DISC-BAD", text: 42 },
        { id: "DISC-OK", text: "Proper text." },
      ],
    });
    setupValidCatalog(catalog);

    expect(lookupDisclaimer("DISC-BAD")).toBeNull();
    expect(lookupDisclaimer("DISC-OK")).toBe("Proper text.");
  });

  it("handles JSON parse errors gracefully and returns empty catalog", () => {
    mockExistsSync.mockImplementation((p) => p === CANDIDATE_1);
    mockReadFileSync.mockReturnValue("NOT VALID JSON {{{");

    const text = lookupDisclaimer("DISC-001");

    expect(text).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load disclaimers:"),
      expect.any(SyntaxError),
    );
  });

  it("handles readFileSync throwing an error gracefully", () => {
    mockExistsSync.mockImplementation((p) => p === CANDIDATE_1);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const text = lookupDisclaimer("DISC-001");

    expect(text).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load disclaimers:"),
      expect.any(Error),
    );
  });

  it("caches the loaded catalog so the file is read only once", () => {
    setupValidCatalog();

    lookupDisclaimer("DISC-001");
    lookupDisclaimer("DISC-002");
    lookupDisclaimer("DISC-003");
    lookupDisclaimer("DISC-UNKNOWN");

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it("caches an empty map when file is missing, preventing re-reads", () => {
    setupMissingCatalog();

    lookupDisclaimer("DISC-001");
    lookupDisclaimer("DISC-002");

    // No file reads should occur when the path is null
    expect(mockReadFileSync).not.toHaveBeenCalled();
    // existsSync should be called for candidate paths on first load only
    // (second call uses cached empty map)
    const existsCalls = mockExistsSync.mock.calls.length;
    expect(existsCalls).toBe(2); // two candidates checked once
  });
});
