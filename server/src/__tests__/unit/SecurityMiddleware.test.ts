/**
 * Security Middleware Tests
 *
 * Tests rate limiting, security headers, and input validation added by D-139.
 * Follows the AdminApi.test.ts pattern: builds standalone Express apps with
 * injected dependencies to avoid importing index.ts (startup side effects).
 */

import express from "express";
import { createServer, type Server } from "http";
import { createRateLimiter } from "../../middleware/rateLimiter.js";
import { securityHeaders } from "../../middleware/securityHeaders.js";
import { createAdminRouter } from "../../api/admin.js";
import { createVoiceRouter } from "../../api/voice.js";
import { createAnalyticsRouter } from "../../api/analytics.js";
import { createSessionsRouter } from "../../api/sessions.js";
import { TenantRegistry } from "../../services/TenantRegistry.js";
import { SystemConfigStore } from "../../services/SystemConfigStore.js";
import { VoiceTriggerService } from "../../services/VoiceTriggerService.js";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, unlinkSync, writeFileSync } from "fs";

// ── HTTP helpers (same pattern as AdminApi.test.ts) ──────────────────

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
        ...(payload
          ? { "Content-Length": Buffer.byteLength(payload).toString() }
          : {}),
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

// ── Stub factories ───────────────────────────────────────────────────

function makeConfigStore(sipTrunk: string | null = null) {
  return { get: () => ({ sipTrunk }) };
}

function tempPath(name: string): string {
  return join(tmpdir(), `security-test-${name}-${Date.now()}.json`);
}

// ── Rate Limiter Tests ───────────────────────────────────────────────

describe("Rate Limiter", () => {
  let server: Server;

  afterEach((done) => {
    if (server?.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  it("allows requests within the limit", async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 5, message: "Too many" }));
    app.get("/test", (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const res = await httpRequest(server, "GET", "/test");
    expect(res.status).toBe(200);
  });

  it("returns 429 when limit is exceeded", async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2, message: "Rate limit hit" }));
    app.get("/test", (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    // Requests 1 and 2 should pass
    await httpRequest(server, "GET", "/test");
    await httpRequest(server, "GET", "/test");

    // Request 3 should be blocked
    const res = await httpRequest(server, "GET", "/test");
    expect(res.status).toBe(429);
    const data = res.json() as { error: string };
    expect(data.error).toBe("Rate limit hit");
  });

  it("resets counter after window expires", async () => {
    const app = express();
    // Very short window for testing
    app.use(createRateLimiter({ windowMs: 50, max: 1, message: "Too fast" }));
    app.get("/test", (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    // First request passes
    const res1 = await httpRequest(server, "GET", "/test");
    expect(res1.status).toBe(200);

    // Second is blocked
    const res2 = await httpRequest(server, "GET", "/test");
    expect(res2.status).toBe(429);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 100));

    // Third should pass (window reset)
    const res3 = await httpRequest(server, "GET", "/test");
    expect(res3.status).toBe(200);
  });
});

// ── Security Headers Tests (N-43: Helmet) ────────────────────────────

describe("Security Headers", () => {
  let server: Server;
  let res: HttpResponse;

  beforeAll(async () => {
    const app = express();
    app.use(securityHeaders);
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    res = await httpRequest(server, "GET", "/health");
  });

  afterAll((done) => {
    server.close(done);
  });

  // ── Headers carried over from manual implementation ──────────────
  it("sets X-Content-Type-Options to nosniff", () => {
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options to DENY (strict — API server, no embeddable UI)", () => {
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Referrer-Policy to strict-origin-when-cross-origin", () => {
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  // ── New headers added by Helmet (N-43) ───────────────────────────
  it("sets Strict-Transport-Security (HSTS) with 180-day maxAge", () => {
    const hsts = res.headers["strict-transport-security"] as string;
    expect(hsts).toBeDefined();
    expect(hsts).toContain("max-age=15552000");
    expect(hsts).toContain("includeSubDomains");
  });

  it("sets Content-Security-Policy header", () => {
    expect(res.headers["content-security-policy"] as string).toMatch(/default-src/);
  });

  it("sets X-DNS-Prefetch-Control to off", () => {
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("sets X-Download-Options to noopen", () => {
    expect(res.headers["x-download-options"]).toBe("noopen");
  });

  it("sets X-Permitted-Cross-Domain-Policies to none", () => {
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
  });

  it("sets Cross-Origin-Opener-Policy header", () => {
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  it("sets Cross-Origin-Resource-Policy header", () => {
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  // X-XSS-Protection: 0 — Helmet explicitly disables the deprecated header.
  // Setting it to "0" is safer than "1; mode=block" on browsers that mishandle the filter.
  it("sets X-XSS-Protection to 0 (explicitly disabled — modern recommendation)", () => {
    expect(res.headers["x-xss-protection"]).toBe("0");
  });
});

// ── Admin Input Validation Tests ─────────────────────────────────────

describe("Admin Input Validation", () => {
  let server: Server;
  let registry: TenantRegistry;
  let filePath: string;

  beforeAll((done) => {
    filePath = tempPath("admin-validation");
    registry = new TenantRegistry(filePath);
    const configStore = new SystemConfigStore();
    const app = express();
    app.use(express.json());
    app.use("/admin", createAdminRouter(registry, configStore));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(filePath)) unlinkSync(filePath);
      done();
    });
  });

  beforeEach(() => {
    writeFileSync(filePath, "[]", "utf-8");
    registry.load();
  });

  it("rejects claimsThreshold > 1.0 on POST", async () => {
    const res = await httpRequest(server, "POST", "/admin/tenants", {
      tenantId: "org_ct",
      name: "CT Test",
      policyLevel: "standard",
      claimsThreshold: 1.5,
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("claimsThreshold");
  });

  it("rejects claimsThreshold < 0 on POST", async () => {
    const res = await httpRequest(server, "POST", "/admin/tenants", {
      tenantId: "org_ct2",
      name: "CT Test 2",
      policyLevel: "standard",
      claimsThreshold: -0.1,
    });
    expect(res.status).toBe(400);
  });

  it("accepts claimsThreshold=0.5 on POST", async () => {
    const res = await httpRequest(server, "POST", "/admin/tenants", {
      tenantId: "org_ct3",
      name: "CT Valid",
      policyLevel: "standard",
      claimsThreshold: 0.5,
    });
    expect(res.status).toBe(201);
  });

  it("rejects claimsThreshold=1.5 on PUT", async () => {
    await httpRequest(server, "POST", "/admin/tenants", {
      tenantId: "org_put_ct",
      name: "Put CT",
      policyLevel: "standard",
    });
    const res = await httpRequest(server, "PUT", "/admin/tenants/org_put_ct", {
      claimsThreshold: 1.5,
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("claimsThreshold");
  });

  it("rejects malformed claims array on POST", async () => {
    const res = await httpRequest(server, "POST", "/admin/tenants", {
      tenantId: "org_claims",
      name: "Claims Test",
      policyLevel: "standard",
      claims: [{ missing: "fields" }],
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("claim");
  });
});

// ── Voice Input Validation Tests ─────────────────────────────────────

describe("Voice Input Validation", () => {
  let server: Server;

  beforeAll((done) => {
    const triggerService = new VoiceTriggerService(
      "http://localhost:3000",
      makeConfigStore(null),
    );
    const app = express();
    app.use(express.json());
    app.use("/voice", createVoiceRouter(triggerService, "http://localhost:3000"));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it("rejects tenantId with path traversal", async () => {
    const res = await httpRequest(server, "POST", "/voice/trigger", {
      tenantId: "../etc/passwd",
      callbackUrl: "https://example.com/cb",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("invalid");
  });

  it("rejects phoneNumber with script tag", async () => {
    const res = await httpRequest(server, "POST", "/voice/trigger", {
      tenantId: "org_safe",
      callbackUrl: "https://example.com/cb",
      phoneNumber: "<script>alert(1)</script>",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("phoneNumber");
  });

  it("accepts valid phoneNumber", async () => {
    const res = await httpRequest(server, "POST", "/voice/trigger", {
      tenantId: "org_phone",
      callbackUrl: "https://example.com/cb",
      phoneNumber: "+1 (555) 123-4567",
    });
    expect(res.status).toBe(202);
  });
});

// ── Analytics Validation Tests ───────────────────────────────────────

describe("Analytics Input Validation", () => {
  let server: Server;

  beforeAll((done) => {
    // Minimal AnalyticsService stub
    const analyticsService = {
      getAggregateMetrics: () => ({ sessions: [], total: 0 }),
    };
    const app = express();
    app.use(express.json());
    app.use("/analytics", createAnalyticsRouter(analyticsService as any));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it("rejects limit=0", async () => {
    const res = await httpRequest(server, "GET", "/analytics/sessions?limit=0");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("limit");
  });

  it("clamps limit=501 to 500 (does not reject)", async () => {
    const res = await httpRequest(server, "GET", "/analytics/sessions?limit=501");
    expect(res.status).toBe(200);
    const data = res.json() as { filter: { limit: number } };
    expect(data.filter.limit).toBe(500);
  });

  it("rejects from=not-a-date", async () => {
    const res = await httpRequest(server, "GET", "/analytics/sessions?from=not-a-date");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("from");
  });

  it("accepts valid date range", async () => {
    const res = await httpRequest(
      server,
      "GET",
      "/analytics/sessions?from=2026-01-01T00:00:00Z&to=2026-03-18T00:00:00Z",
    );
    expect(res.status).toBe(200);
  });

  it("rejects negative offset", async () => {
    const res = await httpRequest(server, "GET", "/analytics/sessions?offset=-5");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("offset");
  });
});

// ── Sessions Validation Tests ────────────────────────────────────────

describe("Sessions Input Validation", () => {
  let server: Server;

  beforeAll((done) => {
    // Minimal recorder stub
    const recorder = {
      listRecordings: () => [],
      loadRecording: () => null,
    };
    const app = express();
    app.use(express.json());
    app.use("/sessions", createSessionsRouter(recorder as any));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it("rejects session ID with slash", async () => {
    const res = await httpRequest(server, "GET", "/sessions/../../etc");
    // Express may normalize the path, so also accept 404 if the path gets mangled
    // But our validation should catch IDs with non-alphanumeric chars
    expect([400, 404]).toContain(res.status);
  });

  it("rejects session ID with special chars", async () => {
    const res = await httpRequest(server, "GET", "/sessions/abc%24def");
    expect(res.status).toBe(400);
  });

  it("accepts valid UUID-like session ID", async () => {
    const res = await httpRequest(server, "GET", "/sessions/abc-123_def");
    // Should pass validation (404 because session doesn't exist, but not 400)
    expect(res.status).toBe(404);
  });
});
