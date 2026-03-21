/**
 * KnowledgeBase Tests
 *
 * Tests the KnowledgeBaseStore, FaqExtractor, and Knowledge API endpoints.
 * Follows the ConversationMemory.test.ts pattern: standalone Express app with
 * injected deps and raw HTTP request helpers.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdirSync } from "fs";
import { KnowledgeBaseStore } from "../../services/KnowledgeBaseStore.js";
import { FaqExtractor } from "../../services/FaqExtractor.js";
import { createKnowledgeRouter } from "../../api/knowledge.js";

// ── HTTP helpers (same pattern as ConversationMemory.test.ts) ─────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
      },
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── Test setup helpers ────────────────────────────────────────────────

function tempDir(name: string): string {
  return join(
    tmpdir(),
    `kb-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

function buildTestApp(store: KnowledgeBaseStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/tenants", createKnowledgeRouter(store));
  return app;
}

// ── Unit Tests: KnowledgeBaseStore ────────────────────────────────────

describe("KnowledgeBaseStore", () => {
  let store: KnowledgeBaseStore;
  let dir: string;

  beforeEach(() => {
    dir = tempDir("store");
    mkdirSync(dir, { recursive: true });
    store = new KnowledgeBaseStore(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("addEntry creates entry with uuid, defaults hitCount=0 and source=manual", () => {
    const entry = store.addEntry({
      tenantId: "org_a",
      question: "How do I reset my password?",
      answer: "Go to Settings > Reset Password.",
    });

    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.hitCount).toBe(0);
    expect(entry.source).toBe("manual");
    expect(entry.tags).toEqual([]);
    expect(entry.tenantId).toBe("org_a");
    expect(entry.question).toBe("How do I reset my password?");
    expect(entry.answer).toBe("Go to Settings > Reset Password.");
    expect(entry.createdAt).toBeDefined();
    expect(entry.updatedAt).toBeDefined();
  });

  it("addEntry with two entries same tenant returns both in list", () => {
    store.addEntry({
      tenantId: "org_b",
      question: "Question 1?",
      answer: "Answer 1",
    });
    store.addEntry({
      tenantId: "org_b",
      question: "Question 2?",
      answer: "Answer 2",
    });

    const entries = store.listEntries("org_b");
    expect(entries).toHaveLength(2);
  });

  it("getEntry returns correct entry by id", () => {
    const created = store.addEntry({
      tenantId: "org_c",
      question: "What is the return policy?",
      answer: "30 days full refund.",
    });

    const found = store.getEntry(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.question).toBe("What is the return policy?");
  });

  it("getEntry returns undefined for unknown id", () => {
    const found = store.getEntry("nonexistent-id");
    expect(found).toBeUndefined();
  });

  it("listEntries returns all for tenant and empty for unknown", () => {
    store.addEntry({ tenantId: "org_d", question: "Q?", answer: "A" });

    expect(store.listEntries("org_d")).toHaveLength(1);
    expect(store.listEntries("org_unknown")).toEqual([]);
  });

  it("listEntries with tag filter returns only entries with that tag", () => {
    store.addEntry({
      tenantId: "org_e",
      question: "Tagged question?",
      answer: "Tagged answer",
      tags: ["billing"],
    });
    store.addEntry({
      tenantId: "org_e",
      question: "Other question?",
      answer: "Other answer",
      tags: ["support"],
    });

    const filtered = store.listEntries("org_e", { tag: "billing" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].tags).toContain("billing");
  });

  it("listEntries with source filter returns only matching source", () => {
    store.addEntry({
      tenantId: "org_f",
      question: "Manual entry?",
      answer: "Manual answer",
      source: "manual",
    });
    store.addEntry({
      tenantId: "org_f",
      question: "Extracted entry?",
      answer: "Extracted answer",
      source: "extracted",
      sessionId: "sess-1",
    });

    const manual = store.listEntries("org_f", { source: "manual" });
    expect(manual).toHaveLength(1);
    expect(manual[0].source).toBe("manual");

    const extracted = store.listEntries("org_f", { source: "extracted" });
    expect(extracted).toHaveLength(1);
    expect(extracted[0].source).toBe("extracted");
  });

  it("updateEntry patches question/answer/tags and updates updatedAt", () => {
    const entry = store.addEntry({
      tenantId: "org_g",
      question: "Old question?",
      answer: "Old answer",
      tags: ["old"],
    });

    const originalUpdatedAt = entry.updatedAt;

    // Ensure a different timestamp by advancing the clock slightly
    jest.useFakeTimers();
    jest.setSystemTime(new Date(Date.now() + 1000));

    const updated = store.updateEntry(entry.id, {
      question: "New question?",
      answer: "New answer",
      tags: ["new", "updated"],
    });

    expect(updated).toBeDefined();
    expect(updated!.question).toBe("New question?");
    expect(updated!.answer).toBe("New answer");
    expect(updated!.tags).toEqual(["new", "updated"]);
    expect(updated!.updatedAt).not.toBe(originalUpdatedAt);

    jest.useRealTimers();
  });

  it("updateEntry returns undefined for unknown id", () => {
    const result = store.updateEntry("nonexistent", { question: "New?" });
    expect(result).toBeUndefined();
  });

  it("deleteEntry removes entry and returns true", () => {
    const entry = store.addEntry({
      tenantId: "org_h",
      question: "Delete me?",
      answer: "OK",
    });

    const result = store.deleteEntry(entry.id);
    expect(result).toBe(true);

    const found = store.getEntry(entry.id);
    expect(found).toBeUndefined();

    expect(store.listEntries("org_h")).toEqual([]);
  });

  it("deleteEntry returns false for unknown id", () => {
    const result = store.deleteEntry("nonexistent-id");
    expect(result).toBe(false);
  });

  it("incrementHit increments hitCount", () => {
    const entry = store.addEntry({
      tenantId: "org_i",
      question: "Popular question?",
      answer: "Popular answer",
    });

    expect(entry.hitCount).toBe(0);

    store.incrementHit(entry.id);
    store.incrementHit(entry.id);
    store.incrementHit(entry.id);

    const updated = store.getEntry(entry.id);
    expect(updated!.hitCount).toBe(3);
  });

  it("search returns entries whose question contains query word", () => {
    store.addEntry({
      tenantId: "org_j",
      question: "How do I configure the dashboard settings?",
      answer: "Go to admin panel.",
    });
    store.addEntry({
      tenantId: "org_j",
      question: "What are the billing options?",
      answer: "Monthly or annual.",
    });

    const results = store.search("org_j", "dashboard");
    expect(results).toHaveLength(1);
    expect(results[0].question).toContain("dashboard");
  });

  it("search excludes stopwords and words shorter than 3 chars", () => {
    store.addEntry({
      tenantId: "org_k",
      question: "What are the pricing tiers?",
      answer: "Basic, Pro, Enterprise.",
    });

    // "the" is a stopword, "is" is too short/stopword — only "pricing" should match
    const results = store.search("org_k", "the is pricing");
    expect(results).toHaveLength(1);
    expect(results[0].question).toContain("pricing");

    // Pure stopwords should return nothing
    const empty = store.search("org_k", "the is a an");
    expect(empty).toEqual([]);
  });

  it("search sorts by hitCount descending", () => {
    const e1 = store.addEntry({
      tenantId: "org_l",
      question: "How to configure settings?",
      answer: "A1",
    });
    const e2 = store.addEntry({
      tenantId: "org_l",
      question: "How to configure alerts?",
      answer: "A2",
    });

    // Give e2 more hits
    store.incrementHit(e2.id);
    store.incrementHit(e2.id);
    store.incrementHit(e1.id);

    const results = store.search("org_l", "configure");
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(e2.id);
    expect(results[1].id).toBe(e1.id);
  });

  it("persistence: new store instance reloads from disk", () => {
    store.addEntry({
      tenantId: "org_persist",
      question: "Persisted question?",
      answer: "Persisted answer",
      tags: ["persist"],
    });

    // Create a fresh store pointing at the same directory
    const store2 = new KnowledgeBaseStore(dir);
    const entries = store2.listEntries("org_persist");
    expect(entries).toHaveLength(1);
    expect(entries[0].question).toBe("Persisted question?");
    expect(entries[0].tags).toEqual(["persist"]);
  });

  it("clearTenant removes all entries for tenant", () => {
    store.addEntry({ tenantId: "org_clear", question: "Q1?", answer: "A1" });
    store.addEntry({ tenantId: "org_clear", question: "Q2?", answer: "A2" });
    store.addEntry({ tenantId: "org_other", question: "Q3?", answer: "A3" });

    store.clearTenant("org_clear");

    expect(store.listEntries("org_clear")).toEqual([]);
    expect(store.listEntries("org_other")).toHaveLength(1);
  });
});

// ── Branch Coverage: KnowledgeBaseStore edge cases ────────────────────

describe("KnowledgeBaseStore — branch coverage", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir("branch");
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadTenant() re-throws non-ENOENT errors (e.g. EACCES)", () => {
    // Step 1: Use a real store to write a tenant file to disk.
    const realStore = new KnowledgeBaseStore(dir);
    realStore.addEntry({ tenantId: "org_eacces", question: "Q?", answer: "A" });

    // Step 2: Spy on readFileSync to throw EACCES for any path.
    // A fresh store instance has an empty cache, so listEntries will
    // call loadTenant → readFileSync → should propagate the error.
    const fs = require("fs") as typeof import("fs");
    const throwingSpy = jest.spyOn(fs, "readFileSync").mockImplementation(() => {
      const err = Object.assign(new Error("Permission denied"), { code: "EACCES" });
      throw err;
    });

    const restrictedStore = new KnowledgeBaseStore(dir);
    expect(() => restrictedStore.listEntries("org_eacces")).toThrow("Permission denied");

    throwingSpy.mockRestore();
  });

  it("incrementHit() with nonexistent id returns void without throwing", () => {
    const store = new KnowledgeBaseStore(dir);
    expect(() => store.incrementHit("nonexistent-id")).not.toThrow();
  });

  it("search() with empty string returns empty array", () => {
    const store = new KnowledgeBaseStore(dir);
    store.addEntry({ tenantId: "org_srch", question: "Meaningful question?", answer: "A" });
    const results = store.search("org_srch", "");
    expect(results).toEqual([]);
  });

  it("search() with only stopwords returns empty array", () => {
    const store = new KnowledgeBaseStore(dir);
    store.addEntry({ tenantId: "org_srch2", question: "Meaningful question?", answer: "A" });
    const results = store.search("org_srch2", "the a an or");
    expect(results).toEqual([]);
  });

  it("clearTenant() when no file exists on disk does not throw", () => {
    const store = new KnowledgeBaseStore(dir);
    // Never add any entries — no file is written for this tenant
    expect(() => store.clearTenant("org_never_written")).not.toThrow();
    expect(store.listEntries("org_never_written")).toEqual([]);
  });
});

// ── Unit Tests: FaqExtractor ──────────────────────────────────────────

describe("FaqExtractor", () => {
  let extractor: FaqExtractor;

  beforeEach(() => {
    extractor = new FaqExtractor();
  });

  it("returns question/answer pairs from user question-mark turns", () => {
    const turns = [
      { role: "user" as const, text: "How do I reset my password?" },
      { role: "assistant" as const, text: "Go to Settings and click Reset." },
    ];

    const faqs = extractor.extract(turns);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe("How do I reset my password?");
    expect(faqs[0].context).toBe("Go to Settings and click Reset.");
  });

  it("extracts question-word turns without trailing question mark", () => {
    const turns = [
      { role: "user" as const, text: "Can you explain how billing works" },
      { role: "assistant" as const, text: "Billing is handled monthly." },
    ];

    const faqs = extractor.extract(turns);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe("Can you explain how billing works");
  });

  it("skips questions shorter than 10 chars", () => {
    const turns = [
      { role: "user" as const, text: "Why?" },
      { role: "assistant" as const, text: "Because reasons." },
      { role: "user" as const, text: "How does the integration system work?" },
      { role: "assistant" as const, text: "It uses webhooks." },
    ];

    const faqs = extractor.extract(turns);
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe("How does the integration system work?");
  });

  it("deduplicates by case-insensitive question prefix (first 30 chars)", () => {
    const turns = [
      { role: "user" as const, text: "How do I configure the dashboard for my team?" },
      { role: "assistant" as const, text: "First response." },
      { role: "user" as const, text: "How do I configure the dashboa extra stuff" },
      { role: "assistant" as const, text: "Second response." },
    ];

    const faqs = extractor.extract(turns);
    expect(faqs).toHaveLength(1);
  });

  it("returns empty when no questions found", () => {
    const turns = [
      { role: "user" as const, text: "Please send me the report." },
      { role: "assistant" as const, text: "Here is the report." },
    ];

    const faqs = extractor.extract(turns);
    expect(faqs).toEqual([]);
  });

  it("context is the following assistant turn text", () => {
    const turns = [
      { role: "user" as const, text: "What are the support hours?" },
      { role: "assistant" as const, text: "9 AM to 5 PM EST, Monday through Friday." },
    ];

    const faqs = extractor.extract(turns);
    expect(faqs[0].context).toBe("9 AM to 5 PM EST, Monday through Friday.");
  });

  it("max 10 results", () => {
    const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ role: "user", text: `Question number ${i} about topic ${i}?` });
      turns.push({ role: "assistant", text: `Answer number ${i}.` });
    }

    const faqs = extractor.extract(turns);
    expect(faqs).toHaveLength(10);
  });
});

// ── Integration Tests: Knowledge API ──────────────────────────────────

describe("Knowledge API Endpoints", () => {
  let app: Express;
  let server: Server;
  let store: KnowledgeBaseStore;
  let dir: string;

  beforeAll((done) => {
    dir = tempDir("kb-api");
    mkdirSync(dir, { recursive: true });
    store = new KnowledgeBaseStore(dir);
    app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
      done();
    });
  });

  beforeEach(() => {
    store.clearTenant("org_api");
  });

  it("GET /tenants/:tenantId/kb returns entries", async () => {
    store.addEntry({
      tenantId: "org_api",
      question: "Test question?",
      answer: "Test answer",
    });

    const res = await httpRequest(server, "GET", "/tenants/org_api/kb");
    expect(res.status).toBe(200);

    const data = res.json() as { tenantId: string; entries: unknown[]; count: number };
    expect(data.tenantId).toBe("org_api");
    expect(data.entries).toHaveLength(1);
    expect(data.count).toBe(1);
  });

  it("POST /tenants/:tenantId/kb creates entry and returns 201", async () => {
    const res = await httpRequest(server, "POST", "/tenants/org_api/kb", {
      question: "How do I get started?",
      answer: "Read the docs.",
      tags: ["onboarding"],
    });

    expect(res.status).toBe(201);
    const data = res.json() as {
      id: string;
      tenantId: string;
      question: string;
      answer: string;
      tags: string[];
    };
    expect(data.id).toBeDefined();
    expect(data.tenantId).toBe("org_api");
    expect(data.question).toBe("How do I get started?");
    expect(data.answer).toBe("Read the docs.");
    expect(data.tags).toEqual(["onboarding"]);
  });

  it("GET /tenants/:tenantId/kb/search returns matches and increments hit", async () => {
    store.addEntry({
      tenantId: "org_api",
      question: "How to configure dashboard notifications?",
      answer: "Go to settings.",
    });

    const res = await httpRequest(
      server,
      "GET",
      "/tenants/org_api/kb/search?q=dashboard",
    );
    expect(res.status).toBe(200);

    const data = res.json() as { results: Array<{ hitCount: number }>; count: number };
    expect(data.count).toBe(1);

    // Verify hitCount was incremented (re-fetch from store)
    const entries = store.listEntries("org_api");
    expect(entries[0].hitCount).toBe(1);
  });

  it("PUT /tenants/:tenantId/kb/:entryId patches entry", async () => {
    const entry = store.addEntry({
      tenantId: "org_api",
      question: "Old?",
      answer: "Old answer",
    });

    const res = await httpRequest(server, "PUT", `/tenants/org_api/kb/${entry.id}`, {
      question: "Updated question?",
      answer: "Updated answer",
    });

    expect(res.status).toBe(200);
    const data = res.json() as { question: string; answer: string };
    expect(data.question).toBe("Updated question?");
    expect(data.answer).toBe("Updated answer");
  });

  it("DELETE /tenants/:tenantId/kb/:entryId returns 204", async () => {
    const entry = store.addEntry({
      tenantId: "org_api",
      question: "Delete me?",
      answer: "OK",
    });

    const res = await httpRequest(
      server,
      "DELETE",
      `/tenants/org_api/kb/${entry.id}`,
    );
    expect(res.status).toBe(204);

    // Verify deletion
    const found = store.getEntry(entry.id);
    expect(found).toBeUndefined();
  });

  it("400 on invalid tenantId", async () => {
    const res = await httpRequest(server, "GET", "/tenants/bad%20tenant!/kb");
    expect(res.status).toBe(400);

    const data = res.json() as { error: string };
    expect(data.error).toContain("tenantId");
  });
});
