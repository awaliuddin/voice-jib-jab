/**
 * TenantQuota Tests
 *
 * Covers TenantQuotaService and the /tenants/:tenantId quota+usage API
 * produced by createQuotaRouter().
 *
 * Uses real filesystem via OS temp directories for service isolation.
 * Rate-limit window tests use jest.useFakeTimers() / jest.setSystemTime().
 * HTTP transport uses a plain Node http helper (no supertest dependency).
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { TenantQuotaService } from "../../services/TenantQuotaService.js";
import { createQuotaRouter } from "../../api/quota.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `quota-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
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
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }
        : {},
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
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

function buildApp(svc: TenantQuotaService): Express {
  const app = express();
  app.use(express.json());
  app.use("/tenants", createQuotaRouter(svc));
  return app;
}

// ── TenantQuotaService unit tests ────────────────────────────────────────

describe("TenantQuotaService", () => {
  let svc: TenantQuotaService;
  let file: string;

  beforeEach(() => {
    file = tempFile("svc");
    svc = new TenantQuotaService(file);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── setQuota ────────────────────────────────────────────────────────

  describe("setQuota()", () => {
    it("creates a new quota config with provided values", () => {
      const config = svc.setQuota("acme", {
        requestsPerMinute: 120,
        maxConcurrentSessions: 10,
        monthlyMinutesQuota: 500,
      });

      expect(config.tenantId).toBe("acme");
      expect(config.requestsPerMinute).toBe(120);
      expect(config.maxConcurrentSessions).toBe(10);
      expect(config.monthlyMinutesQuota).toBe(500);
    });

    it("sets defaults for unspecified fields on new config", () => {
      const config = svc.setQuota("acme", {});

      expect(config.requestsPerMinute).toBe(60);
      expect(config.maxConcurrentSessions).toBe(5);
      expect(config.monthlyMinutesQuota).toBe(0);
    });

    it("sets updatedAt on creation", () => {
      const config = svc.setQuota("acme", {});

      expect(config.updatedAt).toBeDefined();
      expect(new Date(config.updatedAt).toISOString()).toBe(config.updatedAt);
    });

    it("updates an existing config", () => {
      svc.setQuota("acme", { requestsPerMinute: 60 });
      const updated = svc.setQuota("acme", { requestsPerMinute: 200 });

      expect(updated.requestsPerMinute).toBe(200);
    });

    it("partial update preserves fields that were not specified", () => {
      svc.setQuota("acme", {
        requestsPerMinute: 100,
        monthlyMinutesQuota: 300,
      });
      const updated = svc.setQuota("acme", { requestsPerMinute: 200 });

      expect(updated.monthlyMinutesQuota).toBe(300);
    });

    it("updates updatedAt when modifying existing config", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));

      svc.setQuota("acme", { requestsPerMinute: 60 });
      const first = svc.getQuota("acme")!.updatedAt;

      jest.setSystemTime(new Date("2026-03-01T10:01:00.000Z"));
      svc.setQuota("acme", { requestsPerMinute: 120 });
      const second = svc.getQuota("acme")!.updatedAt;

      expect(second).not.toBe(first);
    });

    it("persists to file (survives reload)", () => {
      svc.setQuota("acme", { requestsPerMinute: 99 });

      const svc2 = new TenantQuotaService(file);
      expect(svc2.getQuota("acme")?.requestsPerMinute).toBe(99);
    });
  });

  // ── getQuota ────────────────────────────────────────────────────────

  describe("getQuota()", () => {
    it("returns null for unknown tenant", () => {
      expect(svc.getQuota("ghost")).toBeNull();
    });

    it("returns config after set", () => {
      svc.setQuota("acme", { requestsPerMinute: 42 });
      const config = svc.getQuota("acme");

      expect(config).not.toBeNull();
      expect(config!.requestsPerMinute).toBe(42);
    });
  });

  // ── listQuotas ──────────────────────────────────────────────────────

  describe("listQuotas()", () => {
    it("returns empty array when nothing configured", () => {
      expect(svc.listQuotas()).toHaveLength(0);
    });

    it("returns all configured tenants", () => {
      svc.setQuota("t1", {});
      svc.setQuota("t2", {});

      expect(svc.listQuotas()).toHaveLength(2);
    });
  });

  // ── deleteQuota ─────────────────────────────────────────────────────

  describe("deleteQuota()", () => {
    it("returns true and removes the config", () => {
      svc.setQuota("acme", {});

      expect(svc.deleteQuota("acme")).toBe(true);
      expect(svc.getQuota("acme")).toBeNull();
    });

    it("returns false for unknown tenant", () => {
      expect(svc.deleteQuota("ghost")).toBe(false);
    });
  });

  // ── checkRateLimit ──────────────────────────────────────────────────

  describe("checkRateLimit()", () => {
    it("returns allowed=true on first call", () => {
      const result = svc.checkRateLimit("acme");

      expect(result.allowed).toBe(true);
    });

    it("remaining decrements with each call", () => {
      svc.setQuota("acme", { requestsPerMinute: 10 });

      const first = svc.checkRateLimit("acme");
      const second = svc.checkRateLimit("acme");

      expect(second.remaining).toBe(first.remaining - 1);
    });

    it("returns allowed=false after max requests exceeded", () => {
      svc.setQuota("acme", { requestsPerMinute: 3 });

      svc.checkRateLimit("acme"); // 1
      svc.checkRateLimit("acme"); // 2
      svc.checkRateLimit("acme"); // 3
      const result = svc.checkRateLimit("acme"); // 4 → over limit

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBeDefined();
    });

    it("window resets after windowMs and allows requests again", () => {
      jest.useFakeTimers();
      const start = new Date("2026-03-01T12:00:00.000Z");
      jest.setSystemTime(start);

      svc.setQuota("acme", { requestsPerMinute: 2 });

      svc.checkRateLimit("acme"); // 1
      svc.checkRateLimit("acme"); // 2
      const blocked = svc.checkRateLimit("acme"); // 3 → blocked
      expect(blocked.allowed).toBe(false);

      // Advance past the window
      jest.setSystemTime(new Date(start.getTime() + 61_000));

      const fresh = svc.checkRateLimit("acme");
      expect(fresh.allowed).toBe(true);
    });

    it("different tenants have independent counters", () => {
      svc.setQuota("t1", { requestsPerMinute: 1 });
      svc.setQuota("t2", { requestsPerMinute: 100 });

      svc.checkRateLimit("t1"); // 1 — at limit
      const t1blocked = svc.checkRateLimit("t1"); // 2 — over
      const t2ok = svc.checkRateLimit("t2"); // 1 — fine

      expect(t1blocked.allowed).toBe(false);
      expect(t2ok.allowed).toBe(true);
    });

    it("uses default 60 rps when no quota configured", () => {
      // Call 60 times — all allowed
      for (let i = 0; i < 60; i++) {
        expect(svc.checkRateLimit("new-tenant").allowed).toBe(true);
      }

      // 61st call — blocked
      const result = svc.checkRateLimit("new-tenant");
      expect(result.allowed).toBe(false);
    });

    it("resetAt is a future ms timestamp", () => {
      const before = Date.now();
      const result = svc.checkRateLimit("acme");
      const after = Date.now();

      expect(result.resetAt).toBeGreaterThan(before);
      expect(result.resetAt).toBeGreaterThan(after);
    });
  });

  // ── recordSessionMinutes + getUsage ─────────────────────────────────

  describe("recordSessionMinutes() + getUsage()", () => {
    it("records minutes and retrieves them", () => {
      svc.recordSessionMinutes("acme", 30);
      const usage = svc.getUsage("acme");

      expect(usage).not.toBeNull();
      expect(usage!.minutesUsed).toBe(30);
    });

    it("accumulates multiple recordings", () => {
      svc.recordSessionMinutes("acme", 10);
      svc.recordSessionMinutes("acme", 20);
      svc.recordSessionMinutes("acme", 5);
      const usage = svc.getUsage("acme");

      expect(usage!.minutesUsed).toBe(35);
    });

    it("returns null for tenant with no usage", () => {
      expect(svc.getUsage("ghost")).toBeNull();
    });

    it("different monthKeys produce different records", () => {
      svc.recordSessionMinutes("acme", 50); // current month

      const currentMonth = svc.getCurrentMonthKey();
      const otherMonth = "2025-01";

      const current = svc.getUsage("acme", currentMonth);
      const other = svc.getUsage("acme", otherMonth);

      expect(current?.minutesUsed).toBe(50);
      expect(other).toBeNull();
    });

    it("monthKey parameter overrides current month lookup", () => {
      const currentUsage = svc.getUsage("acme", "2024-06");
      expect(currentUsage).toBeNull();
    });

    it("default monthKey is current month", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-03-15T10:00:00.000Z"));

      svc.recordSessionMinutes("acme", 10);
      const usage = svc.getUsage("acme");

      expect(usage!.monthKey).toBe("2026-03");
    });
  });

  // ── recordSessionStart ───────────────────────────────────────────────

  describe("recordSessionStart()", () => {
    it("increments sessionsStarted for current month", () => {
      svc.recordSessionStart("acme");
      svc.recordSessionStart("acme");
      const usage = svc.getUsage("acme");

      expect(usage!.sessionsStarted).toBe(2);
    });

    it("sessionsStarted starts at 0 for new tenant", () => {
      svc.recordSessionStart("brand-new");
      const usage = svc.getUsage("brand-new");

      expect(usage!.sessionsStarted).toBe(1);
    });
  });

  // ── checkQuota ───────────────────────────────────────────────────────

  describe("checkQuota()", () => {
    it("returns allowed=true when monthlyMinutesQuota=0 (unlimited)", () => {
      svc.setQuota("acme", { monthlyMinutesQuota: 0 });
      svc.recordSessionMinutes("acme", 99999);

      expect(svc.checkQuota("acme").allowed).toBe(true);
    });

    it("returns allowed=true when no quota configured (default unlimited)", () => {
      svc.recordSessionMinutes("acme", 9999);

      expect(svc.checkQuota("acme").allowed).toBe(true);
    });

    it("returns allowed=true when minutes < quota", () => {
      svc.setQuota("acme", { monthlyMinutesQuota: 100 });
      svc.recordSessionMinutes("acme", 50);

      expect(svc.checkQuota("acme").allowed).toBe(true);
    });

    it("returns allowed=false when minutes >= quota", () => {
      svc.setQuota("acme", { monthlyMinutesQuota: 100 });
      svc.recordSessionMinutes("acme", 100);

      const result = svc.checkQuota("acme");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it("returns allowed=false when minutes exceed quota", () => {
      svc.setQuota("acme", { monthlyMinutesQuota: 50 });
      svc.recordSessionMinutes("acme", 75);

      const result = svc.checkQuota("acme");
      expect(result.allowed).toBe(false);
    });

    it("returns allowed=true with zero usage against a set quota", () => {
      svc.setQuota("acme", { monthlyMinutesQuota: 100 });

      expect(svc.checkQuota("acme").allowed).toBe(true);
    });
  });

  // ── getCurrentMonthKey ───────────────────────────────────────────────

  describe("getCurrentMonthKey()", () => {
    it("returns YYYY-MM format string", () => {
      const key = svc.getCurrentMonthKey();

      expect(key).toMatch(/^\d{4}-\d{2}$/);
    });

    it("reflects the system clock month", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-03-21T12:00:00.000Z"));

      expect(svc.getCurrentMonthKey()).toBe("2026-03");
    });

    it("pads single-digit months with a leading zero", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));

      expect(svc.getCurrentMonthKey()).toBe("2026-01");
    });
  });
});

// ── Quota API route tests ────────────────────────────────────────────────

describe("Quota API", () => {
  let svc: TenantQuotaService;
  let file: string;
  let server: Server;

  beforeAll((done) => {
    file = tempFile("api");
    svc = new TenantQuotaService(file);
    server = createServer(buildApp(svc));
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(file)) rmSync(file, { force: true });
      done();
    });
  });

  beforeEach(() => {
    // Fresh service between API tests to avoid state bleed
    if (existsSync(file)) rmSync(file, { force: true });
    svc = new TenantQuotaService(file);
    // Re-mount the app with the fresh service
    const newApp = buildApp(svc);
    // Swap out the underlying listener
    server.removeAllListeners("request");
    server.on("request", newApp);
  });

  // ── GET /tenants/:tenantId/quota ────────────────────────────────────

  describe("GET /tenants/:tenantId/quota", () => {
    it("returns defaults with isDefault=true when not configured", async () => {
      const res = await httpRequest(server, "GET", "/tenants/acme/quota");

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.tenantId).toBe("acme");
      expect(data.requestsPerMinute).toBe(60);
      expect(data.maxConcurrentSessions).toBe(5);
      expect(data.monthlyMinutesQuota).toBe(0);
      expect(data.isDefault).toBe(true);
      expect(data.updatedAt).toBeNull();
    });

    it("returns configured quota after PUT", async () => {
      svc.setQuota("acme", { requestsPerMinute: 120 });

      const res = await httpRequest(server, "GET", "/tenants/acme/quota");

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.requestsPerMinute).toBe(120);
      expect(data.isDefault).toBeUndefined();
    });
  });

  // ── PUT /tenants/:tenantId/quota ────────────────────────────────────

  describe("PUT /tenants/:tenantId/quota", () => {
    it("creates quota and returns 200 with config", async () => {
      const res = await httpRequest(server, "PUT", "/tenants/beta/quota", {
        requestsPerMinute: 30,
        monthlyMinutesQuota: 200,
      });

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.tenantId).toBe("beta");
      expect(data.requestsPerMinute).toBe(30);
      expect(data.monthlyMinutesQuota).toBe(200);
    });

    it("updates existing quota", async () => {
      svc.setQuota("beta", { requestsPerMinute: 30 });

      const res = await httpRequest(server, "PUT", "/tenants/beta/quota", {
        requestsPerMinute: 90,
      });

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.requestsPerMinute).toBe(90);
    });

    it("returns 400 when requestsPerMinute is not a number", async () => {
      const res = await httpRequest(server, "PUT", "/tenants/acme/quota", {
        requestsPerMinute: "lots",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("requestsPerMinute");
    });
  });

  // ── DELETE /tenants/:tenantId/quota ─────────────────────────────────

  describe("DELETE /tenants/:tenantId/quota", () => {
    it("returns 204 on successful deletion", async () => {
      svc.setQuota("acme", {});

      const res = await httpRequest(server, "DELETE", "/tenants/acme/quota");

      expect(res.status).toBe(204);
      expect(svc.getQuota("acme")).toBeNull();
    });

    it("returns 404 when tenant has no configured quota", async () => {
      const res = await httpRequest(server, "DELETE", "/tenants/ghost/quota");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("ghost");
    });
  });

  // ── GET /tenants/:tenantId/usage ────────────────────────────────────

  describe("GET /tenants/:tenantId/usage", () => {
    it("returns zeroed record when no usage recorded", async () => {
      const res = await httpRequest(server, "GET", "/tenants/acme/usage");

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.tenantId).toBe("acme");
      expect(data.minutesUsed).toBe(0);
      expect(data.sessionsStarted).toBe(0);
      expect(data.updatedAt).toBeNull();
    });

    it("returns recorded usage for current month", async () => {
      svc.recordSessionMinutes("acme", 45);

      const res = await httpRequest(server, "GET", "/tenants/acme/usage");

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.minutesUsed).toBe(45);
    });

    it("accepts ?month=YYYY-MM query param", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/tenants/acme/usage?month=2025-06",
      );

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.monthKey).toBe("2025-06");
      expect(data.minutesUsed).toBe(0);
    });
  });

  // ── POST /tenants/:tenantId/usage/record ────────────────────────────

  describe("POST /tenants/:tenantId/usage/record", () => {
    it("records minutes and returns updated usage", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/acme/usage/record",
        { minutes: 25 },
      );

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.minutesUsed).toBe(25);
      expect(data.tenantId).toBe("acme");
    });

    it("accumulates minutes across multiple calls", async () => {
      await httpRequest(server, "POST", "/tenants/acme/usage/record", {
        minutes: 10,
      });
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/acme/usage/record",
        { minutes: 15 },
      );

      const data = res.json() as Record<string, unknown>;
      expect(data.minutesUsed).toBe(25);
    });

    it("returns 400 when minutes is missing", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/acme/usage/record",
        {},
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("minutes");
    });

    it("returns 400 when minutes is not a number", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/acme/usage/record",
        { minutes: "lots" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("minutes");
    });
  });
});
