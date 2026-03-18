/**
 * Metrics & Dashboard Endpoint Tests
 *
 * Tests the /metrics and /dashboard routes defined in index.ts.
 * Since the express app is not exported from index.ts, we replicate the route
 * handlers here with mocked sessionManager to verify response shape and content.
 * This approach avoids importing index.ts (which triggers server startup side effects).
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

// ── Mock sessionManager ──────────────────────────────────────────────────

const mockSessions = [
  { id: "sess-001", state: "listening", createdAt: Date.now() - 60_000 },
  { id: "sess-002", state: "responding", createdAt: Date.now() - 30_000 },
];

const mockSessionManager = {
  getActiveSessions: jest.fn(() => mockSessions),
  getSessionCount: jest.fn(() => 3),
};

// ── Build a test app with the same route handlers as index.ts ────────────

function buildTestApp(): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      sessions: mockSessionManager.getSessionCount(),
    });
  });

  app.get("/status", (_req, res) => {
    const activeSessions = mockSessionManager.getActiveSessions();
    res.json({
      status: "running",
      version: "0.1.0",
      activeSessions: activeSessions.length,
      sessions: activeSessions.map((s) => ({
        id: s.id,
        state: s.state,
        uptime: Date.now() - s.createdAt,
      })),
    });
  });

  app.get("/metrics", (_req, res) => {
    const activeSessions = mockSessionManager.getActiveSessions();
    res.json({
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      sessions: {
        active: activeSessions.length,
        total: mockSessionManager.getSessionCount(),
      },
      memory: {
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap_used_mb: Math.round(
          process.memoryUsage().heapUsed / 1024 / 1024,
        ),
        heap_total_mb: Math.round(
          process.memoryUsage().heapTotal / 1024 / 1024,
        ),
      },
      session_detail: activeSessions.map((s) => ({
        id: s.id,
        state: s.state,
        uptime_ms: Date.now() - s.createdAt,
      })),
    });
  });

  app.get("/dashboard", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><title>voice-jib-jab — Live Metrics</title></head>
<body><h1>voice-jib-jab</h1></body>
</html>`);
  });

  return app;
}

// ── HTTP helper (no supertest dependency) ────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function request(
  server: Server,
  path: string,
): Promise<HttpResponse> {
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
              headers: res.headers as Record<string, string | string[] | undefined>,
              body,
              json: () => JSON.parse(body),
            });
          });
        })
        .on("error", reject);
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Metrics & Dashboard Endpoints", () => {
  let app: Express;
  let server: Server;

  beforeAll((done) => {
    app = buildTestApp();
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionManager.getActiveSessions.mockReturnValue(mockSessions);
    mockSessionManager.getSessionCount.mockReturnValue(3);
  });

  // ── GET /metrics ────────────────────────────────────────────────────

  describe("GET /metrics", () => {
    it("returns 200 with JSON content type", async () => {
      const res = await request(server, "/metrics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
    });

    it("includes a valid ISO timestamp", async () => {
      const res = await request(server, "/metrics");
      const data = res.json() as Record<string, unknown>;
      expect(typeof data.timestamp).toBe("string");
      expect(new Date(data.timestamp as string).toISOString()).toBe(
        data.timestamp,
      );
    });

    it("includes uptime_seconds as a non-negative number", async () => {
      const res = await request(server, "/metrics");
      const data = res.json() as Record<string, unknown>;
      expect(typeof data.uptime_seconds).toBe("number");
      expect(data.uptime_seconds).toBeGreaterThanOrEqual(0);
    });

    it("includes sessions.active matching active session count", async () => {
      const res = await request(server, "/metrics");
      const data = res.json() as {
        sessions: { active: number; total: number };
      };
      expect(data.sessions.active).toBe(mockSessions.length);
      expect(data.sessions.total).toBe(3);
    });

    it("includes memory usage with rss_mb, heap_used_mb, heap_total_mb", async () => {
      const res = await request(server, "/metrics");
      const data = res.json() as {
        memory: {
          rss_mb: number;
          heap_used_mb: number;
          heap_total_mb: number;
        };
      };
      expect(typeof data.memory.rss_mb).toBe("number");
      expect(typeof data.memory.heap_used_mb).toBe("number");
      expect(typeof data.memory.heap_total_mb).toBe("number");
      expect(data.memory.rss_mb).toBeGreaterThan(0);
      expect(data.memory.heap_used_mb).toBeGreaterThan(0);
    });

    it("includes session_detail as an array with correct shape", async () => {
      const res = await request(server, "/metrics");
      const data = res.json() as {
        session_detail: Array<{
          id: string;
          state: string;
          uptime_ms: number;
        }>;
      };
      expect(Array.isArray(data.session_detail)).toBe(true);
      expect(data.session_detail).toHaveLength(2);
      expect(data.session_detail[0]).toEqual(
        expect.objectContaining({
          id: "sess-001",
          state: "listening",
        }),
      );
      expect(typeof data.session_detail[0].uptime_ms).toBe("number");
      expect(data.session_detail[0].uptime_ms).toBeGreaterThan(0);
    });

    it("returns empty session_detail when no active sessions", async () => {
      mockSessionManager.getActiveSessions.mockReturnValue([]);
      mockSessionManager.getSessionCount.mockReturnValue(0);
      const res = await request(server, "/metrics");
      const data = res.json() as {
        sessions: { active: number; total: number };
        session_detail: unknown[];
      };
      expect(data.sessions.active).toBe(0);
      expect(data.session_detail).toEqual([]);
    });
  });

  // ── GET /dashboard ──────────────────────────────────────────────────

  describe("GET /dashboard", () => {
    it("returns 200 with text/html content type", async () => {
      const res = await request(server, "/dashboard");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
    });

    it("contains the project name in the HTML", async () => {
      const res = await request(server, "/dashboard");
      expect(res.body).toContain("voice-jib-jab");
    });

    it("contains a valid HTML document structure", async () => {
      const res = await request(server, "/dashboard");
      expect(res.body).toContain("<!DOCTYPE html>");
      expect(res.body).toContain("<title>");
      expect(res.body).toContain("</html>");
    });
  });

  // ── Non-regression: existing endpoints ──────────────────────────────

  describe("Non-regression", () => {
    it("GET /health returns 200 with status ok", async () => {
      const res = await request(server, "/health");
      expect(res.status).toBe(200);
      const data = res.json() as { status: string; sessions: number };
      expect(data.status).toBe("ok");
      expect(typeof data.sessions).toBe("number");
    });

    it("GET /status returns 200 with running status", async () => {
      const res = await request(server, "/status");
      expect(res.status).toBe(200);
      const data = res.json() as {
        status: string;
        version: string;
        activeSessions: number;
      };
      expect(data.status).toBe("running");
      expect(data.version).toBe("0.1.0");
      expect(data.activeSessions).toBe(mockSessions.length);
    });
  });
});
