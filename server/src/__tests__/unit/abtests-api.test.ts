/**
 * Agent A/B Test API Tests
 *
 * Tests the /abtests router produced by createAbTestsRouter().
 * AgentAbTestService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createAbTestsRouter } from "../../api/abtests.js";

// ── Mock AgentAbTestService ───────────────────────────────────────────

const mockSvc = {
  createTest: jest.fn(),
  getTest: jest.fn(),
  listTests: jest.fn(),
  assignSession: jest.fn(),
  assignSessionByTenant: jest.fn(),
  getSessionAssignment: jest.fn(),
  recordMetrics: jest.fn(),
  getReport: jest.fn(),
  concludeTest: jest.fn(),
  pauseTest: jest.fn(),
  resumeTest: jest.fn(),
  deleteTest: jest.fn(),
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
  body?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const payload =
      body !== undefined ? JSON.stringify(body) : undefined;

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
            headers: res.headers as Record<
              string,
              string | string[] | undefined
            >,
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

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/abtests", createAbTestsRouter(mockSvc as never));
  return app;
}

// ── Fixture data ──────────────────────────────────────────────────────

const VARIANT_A_CONFIG = {
  name: "Control",
  voiceId: "voice_standard",
};

const VARIANT_B_CONFIG = {
  name: "Treatment",
  voiceId: "voice_empathetic",
};

const TEST_A: Record<string, unknown> = {
  testId: "test-001",
  name: "Empathy experiment",
  tenantId: "org_acme",
  hypothesis: "Empathetic voice lowers escalation",
  variantA: VARIANT_A_CONFIG,
  variantB: VARIANT_B_CONFIG,
  splitRatio: 0.5,
  minSamplesPerVariant: 20,
  status: "active",
  createdAt: "2026-03-01T10:00:00.000Z",
};

const TEST_B: Record<string, unknown> = {
  testId: "test-002",
  name: "Speed test",
  tenantId: "org_beta",
  variantA: { name: "Fast" },
  variantB: { name: "Slow" },
  splitRatio: 0.5,
  minSamplesPerVariant: 10,
  status: "paused",
  createdAt: "2026-03-05T08:00:00.000Z",
};

const VARIANT_STATS_A = {
  variant: "A",
  name: "Control",
  totalSessions: 12,
  scoredSessions: 10,
  avgQuality: 82.5,
  avgDuration: 45000,
  avgTurnCount: 4.2,
  escalationRate: 0.08,
};

const VARIANT_STATS_B = {
  variant: "B",
  name: "Treatment",
  totalSessions: 11,
  scoredSessions: 9,
  avgQuality: 87.1,
  avgDuration: 42000,
  avgTurnCount: 3.8,
  escalationRate: 0.04,
};

const REPORT_A = {
  test: TEST_A,
  variantA: VARIANT_STATS_A,
  variantB: VARIANT_STATS_B,
  winnerSuggestion: "B",
  winnerSuggestionReason: "Higher quality, lower escalation rate",
  totalSessions: 23,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("A/B Tests API", () => {
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
  });

  // ── GET /abtests ──────────────────────────────────────────────────

  describe("GET /abtests", () => {
    it("returns 200 with tests array and total count", async () => {
      mockSvc.listTests.mockReturnValue([TEST_A, TEST_B]);

      const res = await httpRequest(server, "GET", "/abtests");

      expect(res.status).toBe(200);
      const data = res.json() as { tests: unknown[]; total: number };
      expect(Array.isArray(data.tests)).toBe(true);
      expect(data.tests).toHaveLength(2);
      expect(data.total).toBe(2);
    });

    it("passes tenantId query param to listTests", async () => {
      mockSvc.listTests.mockReturnValue([TEST_A]);

      await httpRequest(server, "GET", "/abtests?tenantId=org_acme");

      expect(mockSvc.listTests).toHaveBeenCalledWith("org_acme");
    });

    it("filters results by status when status query param is provided", async () => {
      mockSvc.listTests.mockReturnValue([TEST_A, TEST_B]);

      const res = await httpRequest(server, "GET", "/abtests?status=active");

      expect(res.status).toBe(200);
      const data = res.json() as { tests: typeof TEST_A[]; total: number };
      expect(data.tests).toHaveLength(1);
      expect((data.tests[0] as typeof TEST_A).testId).toBe("test-001");
      expect(data.total).toBe(1);
    });
  });

  // ── POST /abtests ─────────────────────────────────────────────────

  describe("POST /abtests", () => {
    it("returns 201 and the created test on valid body", async () => {
      mockSvc.createTest.mockReturnValue(TEST_A);

      const res = await httpRequest(server, "POST", "/abtests", {
        name: "Empathy experiment",
        tenantId: "org_acme",
        variantA: { name: "Control" },
        variantB: { name: "Treatment" },
        splitRatio: 0.5,
      });

      expect(res.status).toBe(201);
      const data = res.json() as typeof TEST_A;
      expect(data.testId).toBe("test-001");
      expect(mockSvc.createTest).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when name is missing", async () => {
      const res = await httpRequest(server, "POST", "/abtests", {
        variantA: { name: "A" },
        variantB: { name: "B" },
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("name");
      expect(mockSvc.createTest).not.toHaveBeenCalled();
    });

    it("returns 400 when variantA.name is missing", async () => {
      const res = await httpRequest(server, "POST", "/abtests", {
        name: "My test",
        variantA: { voiceId: "v1" },
        variantB: { name: "Treatment" },
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("variantA.name");
      expect(mockSvc.createTest).not.toHaveBeenCalled();
    });

    it("returns 400 when splitRatio is out of range", async () => {
      const res = await httpRequest(server, "POST", "/abtests", {
        name: "My test",
        variantA: { name: "A" },
        variantB: { name: "B" },
        splitRatio: 1.5,
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("splitRatio");
      expect(mockSvc.createTest).not.toHaveBeenCalled();
    });
  });

  // ── GET /abtests/:testId ──────────────────────────────────────────

  describe("GET /abtests/:testId", () => {
    it("returns the full report when test exists", async () => {
      mockSvc.getReport.mockReturnValue(REPORT_A);

      const res = await httpRequest(server, "GET", "/abtests/test-001");

      expect(res.status).toBe(200);
      const data = res.json() as typeof REPORT_A;
      expect(data.test.testId).toBe("test-001");
      expect(data.variantA.totalSessions).toBe(12);
      expect(data.winnerSuggestion).toBe("B");
    });

    it("returns 404 when test does not exist", async () => {
      mockSvc.getReport.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/abtests/no-such-test");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("no-such-test");
    });
  });

  // ── POST /abtests/:testId/assign ──────────────────────────────────

  describe("POST /abtests/:testId/assign", () => {
    it("returns variant assignment with testId and sessionId", async () => {
      mockSvc.assignSession.mockReturnValue({
        variant: "B",
        config: VARIANT_B_CONFIG,
      });

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/assign",
        { sessionId: "sess-xyz" },
      );

      expect(res.status).toBe(200);
      const data = res.json() as {
        variant: string;
        config: typeof VARIANT_B_CONFIG;
        testId: string;
        sessionId: string;
      };
      expect(data.variant).toBe("B");
      expect(data.testId).toBe("test-001");
      expect(data.sessionId).toBe("sess-xyz");
      expect(mockSvc.assignSession).toHaveBeenCalledWith("test-001", "sess-xyz");
    });

    it("returns 404 when assignSession returns null (test not found)", async () => {
      mockSvc.assignSession.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/ghost-test/assign",
        { sessionId: "sess-abc" },
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("ghost-test");
    });

    it("returns 400 when sessionId is missing", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/assign",
        {},
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("sessionId");
      expect(mockSvc.assignSession).not.toHaveBeenCalled();
    });
  });

  // ── POST /abtests/:testId/metrics ─────────────────────────────────

  describe("POST /abtests/:testId/metrics", () => {
    it("returns 204 when metrics are recorded successfully", async () => {
      mockSvc.recordMetrics.mockReturnValue(true);

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/metrics",
        {
          sessionId: "sess-xyz",
          qualityScore: 88,
          durationMs: 52000,
          turnCount: 5,
          escalated: false,
          ttfbMs: 310,
        },
      );

      expect(res.status).toBe(204);
      expect(mockSvc.recordMetrics).toHaveBeenCalledWith(
        "test-001",
        "sess-xyz",
        expect.objectContaining({ qualityScore: 88, escalated: false }),
      );
    });

    it("returns 404 when recordMetrics returns false (session not assigned)", async () => {
      mockSvc.recordMetrics.mockReturnValue(false);

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/metrics",
        { sessionId: "sess-unassigned" },
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("sess-unassigned");
    });

    it("returns 400 when sessionId is missing from metrics body", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/metrics",
        { qualityScore: 75 },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("sessionId");
      expect(mockSvc.recordMetrics).not.toHaveBeenCalled();
    });
  });

  // ── POST /abtests/:testId/conclude ────────────────────────────────

  describe("POST /abtests/:testId/conclude", () => {
    it("returns concluded test with auto winner on empty body", async () => {
      const concluded = { ...TEST_A, status: "concluded", winner: "B", concludedAt: "2026-03-19T12:00:00.000Z" };
      mockSvc.concludeTest.mockReturnValue(concluded);

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/conclude",
        {},
      );

      expect(res.status).toBe(200);
      const data = res.json() as typeof concluded;
      expect(data.status).toBe("concluded");
      expect(data.winner).toBe("B");
    });

    it("returns 404 when test does not exist", async () => {
      mockSvc.concludeTest.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/ghost-test/conclude",
        {},
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("ghost-test");
    });

    it("passes a manual winner override to the service", async () => {
      const concluded = { ...TEST_A, status: "concluded", winner: "A", concludedAt: "2026-03-19T12:00:00.000Z" };
      mockSvc.concludeTest.mockReturnValue(concluded);

      const res = await httpRequest(
        server,
        "POST",
        "/abtests/test-001/conclude",
        { winner: "A" },
      );

      expect(res.status).toBe(200);
      expect(mockSvc.concludeTest).toHaveBeenCalledWith("test-001", "A");
    });
  });

  // ── DELETE /abtests/:testId ───────────────────────────────────────

  describe("DELETE /abtests/:testId", () => {
    it("returns 204 on successful deletion", async () => {
      mockSvc.deleteTest.mockReturnValue(true);

      const res = await httpRequest(server, "DELETE", "/abtests/test-001");

      expect(res.status).toBe(204);
      expect(mockSvc.deleteTest).toHaveBeenCalledWith("test-001");
    });

    it("returns 404 when test does not exist", async () => {
      mockSvc.deleteTest.mockReturnValue(false);

      const res = await httpRequest(server, "DELETE", "/abtests/no-such-test");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("no-such-test");
    });
  });
});
