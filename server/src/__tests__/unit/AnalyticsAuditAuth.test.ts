/**
 * AnalyticsAuditAuth Tests (N-33)
 *
 * Verifies that the API key guard is applied to /analytics, /audit,
 * /recordings, and /export routes.
 *
 * Each test builds a minimal express app reproducing the guard + router
 * stack from index.ts, without importing the full server.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync } from "fs";
import express from "express";
import { createServer, type Server } from "http";
import { ApiKeyStore } from "../../services/ApiKeyStore.js";
import { createApiKeyMiddleware } from "../../middleware/apiKeyAuth.js";
import { createAuditEventsRouter } from "../../api/auditEvents.js";
import { AuditEventLogger } from "../../services/AuditEventLogger.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "vjj-analauth-"));
  return join(dir, "keys.json");
}

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    import("http").then(({ default: http }) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: addr.port, path, method, headers: headers ?? {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            resolve({ status: res.statusCode ?? 0, body: rawBody, json: () => JSON.parse(rawBody) });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

/** Builds a minimal app that reproduces the N-33 guard pattern. */
function buildGuardedApp(
  store: ApiKeyStore,
  auditLogger: AuditEventLogger,
  enabled: boolean,
): Server {
  const app = express();
  app.use(express.json());
  const requireApiKey = createApiKeyMiddleware(store, enabled);
  app.use(["/analytics", "/audit", "/recordings", "/export"], requireApiKey);
  // Mount audit events router after guard — same order as index.ts
  app.use("/audit", createAuditEventsRouter(auditLogger));
  // Stub endpoints for the other guarded paths
  app.get("/analytics/*", (_req, res) => res.json({ ok: true }));
  app.get("/recordings/*", (_req, res) => res.json({ ok: true }));
  app.get("/export/*", (_req, res) => res.json({ ok: true }));
  return createServer(app);
}

function startServer(server: Server): Promise<void> {
  return new Promise((r) => server.listen(0, "127.0.0.1", r));
}

function stopServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("N-33: Analytics, Audit, Recordings, Export endpoint protection", () => {
  let store: ApiKeyStore;
  let auditLogger: AuditEventLogger;
  let server: Server;

  describe("auth enabled", () => {
    beforeEach(async () => {
      store = new ApiKeyStore(makeTmpFile());
      auditLogger = new AuditEventLogger(makeTmpFile());
      server = buildGuardedApp(store, auditLogger, true);
      await startServer(server);
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it("GET /analytics/dashboard returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/analytics/dashboard");
      expect(res.status).toBe(401);
    });

    it("GET /audit/events returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/audit/events");
      expect(res.status).toBe(401);
    });

    it("GET /audit/events/stream returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/audit/events/stream");
      expect(res.status).toBe(401);
    });

    it("GET /recordings returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/recordings");
      expect(res.status).toBe(401);
    });

    it("GET /export returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/export");
      expect(res.status).toBe(401);
    });

    it("GET /audit/events returns 200 with valid key", async () => {
      const created = store.createKey("acme", "test");
      const res = await httpRequest(server, "GET", "/audit/events", {
        "x-api-key": created.rawKey,
      });
      expect(res.status).toBe(200);
    });

    it("GET /analytics/dashboard returns 200 with valid key", async () => {
      const created = store.createKey("acme", "test");
      const res = await httpRequest(server, "GET", "/analytics/dashboard", {
        "x-api-key": created.rawKey,
      });
      expect(res.status).toBe(200);
    });

    it("audit events accessible after guard with valid key (SSE route)", async () => {
      auditLogger.log({ type: "session_started", tenantId: "acme", detail: {} });
      const created = store.createKey("acme", "test");
      const res = await httpRequest(server, "GET", "/audit/events?tenantId=acme", {
        "x-api-key": created.rawKey,
      });
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(1);
    });
  });

  describe("auth disabled", () => {
    beforeEach(async () => {
      store = new ApiKeyStore(makeTmpFile());
      auditLogger = new AuditEventLogger(makeTmpFile());
      server = buildGuardedApp(store, auditLogger, false);
      await startServer(server);
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it("GET /audit/events returns 200 without key when auth disabled", async () => {
      const res = await httpRequest(server, "GET", "/audit/events");
      expect(res.status).toBe(200);
    });

    it("GET /analytics returns 200 without key when auth disabled", async () => {
      const res = await httpRequest(server, "GET", "/analytics/dashboard");
      expect(res.status).toBe(200);
    });
  });
});
