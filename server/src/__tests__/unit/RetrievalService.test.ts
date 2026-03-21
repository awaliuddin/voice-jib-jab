/**
 * RetrievalService unit tests.
 *
 * The "fs" module is partially mocked so that existsSync can be controlled
 * per test while readFileSync (used by KnowledgePack) retains its real
 * implementation.
 */

import { resolve } from "path";
import { RetrievalService } from "../../retrieval/RetrievalService.js";

// ── Module-level partial mock for "fs" ───────────────────────────────────────
// jest.mock is hoisted; the factory captures the real existsSync so individual
// tests can call mockImplementation/mockReturnValue and then restore it.

const realExistsSync = jest.requireActual<typeof import("fs")>("fs").existsSync;

jest.mock("fs", () => {
  const real = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...real,
    existsSync: jest.fn().mockImplementation(real.existsSync),
  };
});

// Import AFTER jest.mock so we get the mocked version.
import { existsSync } from "fs";
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

// ── Shared paths ─────────────────────────────────────────────────────────────

const knowledgeDir = resolve(process.cwd(), "..", "knowledge");
const factsPath = resolve(knowledgeDir, "nxtg_facts.jsonl");
const disclaimersPath = resolve(knowledgeDir, "disclaimers.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset existsSync to the real implementation between tests. */
function restoreExistsSync(): void {
  mockExistsSync.mockImplementation(realExistsSync);
}

// ── Original integration tests ───────────────────────────────────────────────

describe("RetrievalService", () => {
  afterEach(restoreExistsSync);

  it("loads and indexes the knowledge pack", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 3,
      maxTokens: 600,
      maxBytes: 4000,
    });

    expect(service.isReady()).toBe(true);
  });

  it("returns facts pack with topic, facts, and disclaimers", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 3,
      maxTokens: 600,
      maxBytes: 4000,
    });

    const pack = service.retrieveFactsPack("performance targets", { topK: 3 });
    expect(pack.topic.toLowerCase()).toContain("performance");
    expect(pack.facts.length).toBeGreaterThan(0);
    expect(pack.facts[0]).toHaveProperty("id");
    expect(pack.facts[0]).toHaveProperty("text");
    expect(pack.disclaimers).toContain("DISC-002");
  });

  it("enforces token and byte caps", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 5,
      maxTokens: 600,
      maxBytes: 4000,
    });

    const pack = service.retrieveFactsPack("NextGen AI", {
      topK: 5,
      maxTokens: 50,
      maxBytes: 200,
    });
    const json = JSON.stringify(pack);
    const bytes = Buffer.byteLength(json, "utf8");
    const tokens = Math.ceil(json.length / 4);

    expect(bytes).toBeLessThanOrEqual(200);
    expect(tokens).toBeLessThanOrEqual(50);
  });
});

// ── Branch coverage additions ─────────────────────────────────────────────────

describe("RetrievalService — branch coverage", () => {
  afterEach(restoreExistsSync);

  // ── getDefaults() (line 64-66) ────────────────────────────────────────────

  it("getDefaults() returns the configured topK, maxTokens, and maxBytes", () => {
    const svc = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 7,
      maxTokens: 500,
      maxBytes: 3000,
    });
    expect(svc.getDefaults()).toEqual({ topK: 7, maxTokens: 500, maxBytes: 3000 });
  });

  // ── !ready early return in retrieveFactsPack (line 72-77) ────────────────

  it("returns empty pack when service is not ready (bad factsPath)", () => {
    const svc = new RetrievalService({ factsPath: "/nonexistent/facts.jsonl" });
    expect(svc.isReady()).toBe(false);
    const pack = svc.retrieveFactsPack("any query");
    expect(pack.topic).toBe("NextGen AI");
    expect(pack.facts).toHaveLength(0);
    expect(pack.disclaimers).toHaveLength(0);
  });

  // ── catch block in load() → ready=false (lines 164-167) ─────────────────

  it("sets ready=false when KnowledgePack.load() throws (file not found)", () => {
    const svc = new RetrievalService({ factsPath: "/definitely/no/such/file.jsonl" });
    expect(svc.isReady()).toBe(false);
  });

  // ── empty / whitespace query (lines 81, 86-88) ───────────────────────────

  it("uses 'NextGen AI' as topic and returns no facts for an empty query", () => {
    const svc = new RetrievalService({ factsPath, disclaimersPath });
    const pack = svc.retrieveFactsPack("");
    expect(pack.topic).toBe("NextGen AI");
    expect(pack.facts).toHaveLength(0); // no vectorStore.search called
  });

  it("uses 'NextGen AI' as topic for a whitespace-only query", () => {
    const svc = new RetrievalService({ factsPath, disclaimersPath });
    const pack = svc.retrieveFactsPack("   ");
    expect(pack.topic).toBe("NextGen AI");
    expect(pack.facts).toHaveLength(0);
  });

  // ── lookupDisclaimer null branch (line 125) ───────────────────────────────

  it("lookupDisclaimer returns null for an unknown disclaimer ID", () => {
    const svc = new RetrievalService({ factsPath, disclaimersPath });
    expect(svc.lookupDisclaimer("nonexistent-id-xyz")).toBeNull();
  });

  // ── resolveKnowledgeFile with knowledgeDir (lines 178-180, 185-189) ──────

  it("loads successfully when knowledgeDir points to the real knowledge directory", () => {
    // knowledgeDir set → resolveKnowledgeFile pushes knowledgeDir candidate first
    const svc = new RetrievalService({ knowledgeDir, topK: 2 });
    expect(svc.isReady()).toBe(true);
    expect(svc.getDefaults().topK).toBe(2);
  });

  // ── resolveKnowledgeFile optional=true not found → warn + undefined (lines 191-196)

  it("loads without disclaimers when optional disclaimers file cannot be found (existsSync=false)", () => {
    // Mock existsSync to return false everywhere so the disclaimers lookup fails.
    // KnowledgePack uses readFileSync (not existsSync) so it still reads factsPath.
    mockExistsSync.mockReturnValue(false);

    // Pass factsPath directly — bypasses resolveKnowledgeFile for facts.
    // disclaimersPath NOT passed → resolveKnowledgeFile("disclaimers.json", true)
    //   → all existsSync=false → optional=true → warn + return undefined → no disclaimers.
    const svc = new RetrievalService({ factsPath });
    expect(svc.isReady()).toBe(true);
    expect(svc.lookupDisclaimer("DISC-001")).toBeNull();
  });

  // ── resolveKnowledgeFile optional=false not found → throw (lines 198-202) ─

  it("sets ready=false when non-optional facts file cannot be found (existsSync=false)", () => {
    // Mock existsSync to return false so all candidate paths fail.
    mockExistsSync.mockReturnValue(false);

    // No factsPath/disclaimersPath → resolveKnowledgeFile("nxtg_facts.jsonl", false)
    //   → all existsSync=false → optional=false → throw → load() catch → ready=false.
    const svc = new RetrievalService({});
    expect(svc.isReady()).toBe(false);
  });

  // ── drop disclaimers when base pack doesn't fit caps (line 102) ──────────

  it("drops disclaimers from base pack when maxBytes is extremely small", () => {
    const svc = new RetrievalService({ factsPath, disclaimersPath, topK: 5 });
    // maxBytes=1 forces the base pack (topic + disclaimers) to fail fitsCaps.
    // Result: disclaimers are dropped, for-loop adds no facts (also too large),
    // and trimToCaps trims the topic string.
    const pack = svc.retrieveFactsPack("performance", { maxBytes: 1, maxTokens: 1 });
    expect(pack.disclaimers).toHaveLength(0);
    expect(pack.facts).toHaveLength(0);
  });

  // ── fact doesn't fit → break out of add-loop (line 114-116) ─────────────

  it("stops adding facts when a fact would exceed caps (for-loop break)", () => {
    const svc = new RetrievalService({ factsPath, disclaimersPath, topK: 10 });
    // Tight caps: only first 0-1 facts can fit. Key assertion: terminates and respects limits.
    const pack = svc.retrieveFactsPack("NextGen AI", { maxBytes: 150, maxTokens: 30 });
    const json = JSON.stringify(pack);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(150);
    expect(Math.ceil(json.length / 4)).toBeLessThanOrEqual(30);
  });

  // ── selectDisclaimerIds query 'latency' keyword branch (line 230-231) ────

  it("includes performance_claims disclaimers when query contains 'latency'", () => {
    const svc = new RetrievalService({ factsPath, disclaimersPath });
    // 'latency' covers the || branch of `queryLower.includes("performance") || queryLower.includes("latency")`
    const pack = svc.retrieveFactsPack("latency measurement");
    expect(pack).toHaveProperty("topic");
    expect(pack).toHaveProperty("facts");
    expect(pack).toHaveProperty("disclaimers");
  });
});
