/**
 * Retrieval Index Unit Tests
 *
 * Tests the retrieval module's getEnvNumber helper and singleton exports.
 * Uses jest.isolateModules to test environment variable parsing.
 */

jest.mock("../../retrieval/RetrievalService.js", () => ({
  RetrievalService: jest.fn().mockImplementation((config: any) => ({
    ...config,
    retrieveFactsPack: jest.fn(),
    lookupDisclaimer: jest.fn(),
    getDefaults: jest.fn().mockReturnValue(config),
  })),
}));

describe("retrieval/index.ts", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should use default values when env vars are not set", () => {
    let mod: any;
    jest.isolateModules(() => {
      process.env = { ...originalEnv };
      delete process.env.RAG_TOP_K;
      delete process.env.RAG_MAX_TOKENS;
      delete process.env.RAG_MAX_BYTES;
      mod = require("../../retrieval/index.js");
    });

    expect(mod.retrievalService.topK).toBe(5);
    expect(mod.retrievalService.maxTokens).toBe(600);
    expect(mod.retrievalService.maxBytes).toBe(4000);
  });

  it("should parse valid numeric env vars", () => {
    let mod: any;
    jest.isolateModules(() => {
      process.env = { ...originalEnv, RAG_TOP_K: "10", RAG_MAX_TOKENS: "1200", RAG_MAX_BYTES: "8000" };
      mod = require("../../retrieval/index.js");
    });

    // Covers Number.isNaN(value) ? fallback : value — the false branch (valid number)
    expect(mod.retrievalService.topK).toBe(10);
    expect(mod.retrievalService.maxTokens).toBe(1200);
    expect(mod.retrievalService.maxBytes).toBe(8000);
  });

  it("should fall back to defaults when env vars are NaN", () => {
    let mod: any;
    jest.isolateModules(() => {
      process.env = { ...originalEnv, RAG_TOP_K: "not-a-number", RAG_MAX_TOKENS: "abc", RAG_MAX_BYTES: "" };
      mod = require("../../retrieval/index.js");
    });

    // Covers Number.isNaN(value) ? fallback : value — the true branch (NaN)
    expect(mod.retrievalService.topK).toBe(5);
    expect(mod.retrievalService.maxTokens).toBe(600);
    // RAG_MAX_BYTES="" → !raw is true → returns fallback directly
    expect(mod.retrievalService.maxBytes).toBe(4000);
  });
});
