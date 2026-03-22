/**
 * Health Monitor API Tests
 *
 * Tests the /health router produced by createHealthRouter().
 * HealthMonitorService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createHealthRouter } from "../../api/health.js";

// ── Mock HealthMonitorService ─────────────────────────────────────────

const MOCK_SUBSYSTEMS = [
  { name: "stt",      status: "healthy",   latencyMs: 42,  checkedAt: "2026-01-01T00:00:00.000Z", consecutiveFailures: 0 },
  { name: "tts",      status: "healthy",   latencyMs: 38,  checkedAt: "2026-01-01T00:00:00.000Z", consecutiveFailures: 0 },
  { name: "opa",      status: "unknown",   latencyMs: 0,   checkedAt: "2026-01-01T00:00:00.000Z", consecutiveFailures: 0 },
  { name: "chromadb", status: "unhealthy", latencyMs: 100, checkedAt: "2026-01-01T00:00:00.000Z", error: "Connection refused", consecutiveFailures: 2 },
  { name: "database", status: "healthy",   latencyMs: 5,   checkedAt: "2026-01-01T00:00:00.000Z", consecutiveFailures: 0 },
];

const mockMonitor = {
  getOverallStatus: jest.fn().mockReturnValue("healthy"),
  getStatus: jest.fn().mockReturnValue(MOCK_SUBSYSTEMS),
};

// ── HTTP helper ───────────────────────────────────────────────────────

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
): Promise<HttpResponse> {
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
  app.use("/health", createHealthRouter(mockMonitor as never));
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Health Monitor API", () => {
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
    mockMonitor.getOverallStatus.mockReturnValue("healthy");
    mockMonitor.getStatus.mockReturnValue(MOCK_SUBSYSTEMS);
  });

  // ── GET /health/live ──────────────────────────────────────────────

  describe("GET /health/live", () => {
    it("returns 200", async () => {
      const res = await httpRequest(server, "GET", "/health/live");
      expect(res.status).toBe(200);
    });

    it("response has live: true", async () => {
      const res = await httpRequest(server, "GET", "/health/live");
      const data = res.json() as { live: boolean };
      expect(data.live).toBe(true);
    });

    it("response includes uptime as a number", async () => {
      const res = await httpRequest(server, "GET", "/health/live");
      const data = res.json() as { uptime: unknown };
      expect(typeof data.uptime).toBe("number");
    });

    it("response includes pid as a number", async () => {
      const res = await httpRequest(server, "GET", "/health/live");
      const data = res.json() as { pid: unknown };
      expect(typeof data.pid).toBe("number");
    });

    it("response includes a valid timestamp", async () => {
      const res = await httpRequest(server, "GET", "/health/live");
      const data = res.json() as { timestamp: string };
      expect(typeof data.timestamp).toBe("string");
      expect(new Date(data.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  // ── GET /health/ready ─────────────────────────────────────────────

  describe("GET /health/ready", () => {
    it("returns 200 when overall is 'healthy'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("healthy");
      const res = await httpRequest(server, "GET", "/health/ready");
      expect(res.status).toBe(200);
    });

    it("response has ready: true when overall is 'healthy'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("healthy");
      const res = await httpRequest(server, "GET", "/health/ready");
      const data = res.json() as { ready: boolean };
      expect(data.ready).toBe(true);
    });

    it("returns 200 when overall is 'degraded'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("degraded");
      const res = await httpRequest(server, "GET", "/health/ready");
      expect(res.status).toBe(200);
    });

    it("response has ready: true when overall is 'degraded'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("degraded");
      const res = await httpRequest(server, "GET", "/health/ready");
      const data = res.json() as { ready: boolean };
      expect(data.ready).toBe(true);
    });

    it("returns 503 when overall is 'down'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("down");
      const res = await httpRequest(server, "GET", "/health/ready");
      expect(res.status).toBe(503);
    });

    it("response has ready: false when overall is 'down'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("down");
      const res = await httpRequest(server, "GET", "/health/ready");
      const data = res.json() as { ready: boolean };
      expect(data.ready).toBe(false);
    });

    it("response includes overall field in all cases", async () => {
      for (const status of ["healthy", "degraded", "down"] as const) {
        mockMonitor.getOverallStatus.mockReturnValue(status);
        const res = await httpRequest(server, "GET", "/health/ready");
        const data = res.json() as { overall: string };
        expect(data.overall).toBe(status);
      }
    });

    it("response includes a valid timestamp", async () => {
      const res = await httpRequest(server, "GET", "/health/ready");
      const data = res.json() as { timestamp: string };
      expect(typeof data.timestamp).toBe("string");
      expect(new Date(data.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  // ── GET /health/subsystems ────────────────────────────────────────

  describe("GET /health/subsystems", () => {
    it("returns 200", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      expect(res.status).toBe(200);
    });

    it("response includes overall: 'healthy'", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { overall: string };
      expect(data.overall).toBe("healthy");
    });

    it("response includes subsystems array", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { subsystems: unknown[] };
      expect(Array.isArray(data.subsystems)).toBe(true);
    });

    it("subsystems array has 5 items", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { subsystems: unknown[] };
      expect(data.subsystems).toHaveLength(5);
    });

    it("each subsystem has name, status, latencyMs, checkedAt, consecutiveFailures", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { subsystems: Record<string, unknown>[] };
      for (const ss of data.subsystems) {
        expect(typeof ss.name).toBe("string");
        expect(typeof ss.status).toBe("string");
        expect(typeof ss.latencyMs).toBe("number");
        expect(typeof ss.checkedAt).toBe("string");
        expect(typeof ss.consecutiveFailures).toBe("number");
      }
    });

    it("unhealthy subsystem includes error field", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { subsystems: Record<string, unknown>[] };
      const chromadb = data.subsystems.find((s) => s.name === "chromadb");
      expect(chromadb).toBeDefined();
      expect(chromadb?.status).toBe("unhealthy");
      expect(chromadb?.error).toBe("Connection refused");
    });

    it("response includes checkedAt timestamp", async () => {
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { checkedAt: string };
      expect(typeof data.checkedAt).toBe("string");
      expect(() => new Date(data.checkedAt)).not.toThrow();
      expect(new Date(data.checkedAt).getTime()).toBeGreaterThan(0);
    });

    it("when overall is 'degraded', response has overall: 'degraded'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("degraded");
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { overall: string };
      expect(data.overall).toBe("degraded");
    });

    it("when overall is 'down', response has overall: 'down'", async () => {
      mockMonitor.getOverallStatus.mockReturnValue("down");
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { overall: string };
      expect(data.overall).toBe("down");
    });

    it("empty subsystems array returns empty array", async () => {
      mockMonitor.getStatus.mockReturnValue([]);
      const res = await httpRequest(server, "GET", "/health/subsystems");
      const data = res.json() as { subsystems: unknown[] };
      expect(data.subsystems).toEqual([]);
    });

    it("getStatus is called once per request", async () => {
      await httpRequest(server, "GET", "/health/subsystems");
      expect(mockMonitor.getStatus).toHaveBeenCalledTimes(1);
    });

    it("getOverallStatus is called once per request", async () => {
      await httpRequest(server, "GET", "/health/subsystems");
      expect(mockMonitor.getOverallStatus).toHaveBeenCalledTimes(1);
    });
  });
});
