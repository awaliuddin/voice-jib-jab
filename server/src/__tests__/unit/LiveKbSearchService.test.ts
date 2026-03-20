/**
 * LiveKbSearchService Unit Tests
 *
 * KnowledgeBaseStore is fully mocked — only listEntries() is called by the
 * service. The mock shape matches the real interface exactly.
 *
 * KbEntry shape used in mocks:
 *   { id, tenantId, question, answer, tags, source, hitCount, createdAt, updatedAt }
 *
 * The service maps:
 *   question -> title
 *   answer   -> excerpt (trimmed to excerptLength)
 *   id       -> entryId
 */

import { LiveKbSearchService } from "../../services/LiveKbSearchService.js";
import type { KnowledgeBaseStore, KbEntry } from "../../services/KnowledgeBaseStore.js";

// ── Mock store ────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<KbEntry> & { id: string; question: string; answer: string }): KbEntry {
  return {
    tenantId: "tenant-x",
    tags: [],
    source: "manual",
    hitCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockStore(entries: KbEntry[]): KnowledgeBaseStore {
  return {
    listEntries: jest.fn().mockReturnValue(entries),
    addEntry: jest.fn(),
    getEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
    incrementHit: jest.fn(),
    search: jest.fn(),
    clearTenant: jest.fn(),
  } as unknown as KnowledgeBaseStore;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const BILLING_ENTRY = makeEntry({
  id: "entry-billing",
  question: "How do I view my billing invoice?",
  answer: "Go to Settings > Billing to download your invoice as a PDF.",
  tenantId: "tenant-x",
});

const RESET_ENTRY = makeEntry({
  id: "entry-reset",
  question: "How do I reset my password?",
  answer: "Click Forgot Password on the login page and follow the email instructions.",
  tenantId: "tenant-x",
});

const REFUND_ENTRY = makeEntry({
  id: "entry-refund",
  question: "Can I get a refund?",
  answer: "Refunds are processed within 5-7 business days after approval.",
  tenantId: "tenant-x",
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("LiveKbSearchService", () => {
  // ── search() ────────────────────────────────────────────────────────

  describe("search()", () => {
    it("returns empty results when no KB entries exist", async () => {
      const svc = new LiveKbSearchService(mockStore([]));
      const res = await svc.search("billing invoice", "tenant-x");

      expect(res.results).toHaveLength(0);
    });

    it("returns matching entries for a relevant query", async () => {
      const store = mockStore([BILLING_ENTRY, RESET_ENTRY]);
      const svc = new LiveKbSearchService(store);

      const res = await svc.search("billing invoice", "tenant-x");

      expect(res.results.length).toBeGreaterThan(0);
      expect(res.results[0].entryId).toBe("entry-billing");
    });

    it("scores by token overlap — entry with more matching tokens scores higher", async () => {
      // "billing invoice" — BILLING_ENTRY question has both tokens
      // REFUND_ENTRY question has neither
      const store = mockStore([BILLING_ENTRY, REFUND_ENTRY]);
      const svc = new LiveKbSearchService(store);

      const res = await svc.search("billing invoice", "tenant-x");

      // Billing entry should have a higher score than refund entry
      const billingResult = res.results.find((r) => r.entryId === "entry-billing");
      const refundResult = res.results.find((r) => r.entryId === "entry-refund");

      expect(billingResult).toBeDefined();
      if (refundResult) {
        expect(billingResult!.score).toBeGreaterThan(refundResult.score);
      }
    });

    it("filters out entries below minScore threshold", async () => {
      const store = mockStore([BILLING_ENTRY, RESET_ENTRY, REFUND_ENTRY]);
      // Use minScore higher than what a non-matching entry can score.
      // RESET_ENTRY and REFUND_ENTRY have no tokens from "billing invoice" in
      // their questions, so their title score is 0. Body has partial overlap at best.
      // Set minScore = 0.8 so only BILLING_ENTRY (both tokens in title) passes.
      const svc = new LiveKbSearchService(store, { minScore: 0.8 });

      const res = await svc.search("billing invoice", "tenant-x");

      // Only BILLING_ENTRY has both "billing" and "invoice" in its title
      expect(res.results).toHaveLength(1);
      expect(res.results[0].entryId).toBe("entry-billing");
    });

    it("respects maxResults limit (default 3)", async () => {
      const entries = [
        makeEntry({ id: "e1", question: "billing payment invoice", answer: "billing details" }),
        makeEntry({ id: "e2", question: "billing account invoice", answer: "billing info" }),
        makeEntry({ id: "e3", question: "billing charge invoice", answer: "billing charge info" }),
        makeEntry({ id: "e4", question: "billing refund invoice", answer: "billing refund info" }),
      ];
      const store = mockStore(entries);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing invoice", "tenant-x");

      expect(res.results.length).toBeLessThanOrEqual(3);
    });

    it("returns results sorted by score descending", async () => {
      const store = mockStore([BILLING_ENTRY, RESET_ENTRY, REFUND_ENTRY]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing invoice password reset", "tenant-x");

      for (let i = 1; i < res.results.length; i++) {
        expect(res.results[i - 1].score).toBeGreaterThanOrEqual(res.results[i].score);
      }
    });

    it("excerpt is capped at excerptLength chars", async () => {
      const longAnswer = "A".repeat(500);
      const entry = makeEntry({ id: "e-long", question: "long answer entry", answer: longAnswer });
      const store = mockStore([entry]);
      const svc = new LiveKbSearchService(store, { excerptLength: 100, minScore: 0 });

      const res = await svc.search("long answer", "tenant-x");

      expect(res.results[0].excerpt.length).toBe(100);
    });

    it("excerpt is full answer when answer is shorter than excerptLength", async () => {
      const short = "Short answer.";
      const entry = makeEntry({ id: "e-short", question: "short question answer", answer: short });
      const store = mockStore([entry]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("short", "tenant-x");

      expect(res.results[0].excerpt).toBe(short);
    });

    it("includes entryId, title, excerpt, score in each result", async () => {
      const store = mockStore([BILLING_ENTRY]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing", "tenant-x");

      expect(res.results[0]).toMatchObject({
        entryId: expect.any(String),
        title: expect.any(String),
        excerpt: expect.any(String),
        score: expect.any(Number),
      });
    });

    it("entryId maps to the KB entry id", async () => {
      const store = mockStore([BILLING_ENTRY]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing", "tenant-x");

      expect(res.results[0].entryId).toBe(BILLING_ENTRY.id);
    });

    it("title maps to the KB entry question", async () => {
      const store = mockStore([BILLING_ENTRY]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing", "tenant-x");

      expect(res.results[0].title).toBe(BILLING_ENTRY.question);
    });

    it("includes query, tenantId, searchedAt, durationMs in response", async () => {
      const store = mockStore([]);
      const svc = new LiveKbSearchService(store);

      const res = await svc.search("test query", "tenant-abc");

      expect(res.query).toBe("test query");
      expect(res.tenantId).toBe("tenant-abc");
      expect(typeof res.searchedAt).toBe("string");
      expect(new Date(res.searchedAt).toISOString()).toBe(res.searchedAt);
      expect(typeof res.durationMs).toBe("number");
    });

    it("matching is case-insensitive", async () => {
      const entry = makeEntry({
        id: "e-case",
        question: "Billing Invoice Download",
        answer: "You can download your Invoice from the Billing section.",
      });
      const store = mockStore([entry]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("BILLING INVOICE", "tenant-x");

      expect(res.results.length).toBeGreaterThan(0);
      expect(res.results[0].entryId).toBe("e-case");
    });

    it("partial word matching — query 'billing' matches entry with 'billing issue'", async () => {
      const entry = makeEntry({
        id: "e-partial",
        question: "billing issue with subscription",
        answer: "Contact support for billing issues.",
      });
      const store = mockStore([entry]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing", "tenant-x");

      expect(res.results.length).toBeGreaterThan(0);
    });

    it("query with multiple terms — higher overlap yields higher score", async () => {
      const oneMatch = makeEntry({
        id: "e-one",
        question: "billing details",
        answer: "See your billing details.",
      });
      const twoMatches = makeEntry({
        id: "e-two",
        question: "billing invoice details",
        answer: "Download your billing invoice.",
      });
      const store = mockStore([oneMatch, twoMatches]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing invoice", "tenant-x");

      const two = res.results.find((r) => r.entryId === "e-two");
      const one = res.results.find((r) => r.entryId === "e-one");

      expect(two).toBeDefined();
      expect(one).toBeDefined();
      expect(two!.score).toBeGreaterThanOrEqual(one!.score);
    });

    it("entry with title match scores higher than content-only match", async () => {
      const titleMatch = makeEntry({
        id: "e-title",
        question: "billing invoice question",
        answer: "Please see your account for details.",
      });
      const bodyMatch = makeEntry({
        id: "e-body",
        question: "general account question",
        answer: "Your billing invoice is available in your account settings.",
      });
      const store = mockStore([titleMatch, bodyMatch]);
      const svc = new LiveKbSearchService(store, { minScore: 0 });

      const res = await svc.search("billing invoice", "tenant-x");

      const titleResult = res.results.find((r) => r.entryId === "e-title");
      const bodyResult = res.results.find((r) => r.entryId === "e-body");

      expect(titleResult).toBeDefined();
      expect(bodyResult).toBeDefined();
      expect(titleResult!.score).toBeGreaterThan(bodyResult!.score);
    });

    it("returns empty results when all scores are below minScore", async () => {
      const store = mockStore([BILLING_ENTRY, RESET_ENTRY]);
      const svc = new LiveKbSearchService(store, { minScore: 1.0 });

      // No single query can achieve score = 1.0 unless every token matches
      const res = await svc.search("xyz", "tenant-x");

      expect(res.results).toHaveLength(0);
    });

    it("passes tenantId to kbStore.listEntries correctly", async () => {
      const store = mockStore([]);
      const svc = new LiveKbSearchService(store);

      await svc.search("some query", "org-acme-123");

      expect(store.listEntries).toHaveBeenCalledWith("org-acme-123");
    });

    it("custom maxResults is respected", async () => {
      const entries = Array.from({ length: 6 }, (_, i) =>
        makeEntry({ id: `e-${i}`, question: `billing invoice item ${i}`, answer: `Answer ${i}` }),
      );
      const store = mockStore(entries);
      const svc = new LiveKbSearchService(store, { maxResults: 2, minScore: 0 });

      const res = await svc.search("billing invoice", "tenant-x");

      expect(res.results.length).toBeLessThanOrEqual(2);
    });

    it("custom minScore is respected", async () => {
      const store = mockStore([BILLING_ENTRY]);
      const svc = new LiveKbSearchService(store, { minScore: 0.99 });

      // 'xyzabc' won't match any token in BILLING_ENTRY
      const res = await svc.search("xyzabc", "tenant-x");

      expect(res.results).toHaveLength(0);
    });

    it("custom excerptLength is respected", async () => {
      const longAnswer = "B".repeat(1000);
      const entry = makeEntry({ id: "e-xl", question: "excerpt length test answer", answer: longAnswer });
      const store = mockStore([entry]);
      const svc = new LiveKbSearchService(store, { excerptLength: 50, minScore: 0 });

      const res = await svc.search("excerpt length test", "tenant-x");

      expect(res.results[0].excerpt.length).toBe(50);
    });

    it("durationMs is a non-negative number", async () => {
      const store = mockStore([BILLING_ENTRY]);
      const svc = new LiveKbSearchService(store);

      const res = await svc.search("billing", "tenant-x");

      expect(res.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── extractSearchTerms() ─────────────────────────────────────────────

  describe("extractSearchTerms()", () => {
    let svc: LiveKbSearchService;

    beforeEach(() => {
      svc = new LiveKbSearchService(mockStore([]));
    });

    it("removes stop words", () => {
      const result = svc.extractSearchTerms("what billing issue");
      // "what" is a stop word; "billing" and "issue" are kept
      const tokens = result.split(" ");
      expect(tokens).not.toContain("what");
      expect(tokens).toContain("billing");
      expect(tokens).toContain("issue");
    });

    it("lowercases text", () => {
      const result = svc.extractSearchTerms("BILLING INVOICE");
      expect(result).toBe("billing invoice");
    });

    it("strips punctuation", () => {
      const result = svc.extractSearchTerms("billing? invoice!");
      expect(result).not.toContain("?");
      expect(result).not.toContain("!");
      expect(result).toContain("billing");
      expect(result).toContain("invoice");
    });

    it("returns remaining terms as a joined string", () => {
      const result = svc.extractSearchTerms("reset my password please");
      // "my" is a stop word; "please" is not
      expect(typeof result).toBe("string");
      expect(result.split(" ").length).toBeGreaterThan(0);
    });

    it("returns empty string for empty input", () => {
      expect(svc.extractSearchTerms("")).toBe("");
    });

    it("returns empty string when all tokens are stop words", () => {
      const result = svc.extractSearchTerms("what is the a an");
      expect(result).toBe("");
    });
  });
});
