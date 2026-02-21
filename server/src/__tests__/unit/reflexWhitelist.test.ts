/**
 * reflexWhitelist Unit Tests
 *
 * Tests the Lane A reflex whitelist configuration and helper functions
 * that provide pre-approved, non-committal acknowledgement utterances.
 *
 * Target Coverage: 85%+
 */

import {
  REFLEX_WHITELIST,
  getRandomReflex,
  isApprovedReflex,
  getWeightedReflex,
} from "../../config/reflexWhitelist.js";

// ── REFLEX_WHITELIST ───────────────────────────────────────────────────

describe("REFLEX_WHITELIST", () => {
  it("should be a non-empty array of strings", () => {
    expect(Array.isArray(REFLEX_WHITELIST)).toBe(true);
    expect(REFLEX_WHITELIST.length).toBeGreaterThan(0);
  });

  it("should contain only string entries", () => {
    for (const entry of REFLEX_WHITELIST) {
      expect(typeof entry).toBe("string");
    }
  });

  it("should contain known acknowledgement phrases", () => {
    expect(REFLEX_WHITELIST).toContain("Mmhmm");
    expect(REFLEX_WHITELIST).toContain("Yeah");
    expect(REFLEX_WHITELIST).toContain("Okay");
  });

  it("should not contain empty strings", () => {
    for (const entry of REFLEX_WHITELIST) {
      expect(entry.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── getRandomReflex ────────────────────────────────────────────────────

describe("getRandomReflex", () => {
  it("should return a string", () => {
    const result = getRandomReflex();
    expect(typeof result).toBe("string");
  });

  it("should return a value from the whitelist", () => {
    // Run multiple times to account for randomness
    for (let i = 0; i < 20; i++) {
      const result = getRandomReflex();
      expect(REFLEX_WHITELIST).toContain(result);
    }
  });
});

// ── isApprovedReflex ───────────────────────────────────────────────────

describe("isApprovedReflex", () => {
  it("should return true for an approved reflex (exact case)", () => {
    expect(isApprovedReflex("Mmhmm")).toBe(true);
  });

  it("should return true for an approved reflex (case insensitive)", () => {
    expect(isApprovedReflex("mmhmm")).toBe(true);
    expect(isApprovedReflex("MMHMM")).toBe(true);
    expect(isApprovedReflex("MmHmM")).toBe(true);
  });

  it("should return true for other approved reflexes", () => {
    expect(isApprovedReflex("Yeah")).toBe(true);
    expect(isApprovedReflex("okay")).toBe(true);
    expect(isApprovedReflex("UH HUH")).toBe(true);
  });

  it("should return false for non-approved utterances", () => {
    expect(isApprovedReflex("Hello")).toBe(false);
    expect(isApprovedReflex("Goodbye")).toBe(false);
    expect(isApprovedReflex("Yes sir")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isApprovedReflex("")).toBe(false);
  });

  it("should return false for substrings of approved reflexes", () => {
    // "Mm" is approved, but "M" alone is not
    expect(isApprovedReflex("M")).toBe(false);
  });
});

// ── getWeightedReflex ──────────────────────────────────────────────────

describe("getWeightedReflex", () => {
  it("should return a string from the whitelist", () => {
    for (let i = 0; i < 20; i++) {
      const result = getWeightedReflex();
      expect(typeof result).toBe("string");
      expect(REFLEX_WHITELIST).toContain(result);
    }
  });

  it("should favor shorter phrases over longer ones", () => {
    // Run many iterations and count frequency of short vs long phrases
    const counts = new Map<string, number>();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const result = getWeightedReflex();
      counts.set(result, (counts.get(result) || 0) + 1);
    }

    // Find the shortest and longest phrases in the whitelist
    const sorted = [...REFLEX_WHITELIST].sort((a, b) => a.length - b.length);
    const shortest = sorted[0];
    const longest = sorted[sorted.length - 1];

    const shortestCount = counts.get(shortest) || 0;
    const longestCount = counts.get(longest) || 0;

    // Shorter phrases should be picked more often than the longest
    expect(shortestCount).toBeGreaterThan(longestCount);
  });
});
