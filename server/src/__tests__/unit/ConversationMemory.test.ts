/**
 * ConversationMemory Tests
 *
 * Tests the ConversationMemoryStore service and Memory API endpoints.
 * Follows the AdminApi.test.ts pattern: standalone Express app with injected deps.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdirSync } from "fs";
import { ConversationMemoryStore } from "../../services/ConversationMemoryStore.js";
import { createMemoryRouter } from "../../api/memory.js";

// ── HTTP helpers (same pattern as AdminApi.test.ts) ───────────────────

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
  return join(tmpdir(), `conv-memory-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function buildTestApp(store: ConversationMemoryStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/tenants", createMemoryRouter(store));
  return app;
}

// ── Unit Tests: ConversationMemoryStore ───────────────────────────────

describe("ConversationMemoryStore", () => {
  let store: ConversationMemoryStore;
  let dir: string;

  beforeEach(() => {
    dir = tempDir("store");
    mkdirSync(dir, { recursive: true });
    store = new ConversationMemoryStore(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add() returns entry with id, createdAt, and provided fields", () => {
    const entry = store.add({
      tenantId: "org_a",
      fact: "Customer prefers email",
      source: "manual",
      tags: ["preference"],
    });

    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.createdAt).toBeDefined();
    expect(new Date(entry.createdAt).toISOString()).toBe(entry.createdAt);
    expect(entry.tenantId).toBe("org_a");
    expect(entry.fact).toBe("Customer prefers email");
    expect(entry.source).toBe("manual");
    expect(entry.tags).toEqual(["preference"]);
  });

  it("add() persists to disk (loadable after add)", () => {
    store.add({ tenantId: "org_b", fact: "Uses metric units", source: "manual" });

    // Create a fresh store pointing at the same directory
    const store2 = new ConversationMemoryStore(dir);
    const entries = store2.load("org_b");
    expect(entries).toHaveLength(1);
    expect(entries[0].fact).toBe("Uses metric units");
  });

  it("getForTenant() returns empty array for unknown tenant", () => {
    const entries = store.getForTenant("org_nonexistent");
    expect(entries).toEqual([]);
  });

  it("getForTenant() returns entries sorted by createdAt desc", () => {
    // Add entries with slight time gaps to ensure ordering
    store.add({ tenantId: "org_c", fact: "First fact", source: "manual" });
    store.add({ tenantId: "org_c", fact: "Second fact", source: "manual" });
    store.add({ tenantId: "org_c", fact: "Third fact", source: "manual" });

    const entries = store.getForTenant("org_c");
    expect(entries).toHaveLength(3);
    // Newest first — since they're added sequentially, the last added should be first
    // (or at least not older than the previous)
    const timestamps = entries.map((e) => new Date(e.createdAt).getTime());
    for (let i = 0; i < timestamps.length - 1; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
    }
  });

  it("getContextString() returns empty string when no facts", () => {
    const ctx = store.getContextString("org_empty");
    expect(ctx).toBe("");
  });

  it("getContextString() returns formatted string with bullet points", () => {
    store.add({ tenantId: "org_d", fact: "Operates in healthcare", source: "manual" });
    store.add({ tenantId: "org_d", fact: "HQ in Boston", source: "manual" });

    const ctx = store.getContextString("org_d");
    expect(ctx).toContain("Tenant memory context:");
    expect(ctx).toContain("- Operates in healthcare");
    expect(ctx).toContain("- HQ in Boston");
  });

  it("getContextString() respects maxFacts limit (only last N)", () => {
    for (let i = 0; i < 15; i++) {
      store.add({ tenantId: "org_e", fact: `Fact number ${i}`, source: "manual" });
    }

    const ctx = store.getContextString("org_e", 3);
    const lines = ctx.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
  });

  it("clearTenant() removes all entries for tenant", () => {
    store.add({ tenantId: "org_f", fact: "Will be cleared", source: "manual" });
    store.add({ tenantId: "org_other", fact: "Should survive", source: "manual" });

    store.clearTenant("org_f");

    expect(store.getForTenant("org_f")).toEqual([]);
    expect(store.getForTenant("org_other")).toHaveLength(1);
  });

  it("deleteEntry() removes specific entry by id", () => {
    const e1 = store.add({ tenantId: "org_g", fact: "Keep me", source: "manual" });
    const e2 = store.add({ tenantId: "org_g", fact: "Delete me", source: "manual" });

    const result = store.deleteEntry("org_g", e2.id);
    expect(result).toBe(true);

    const remaining = store.getForTenant("org_g");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(e1.id);
  });

  it("deleteEntry() returns false for unknown id", () => {
    store.add({ tenantId: "org_h", fact: "A fact", source: "manual" });
    const result = store.deleteEntry("org_h", "nonexistent-id");
    expect(result).toBe(false);
  });

  it("multiple tenants are isolated", () => {
    store.add({ tenantId: "tenant_x", fact: "X fact", source: "manual" });
    store.add({ tenantId: "tenant_y", fact: "Y fact", source: "manual" });

    const xEntries = store.getForTenant("tenant_x");
    const yEntries = store.getForTenant("tenant_y");

    expect(xEntries).toHaveLength(1);
    expect(xEntries[0].fact).toBe("X fact");
    expect(yEntries).toHaveLength(1);
    expect(yEntries[0].fact).toBe("Y fact");
  });

  it("add() with session source includes sessionId", () => {
    const entry = store.add({
      tenantId: "org_sess",
      fact: "Learned during session",
      source: "session",
      sessionId: "sess-123",
    });

    expect(entry.source).toBe("session");
    expect(entry.sessionId).toBe("sess-123");
  });
});

// ── Integration Tests: Memory API endpoints ───────────────────────────

describe("Memory API Endpoints", () => {
  let app: Express;
  let server: Server;
  let store: ConversationMemoryStore;
  let dir: string;

  beforeAll((done) => {
    dir = tempDir("memory-api");
    mkdirSync(dir, { recursive: true });
    store = new ConversationMemoryStore(dir);
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
    // Clear any tenant data between tests
    store.clearTenant("org_api");
  });

  // ── GET /tenants/:tenantId/memory ─────────────────────────────────

  describe("GET /tenants/:tenantId/memory", () => {
    it("returns 200 with entries array", async () => {
      store.add({ tenantId: "org_api", fact: "Test fact", source: "manual" });

      const res = await httpRequest(server, "GET", "/tenants/org_api/memory");
      expect(res.status).toBe(200);

      const data = res.json() as { tenantId: string; entries: unknown[]; count: number };
      expect(data.tenantId).toBe("org_api");
      expect(data.entries).toHaveLength(1);
      expect(data.count).toBe(1);
    });

    it("returns 200 with count=0 for unknown tenant (not 404)", async () => {
      const res = await httpRequest(server, "GET", "/tenants/org_unknown/memory");
      expect(res.status).toBe(200);

      const data = res.json() as { tenantId: string; entries: unknown[]; count: number };
      expect(data.tenantId).toBe("org_unknown");
      expect(data.entries).toEqual([]);
      expect(data.count).toBe(0);
    });
  });

  // ── POST /tenants/:tenantId/memory ────────────────────────────────

  describe("POST /tenants/:tenantId/memory", () => {
    it("returns 201 with created entry", async () => {
      const res = await httpRequest(server, "POST", "/tenants/org_api/memory", {
        fact: "New memory fact",
        tags: ["important"],
      });

      expect(res.status).toBe(201);
      const data = res.json() as { id: string; tenantId: string; fact: string; tags: string[]; source: string };
      expect(data.id).toBeDefined();
      expect(data.tenantId).toBe("org_api");
      expect(data.fact).toBe("New memory fact");
      expect(data.tags).toEqual(["important"]);
      expect(data.source).toBe("manual");
    });

    it("returns 400 when fact is missing", async () => {
      const res = await httpRequest(server, "POST", "/tenants/org_api/memory", {
        tags: ["nope"],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("fact");
    });

    it("returns 400 when fact exceeds 500 chars", async () => {
      const res = await httpRequest(server, "POST", "/tenants/org_api/memory", {
        fact: "x".repeat(501),
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("500");
    });

    it("returns 400 when tags is not a string array", async () => {
      const res = await httpRequest(server, "POST", "/tenants/org_api/memory", {
        fact: "Valid fact",
        tags: [123, true],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tags");
    });

    it("accepts fact at exactly 500 chars", async () => {
      const res = await httpRequest(server, "POST", "/tenants/org_api/memory", {
        fact: "x".repeat(500),
      });

      expect(res.status).toBe(201);
    });
  });

  // ── DELETE /tenants/:tenantId/memory ───────────────────────────────

  describe("DELETE /tenants/:tenantId/memory", () => {
    it("returns 204 (clear all)", async () => {
      store.add({ tenantId: "org_api", fact: "To be cleared", source: "manual" });

      const res = await httpRequest(server, "DELETE", "/tenants/org_api/memory");
      expect(res.status).toBe(204);

      // Verify cleared
      const entries = store.getForTenant("org_api");
      expect(entries).toEqual([]);
    });
  });

  // ── DELETE /tenants/:tenantId/memory/:entryId ─────────────────────

  describe("DELETE /tenants/:tenantId/memory/:entryId", () => {
    it("returns 204 on success", async () => {
      const entry = store.add({ tenantId: "org_api", fact: "Delete me", source: "manual" });

      const res = await httpRequest(server, "DELETE", `/tenants/org_api/memory/${entry.id}`);
      expect(res.status).toBe(204);
    });

    it("returns 404 for unknown entry", async () => {
      const res = await httpRequest(
        server,
        "DELETE",
        "/tenants/org_api/memory/nonexistent-uuid",
      );
      expect(res.status).toBe(404);

      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });
  });
});

// ── ConversationMemoryStore — error + singleton branches ──────────────

describe("ConversationMemoryStore — branch coverage", () => {
  it("load() rethrows non-ENOENT errors", () => {
    const dir = join(tmpdir(), `cmem-err-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = new ConversationMemoryStore(dir);

    // Write a file that will be treated as the memory file but with invalid content
    // to trigger a JSON parse error (which has no .code, so it re-throws)
    const { writeFileSync } = require("fs");
    writeFileSync(join(dir, "tenant-x.json"), "NOT_VALID_JSON");

    expect(() => store.load("tenant-x")).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("initConversationMemoryStore() wires the proxy correctly", () => {
    const { initConversationMemoryStore, conversationMemoryStore: proxy } =
      require("../../services/ConversationMemoryStore.js");
    const dir = join(tmpdir(), `cmem-init-${Date.now()}`);
    initConversationMemoryStore(dir);
    expect(typeof proxy.load).toBe("function");
    rmSync(dir, { recursive: true, force: true });
  });
});
