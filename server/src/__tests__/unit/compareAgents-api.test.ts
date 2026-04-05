/**
 * compareAgents API Router Unit Tests
 *
 * Uses a plain Node HTTP helper (no supertest dependency) to exercise the
 * Express router. AgentComparisonService is fully mocked.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createCompareAgentsRouter } from "../../api/compareAgents.js";
import type { AgentComparisonService, ComparisonReport } from "../../services/AgentComparisonService.js";

// ── HTTP helper ───────────────────────────────────────────────────────────

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

// ── Mock report fixture ───────────────────────────────────────────────────

function makeReport(overrides: Partial<ComparisonReport> = {}): ComparisonReport {
  return {
    reportId: "test-report-id",
    generatedAt: new Date().toISOString(),
    configA: {
      configId: "config-a",
      label: "Config A",
      sessionCount: 3,
      avgQualityScore: 85,
      p50LatencyMs: 1000,
      p95LatencyMs: 1500,
      escalationRatePct: 0,
      topSentiment: "positive",
      sentimentBreakdown: { positive: 3 },
      avgTurnCount: 5,
    },
    configB: {
      configId: "config-b",
      label: "Config B",
      sessionCount: 3,
      avgQualityScore: 70,
      p50LatencyMs: 2000,
      p95LatencyMs: 2500,
      escalationRatePct: 33.3,
      topSentiment: "neutral",
      sentimentBreakdown: { neutral: 3 },
      avgTurnCount: 4,
    },
    recommendation: "A",
    reasoning: "Config A wins 3/4 metrics.",
    metricWinners: {
      quality: "A",
      latency: "A",
      escalation: "A",
      sentiment: "A",
    },
    ...overrides,
  };
}

// ── App builder ───────────────────────────────────────────────────────────

const mockService = {
  compareConfigs: jest.fn(),
  listReports: jest.fn(),
  getRecentReport: jest.fn(),
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/compare-agents", createCompareAgentsRouter(mockService as unknown as AgentComparisonService));
  return app;
}

// ── Server lifecycle ──────────────────────────────────────────────────────

let server: Server;

beforeAll((done) => {
  server = createServer(buildApp());
  server.listen(0, "127.0.0.1", done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.resetAllMocks();
  mockService.listReports.mockReturnValue([]);
  mockService.compareConfigs.mockResolvedValue(makeReport());
});

const validBody = {
  configA: { configId: "a", label: "Alpha", sessionIds: ["s1", "s2"] },
  configB: { configId: "b", label: "Beta", sessionIds: ["s3", "s4"] },
};

// ── POST /compare-agents ──────────────────────────────────────────────────

describe("POST /compare-agents", () => {
  it("returns 200 with ComparisonReport on valid body", async () => {
    const res = await httpRequest(server, "POST", "/compare-agents", validBody);

    expect(res.status).toBe(200);
    expect((res.json() as Record<string, unknown>).reportId).toBe("test-report-id");
  });

  it("response has configA, configB, recommendation, metricWinners, reasoning", async () => {
    const res = await httpRequest(server, "POST", "/compare-agents", validBody);
    const body = res.json() as Record<string, unknown>;

    expect((body.configA as { configId: string }).configId).toBe("config-a");
    expect((body.configB as { configId: string }).configId).toBe("config-b");
    expect(body.recommendation).toBe("A");
    expect((body.metricWinners as Record<string, string>).quality).toBe("A");
    expect(typeof body.reasoning).toBe("string");
  });

  it("returns 400 when configA is missing", async () => {
    const res = await httpRequest(server, "POST", "/compare-agents", {
      configB: validBody.configB,
    });

    expect(res.status).toBe(400);
    expect((res.json() as Record<string, unknown>).error).toMatch(/configA/i);
  });

  it("returns 400 when configB is missing", async () => {
    const res = await httpRequest(server, "POST", "/compare-agents", {
      configA: validBody.configA,
    });

    expect(res.status).toBe(400);
    expect((res.json() as Record<string, unknown>).error).toMatch(/configB/i);
  });

  it("returns 400 when configA.sessionIds is empty", async () => {
    const res = await httpRequest(server, "POST", "/compare-agents", {
      configA: { configId: "a", label: "A", sessionIds: [] },
      configB: validBody.configB,
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when configB.sessionIds is empty", async () => {
    const res = await httpRequest(server, "POST", "/compare-agents", {
      configA: validBody.configA,
      configB: { configId: "b", label: "B", sessionIds: [] },
    });

    expect(res.status).toBe(400);
  });

  it("calls compareConfigs with the correct arguments", async () => {
    await httpRequest(server, "POST", "/compare-agents", validBody);

    expect(mockService.compareConfigs).toHaveBeenCalledWith(
      validBody.configA,
      validBody.configB,
    );
  });
});

// ── GET /compare-agents/reports ───────────────────────────────────────────

describe("GET /compare-agents/reports", () => {
  it("returns 200 with array", async () => {
    mockService.listReports.mockReturnValue([makeReport()]);

    const res = await httpRequest(server, "GET", "/compare-agents/reports");

    expect(res.status).toBe(200);
    const body = res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it("returns empty array when no reports exist", async () => {
    mockService.listReports.mockReturnValue([]);

    const res = await httpRequest(server, "GET", "/compare-agents/reports");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ── GET /compare-agents/dashboard ────────────────────────────────────────

describe("GET /compare-agents/dashboard", () => {
  it("returns 200 with HTML content", async () => {
    const res = await httpRequest(server, "GET", "/compare-agents/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
