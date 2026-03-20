/**
 * AnalyticsDashboard Tests
 *
 * Tests the dashboard-specific extensions to AnalyticsService:
 *   - sentimentDistribution aggregation
 *   - callsPerDay grouping and sorting
 *   - topPolicyViolations (timeline-based and summary-based)
 *   - getTenantComparison()
 *   - getCallsPerDay() with filter
 *
 * And the new Analytics API endpoints:
 *   GET /analytics/dashboard
 *   GET /analytics/tenants
 *   GET /analytics/calls-per-day
 *   GET /analytics/export.csv
 *
 * Follows the same pattern as AnalyticsService.test.ts.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { AnalyticsService } from "../../services/AnalyticsService.js";
import { createAnalyticsRouter } from "../../api/analytics.js";
import type { SessionRecording } from "../../services/SessionRecorder.js";

// ── HTTP helpers ──────────────────────────────────────────────────────

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

// ── Test data factories ───────────────────────────────────────────────

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

// ── Unit Tests: sentimentDistribution ────────────────────────────────

describe("AnalyticsService — sentimentDistribution", () => {
  it("counts positive/neutral/negative/frustrated correctly", () => {
    const recordings = [
      makeRecording({
        sessionId: "s1",
        summary: {
          turnCount: 2,
          policyDecisions: {},
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "positive", averageScore: 0.8, escalationTriggered: false, readingCount: 3 },
        },
      }),
      makeRecording({
        sessionId: "s2",
        summary: {
          turnCount: 2,
          policyDecisions: {},
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "neutral", averageScore: 0.1, escalationTriggered: false, readingCount: 2 },
        },
      }),
      makeRecording({
        sessionId: "s3",
        summary: {
          turnCount: 2,
          policyDecisions: {},
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "negative", averageScore: -0.5, escalationTriggered: false, readingCount: 4 },
        },
      }),
      makeRecording({
        sessionId: "s4",
        summary: {
          turnCount: 2,
          policyDecisions: {},
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "frustrated", averageScore: -0.9, escalationTriggered: true, readingCount: 5 },
        },
      }),
      makeRecording({
        sessionId: "s5",
        summary: {
          turnCount: 2,
          policyDecisions: {},
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "positive", averageScore: 0.7, escalationTriggered: false, readingCount: 2 },
        },
      }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();

    expect(agg.sentimentDistribution.positive).toBe(2);
    expect(agg.sentimentDistribution.neutral).toBe(1);
    expect(agg.sentimentDistribution.negative).toBe(1);
    expect(agg.sentimentDistribution.frustrated).toBe(1);
  });

  it("skips recordings without sentiment data", () => {
    const recordings = [
      makeRecording({
        sessionId: "s1",
        summary: {
          turnCount: 2,
          policyDecisions: {},
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "positive", averageScore: 0.8, escalationTriggered: false, readingCount: 3 },
        },
      }),
      makeRecording({
        sessionId: "s2",
        // no sentiment field
        summary: { turnCount: 2, policyDecisions: {}, audioInputChunks: 0, audioOutputChunks: 0 },
      }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();

    expect(agg.sentimentDistribution.positive).toBe(1);
    // The session without sentiment should still be counted in totalSessions
    expect(agg.totalSessions).toBe(2);
    // but the zero-sentiment session doesn't inflate other buckets
    expect(
      agg.sentimentDistribution.neutral +
      agg.sentimentDistribution.negative +
      agg.sentimentDistribution.frustrated,
    ).toBe(0);
  });

  it("returns all zeros when no recordings have sentiment", () => {
    const recordings = [
      makeRecording({ sessionId: "s1" }),
      makeRecording({ sessionId: "s2" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();

    expect(agg.sentimentDistribution).toEqual({ positive: 0, neutral: 0, negative: 0, frustrated: 0 });
  });

  it("sentimentDistribution is all zeros for empty recordings", () => {
    const service = new AnalyticsService(makeRecorder([]));
    const agg = service.getAggregateMetrics();
    expect(agg.sentimentDistribution).toEqual({ positive: 0, neutral: 0, negative: 0, frustrated: 0 });
  });
});

// ── Unit Tests: callsPerDay ───────────────────────────────────────────

describe("AnalyticsService — callsPerDay", () => {
  it("groups sessions by date and sorts ascending", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", startedAt: "2026-03-20T14:00:00.000Z" }),
      makeRecording({ sessionId: "s2", startedAt: "2026-03-18T09:00:00.000Z" }),
      makeRecording({ sessionId: "s3", startedAt: "2026-03-18T17:00:00.000Z" }),
      makeRecording({ sessionId: "s4", startedAt: "2026-03-19T11:00:00.000Z" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();

    expect(agg.callsPerDay).toEqual([
      { date: "2026-03-18", count: 2 },
      { date: "2026-03-19", count: 1 },
      { date: "2026-03-20", count: 1 },
    ]);
  });

  it("returns empty array when there are no recordings", () => {
    const service = new AnalyticsService(makeRecorder([]));
    const agg = service.getAggregateMetrics();
    expect(agg.callsPerDay).toEqual([]);
  });

  it("single date with multiple sessions produces one entry", () => {
    const recordings = Array.from({ length: 5 }, (_, i) =>
      makeRecording({ sessionId: `s-${i}`, startedAt: "2026-03-18T10:00:00.000Z" }),
    );
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();
    expect(agg.callsPerDay).toEqual([{ date: "2026-03-18", count: 5 }]);
  });
});

// ── Unit Tests: topPolicyViolations ──────────────────────────────────

describe("AnalyticsService — topPolicyViolations (summary fallback)", () => {
  it("returns top violations derived from policyDecisions summary", () => {
    const recordings = [
      makeRecording({
        sessionId: "s1",
        summary: {
          turnCount: 2,
          policyDecisions: { allow: 5, refuse: 3, escalate: 2 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
      makeRecording({
        sessionId: "s2",
        summary: {
          turnCount: 2,
          policyDecisions: { allow: 3, refuse: 1, escalate: 4 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();

    // refuse total = 4, escalate total = 6 → escalate ranks first
    expect(agg.topPolicyViolations[0].violation).toBe("escalate");
    expect(agg.topPolicyViolations[0].count).toBe(6);
    expect(agg.topPolicyViolations[1].violation).toBe("refuse");
    expect(agg.topPolicyViolations[1].count).toBe(4);
  });

  it("only includes refuse and escalate decisions (not allow/rewrite)", () => {
    const recordings = [
      makeRecording({
        sessionId: "s1",
        summary: {
          turnCount: 2,
          policyDecisions: { allow: 100, rewrite: 50, refuse: 2, escalate: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const agg = service.getAggregateMetrics();

    const violationNames = agg.topPolicyViolations.map((v) => v.violation);
    expect(violationNames).not.toContain("allow");
    expect(violationNames).not.toContain("rewrite");
  });

  it("returns empty array when there are no recordings", () => {
    const service = new AnalyticsService(makeRecorder([]));
    const agg = service.getAggregateMetrics();
    expect(agg.topPolicyViolations).toEqual([]);
  });

  it("returns at most 5 entries", () => {
    // Build a recorder with listFullRecordings to test the timeline path
    const recordings = [
      makeRecording({ sessionId: "s1", summary: { turnCount: 1, policyDecisions: {}, audioInputChunks: 0, audioOutputChunks: 0 } }),
    ];

    // Simulate recorder with full recordings containing diverse violation reasons
    const reasons = ["fraud", "pii", "offensive", "competitor", "off-topic", "spam"];
    const fullRecordings = recordings.map((r) => ({
      ...r,
      timeline: reasons.map((reason, idx) => ({
        t_ms: idx * 100,
        type: "policy.decision",
        payload: { decision: "refuse", reason },
      })),
    }));

    const recorderWithTimeline = {
      listRecordings: () => recordings,
      listFullRecordings: () => fullRecordings,
    };
    const service = new AnalyticsService(recorderWithTimeline);
    const agg = service.getAggregateMetrics();

    expect(agg.topPolicyViolations.length).toBeLessThanOrEqual(5);
  });
});

// ── Unit Tests: topPolicyViolations (timeline path) ───────────────────

describe("AnalyticsService — topPolicyViolations (timeline path)", () => {
  it("uses reason field from timeline payload when available", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", summary: { turnCount: 1, policyDecisions: { refuse: 2 }, audioInputChunks: 0, audioOutputChunks: 0 } }),
    ];
    const fullRecordings = [
      {
        ...recordings[0],
        timeline: [
          { t_ms: 0, type: "policy.decision", payload: { decision: "refuse", reason: "pii_violation" } },
          { t_ms: 100, type: "policy.decision", payload: { decision: "refuse", reason: "pii_violation" } },
        ],
      },
    ];
    const recorder = {
      listRecordings: () => recordings,
      listFullRecordings: () => fullRecordings,
    };
    const service = new AnalyticsService(recorder);
    const agg = service.getAggregateMetrics();

    expect(agg.topPolicyViolations[0].violation).toBe("pii_violation");
    expect(agg.topPolicyViolations[0].count).toBe(2);
  });

  it("falls back to decision when reason is absent", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", summary: { turnCount: 1, policyDecisions: { escalate: 1 }, audioInputChunks: 0, audioOutputChunks: 0 } }),
    ];
    const fullRecordings = [
      {
        ...recordings[0],
        timeline: [
          { t_ms: 0, type: "policy.decision", payload: { decision: "escalate" } },
        ],
      },
    ];
    const recorder = {
      listRecordings: () => recordings,
      listFullRecordings: () => fullRecordings,
    };
    const service = new AnalyticsService(recorder);
    const agg = service.getAggregateMetrics();

    expect(agg.topPolicyViolations[0].violation).toBe("escalate");
    expect(agg.topPolicyViolations[0].count).toBe(1);
  });

  it("ignores allow and rewrite timeline entries", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", summary: { turnCount: 1, policyDecisions: { allow: 3, refuse: 0, escalate: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } }),
    ];
    const fullRecordings = [
      {
        ...recordings[0],
        timeline: [
          { t_ms: 0, type: "policy.decision", payload: { decision: "allow" } },
          { t_ms: 100, type: "policy.decision", payload: { decision: "allow" } },
          { t_ms: 200, type: "policy.decision", payload: { decision: "allow" } },
        ],
      },
    ];
    const recorder = {
      listRecordings: () => recordings,
      listFullRecordings: () => fullRecordings,
    };
    const service = new AnalyticsService(recorder);
    const agg = service.getAggregateMetrics();

    expect(agg.topPolicyViolations).toEqual([]);
  });
});

// ── Unit Tests: getTenantComparison ───────────────────────────────────

describe("AnalyticsService — getTenantComparison", () => {
  it("groups sessions by tenantId", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", tenantId: "alpha" }),
      makeRecording({ sessionId: "s2", tenantId: "alpha" }),
      makeRecording({ sessionId: "s3", tenantId: "beta" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const comparison = service.getTenantComparison();

    const alpha = comparison.find((e) => e.tenantId === "alpha");
    const beta = comparison.find((e) => e.tenantId === "beta");

    expect(alpha).toBeDefined();
    expect(alpha!.sessions).toBe(2);
    expect(beta).toBeDefined();
    expect(beta!.sessions).toBe(1);
  });

  it("computes avgDurationMs correctly and returns null when all durations are null", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", tenantId: "alpha", durationMs: null }),
      makeRecording({ sessionId: "s2", tenantId: "alpha", durationMs: null }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const comparison = service.getTenantComparison();

    const alpha = comparison.find((e) => e.tenantId === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha!.avgDurationMs).toBeNull();
  });

  it("computes avgDurationMs correctly skipping null values", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", tenantId: "alpha", durationMs: 60000 }),
      makeRecording({ sessionId: "s2", tenantId: "alpha", durationMs: null }),
      makeRecording({ sessionId: "s3", tenantId: "alpha", durationMs: 120000 }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const comparison = service.getTenantComparison();

    const alpha = comparison.find((e) => e.tenantId === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha!.avgDurationMs).toBe(90000);
  });

  it("includes escalationRate and avgComplianceRate per tenant", () => {
    const recordings = [
      makeRecording({
        sessionId: "s1",
        tenantId: "alpha",
        summary: {
          turnCount: 2,
          policyDecisions: { allow: 10, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const comparison = service.getTenantComparison();

    const alpha = comparison.find((e) => e.tenantId === "alpha");
    expect(alpha).toBeDefined();
    // escalation = 2 / 12 total decisions
    expect(alpha!.escalationRate).toBeCloseTo(2 / 12, 5);
    // compliance = (allow + rewrite) / total = 10 / 12
    expect(alpha!.avgComplianceRate).toBeCloseTo(10 / 12, 5);
  });

  it("returns empty array for empty recordings", () => {
    const service = new AnalyticsService(makeRecorder([]));
    const comparison = service.getTenantComparison();
    expect(comparison).toEqual([]);
  });
});

// ── Unit Tests: getCallsPerDay ────────────────────────────────────────

describe("AnalyticsService — getCallsPerDay", () => {
  it("respects tenantId filter", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", tenantId: "alpha", startedAt: "2026-03-18T10:00:00.000Z" }),
      makeRecording({ sessionId: "s2", tenantId: "beta", startedAt: "2026-03-18T11:00:00.000Z" }),
      makeRecording({ sessionId: "s3", tenantId: "alpha", startedAt: "2026-03-19T10:00:00.000Z" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const result = service.getCallsPerDay({ tenantId: "alpha" });

    expect(result).toEqual([
      { date: "2026-03-18", count: 1 },
      { date: "2026-03-19", count: 1 },
    ]);
  });

  it("returns results sorted ascending by date", () => {
    const recordings = [
      makeRecording({ sessionId: "s1", startedAt: "2026-03-20T10:00:00.000Z" }),
      makeRecording({ sessionId: "s2", startedAt: "2026-03-18T10:00:00.000Z" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const result = service.getCallsPerDay();

    expect(result[0].date).toBe("2026-03-18");
    expect(result[1].date).toBe("2026-03-20");
  });
});

// ── Integration Tests: new API endpoints ──────────────────────────────

describe("Analytics Dashboard API Endpoints", () => {
  let app: Express;
  let server: Server;
  let service: AnalyticsService;

  beforeAll((done) => {
    const recordings: RecordingMetadata[] = [
      makeRecording({
        sessionId: "sess-001",
        tenantId: "tenant-a",
        durationMs: 30000,
        startedAt: "2026-03-18T10:00:00.000Z",
        summary: {
          turnCount: 4,
          policyDecisions: { allow: 8, refuse: 1, escalate: 0, rewrite: 1, cancel_output: 0 },
          audioInputChunks: 100,
          audioOutputChunks: 80,
          sentiment: { dominantSentiment: "positive", averageScore: 0.7, escalationTriggered: false, readingCount: 3 },
        },
      }),
      makeRecording({
        sessionId: "sess-002",
        tenantId: "tenant-b",
        durationMs: 90000,
        startedAt: "2026-03-18T14:00:00.000Z",
        summary: {
          turnCount: 3,
          policyDecisions: { allow: 5, refuse: 2, escalate: 1, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 80,
          audioOutputChunks: 60,
          sentiment: { dominantSentiment: "neutral", averageScore: 0.1, escalationTriggered: false, readingCount: 2 },
        },
      }),
      makeRecording({
        sessionId: "sess-003",
        tenantId: "tenant-a",
        durationMs: null,
        startedAt: "2026-03-19T09:00:00.000Z",
        summary: {
          turnCount: 5,
          policyDecisions: { allow: 10, refuse: 0, escalate: 2, rewrite: 2, cancel_output: 0 },
          audioInputChunks: 90,
          audioOutputChunks: 75,
        },
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

  describe("GET /analytics/dashboard", () => {
    it("returns 200 with sentimentDistribution", async () => {
      const res = await httpRequest(server, "GET", "/analytics/dashboard");
      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.sentimentDistribution).toBeDefined();
      const dist = data.sentimentDistribution as Record<string, number>;
      expect(typeof dist.positive).toBe("number");
      expect(typeof dist.neutral).toBe("number");
      expect(typeof dist.negative).toBe("number");
      expect(typeof dist.frustrated).toBe("number");
      expect(dist.positive).toBe(1);
      expect(dist.neutral).toBe(1);
    });

    it("returns callsPerDay in response", async () => {
      const res = await httpRequest(server, "GET", "/analytics/dashboard");
      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(Array.isArray(data.callsPerDay)).toBe(true);
      const cpd = data.callsPerDay as Array<{ date: string; count: number }>;
      expect(cpd.length).toBeGreaterThan(0);
      // first date should be 2026-03-18 (2 sessions)
      expect(cpd[0].date).toBe("2026-03-18");
      expect(cpd[0].count).toBe(2);
    });

    it("returns topPolicyViolations in response", async () => {
      const res = await httpRequest(server, "GET", "/analytics/dashboard");
      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(Array.isArray(data.topPolicyViolations)).toBe(true);
    });

    it("returns totalSessions and sessions array", async () => {
      const res = await httpRequest(server, "GET", "/analytics/dashboard");
      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.totalSessions).toBe(3);
      expect(Array.isArray(data.sessions)).toBe(true);
    });
  });

  describe("GET /analytics/tenants", () => {
    it("returns 200 with an array", async () => {
      const res = await httpRequest(server, "GET", "/analytics/tenants");
      expect(res.status).toBe(200);
      const data = res.json() as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });

    it("includes both tenants", async () => {
      const res = await httpRequest(server, "GET", "/analytics/tenants");
      const data = res.json() as Array<{ tenantId: string; sessions: number }>;
      const tenantIds = data.map((e) => e.tenantId);
      expect(tenantIds).toContain("tenant-a");
      expect(tenantIds).toContain("tenant-b");
    });

    it("each entry has required fields", async () => {
      const res = await httpRequest(server, "GET", "/analytics/tenants");
      const data = res.json() as Array<Record<string, unknown>>;
      for (const entry of data) {
        expect(typeof entry.tenantId).toBe("string");
        expect(typeof entry.sessions).toBe("number");
        expect(typeof entry.avgQualityScore).toBe("number");
        expect(typeof entry.escalationRate).toBe("number");
        expect(typeof entry.avgComplianceRate).toBe("number");
        // avgDurationMs is number or null
        expect(entry.avgDurationMs === null || typeof entry.avgDurationMs === "number").toBe(true);
      }
    });

    it("tenant-a avgDurationMs is 30000 (only sess-001 has duration)", async () => {
      const res = await httpRequest(server, "GET", "/analytics/tenants");
      const data = res.json() as Array<{ tenantId: string; avgDurationMs: number | null }>;
      const alpha = data.find((e) => e.tenantId === "tenant-a");
      expect(alpha).toBeDefined();
      // sess-003 has null durationMs, so avg of [30000] = 30000
      expect(alpha!.avgDurationMs).toBe(30000);
    });
  });

  describe("GET /analytics/calls-per-day", () => {
    it("returns 200 with array", async () => {
      const res = await httpRequest(server, "GET", "/analytics/calls-per-day");
      expect(res.status).toBe(200);
      const data = res.json() as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });

    it("each entry has date and count", async () => {
      const res = await httpRequest(server, "GET", "/analytics/calls-per-day");
      const data = res.json() as Array<{ date: string; count: number }>;
      for (const entry of data) {
        expect(typeof entry.date).toBe("string");
        expect(typeof entry.count).toBe("number");
        // date should be YYYY-MM-DD
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("respects tenantId query param", async () => {
      const res = await httpRequest(server, "GET", "/analytics/calls-per-day?tenantId=tenant-b");
      expect(res.status).toBe(200);
      const data = res.json() as Array<{ date: string; count: number }>;
      // Only sess-002 belongs to tenant-b
      expect(data.length).toBe(1);
      expect(data[0].count).toBe(1);
    });
  });

  describe("GET /analytics/export.csv", () => {
    it("returns text/csv content-type", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
    });

    it("returns Content-Disposition attachment header", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv");
      const disposition = res.headers["content-disposition"] as string;
      expect(disposition).toContain("attachment");
      expect(disposition).toContain("call-log.csv");
    });

    it("CSV has correct headers row", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv");
      const lines = res.body.split("\n");
      expect(lines[0]).toBe(
        "sessionId,tenantId,startedAt,durationMs,turnCount,qualityScore,complianceRate,escalationCount,policyDecisions",
      );
    });

    it("CSV has correct number of data rows", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv");
      const lines = res.body.split("\n").filter((l) => l.trim() !== "");
      // 1 header + 3 sessions
      expect(lines.length).toBe(4);
    });

    it("handles null durationMs gracefully (empty string in CSV)", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv");
      const lines = res.body.split("\n");
      // sess-003 has null durationMs — find it
      const sess003Line = lines.find((l) => l.startsWith("sess-003"));
      expect(sess003Line).toBeDefined();
      // durationMs column (4th, 0-indexed col 3) should be empty
      const cols = sess003Line!.split(",");
      expect(cols[3]).toBe("");
    });

    it("filters by tenantId query param", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv?tenantId=tenant-b");
      expect(res.status).toBe(200);
      const lines = res.body.split("\n").filter((l) => l.trim() !== "");
      // 1 header + 1 session (sess-002)
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain("sess-002");
    });

    it("returns 400 when from is an invalid date", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv?from=not-a-date");
      expect(res.status).toBe(400);
      const data = res.json() as Record<string, string>;
      expect(data.error).toMatch(/valid ISO date/i);
    });

    it("returns 400 when to is an invalid date", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv?to=not-a-date");
      expect(res.status).toBe(400);
      const data = res.json() as Record<string, string>;
      expect(data.error).toMatch(/valid ISO date/i);
    });

    it("returns 400 when limit is not a valid number", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv?limit=abc");
      expect(res.status).toBe(400);
      const data = res.json() as Record<string, string>;
      expect(data.error).toMatch(/limit must be between/i);
    });

    it("returns 400 when limit is zero", async () => {
      const res = await httpRequest(server, "GET", "/analytics/export.csv?limit=0");
      expect(res.status).toBe(400);
      const data = res.json() as Record<string, string>;
      expect(data.error).toMatch(/limit must be between/i);
    });
  });
});

// ── Additional coverage: /sessions invalid date params ────────────────

describe("Analytics API — /sessions invalid query param branches", () => {
  let server: Server;

  beforeAll((done) => {
    const recordings: RecordingMetadata[] = [
      makeRecording({ sessionId: "s1", tenantId: "t1", startedAt: "2026-03-18T10:00:00.000Z" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const app = express();
    app.use(express.json());
    app.use("/analytics", createAnalyticsRouter(service));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it("returns 400 when /sessions to param is an invalid date", async () => {
    const res = await httpRequest(server, "GET", "/analytics/sessions?to=not-a-date");
    expect(res.status).toBe(400);
    const data = res.json() as Record<string, string>;
    expect(data.error).toMatch(/valid ISO date/i);
  });
});

// ── Additional coverage: /calls-per-day invalid date params ──────────

describe("Analytics API — /calls-per-day invalid query param branches", () => {
  let server: Server;

  beforeAll((done) => {
    const recordings: RecordingMetadata[] = [
      makeRecording({ sessionId: "s1", tenantId: "t1", startedAt: "2026-03-18T10:00:00.000Z" }),
    ];
    const service = new AnalyticsService(makeRecorder(recordings));
    const app = express();
    app.use(express.json());
    app.use("/analytics", createAnalyticsRouter(service));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it("returns 400 when from is an invalid date", async () => {
    const res = await httpRequest(server, "GET", "/analytics/calls-per-day?from=not-a-date");
    expect(res.status).toBe(400);
    const data = res.json() as Record<string, string>;
    expect(data.error).toMatch(/valid ISO date/i);
  });

  it("returns 400 when to is an invalid date", async () => {
    const res = await httpRequest(server, "GET", "/analytics/calls-per-day?to=not-a-date");
    expect(res.status).toBe(400);
    const data = res.json() as Record<string, string>;
    expect(data.error).toMatch(/valid ISO date/i);
  });
});
