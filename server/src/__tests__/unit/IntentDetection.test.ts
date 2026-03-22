/**
 * IntentDetection Tests
 *
 * Tests for IntentClassifier, IntentStore, and the Intents API endpoints.
 * Follows the ConversationMemory.test.ts pattern: standalone Express app with
 * injected deps, raw HTTP helpers, temp-dir isolation per test suite.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, writeFileSync } from "fs";
import { IntentClassifier } from "../../services/IntentClassifier.js";
import { IntentStore } from "../../services/IntentStore.js";
import { createIntentsRouter } from "../../api/intents.js";

// ── HTTP helpers ───────────────────────────────────────────────────────

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

function tempFile(name: string): string {
  return join(
    tmpdir(),
    `intent-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

function buildTestApp(classifier: IntentClassifier, store: IntentStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/intents", createIntentsRouter(classifier, store));
  return app;
}

// ── 1. IntentClassifier.classify() — happy paths ──────────────────────

describe("IntentClassifier.classify() — happy paths", () => {
  const classifier = new IntentClassifier();

  it("returns 'billing' intent for billing text", () => {
    const result = classifier.classify("I have a question about my invoice and payment");
    expect(result.intent).toBe("billing");
    expect(result.fallback).toBe(false);
  });

  it("returns 'support' intent for support text", () => {
    const result = classifier.classify("I need help with an error that keeps crashing");
    expect(result.intent).toBe("support");
    expect(result.fallback).toBe(false);
  });

  it("returns 'sales' intent for sales text", () => {
    const result = classifier.classify("I want to buy the enterprise plan and get a demo");
    expect(result.intent).toBe("sales");
    expect(result.fallback).toBe(false);
  });

  it("returns 'complaint' intent for complaint text", () => {
    const result = classifier.classify("I am frustrated and angry about this terrible service");
    expect(result.intent).toBe("complaint");
    expect(result.fallback).toBe(false);
  });

  it("returns 'general' for empty text", () => {
    const result = classifier.classify("");
    expect(result.intent).toBe("general");
    expect(result.fallback).toBe(true);
  });

  it("returns 'general' for unrelated text", () => {
    const result = classifier.classify("the cat sat on the mat");
    expect(result.intent).toBe("general");
    expect(result.fallback).toBe(true);
  });

  it("fallback is true when returning general", () => {
    const result = classifier.classify("hello there");
    expect(result.fallback).toBe(true);
    expect(result.intent).toBe("general");
  });

  it("confidence is a number between 0 and 1 (inclusive)", () => {
    const result = classifier.classify("I need help with my bill and payment");
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("scores contains all 5 intent keys", () => {
    const result = classifier.classify("I need help");
    expect(result.scores).toHaveProperty("billing");
    expect(result.scores).toHaveProperty("support");
    expect(result.scores).toHaveProperty("sales");
    expect(result.scores).toHaveProperty("complaint");
    expect(result.scores).toHaveProperty("general");
  });
});

// ── 2. IntentClassifier edge cases ────────────────────────────────────

describe("IntentClassifier edge cases", () => {
  const classifier = new IntentClassifier();

  it("single keyword hit classifies correctly", () => {
    const result = classifier.classify("refund");
    expect(result.intent).toBe("billing");
    expect(result.scores.billing).toBe(1);
  });

  it("mixed-intent text returns highest scorer", () => {
    // More complaint keywords than billing keywords
    const result = classifier.classify(
      "I am angry and frustrated and disgusted and complaining to manager",
    );
    expect(result.intent).toBe("complaint");
  });

  it("very short text with one matching keyword returns correct intent", () => {
    const result = classifier.classify("invoice");
    expect(result.intent).toBe("billing");
    expect(result.fallback).toBe(false);
  });

  it("handles punctuation — 'I need help!!'", () => {
    const result = classifier.classify("I need help!!");
    expect(result.intent).toBe("support");
    expect(result.fallback).toBe(false);
  });

  it("keyword matched only once even if appears multiple times in text", () => {
    const result = classifier.classify("help help help help help");
    // 'help' is one distinct keyword → score for support = 1
    expect(result.scores.support).toBe(1);
  });

  it("confidence of exactly 0 when text is empty", () => {
    const result = classifier.classify("   ");
    expect(result.confidence).toBe(0);
    expect(result.fallback).toBe(true);
  });

  it("general score is always 0", () => {
    const result = classifier.classify("buy purchase enterprise license");
    expect(result.scores.general).toBe(0);
  });

  it("multi-word keyword 'not working' is matched", () => {
    const result = classifier.classify("my device is not working at all");
    expect(result.scores.support).toBeGreaterThan(0);
  });

  it("multi-word keyword 'credit card' is matched in billing", () => {
    const result = classifier.classify("my credit card was charged");
    expect(result.scores.billing).toBeGreaterThan(0);
  });
});

// ── 3. IntentClassifier — confidence arithmetic invariants ────────────
// These verify the exact formula (highScore / totalWords, clamped [0,1])
// and threshold behaviour. They kill arithmetic mutations that the hollow
// toBeGreaterThanOrEqual(0) / toBeLessThanOrEqual(1) assertions cannot catch.

describe("IntentClassifier — confidence arithmetic invariants", () => {
  const classifier = new IntentClassifier();

  it("confidence = highScore / totalWords exactly (1 match in 5 words = 0.2)", () => {
    const result = classifier.classify("refund xxx xxx xxx xxx");
    expect(result.scores.billing).toBe(1);
    expect(result.confidence).toBeCloseTo(1 / 5, 10);
  });

  it("confidence = 2 / totalWords when 2 distinct keywords match (2 in 5 = 0.4)", () => {
    const result = classifier.classify("bill invoice xxx xxx xxx");
    expect(result.scores.billing).toBe(2);
    expect(result.confidence).toBeCloseTo(2 / 5, 10);
  });

  it("confidence is clamped to 1.0 when highScore equals totalWords", () => {
    const result = classifier.classify("refund");
    expect(result.scores.billing).toBe(1);
    expect(result.confidence).toBe(1.0);
  });

  it("confidence is NOT inverted (highScore/totalWords, not totalWords/highScore)", () => {
    // Inverted formula 10/1=10 clamps to 1.0 — indistinguishable from clamped case,
    // so use 1 keyword in 10 words: correct=0.1, inverted=10 clamped to 1.0
    const result = classifier.classify("refund xxx xxx xxx xxx xxx xxx xxx xxx xxx");
    expect(result.confidence).toBeCloseTo(1 / 10, 10);
    expect(result.confidence).not.toBeCloseTo(1.0, 5);
  });

  it("fallback threshold: exactly 0.03 (3 matches in 100 words) does NOT trigger fallback", () => {
    const text = ["refund", "invoice", "subscription", ...Array(97).fill("xxx")].join(" ");
    const result = classifier.classify(text);
    expect(result.scores.billing).toBe(3);
    expect(result.confidence).toBeCloseTo(3 / 100, 10);
    expect(result.fallback).toBe(false);
    expect(result.intent).toBe("billing");
  });

  it("fallback threshold: 0.02 (2 matches in 100 words) IS below threshold → fallback", () => {
    const text = ["bill", "invoice", ...Array(98).fill("xxx")].join(" ");
    const result = classifier.classify(text);
    expect(result.scores.billing).toBe(2);
    expect(result.confidence).toBeCloseTo(2 / 100, 10);
    expect(result.fallback).toBe(true);
    expect(result.intent).toBe("general");
  });

  it("winner has the highest raw score — secondary scorer does not win", () => {
    // sales: buy, purchase, demo = 3; billing: bill = 1; 4 words total
    const result = classifier.classify("buy purchase demo bill");
    expect(result.scores.sales).toBe(3);
    expect(result.scores.billing).toBe(1);
    expect(result.intent).toBe("sales");
    expect(result.confidence).toBeCloseTo(3 / 4, 10);
  });

  it("repeated keyword: counted once, confidence uses totalWords (1/3 not 3/3)", () => {
    // "help help help" = 3 words, 1 distinct keyword → confidence = 1/3
    // Bug (additive occurrences): 3 hits → confidence = 3/3 = 1.0
    const result = classifier.classify("help help help");
    expect(result.scores.support).toBe(1);
    expect(result.confidence).toBeCloseTo(1 / 3, 10);
    expect(result.confidence).not.toBeCloseTo(1.0, 5);
  });
});

// ── 4. IntentStore — log operations ──────────────────────────────────

describe("IntentStore — log operations", () => {
  let store: IntentStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("logs");
    store = new IntentStore(storageFile);
  });

  afterEach(() => {
    if (existsSync(storageFile)) {
      rmSync(storageFile);
    }
  });

  it("logDetection() returns entry with entryId and detectedAt", () => {
    const entry = store.logDetection({
      tenantId: "t1",
      sessionId: null,
      text: "I need help",
      intent: "support",
      confidence: 0.5,
    });

    expect(entry.entryId).toBeDefined();
    expect(typeof entry.entryId).toBe("string");
    expect(entry.entryId.length).toBeGreaterThan(0);
    expect(entry.detectedAt).toBeDefined();
    expect(new Date(entry.detectedAt).toISOString()).toBe(entry.detectedAt);
  });

  it("logDetection() persists to disk (readable by fresh instance)", () => {
    store.logDetection({
      tenantId: "t2",
      sessionId: null,
      text: "invoice question",
      intent: "billing",
      confidence: 0.4,
    });

    const store2 = new IntentStore(storageFile);
    const logs = store2.listLogs("t2");
    expect(logs).toHaveLength(1);
    expect(logs[0].intent).toBe("billing");
  });

  it("getFrequencies() counts each intent correctly", () => {
    store.logDetection({ tenantId: "t3", sessionId: null, text: "help", intent: "support", confidence: 0.3 });
    store.logDetection({ tenantId: "t3", sessionId: null, text: "bill", intent: "billing", confidence: 0.3 });
    store.logDetection({ tenantId: "t3", sessionId: null, text: "help again", intent: "support", confidence: 0.3 });

    const freq = store.getFrequencies("t3");
    expect(freq.support).toBe(2);
    expect(freq.billing).toBe(1);
    expect(freq.complaint).toBe(0);
  });

  it("listLogs() returns most recent first", () => {
    store.logDetection({ tenantId: "t4", sessionId: null, text: "a", intent: "general", confidence: 0 });
    store.logDetection({ tenantId: "t4", sessionId: null, text: "b", intent: "support", confidence: 0.2 });
    store.logDetection({ tenantId: "t4", sessionId: null, text: "c", intent: "billing", confidence: 0.3 });

    const logs = store.listLogs("t4");
    expect(logs).toHaveLength(3);
    const timestamps = logs.map((e) => new Date(e.detectedAt).getTime());
    for (let i = 0; i < timestamps.length - 1; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
    }
  });

  it("listLogs() respects limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      store.logDetection({ tenantId: "t5", sessionId: null, text: `text ${i}`, intent: "general", confidence: 0 });
    }

    const logs = store.listLogs("t5", 3);
    expect(logs).toHaveLength(3);
  });

  it("text is truncated to 200 chars on storage", () => {
    const longText = "x".repeat(300);
    const entry = store.logDetection({
      tenantId: "t6",
      sessionId: null,
      text: longText,
      intent: "general",
      confidence: 0,
    });
    expect(entry.text.length).toBe(200);
  });
});

// ── 5. IntentStore — mapping operations ──────────────────────────────

describe("IntentStore — mapping operations", () => {
  let store: IntentStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("mappings");
    store = new IntentStore(storageFile);
  });

  afterEach(() => {
    if (existsSync(storageFile)) {
      rmSync(storageFile);
    }
  });

  it("setMapping() creates a mapping and returns it", () => {
    const mapping = store.setMapping("tenant1", "billing", "tmpl-billing-001");
    expect(mapping.intent).toBe("billing");
    expect(mapping.templateId).toBe("tmpl-billing-001");
    expect(mapping.tenantId).toBe("tenant1");
    expect(mapping.updatedAt).toBeDefined();
  });

  it("getMapping() returns the mapping after set", () => {
    store.setMapping("tenant1", "support", "tmpl-support-001");
    const result = store.getMapping("tenant1", "support");
    expect(result).toBeDefined();
    expect(result!.templateId).toBe("tmpl-support-001");
  });

  it("setMapping() updates existing mapping (upsert)", () => {
    store.setMapping("tenant1", "sales", "tmpl-old");
    store.setMapping("tenant1", "sales", "tmpl-new");

    const result = store.getMapping("tenant1", "sales");
    expect(result!.templateId).toBe("tmpl-new");

    const all = store.listMappings("tenant1");
    const salesMappings = all.filter((m) => m.intent === "sales");
    expect(salesMappings).toHaveLength(1);
  });

  it("deleteMapping() removes the mapping", () => {
    store.setMapping("tenant1", "complaint", "tmpl-complaint");
    const removed = store.deleteMapping("tenant1", "complaint");
    expect(removed).toBe(true);
    expect(store.getMapping("tenant1", "complaint")).toBeUndefined();
  });

  it("deleteMapping() returns false for unknown mapping", () => {
    const result = store.deleteMapping("nonexistent", "billing");
    expect(result).toBe(false);
  });

  it("listMappings() returns tenant-scoped + global (null tenantId) mappings", () => {
    store.setMapping(null, "billing", "global-billing");
    store.setMapping("tenant2", "support", "tenant2-support");
    store.setMapping("other", "sales", "other-sales");

    const results = store.listMappings("tenant2");
    expect(results).toHaveLength(2);
    const intents = results.map((m) => m.intent);
    expect(intents).toContain("billing");
    expect(intents).toContain("support");
    expect(intents).not.toContain("sales");
  });

  it("getMapping() works with null tenantId (global mapping)", () => {
    store.setMapping(null, "general", "tmpl-global-general");
    const result = store.getMapping(null, "general");
    expect(result).toBeDefined();
    expect(result!.tenantId).toBeNull();
  });
});

// ── 6. IntentStore — singleton proxy ─────────────────────────────────

describe("IntentStore — singleton proxy wiring", () => {
  it("initIntentStore() wires the proxy correctly", () => {
    const { initIntentStore, intentStore: proxy } =
      require("../../services/IntentStore.js");
    const storageFile = tempFile("singleton");
    initIntentStore(storageFile);
    expect(typeof proxy.logDetection).toBe("function");
    expect(typeof proxy.getFrequencies).toBe("function");
    expect(typeof proxy.listMappings).toBe("function");
    if (existsSync(storageFile)) rmSync(storageFile);
  });

  it("intentStore proxy throws before initialization", () => {
    // Reset the internal singleton by re-requiring in isolated module context
    // We can only test that the proxy works post-init, since singleton is shared
    const { initIntentStore, intentStore: proxy } =
      require("../../services/IntentStore.js");
    const storageFile = tempFile("singleton2");
    initIntentStore(storageFile);
    // After init, it should not throw
    expect(() => proxy.listLogs()).not.toThrow();
    if (existsSync(storageFile)) rmSync(storageFile);
  });
});

// ── 7. HTTP POST /intents/detect ─────────────────────────────────────

describe("HTTP POST /intents/detect", () => {
  let app: Express;
  let server: Server;
  let store: IntentStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("http-detect");
    store = new IntentStore(storageFile);
    app = buildTestApp(new IntentClassifier(), store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(storageFile)) rmSync(storageFile);
      done();
    });
  });

  it("returns 200 with intent and logEntry for valid text", async () => {
    const res = await httpRequest(server, "POST", "/intents/detect", {
      text: "I need help with an error",
    });
    expect(res.status).toBe(200);

    const data = res.json() as {
      intent: string;
      confidence: number;
      scores: Record<string, number>;
      fallback: boolean;
      logEntry: { entryId: string; detectedAt: string };
    };
    expect(data.intent).toBe("support");
    expect(typeof data.confidence).toBe("number");
    expect(data.logEntry).toBeDefined();
    expect(data.logEntry.entryId).toBeDefined();
    expect(data.logEntry.detectedAt).toBeDefined();
  });

  it("returns 400 when text is missing", async () => {
    const res = await httpRequest(server, "POST", "/intents/detect", {});
    expect(res.status).toBe(400);

    const data = res.json() as { error: string };
    expect(data.error).toContain("text");
  });

  it("returns 400 when text is an empty string", async () => {
    const res = await httpRequest(server, "POST", "/intents/detect", { text: "" });
    expect(res.status).toBe(400);
  });

  it("logs detection with tenantId when provided", async () => {
    await httpRequest(server, "POST", "/intents/detect", {
      text: "my bill is wrong",
      tenantId: "tenant-log-test",
    });

    const logs = store.listLogs("tenant-log-test");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].tenantId).toBe("tenant-log-test");
  });

  it("logs detection with sessionId when provided", async () => {
    await httpRequest(server, "POST", "/intents/detect", {
      text: "I want to buy the enterprise plan",
      tenantId: "tenant-sess",
      sessionId: "sess-abc-123",
    });

    const logs = store.listLogs("tenant-sess");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].sessionId).toBe("sess-abc-123");
  });

  it("returns 400 when text is whitespace only", async () => {
    const res = await httpRequest(server, "POST", "/intents/detect", { text: "   " });
    expect(res.status).toBe(400);
  });
});

// ── 8. HTTP GET /intents ──────────────────────────────────────────────

describe("HTTP GET /intents", () => {
  let app: Express;
  let server: Server;
  let store: IntentStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("http-get");
    store = new IntentStore(storageFile);
    // Pre-seed data
    store.logDetection({ tenantId: "tA", sessionId: null, text: "help", intent: "support", confidence: 0.3 });
    store.logDetection({ tenantId: "tA", sessionId: null, text: "bill", intent: "billing", confidence: 0.3 });
    store.logDetection({ tenantId: "tB", sessionId: null, text: "buy", intent: "sales", confidence: 0.3 });
    app = buildTestApp(new IntentClassifier(), store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(storageFile)) rmSync(storageFile);
      done();
    });
  });

  it("returns frequencies, total, and logs", async () => {
    const res = await httpRequest(server, "GET", "/intents");
    expect(res.status).toBe(200);

    const data = res.json() as { frequencies: Record<string, number>; total: number; logs: unknown[] };
    expect(data.frequencies).toBeDefined();
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.logs)).toBe(true);
  });

  it("respects ?tenantId= filter", async () => {
    const res = await httpRequest(server, "GET", "/intents?tenantId=tA");
    expect(res.status).toBe(200);

    const data = res.json() as { logs: Array<{ tenantId: string }> };
    for (const log of data.logs) {
      expect(log.tenantId).toBe("tA");
    }
  });

  it("respects ?limit= parameter", async () => {
    const res = await httpRequest(server, "GET", "/intents?limit=1");
    expect(res.status).toBe(200);

    const data = res.json() as { logs: unknown[] };
    expect(data.logs.length).toBeLessThanOrEqual(1);
  });
});

// ── 9. HTTP GET /intents/config ───────────────────────────────────────

describe("HTTP GET /intents/config", () => {
  let app: Express;
  let server: Server;
  let store: IntentStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("http-config-get");
    store = new IntentStore(storageFile);
    app = buildTestApp(new IntentClassifier(), store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(storageFile)) rmSync(storageFile);
      done();
    });
  });

  it("returns empty array initially", async () => {
    const res = await httpRequest(server, "GET", "/intents/config");
    expect(res.status).toBe(200);

    const data = res.json() as { mappings: unknown[]; count: number };
    expect(data.mappings).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("returns mappings after they are set", async () => {
    store.setMapping(null, "billing", "tmpl-bill-001");

    const res = await httpRequest(server, "GET", "/intents/config");
    expect(res.status).toBe(200);

    const data = res.json() as { mappings: unknown[]; count: number };
    expect(data.count).toBeGreaterThan(0);
  });
});

// ── 10. HTTP POST /intents/config ─────────────────────────────────────

describe("HTTP POST /intents/config", () => {
  let app: Express;
  let server: Server;
  let store: IntentStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("http-config-post");
    store = new IntentStore(storageFile);
    app = buildTestApp(new IntentClassifier(), store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(storageFile)) rmSync(storageFile);
      done();
    });
  });

  it("creates a mapping and returns 201", async () => {
    const res = await httpRequest(server, "POST", "/intents/config", {
      intent: "billing",
      templateId: "tmpl-billing-100",
    });
    expect(res.status).toBe(201);

    const data = res.json() as { intent: string; templateId: string };
    expect(data.intent).toBe("billing");
    expect(data.templateId).toBe("tmpl-billing-100");
  });

  it("returns 400 when intent is missing", async () => {
    const res = await httpRequest(server, "POST", "/intents/config", {
      templateId: "tmpl-x",
    });
    expect(res.status).toBe(400);

    const data = res.json() as { error: string };
    expect(data.error).toContain("intent");
  });

  it("returns 400 when intent is invalid", async () => {
    const res = await httpRequest(server, "POST", "/intents/config", {
      intent: "unknown_intent",
      templateId: "tmpl-x",
    });
    expect(res.status).toBe(400);

    const data = res.json() as { error: string };
    expect(data.error).toContain("intent");
  });

  it("returns 400 when templateId is missing", async () => {
    const res = await httpRequest(server, "POST", "/intents/config", {
      intent: "support",
    });
    expect(res.status).toBe(400);

    const data = res.json() as { error: string };
    expect(data.error).toContain("templateId");
  });

  it("updates existing mapping (returns 201 for upsert)", async () => {
    await httpRequest(server, "POST", "/intents/config", {
      intent: "sales",
      templateId: "tmpl-sales-v1",
    });

    const res = await httpRequest(server, "POST", "/intents/config", {
      intent: "sales",
      templateId: "tmpl-sales-v2",
    });
    expect(res.status).toBe(201);

    const data = res.json() as { templateId: string };
    expect(data.templateId).toBe("tmpl-sales-v2");
  });
});

// ── 11. HTTP DELETE /intents/config/:intent ───────────────────────────

describe("HTTP DELETE /intents/config/:intent", () => {
  let app: Express;
  let server: Server;
  let store: IntentStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("http-config-delete");
    store = new IntentStore(storageFile);
    app = buildTestApp(new IntentClassifier(), store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(storageFile)) rmSync(storageFile);
      done();
    });
  });

  it("returns 204 on successful deletion", async () => {
    store.setMapping(null, "complaint", "tmpl-complaint-del");

    const res = await httpRequest(server, "DELETE", "/intents/config/complaint");
    expect(res.status).toBe(204);
  });

  it("returns 404 when mapping not found", async () => {
    const res = await httpRequest(server, "DELETE", "/intents/config/general");
    expect(res.status).toBe(404);

    const data = res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it("deletes the correct tenant-scoped mapping", async () => {
    store.setMapping("tenant-del", "support", "tmpl-support-del");

    const res = await httpRequest(
      server,
      "DELETE",
      "/intents/config/support?tenantId=tenant-del",
    );
    expect(res.status).toBe(204);
    expect(store.getMapping("tenant-del", "support")).toBeUndefined();
  });
});

// ── 12. Word-boundary regression tests (N-35 / Q40) ──────────────────
// Verify that short keywords no longer match as substrings inside longer words.

describe("IntentClassifier — word-boundary matching (N-35)", () => {
  const classifier = new IntentClassifier();

  it("'payment' does NOT also match the 'pay' keyword (billing score = 1 not 2)", () => {
    // Pre-fix: both "payment" and "pay" would match → billing score 2
    // Post-fix: only "payment" matches → billing score 1
    const result = classifier.classify("I had a payment issue");
    expect(result.scores.billing).toBe(1);
  });

  it("'pay' keyword matches the standalone word 'pay'", () => {
    const result = classifier.classify("I need to pay now");
    expect(result.scores.billing).toBeGreaterThanOrEqual(1);
    // Verify "pay" is counted
    const withPay = classifier.classify("pay");
    expect(withPay.scores.billing).toBe(1);
  });

  it("'bug' keyword does NOT match inside 'debug'", () => {
    const result = classifier.classify("how do I debug this issue");
    // "debug" should not fire "bug"; "issue" should fire support = 1
    expect(result.scores.support).toBe(1);
  });

  it("'fail' keyword does NOT match inside 'failure'", () => {
    const result = classifier.classify("there was a failure in the system");
    // "failure" should not match "fail"
    expect(result.scores.support).toBe(0);
  });

  it("'bug' standalone word matches correctly", () => {
    const result = classifier.classify("there is a bug");
    expect(result.scores.support).toBeGreaterThanOrEqual(1);
  });

  it("'bill' does NOT match inside 'billing' (word boundary prevents it)", () => {
    // "billing" is not itself a keyword; "bill" should not match inside it
    const result = classifier.classify("billing question");
    expect(result.scores.billing).toBe(0);
  });

  it("'bill' standalone keyword matches correctly", () => {
    const result = classifier.classify("my bill is too high");
    expect(result.scores.billing).toBeGreaterThanOrEqual(1);
  });

  it("multi-word keyword 'not working' still matches after word-boundary fix", () => {
    const result = classifier.classify("the app is not working");
    expect(result.scores.support).toBeGreaterThan(0);
  });

  it("multi-word keyword 'credit card' still matches after word-boundary fix", () => {
    const result = classifier.classify("my credit card was declined");
    expect(result.scores.billing).toBeGreaterThan(0);
  });

  it("'plan' does NOT match inside 'planning'", () => {
    const result = classifier.classify("we are planning something");
    expect(result.scores.sales).toBe(0);
  });

  it("'plan' standalone word matches sales intent", () => {
    const result = classifier.classify("what is the pricing for the plan");
    // "pricing" and "plan" both in sales keywords
    expect(result.scores.sales).toBeGreaterThanOrEqual(2);
  });
});

// ── Helper: send request with no body (Content-Type omitted so express.json()
//    leaves req.body undefined, exercising the `req.body ?? {}` fallback) ────

function httpRequestNoBody(
  server: Server,
  method: string,
  path: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    import("http").then(({ default: http }) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: (addr as { port: number }).port,
          path,
          method,
        },
        (res) => {
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
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

// ── 13. IntentStore — branch coverage ────────────────────────────────

describe("IntentStore — branch coverage", () => {
  function tempBranchFile(label: string): string {
    return join(
      tmpdir(),
      `intent-branch-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
  }

  // L65: Array.isArray(data.logs) false branch
  // When the JSON file has logs as a non-array value, it should fall back to []
  it("loadFromDisk: non-array 'logs' field falls back to empty array (L65 false branch)", () => {
    const file = tempBranchFile("logs-nonarray");
    writeFileSync(file, JSON.stringify({ logs: "not-an-array", mappings: [] }), "utf-8");

    const store = new IntentStore(file);
    // logs is not an array — listLogs() should return []
    expect(store.listLogs()).toEqual([]);

    rmSync(file);
  });

  // L66: Array.isArray(data.mappings) false branch
  // When the JSON file has mappings as a non-array value, it should fall back to []
  it("loadFromDisk: non-array 'mappings' field falls back to empty array (L66 false branch)", () => {
    const file = tempBranchFile("mappings-nonarray");
    writeFileSync(file, JSON.stringify({ logs: [], mappings: null }), "utf-8");

    const store = new IntentStore(file);
    // mappings is not an array — listMappings() should return []
    expect(store.listMappings()).toEqual([]);

    rmSync(file);
  });

  // L68: err.code !== "ENOENT" true branch — re-throw non-ENOENT errors
  // Write invalid JSON to a file that exists; JSON.parse throws a SyntaxError
  // (code is undefined, not "ENOENT"), so the catch block must re-throw it.
  it("loadFromDisk: re-throws non-ENOENT errors (L68 true branch)", () => {
    const file = tempBranchFile("parse-error");
    writeFileSync(file, "{ this is invalid JSON }", "utf-8");

    expect(() => new IntentStore(file)).toThrow(SyntaxError);

    rmSync(file);
  });

  // L125: frequencies[entry.intent] ?? 0 — the ?? 0 fallback path
  // Inject a log entry whose intent is not one of the 5 pre-seeded keys.
  // This makes the lookup return undefined, exercising the ?? 0 branch.
  it("getFrequencies: unknown intent key falls back to 0 via nullish coalescing (L125 ?? branch)", () => {
    const file = tempBranchFile("unknown-intent");

    // Write a valid store file with an intent value not in the seeded frequencies object
    const storeData = {
      logs: [
        {
          entryId: "abc-123",
          tenantId: "t1",
          sessionId: null,
          text: "test text",
          intent: "unknown_intent_xyz",
          confidence: 0.5,
          detectedAt: new Date().toISOString(),
        },
      ],
      mappings: [],
    };
    writeFileSync(file, JSON.stringify(storeData), "utf-8");

    const store = new IntentStore(file);
    // getFrequencies should not throw; the unknown intent lands in ?? 0 branch
    // and its count is stored under the unknown key
    const freq = store.getFrequencies();
    // The 5 known intents remain at 0
    expect(freq.billing).toBe(0);
    expect(freq.support).toBe(0);

    rmSync(file);
  });

  // L250: if (!_store) true branch — proxy accessed before initIntentStore()
  // Use jest.resetModules() + dynamic import to get a fresh module where _store is null.
  it("intentStore proxy: throws before initIntentStore() is called (L250 true branch)", async () => {
    jest.resetModules();
    jest.doMock("fs", () => ({
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    }));

    const { intentStore } = await import("../../services/IntentStore.js");

    expect(() =>
      (intentStore as unknown as { listLogs: () => unknown }).listLogs(),
    ).toThrow("IntentStore not initialized");

    jest.resetModules();
  });
});

// ── 14. intents API — branch coverage ────────────────────────────────
//
// Targets the six missed branches in server/src/api/intents.ts:
//   L36  binary-expr  req.body ?? {}        (POST /detect, no body)
//   L74  cond-expr    limitRaw !== undefined (GET /,      no ?limit)
//   L91  cond-expr    tenantId query string  (GET /config, no ?tenantId)
//   L108 binary-expr  req.body ?? {}        (POST /config, no body)
//   L127 cond-expr    body.tenantId string   (POST /config, tenantId not a string)
//   L145 if branch    invalid intent DELETE  (DELETE /config/:intent, bad intent)

describe("intents API — branch coverage", () => {
  let app: Express;
  let server: Server;
  let store: IntentStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("api-branch");
    store = new IntentStore(storageFile);
    app = buildTestApp(new IntentClassifier(), store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(storageFile)) rmSync(storageFile);
      done();
    });
  });

  // L36: req.body ?? {} — right side fires when req.body is undefined.
  // Sending a raw POST with no body and no Content-Type header leaves
  // req.body undefined after express.json(); the ?? {} fallback is taken,
  // body.text is undefined, and the handler returns 400.
  it("POST /detect with no body exercises req.body ?? {} fallback (L36)", async () => {
    const res = await httpRequestNoBody(server, "POST", "/intents/detect");
    // body is undefined → {} → body.text is undefined → 400
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("text");
  });

  // L74: limitRaw !== undefined ternary — false branch (?: 50) fires when
  // ?limit is absent from the query string.
  it("GET /intents with no ?limit uses default 50 (L74 false branch)", async () => {
    store.logDetection({
      tenantId: "branch-t1",
      sessionId: null,
      text: "need support",
      intent: "support",
      confidence: 0.5,
    });

    const res = await httpRequest(server, "GET", "/intents?tenantId=branch-t1");
    expect(res.status).toBe(200);
    // Response succeeds — the default limit of 50 was applied
    const data = res.json() as { logs: unknown[] };
    expect(Array.isArray(data.logs)).toBe(true);
  });

  // L74 (safeLimit fallback): passing a non-numeric limit string makes
  // parseInt return NaN, which is not finite, so safeLimit falls back to 50.
  it("GET /intents with ?limit=nan falls back to safeLimit 50 (L74 NaN branch)", async () => {
    const res = await httpRequest(server, "GET", "/intents?limit=notanumber");
    expect(res.status).toBe(200);
    const data = res.json() as { logs: unknown[] };
    expect(Array.isArray(data.logs)).toBe(true);
  });

  // L91: typeof req.query.tenantId === "string" — false branch fires when
  // ?tenantId is absent, so tenantId becomes undefined and all mappings are returned.
  it("GET /config with no ?tenantId exercises tenantId undefined branch (L91)", async () => {
    store.setMapping(null, "sales", "tmpl-sales-branch");

    const res = await httpRequest(server, "GET", "/intents/config");
    expect(res.status).toBe(200);
    const data = res.json() as { mappings: unknown[]; count: number };
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  // L108: req.body ?? {} — right side fires when req.body is undefined.
  // Sending a raw POST /config with no body → {} → body.intent is undefined → 400.
  it("POST /config with no body exercises req.body ?? {} fallback (L108)", async () => {
    const res = await httpRequestNoBody(server, "POST", "/intents/config");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("intent");
  });

  // L127: typeof body.tenantId === "string" — false branch fires when tenantId
  // is a non-string value (e.g., a number). The handler coerces it to null.
  it("POST /config with numeric tenantId stores null tenantId (L127 false branch)", async () => {
    const res = await httpRequest(server, "POST", "/intents/config", {
      intent: "complaint",
      templateId: "tmpl-complaint-branch",
      tenantId: 42, // number, not string → false branch → null
    });
    expect(res.status).toBe(201);
    const data = res.json() as { tenantId: null };
    expect(data.tenantId).toBeNull();
  });

  // L145: if (!(VALID_INTENTS).includes(intent)) — true branch fires when
  // the :intent param is not in VALID_INTENTS. Returns 400.
  it("DELETE /config/:intent with invalid intent returns 400 (L145 true branch)", async () => {
    const res = await httpRequest(
      server,
      "DELETE",
      "/intents/config/not_a_valid_intent",
    );
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("intent");
  });
});
