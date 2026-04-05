/**
 * AnalyticsService + Analytics API Tests
 *
 * Tests the AnalyticsService (unit) and /analytics/* HTTP endpoints (integration).
 * Follows the AdminApi.test.ts pattern: builds a standalone Express app
 * with injected dependencies to avoid importing index.ts.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { AnalyticsService } from "../../services/AnalyticsService.js";
import type { SessionMetrics, AggregateMetrics } from "../../services/AnalyticsService.js";
import { createAnalyticsRouter } from "../../api/analytics.js";
import type { SessionRecording } from "../../services/SessionRecorder.js";

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
      headers: { "Content-Type": "application/json" },
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

// ── Test data factory ────────────────────────────────────────────────

type RecordingMetadata = Omit<SessionRecording, "timeline">;

function makeRecording(overrides: Partial<RecordingMetadata> = {}): RecordingMetadata {
  return {
    sessionId: "sessionId" in overrides ? overrides.sessionId! : "sess-001",
    startedAt: "startedAt" in overrides ? overrides.startedAt! : "2026-03-18T10:00:00.000Z",
    endedAt: "endedAt" in overrides ? overrides.endedAt! : "2026-03-18T10:01:00.000Z",
    durationMs: "durationMs" in overrides ? overrides.durationMs! : 45000,
    tenantId: "tenantId" in overrides ? overrides.tenantId! : "tenant-a",
    summary: overrides.summary ?? {
      turnCount: 4,
      policyDecisions: { allow: 8, refuse: 1, escalate: 0, rewrite: 1, cancel_output: 0 },
      audioInputChunks: 100,
      audioOutputChunks: 80,
    },
  };
}

function makeRecorder(recordings: RecordingMetadata[]) {
  return { listRecordings: () => recordings };
}

// ── Unit Tests: AnalyticsService.computeSessionMetrics ───────────────

describe("AnalyticsService", () => {
  describe("computeSessionMetrics", () => {
    it("computes correct complianceRate with decisions", () => {
      const recorder = makeRecorder([]);
      const service = new AnalyticsService(recorder);
      const recording = makeRecording({
        summary: {
          turnCount: 3,
          policyDecisions: { allow: 7, refuse: 2, escalate: 1, rewrite: 3, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(recording);
      // (7 + 3) / 13 = 0.769...
      expect(metrics.complianceRate).toBeCloseTo(10 / 13, 5);
      expect(metrics.totalDecisions).toBe(13);
    });

    it("complianceRate is 1.0 when 0 decisions", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({
        summary: {
          turnCount: 2,
          policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(recording);
      expect(metrics.complianceRate).toBe(1.0);
      expect(metrics.totalDecisions).toBe(0);
    });

    it("qualityScore is in 0–100 range", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording();
      const metrics = service.computeSessionMetrics(recording);
      expect(metrics.qualityScore).toBeGreaterThanOrEqual(0);
      expect(metrics.qualityScore).toBeLessThanOrEqual(100);
    });

    it("all-allow decisions yield higher compliance portion", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const allAllow = makeRecording({
        summary: {
          turnCount: 5,
          policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(allAllow);
      expect(metrics.complianceRate).toBe(1.0);
      // compliance portion = 1.0 * 40 = 40
      // With 5 turns and durationMs=45000 (< 60s): 30 + 40 + 30 = 100
      expect(metrics.qualityScore).toBe(100);
    });

    it("all-escalate decisions yield lower compliance", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const allEscalate = makeRecording({
        summary: {
          turnCount: 5,
          policyDecisions: { allow: 0, refuse: 0, escalate: 10, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(allEscalate);
      expect(metrics.complianceRate).toBe(0);
      // compliance portion = 0
      // 30 (latency) + 0 (compliance) + 30 (engagement) = 60
      expect(metrics.qualityScore).toBe(60);
    });

    it("5+ turns yield full engagement score", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({
        summary: {
          turnCount: 10,
          policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(recording);
      // engagement = min(10/5, 1) * 30 = 30
      // latency = 30 (45s < 60s)
      // compliance = 1.0 * 40 = 40
      expect(metrics.qualityScore).toBe(100);
    });

    it("0 turns yield 0 engagement score", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({
        summary: {
          turnCount: 0,
          policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(recording);
      // engagement = min(0/5, 1) * 30 = 0
      // latency = 30, compliance = 40
      expect(metrics.qualityScore).toBe(70);
    });

    it("latency SLA: durationMs=30000 yields 30 pts", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({ durationMs: 30000 });
      const metrics = service.computeSessionMetrics(recording);
      // 30 (latency) + compliance + engagement
      // We check by computing the other components and verifying total
      const complianceComponent = metrics.complianceRate * 40;
      const engagementComponent = Math.min(metrics.turnCount / 5, 1) * 30;
      expect(metrics.qualityScore).toBe(Math.round(30 + complianceComponent + engagementComponent));
    });

    it("latency SLA: durationMs=90000 yields 20 pts", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({ durationMs: 90000 });
      const metrics = service.computeSessionMetrics(recording);
      const complianceComponent = metrics.complianceRate * 40;
      const engagementComponent = Math.min(metrics.turnCount / 5, 1) * 30;
      expect(metrics.qualityScore).toBe(Math.round(20 + complianceComponent + engagementComponent));
    });

    it("latency SLA: durationMs=200000 yields 10 pts", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({ durationMs: 200000 });
      const metrics = service.computeSessionMetrics(recording);
      const complianceComponent = metrics.complianceRate * 40;
      const engagementComponent = Math.min(metrics.turnCount / 5, 1) * 30;
      expect(metrics.qualityScore).toBe(Math.round(10 + complianceComponent + engagementComponent));
    });

    it("latency SLA: null durationMs yields 20 pts (neutral)", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({ durationMs: null });
      const metrics = service.computeSessionMetrics(recording);
      const complianceComponent = metrics.complianceRate * 40;
      const engagementComponent = Math.min(metrics.turnCount / 5, 1) * 30;
      expect(metrics.qualityScore).toBe(Math.round(20 + complianceComponent + engagementComponent));
    });

    it("extracts escalationCount from policyDecisions", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const recording = makeRecording({
        summary: {
          turnCount: 3,
          policyDecisions: { allow: 5, refuse: 0, escalate: 3, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });

      const metrics = service.computeSessionMetrics(recording);
      expect(metrics.escalationCount).toBe(3);
    });
  });

  // ── getAggregateMetrics ──────────────────────────────────────────

  describe("getAggregateMetrics", () => {
    it("returns sensible defaults for empty recordings", () => {
      const service = new AnalyticsService(makeRecorder([]));
      const agg = service.getAggregateMetrics();

      expect(agg.totalSessions).toBe(0);
      expect(agg.filteredSessions).toBe(0);
      expect(agg.avgDurationMs).toBeNull();
      expect(agg.avgTurnCount).toBe(0);
      expect(agg.avgQualityScore).toBe(0);
      expect(agg.totalDecisions).toBe(0);
      expect(agg.decisionBreakdown).toEqual({});
      expect(agg.avgComplianceRate).toBe(0);
      expect(agg.escalationRate).toBe(0);
      expect(agg.tenantBreakdown).toEqual({});
      expect(agg.sessions).toEqual([]);
    });

    it("tenantId filter works", () => {
      const recordings = [
        makeRecording({ sessionId: "s1", tenantId: "tenant-a" }),
        makeRecording({ sessionId: "s2", tenantId: "tenant-b" }),
        makeRecording({ sessionId: "s3", tenantId: "tenant-a" }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics({ tenantId: "tenant-a" });
      expect(agg.filteredSessions).toBe(2);
      expect(agg.sessions).toHaveLength(2);
      expect(agg.sessions.every((s) => s.tenantId === "tenant-a")).toBe(true);
    });

    it("date range filter works (from/to)", () => {
      const recordings = [
        makeRecording({ sessionId: "s1", startedAt: "2026-03-15T10:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-17T10:00:00.000Z" }),
        makeRecording({ sessionId: "s3", startedAt: "2026-03-19T10:00:00.000Z" }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics({
        fromDate: "2026-03-16T00:00:00.000Z",
        toDate: "2026-03-18T00:00:00.000Z",
      });
      expect(agg.filteredSessions).toBe(1);
      expect(agg.sessions[0].sessionId).toBe("s2");
    });

    it("limit and offset work", () => {
      const recordings = Array.from({ length: 10 }, (_, i) =>
        makeRecording({ sessionId: `s-${i}` }),
      );
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics({ limit: 3, offset: 2 });
      expect(agg.filteredSessions).toBe(10);
      expect(agg.sessions).toHaveLength(3);
      expect(agg.sessions[0].sessionId).toBe("s-2");
      expect(agg.sessions[2].sessionId).toBe("s-4");
    });

    it("decisionBreakdown sums correctly across sessions", () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 5, refuse: 1, escalate: 0, rewrite: 2, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 3, refuse: 0, escalate: 2, rewrite: 1, cancel_output: 1 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics();
      expect(agg.decisionBreakdown.allow).toBe(8);
      expect(agg.decisionBreakdown.refuse).toBe(1);
      expect(agg.decisionBreakdown.escalate).toBe(2);
      expect(agg.decisionBreakdown.rewrite).toBe(3);
      expect(agg.decisionBreakdown.cancel_output).toBe(1);
      expect(agg.totalDecisions).toBe(15);
    });

    it("tenantBreakdown groups correctly with per-tenant avgQualityScore", () => {
      const recordings = [
        makeRecording({ sessionId: "s1", tenantId: "tenant-a", durationMs: 30000 }),
        makeRecording({ sessionId: "s2", tenantId: "tenant-a", durationMs: 30000 }),
        makeRecording({ sessionId: "s3", tenantId: "tenant-b", durationMs: 200000 }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics();
      expect(agg.tenantBreakdown["tenant-a"].sessions).toBe(2);
      expect(agg.tenantBreakdown["tenant-b"].sessions).toBe(1);
      // tenant-b has lower latency score (10 vs 30), so lower quality
      expect(agg.tenantBreakdown["tenant-a"].avgQualityScore).toBeGreaterThan(
        agg.tenantBreakdown["tenant-b"].avgQualityScore,
      );
    });

    it("escalationRate = escalations / totalDecisions", () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 5, refuse: 0, escalate: 3, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 10, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics();
      // 5 escalations / 20 total = 0.25
      expect(agg.escalationRate).toBeCloseTo(5 / 20, 5);
    });

    it("escalationRate is 0 when no decisions", () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));
      const agg = service.getAggregateMetrics();
      expect(agg.escalationRate).toBe(0);
    });

    it("avgComplianceRate correct across multiple sessions", () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 0, refuse: 10, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics();
      // Session 1: compliance = 1.0, Session 2: compliance = 0.0
      // Average = 0.5
      expect(agg.avgComplianceRate).toBeCloseTo(0.5, 5);
    });

    it("avgDurationMs skips null durations", () => {
      const recordings = [
        makeRecording({ sessionId: "s1", durationMs: 60000 }),
        makeRecording({ sessionId: "s2", durationMs: null }),
        makeRecording({ sessionId: "s3", durationMs: 120000 }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics();
      // avg of 60000 and 120000 = 90000
      expect(agg.avgDurationMs).toBe(90000);
    });

    it("tenantBreakdown uses 'unknown' for null tenantId", () => {
      const recordings = [
        makeRecording({ sessionId: "s1", tenantId: null }),
      ];
      const service = new AnalyticsService(makeRecorder(recordings));

      const agg = service.getAggregateMetrics();
      expect(agg.tenantBreakdown["unknown"]).toBeDefined();
      expect(agg.tenantBreakdown["unknown"].sessions).toBe(1);
    });
  });
});

// ── Integration Tests: Analytics API endpoints ────────────────────────

describe("Analytics API Endpoints", () => {
  let app: Express;
  let server: Server;
  let recordings: RecordingMetadata[];
  let service: AnalyticsService;

  beforeAll((done) => {
    recordings = [
      makeRecording({ sessionId: "sess-001", tenantId: "tenant-a", durationMs: 30000 }),
      makeRecording({ sessionId: "sess-002", tenantId: "tenant-b", durationMs: 90000 }),
      makeRecording({
        sessionId: "sess-003",
        tenantId: "tenant-a",
        durationMs: 200000,
        startedAt: "2026-03-19T10:00:00.000Z",
      }),
    ];
    const recorder = makeRecorder(recordings);
    service = new AnalyticsService(recorder);

    app = express();
    app.use(express.json());
    app.use("/analytics", createAnalyticsRouter(service));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  describe("GET /analytics/sessions", () => {
    it("returns 200 with metrics object", async () => {
      const res = await httpRequest(server, "GET", "/analytics/sessions");
      expect(res.status).toBe(200);
      const data = res.json() as { filter: Record<string, unknown>; metrics: AggregateMetrics };
      expect(data.filter).toBeDefined();
      expect(data.metrics).toBeDefined();
      expect(data.metrics.totalSessions).toBe(3);
      expect(data.metrics.sessions).toHaveLength(3);
    });

    it("filters by tenantId", async () => {
      const res = await httpRequest(server, "GET", "/analytics/sessions?tenantId=tenant-a");
      expect(res.status).toBe(200);
      const data = res.json() as { filter: Record<string, unknown>; metrics: AggregateMetrics };
      expect(data.metrics.filteredSessions).toBe(2);
      expect(data.metrics.sessions.every((s: SessionMetrics) => s.tenantId === "tenant-a")).toBe(true);
      expect(data.filter.tenantId).toBe("tenant-a");
    });

    it("respects limit query param", async () => {
      const res = await httpRequest(server, "GET", "/analytics/sessions?limit=1");
      expect(res.status).toBe(200);
      const data = res.json() as { filter: { limit: number }; metrics: AggregateMetrics };
      expect(data.filter.limit).toBe(1);
      expect(data.metrics.sessions).toHaveLength(1);
    });

    it("clamps limit to max 500", async () => {
      const res = await httpRequest(server, "GET", "/analytics/sessions?limit=999");
      expect(res.status).toBe(200);
      const data = res.json() as { filter: { limit: number }; metrics: AggregateMetrics };
      expect(data.filter.limit).toBe(500);
    });

    it("filters by date range", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/analytics/sessions?from=2026-03-19T00:00:00.000Z&to=2026-03-20T00:00:00.000Z",
      );
      expect(res.status).toBe(200);
      const data = res.json() as { metrics: AggregateMetrics };
      expect(data.metrics.filteredSessions).toBe(1);
      expect(data.metrics.sessions[0].sessionId).toBe("sess-003");
    });
  });

  describe("GET /analytics/sessions/:id", () => {
    it("returns 200 for a known session", async () => {
      const res = await httpRequest(server, "GET", "/analytics/sessions/sess-001");
      expect(res.status).toBe(200);
      const data = res.json() as SessionMetrics;
      expect(data.sessionId).toBe("sess-001");
      expect(data.qualityScore).toBeGreaterThanOrEqual(0);
      expect(data.qualityScore).toBeLessThanOrEqual(100);
      expect(typeof data.complianceRate).toBe("number");
    });

    it("returns 404 for unknown session", async () => {
      const res = await httpRequest(server, "GET", "/analytics/sessions/nonexistent");
      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });
  });

  describe("GET /analytics/summary", () => {
    it("returns 200 with AggregateMetrics", async () => {
      const res = await httpRequest(server, "GET", "/analytics/summary");
      expect(res.status).toBe(200);
      const data = res.json() as AggregateMetrics;
      expect(data.totalSessions).toBe(3);
      expect(data.filteredSessions).toBe(3);
      expect(typeof data.avgDurationMs).toBe("number");
      expect(typeof data.avgTurnCount).toBe("number");
      expect(typeof data.avgQualityScore).toBe("number");
      expect(typeof data.avgComplianceRate).toBe("number");
      expect(Object.keys(data.tenantBreakdown)).toEqual(expect.arrayContaining(["tenant-a", "tenant-b"]));
      expect(data.sessions).toHaveLength(3);
    });
  });
});
