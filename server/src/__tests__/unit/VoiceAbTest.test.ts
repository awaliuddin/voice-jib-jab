/**
 * VoiceAbTest Unit Tests
 *
 * Tests for:
 *   - VoiceAbTestService — A/B test management and session assignment
 *   - Voices API A/B test endpoints — GET /available, /abtests, /abtests/:id/stats,
 *     /abtests/:id/deactivate
 *
 * Uses real filesystem via OS temp directories. HTTP requests use Node's built-in
 * http module (no supertest dependency).
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import { createServer, type Server } from "http";
import express, { type Express } from "express";
import {
  VoiceAbTestService,
  initVoiceAbTestService,
} from "../../services/VoiceAbTestService.js";
import { VoiceProfileStore } from "../../services/VoiceProfileStore.js";
import { createVoicesRouter } from "../../api/voices.js";

// ── HTTP helper ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: <T = unknown>() => T;
}

function httpGet(server: Server, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    const url = `http://127.0.0.1:${addr.port}${path}`;
    import("http").then(({ default: http }) => {
      http
        .get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            resolve({
              status: res.statusCode ?? 0,
              body,
              json: <T>() => JSON.parse(body) as T,
            });
          });
        })
        .on("error", reject);
    });
  });
}

function httpPost(
  server: Server,
  path: string,
  payload?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    const bodyStr = payload !== undefined ? JSON.stringify(payload) : "";
    const options = {
      hostname: "127.0.0.1",
      port: (addr as { port: number }).port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            body,
            json: <T>() => JSON.parse(body) as T,
          });
        });
      });
      req.on("error", reject);
      req.write(bodyStr);
      req.end();
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `voice-abtest-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

function tempDir(label: string): string {
  return join(
    tmpdir(),
    `voice-abtest-dir-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

function buildApp(
  store: VoiceProfileStore,
  abTestService?: VoiceAbTestService,
): Express {
  const app = express();
  app.use(express.json());
  app.use("/voices", createVoicesRouter(store, undefined, abTestService));
  return app;
}

// ── VoiceAbTestService unit tests ─────────────────────────────────────

describe("VoiceAbTestService", () => {
  let svc: VoiceAbTestService;
  let file: string;

  beforeEach(() => {
    file = tempFile("svc");
    svc = new VoiceAbTestService(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── createTest ─────────────────────────────────────────────────────

  describe("createTest()", () => {
    it("generates a UUID testId", () => {
      const test = svc.createTest({
        tenantId: "t1",
        name: "Test One",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      expect(test.testId).toBeDefined();
      expect(typeof test.testId).toBe("string");
      expect(test.testId.length).toBeGreaterThan(0);
      expect(test.testId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("sets createdAt to an ISO date string", () => {
      const test = svc.createTest({
        tenantId: "t1",
        name: "Test One",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      expect(test.createdAt).toBeDefined();
      expect(new Date(test.createdAt).toISOString()).toBe(test.createdAt);
    });

    it("defaults active to true", () => {
      const test = svc.createTest({
        tenantId: "t1",
        name: "Test One",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      expect(test.active).toBe(true);
    });

    it("respects explicit active=false", () => {
      const test = svc.createTest({
        tenantId: "t1",
        name: "Inactive",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        active: false,
      });

      expect(test.active).toBe(false);
    });

    it("defaults splitRatio to 0.5 when not provided", () => {
      const test = svc.createTest({
        tenantId: "t1",
        name: "No Ratio",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      expect(test.splitRatio).toBe(0.5);
    });

    it("uses provided splitRatio", () => {
      const test = svc.createTest({
        tenantId: "t1",
        name: "Custom Ratio",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.3,
      });

      expect(test.splitRatio).toBe(0.3);
    });
  });

  // ── getTest ────────────────────────────────────────────────────────

  describe("getTest()", () => {
    it("returns the test when found", () => {
      const created = svc.createTest({
        tenantId: "t2",
        name: "Find Me",
        voiceA: "af_bella",
        voiceB: "af_sarah",
      });

      const found = svc.getTest(created.testId);
      expect(found).toBeDefined();
      expect(found!.testId).toBe(created.testId);
      expect(found!.name).toBe("Find Me");
    });

    it("returns undefined for unknown testId", () => {
      const result = svc.getTest("00000000-0000-0000-0000-000000000000");
      expect(result).toBeUndefined();
    });
  });

  // ── listTests ──────────────────────────────────────────────────────

  describe("listTests()", () => {
    it("returns all tests when no tenantId filter", () => {
      svc.createTest({ tenantId: "a", name: "A1", voiceA: "af_bella", voiceB: "bf_emma" });
      svc.createTest({ tenantId: "b", name: "B1", voiceA: "af_sarah", voiceB: "bm_george" });

      const all = svc.listTests();
      expect(all).toHaveLength(2);
    });

    it("filters by tenantId", () => {
      svc.createTest({ tenantId: "acme", name: "ACME Test", voiceA: "af_bella", voiceB: "bf_emma" });
      svc.createTest({ tenantId: "other", name: "Other Test", voiceA: "af_sarah", voiceB: "bm_george" });
      svc.createTest({ tenantId: "acme", name: "ACME Test 2", voiceA: "am_adam", voiceB: "bm_lewis" });

      const acmeTests = svc.listTests("acme");
      expect(acmeTests).toHaveLength(2);
      expect(acmeTests.every((t) => t.tenantId === "acme")).toBe(true);
    });

    it("returns empty array when tenant has no tests", () => {
      const result = svc.listTests("no-such-tenant");
      expect(result).toEqual([]);
    });
  });

  // ── deactivateTest ─────────────────────────────────────────────────

  describe("deactivateTest()", () => {
    it("sets active=false and returns updated test", () => {
      const test = svc.createTest({
        tenantId: "t3",
        name: "Active Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });
      expect(test.active).toBe(true);

      const updated = svc.deactivateTest(test.testId);
      expect(updated).toBeDefined();
      expect(updated!.active).toBe(false);
      expect(updated!.testId).toBe(test.testId);
    });

    it("returns undefined for unknown testId", () => {
      const result = svc.deactivateTest("nonexistent-id");
      expect(result).toBeUndefined();
    });

    it("persists deactivation across reload", () => {
      const test = svc.createTest({
        tenantId: "t4",
        name: "Will Deactivate",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      svc.deactivateTest(test.testId);

      const svc2 = new VoiceAbTestService(file);
      const reloaded = svc2.getTest(test.testId);
      expect(reloaded!.active).toBe(false);
    });
  });

  // ── assignVoice ────────────────────────────────────────────────────

  describe("assignVoice()", () => {
    it("returns default voice when no active test for tenant", () => {
      const result = svc.assignVoice("no-test-tenant", "session-123", "af_bella");
      expect(result).toEqual({ voice: "af_bella", testId: null, assignment: "default" });
    });

    it("returns default voice when all tests are inactive", () => {
      const test = svc.createTest({
        tenantId: "t5",
        name: "Inactive Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        active: false,
      });
      expect(test.active).toBe(false);

      const result = svc.assignVoice("t5", "session-abc", "am_adam");
      expect(result.assignment).toBe("default");
      expect(result.voice).toBe("am_adam");
      expect(result.testId).toBeNull();
    });

    it("is deterministic — same sessionId always gets same voice", () => {
      svc.createTest({
        tenantId: "t6",
        name: "Deterministic",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      const sessionId = "test-session-xyz-999";
      const first = svc.assignVoice("t6", sessionId, "am_adam");
      const second = svc.assignVoice("t6", sessionId, "am_adam");
      const third = svc.assignVoice("t6", sessionId, "am_adam");

      expect(first.voice).toBe(second.voice);
      expect(second.voice).toBe(third.voice);
      expect(first.assignment).toBe(second.assignment);
    });

    it("assigns voiceA when hash bucket < splitRatio*100", () => {
      // "!" has charCode 33; 33 % 100 = 33; 33 < 50 → voiceA
      svc.createTest({
        tenantId: "t7",
        name: "Split Test A",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      const result = svc.assignVoice("t7", "!", "am_adam");
      expect(result.assignment).toBe("A");
      expect(result.voice).toBe("af_bella");
      expect(result.testId).not.toBeNull();
    });

    it("assigns voiceB when hash bucket >= splitRatio*100", () => {
      // "aaa" → 97+97+97 = 291; 291 % 100 = 91; 91 >= 50 → voiceB
      svc.createTest({
        tenantId: "t8",
        name: "Split Test B",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      const result = svc.assignVoice("t8", "aaa", "am_adam");
      expect(result.assignment).toBe("B");
      expect(result.voice).toBe("bf_emma");
    });

    it("returns testId of the active test on assignment", () => {
      const test = svc.createTest({
        tenantId: "t9",
        name: "With TestId",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 1.0, // always A
      });

      const result = svc.assignVoice("t9", "any-session", "am_adam");
      expect(result.testId).toBe(test.testId);
    });
  });

  // ── recordQuality ──────────────────────────────────────────────────

  describe("recordQuality()", () => {
    it("stores quality score for an assigned session", () => {
      const test = svc.createTest({
        tenantId: "t10",
        name: "Quality Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 1.0, // all to A
      });

      svc.assignVoice("t10", "sess-q1", "am_adam");
      svc.recordQuality(test.testId, "sess-q1", 87);

      const stats = svc.getTestStats(test.testId);
      expect(stats).toBeDefined();
      expect(stats!.voiceA.avgQuality).toBe(87);
    });

    it("does nothing for unknown session (no throw)", () => {
      const test = svc.createTest({
        tenantId: "t11",
        name: "No Session",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      expect(() => svc.recordQuality(test.testId, "ghost-session", 95)).not.toThrow();
    });
  });

  // ── getTestStats ───────────────────────────────────────────────────

  describe("getTestStats()", () => {
    it("returns undefined for unknown testId", () => {
      const stats = svc.getTestStats("00000000-0000-0000-0000-000000000000");
      expect(stats).toBeUndefined();
    });

    it("returns zero sessions and null avgQuality when no sessions assigned", () => {
      const test = svc.createTest({
        tenantId: "t12",
        name: "Empty Stats",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      const stats = svc.getTestStats(test.testId);
      expect(stats).toBeDefined();
      expect(stats!.voiceA.sessions).toBe(0);
      expect(stats!.voiceA.avgQuality).toBeNull();
      expect(stats!.voiceB.sessions).toBe(0);
      expect(stats!.voiceB.avgQuality).toBeNull();
    });

    it("returns null avgQuality when sessions assigned but no quality recorded", () => {
      const test = svc.createTest({
        tenantId: "t13",
        name: "No Quality",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 1.0, // all to A
      });

      svc.assignVoice("t13", "s1", "am_adam");
      svc.assignVoice("t13", "s2", "am_adam");

      const stats = svc.getTestStats(test.testId);
      expect(stats!.voiceA.sessions).toBe(2);
      expect(stats!.voiceA.avgQuality).toBeNull();
    });

    it("computes correct avgQuality for voiceA and voiceB", () => {
      const test = svc.createTest({
        tenantId: "t14",
        name: "Quality Stats",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.5,
      });

      // "!" → bucket 33 < 50 → A; "aaa" → bucket 91 >= 50 → B
      svc.assignVoice("t14", "!", "am_adam");
      svc.assignVoice("t14", "aaa", "am_adam");

      svc.recordQuality(test.testId, "!", 80);
      svc.recordQuality(test.testId, "aaa", 90);

      const stats = svc.getTestStats(test.testId);
      expect(stats!.voiceA.name).toBe("af_bella");
      expect(stats!.voiceA.sessions).toBe(1);
      expect(stats!.voiceA.avgQuality).toBe(80);
      expect(stats!.voiceB.name).toBe("bf_emma");
      expect(stats!.voiceB.sessions).toBe(1);
      expect(stats!.voiceB.avgQuality).toBe(90);
    });

    it("averages multiple quality scores for same arm", () => {
      const test = svc.createTest({
        tenantId: "t15",
        name: "Avg Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 1.0, // all to A
      });

      svc.assignVoice("t15", "s1", "am_adam");
      svc.assignVoice("t15", "s2", "am_adam");
      svc.assignVoice("t15", "s3", "am_adam");

      svc.recordQuality(test.testId, "s1", 60);
      svc.recordQuality(test.testId, "s2", 80);
      svc.recordQuality(test.testId, "s3", 100);

      const stats = svc.getTestStats(test.testId);
      expect(stats!.voiceA.avgQuality).toBe(80); // (60+80+100)/3
    });
  });

  // ── initVoiceAbTestService factory ────────────────────────────────

  describe("initVoiceAbTestService()", () => {
    it("returns a VoiceAbTestService instance", () => {
      const f = tempFile("factory");
      try {
        const instance = initVoiceAbTestService(f);
        expect(instance).toBeInstanceOf(VoiceAbTestService);
      } finally {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });
  });
});

// ── Voices API A/B test endpoint tests ───────────────────────────────

describe("Voices API — A/B test endpoints", () => {
  let store: VoiceProfileStore;
  let abTestService: VoiceAbTestService;
  let storeDir: string;
  let abTestFile: string;
  let server: Server;
  let serverNoAb: Server;

  beforeAll((done) => {
    storeDir = tempDir("api-store");
    abTestFile = tempFile("api-abtest");
    store = new VoiceProfileStore(storeDir);
    abTestService = new VoiceAbTestService(abTestFile);

    const app = buildApp(store, abTestService);
    const appNoAb = buildApp(store);

    server = createServer(app);
    serverNoAb = createServer(appNoAb);

    server.listen(0, () => {
      serverNoAb.listen(0, done);
    });
  });

  afterAll((done) => {
    server.close(() => {
      serverNoAb.close(() => {
        if (existsSync(storeDir)) rmSync(storeDir, { recursive: true, force: true });
        if (existsSync(abTestFile)) rmSync(abTestFile, { force: true });
        done();
      });
    });
  });

  // ── GET /voices/available ─────────────────────────────────────────

  describe("GET /voices/available", () => {
    it("returns 8 built-in voices", async () => {
      const res = await httpGet(server, "/voices/available");
      const body = res.json<{ builtIn: Array<{ name: string; previewText: string }>; custom: unknown[]; total: number }>();

      expect(res.status).toBe(200);
      expect(body.builtIn).toHaveLength(8);
    });

    it("includes all expected voice names", async () => {
      const res = await httpGet(server, "/voices/available");
      const body = res.json<{ builtIn: Array<{ name: string }> }>();
      const names = body.builtIn.map((v) => v.name);

      expect(names).toContain("af_bella");
      expect(names).toContain("af_sarah");
      expect(names).toContain("am_adam");
      expect(names).toContain("am_michael");
      expect(names).toContain("bf_emma");
      expect(names).toContain("bf_isabella");
      expect(names).toContain("bm_george");
      expect(names).toContain("bm_lewis");
    });

    it("returns previewText on each built-in voice", async () => {
      const res = await httpGet(server, "/voices/available");
      const body = res.json<{ builtIn: Array<{ name: string; previewText: string }> }>();

      for (const v of body.builtIn) {
        expect(v.previewText).toBe("Hello, how can I help you today?");
      }
    });

    it("returns empty custom array when no tenantId", async () => {
      const res = await httpGet(server, "/voices/available");
      const body = res.json<{ custom: unknown[] }>();

      expect(body.custom).toEqual([]);
    });

    it("returns custom profiles for tenant when tenantId provided", async () => {
      store.createProfile({ tenantId: "org_api", name: "Custom Voice", audioPath: "/c.wav" });

      const res = await httpGet(server, "/voices/available?tenantId=org_api");
      const body = res.json<{ custom: Array<{ name: string }> }>();

      expect(body.custom.length).toBeGreaterThanOrEqual(1);
      expect(body.custom.some((p) => p.name === "Custom Voice")).toBe(true);
    });

    it("total equals builtIn count plus custom count", async () => {
      store.createProfile({ tenantId: "org_total", name: "V1", audioPath: "/v1.wav" });
      store.createProfile({ tenantId: "org_total", name: "V2", audioPath: "/v2.wav" });

      const res = await httpGet(server, "/voices/available?tenantId=org_total");
      const body = res.json<{ builtIn: unknown[]; custom: unknown[]; total: number }>();

      expect(body.total).toBe(body.builtIn.length + body.custom.length);
    });
  });

  // ── GET /voices/abtests ───────────────────────────────────────────

  describe("GET /voices/abtests", () => {
    it("returns 503 when abTestService is not provided", async () => {
      const res = await httpGet(serverNoAb, "/voices/abtests?tenantId=t1");
      expect(res.status).toBe(503);
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpGet(server, "/voices/abtests");
      expect(res.status).toBe(400);
    });

    it("returns tests for the given tenant", async () => {
      abTestService.createTest({ tenantId: "t-api-list", name: "API Test", voiceA: "af_bella", voiceB: "bf_emma" });

      const res = await httpGet(server, "/voices/abtests?tenantId=t-api-list");
      const body = res.json<{ tests: Array<{ tenantId: string }>; count: number }>();

      expect(res.status).toBe(200);
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body.tests.every((t) => t.tenantId === "t-api-list")).toBe(true);
    });
  });

  // ── POST /voices/abtests ──────────────────────────────────────────

  describe("POST /voices/abtests", () => {
    it("returns 503 when abTestService is not provided", async () => {
      const res = await httpPost(serverNoAb, "/voices/abtests", {
        tenantId: "t",
        name: "N",
        voiceA: "a",
        voiceB: "b",
      });
      expect(res.status).toBe(503);
    });

    it("returns 400 when voiceA and voiceB are missing", async () => {
      const res = await httpPost(server, "/voices/abtests", {
        tenantId: "t",
        name: "N",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpPost(server, "/voices/abtests", {
        name: "N",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });
      expect(res.status).toBe(400);
    });

    it("creates a test and returns 201 with the test", async () => {
      const res = await httpPost(server, "/voices/abtests", {
        tenantId: "t-create",
        name: "Created",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });
      const body = res.json<{ test: { name: string; tenantId: string; testId: string; active: boolean } }>();

      expect(res.status).toBe(201);
      expect(body.test.name).toBe("Created");
      expect(body.test.tenantId).toBe("t-create");
      expect(body.test.testId).toBeDefined();
      expect(body.test.active).toBe(true);
    });

    it("uses provided splitRatio", async () => {
      const res = await httpPost(server, "/voices/abtests", {
        tenantId: "t-ratio",
        name: "Ratio Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.3,
      });
      const body = res.json<{ test: { splitRatio: number } }>();

      expect(res.status).toBe(201);
      expect(body.test.splitRatio).toBe(0.3);
    });
  });

  // ── GET /voices/abtests/:testId/stats ─────────────────────────────

  describe("GET /voices/abtests/:testId/stats", () => {
    it("returns 404 for unknown testId", async () => {
      const res = await httpGet(
        server,
        "/voices/abtests/00000000-0000-0000-0000-000000000000/stats",
      );
      expect(res.status).toBe(404);
    });

    it("returns stats for an existing test", async () => {
      const test = abTestService.createTest({
        tenantId: "t-stats-api",
        name: "Stats API Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      const res = await httpGet(server, `/voices/abtests/${test.testId}/stats`);
      const body = res.json<{
        testId: string;
        voiceA: { name: string; sessions: number; avgQuality: number | null };
        voiceB: { name: string; sessions: number; avgQuality: number | null };
      }>();

      expect(res.status).toBe(200);
      expect(body.testId).toBe(test.testId);
      expect(body.voiceA.name).toBe("af_bella");
      expect(body.voiceB.name).toBe("bf_emma");
      expect(body.voiceA.sessions).toBe(0);
      expect(body.voiceA.avgQuality).toBeNull();
    });
  });

  // ── POST /voices/abtests/:testId/deactivate ───────────────────────

  describe("POST /voices/abtests/:testId/deactivate", () => {
    it("returns 404 for unknown testId", async () => {
      const res = await httpPost(
        server,
        "/voices/abtests/00000000-0000-0000-0000-000000000000/deactivate",
      );
      expect(res.status).toBe(404);
    });

    it("deactivates a test and returns updated test with 200", async () => {
      const test = abTestService.createTest({
        tenantId: "t-deact-api",
        name: "Deactivate Me",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });
      expect(test.active).toBe(true);

      const res = await httpPost(server, `/voices/abtests/${test.testId}/deactivate`);
      const body = res.json<{ test: { testId: string; active: boolean } }>();

      expect(res.status).toBe(200);
      expect(body.test.testId).toBe(test.testId);
      expect(body.test.active).toBe(false);
    });
  });
});
