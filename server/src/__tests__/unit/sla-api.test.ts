/**
 * SLA Monitor API Tests
 *
 * Tests the /sla router produced by createSlaRouter().
 * SlaMonitor is fully mocked.
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createSlaRouter } from "../../api/sla.js";
import type { SlaStatus } from "../../services/SlaMonitor.js";
import { DEFAULT_SLA_TARGETS } from "../../services/SlaMonitor.js";

// ── Mock SlaMonitor ───────────────────────────────────────────────────

function makeMetricStats(metric: string) {
  const target = DEFAULT_SLA_TARGETS[metric] ?? {
    name: metric,
    targetMs: 500,
    criticalMs: 1200,
    description: "",
  };
  return {
    metric,
    target,
    sampleCount: 10,
    p50Ms: 100,
    p95Ms: 400,
    p99Ms: 490,
    breachCount: 0,
    criticalBreachCount: 0,
    breachRatePct: 0,
    uptimePct: 100,
    windowStartedAt: "2026-01-01T00:00:00.000Z",
  };
}

const MOCK_STATUS_OK: SlaStatus = {
  overall: "ok",
  metrics: Object.keys(DEFAULT_SLA_TARGETS).map(makeMetricStats),
  windowMinutes: 60,
  evaluatedAt: "2026-01-01T01:00:00.000Z",
};

const mockMonitor = {
  getStatus: jest.fn<SlaStatus, []>().mockReturnValue(MOCK_STATUS_OK),
};

// ── HTTP helper ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpRequest(server: Server, method: string, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {},
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
      req.end();
    });
  });
}

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/sla", createSlaRouter(mockMonitor as never));
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("SLA Monitor API", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockMonitor.getStatus.mockReturnValue(MOCK_STATUS_OK);
  });

  // ── GET /sla/status ──────────────────────────────────────────────

  describe("GET /sla/status", () => {
    it("returns 200", async () => {
      const res = await httpRequest(server, "GET", "/sla/status");
      expect(res.status).toBe(200);
    });

    it("response has overall, metrics, windowMinutes, evaluatedAt", async () => {
      const res = await httpRequest(server, "GET", "/sla/status");
      const data = res.json() as Record<string, unknown>;
      expect(data).toHaveProperty("overall");
      expect(data).toHaveProperty("metrics");
      expect(data).toHaveProperty("windowMinutes");
      expect(data).toHaveProperty("evaluatedAt");
    });

    it("metrics array has 4 items (one per default target)", async () => {
      const res = await httpRequest(server, "GET", "/sla/status");
      const data = res.json() as SlaStatus;
      expect(data.metrics).toHaveLength(4);
    });

    it("each metric has name, p50Ms, p95Ms, breachRatePct, uptimePct, sampleCount", async () => {
      const res = await httpRequest(server, "GET", "/sla/status");
      const data = res.json() as SlaStatus;
      for (const m of data.metrics) {
        expect(typeof m.target.name).toBe("string");
        expect(typeof m.p50Ms).toBe("number");
        expect(typeof m.p95Ms).toBe("number");
        expect(typeof m.breachRatePct).toBe("number");
        expect(typeof m.uptimePct).toBe("number");
        expect(typeof m.sampleCount).toBe("number");
      }
    });

    it("overall 'ok' is reflected in response", async () => {
      mockMonitor.getStatus.mockReturnValue({ ...MOCK_STATUS_OK, overall: "ok" });
      const res = await httpRequest(server, "GET", "/sla/status");
      const data = res.json() as SlaStatus;
      expect(data.overall).toBe("ok");
    });

    it("overall 'warning' is reflected in response", async () => {
      mockMonitor.getStatus.mockReturnValue({ ...MOCK_STATUS_OK, overall: "warning" });
      const res = await httpRequest(server, "GET", "/sla/status");
      const data = res.json() as SlaStatus;
      expect(data.overall).toBe("warning");
    });

    it("overall 'critical' is reflected in response", async () => {
      mockMonitor.getStatus.mockReturnValue({ ...MOCK_STATUS_OK, overall: "critical" });
      const res = await httpRequest(server, "GET", "/sla/status");
      const data = res.json() as SlaStatus;
      expect(data.overall).toBe("critical");
    });
  });

  // ── GET /sla/dashboard ───────────────────────────────────────────

  describe("GET /sla/dashboard", () => {
    it("returns 200 with HTML", async () => {
      const res = await httpRequest(server, "GET", "/sla/dashboard");
      expect(res.status).toBe(200);
      const ct = res.headers["content-type"] as string;
      expect(ct).toMatch(/text\/html/);
    });

    it("response body contains DOCTYPE", async () => {
      const res = await httpRequest(server, "GET", "/sla/dashboard");
      expect(res.body.toLowerCase()).toContain("<!doctype html>");
    });

    it("response body is non-empty HTML", async () => {
      const res = await httpRequest(server, "GET", "/sla/dashboard");
      expect(res.body.length).toBeGreaterThan(200);
      expect(res.body).toContain("</html>");
    });
  });
});
