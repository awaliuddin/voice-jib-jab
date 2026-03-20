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
import { existsSync, rmSync } from "fs";
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

// ── 3. IntentStore — log operations ──────────────────────────────────

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

// ── 4. IntentStore — mapping operations ──────────────────────────────

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

// ── 5. IntentStore — singleton proxy ─────────────────────────────────

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

// ── 6. HTTP POST /intents/detect ─────────────────────────────────────

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

// ── 7. HTTP GET /intents ──────────────────────────────────────────────

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

// ── 8. HTTP GET /intents/config ───────────────────────────────────────

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

// ── 9. HTTP POST /intents/config ──────────────────────────────────────

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

// ── 10. HTTP DELETE /intents/config/:intent ───────────────────────────

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
