/**
 * Conversation Analytics API Unit Tests
 *
 * Tests the router produced by createConversationAnalyticsRouter().
 * ConversationAnalyticsService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createConversationAnalyticsRouter } from "../../api/conversationAnalytics.js";
import type { ConversationAnalyticsService, ConversationInsights } from "../../services/ConversationAnalyticsService.js";

// ── Mock service ───────────────────────────────────────────────────────────────

const mockInsights: ConversationInsights = {
  generatedAt: "2026-03-20T10:00:00.000Z",
  sessionCount: 5,
  dateRange: { from: "2026-03-01T00:00:00.000Z", to: "2026-03-20T00:00:00.000Z" },
  topicClusters: [
    {
      topicId: "billing",
      label: "billing",
      keywords: ["bill", "charge"],
      sessionCount: 3,
      avgHandleTimeMs: 120000,
      escalationRate: 0.1,
      resolutionRate: 0.9,
      sentimentBreakdown: { positive: 2, neutral: 1 },
    },
  ],
  frequentQuestions: [
    {
      text: "What is my balance?",
      normalizedText: "balance",
      occurrences: 3,
      topicLabel: "billing",
      avgHandleTimeMs: 90000,
      escalationRate: 0,
    },
  ],
  resolutionPaths: [
    {
      pathId: "user|agent|end",
      steps: ["user", "agent", "end"],
      occurrences: 4,
      avgHandleTimeMs: 100000,
      outcomeLabel: "resolved",
    },
  ],
  handleTimeByTopic: [
    {
      topicLabel: "billing",
      avgMs: 120000,
      p50Ms: 110000,
      p95Ms: 150000,
      sampleCount: 3,
    },
  ],
  overallStats: {
    avgHandleTimeMs: 115000,
    p50HandleTimeMs: 110000,
    p95HandleTimeMs: 140000,
    overallEscalationRate: 0.2,
    overallResolutionRate: 0.8,
    totalUserTurns: 15,
  },
};

const mockSvc = {
  generateInsights: jest.fn<Promise<ConversationInsights>, [unknown]>(),
};

// ── HTTP helper ────────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpRequest(server: Server, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    import("http").then(({ default: http }) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: (addr as { port: number }).port,
          path,
          method: "GET",
        },
        (res) => {
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
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

// ── Test app ───────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/analytics/conversations",
    createConversationAnalyticsRouter(mockSvc as unknown as ConversationAnalyticsService),
  );
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("conversationAnalytics API", () => {
  let server: Server;

  beforeEach((done) => {
    mockSvc.generateInsights.mockReset();
    mockSvc.generateInsights.mockResolvedValue(mockInsights);
    server = createServer(buildApp()).listen(0, "127.0.0.1", done);
  });

  afterEach((done) => {
    server.close(done);
  });

  // ── GET /insights ────────────────────────────────────────────────────────

  it("GET /insights returns 200", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights");
    expect(resp.status).toBe(200);
  });

  it("GET /insights response has topicClusters", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights");
    const body = resp.json() as ConversationInsights;
    expect(body).toHaveProperty("topicClusters");
    expect(Array.isArray(body.topicClusters)).toBe(true);
  });

  it("GET /insights response has frequentQuestions", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights");
    const body = resp.json() as ConversationInsights;
    expect(body).toHaveProperty("frequentQuestions");
  });

  it("GET /insights response has resolutionPaths", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights");
    const body = resp.json() as ConversationInsights;
    expect(body).toHaveProperty("resolutionPaths");
  });

  it("GET /insights response has handleTimeByTopic", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights");
    const body = resp.json() as ConversationInsights;
    expect(body).toHaveProperty("handleTimeByTopic");
  });

  it("GET /insights response has overallStats", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights");
    const body = resp.json() as ConversationInsights;
    expect(body).toHaveProperty("overallStats");
  });

  it("returns 400 for invalid from date", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights?from=not-a-date");
    expect(resp.status).toBe(400);
    const body = resp.json() as { error: string };
    expect(body.error).toMatch(/from/i);
  });

  it("returns 400 for maxSessions > 1000", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/insights?maxSessions=1001");
    expect(resp.status).toBe(400);
    const body = resp.json() as { error: string };
    expect(body.error).toMatch(/maxSessions/i);
  });

  it("passes tenantId to service", async () => {
    await httpRequest(server, "/analytics/conversations/insights?tenantId=acme");
    expect(mockSvc.generateInsights).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "acme" }),
    );
  });

  it("passes from/to/maxSessions to service", async () => {
    await httpRequest(
      server,
      "/analytics/conversations/insights?from=2026-03-01&to=2026-03-20&maxSessions=50",
    );
    expect(mockSvc.generateInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-03-01",
        to: "2026-03-20",
        maxSessions: 50,
      }),
    );
  });

  // ── GET /dashboard ───────────────────────────────────────────────────────

  it("GET /dashboard returns 200 HTML", async () => {
    const resp = await httpRequest(server, "/analytics/conversations/dashboard");
    expect(resp.status).toBe(200);
    expect(resp.body).toContain("<!DOCTYPE html>");
  });
});
