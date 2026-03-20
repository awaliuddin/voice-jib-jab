/**
 * ConversationAnalyticsService Unit Tests
 *
 * SessionRecorder is fully mocked. Tests exercise topic clustering, FAQ
 * extraction, resolution path mapping, handle time percentiles, and all
 * filter options (tenantId, from/to, maxSessions).
 *
 * SessionRecorder API used:
 *   - listRecordings() → Array<Omit<SessionRecording, "timeline">>
 *   - loadRecording(sessionId) → SessionRecording | null
 */

import {
  ConversationAnalyticsService,
} from "../../services/ConversationAnalyticsService.js";
import type { SessionRecorder, SessionRecording } from "../../services/SessionRecorder.js";

// ── Mock factory helpers ──────────────────────────────────────────────────────

function makeRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  return {
    sessionId: "sess-001",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:05:00.000Z",
    durationMs: 300000,
    tenantId: "tenant-a",
    timeline: [],
    summary: {
      turnCount: 0,
      policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
      audioInputChunks: 0,
      audioOutputChunks: 0,
    },
    ...overrides,
  };
}

type RecordingMeta = Omit<SessionRecording, "timeline">;

function metaOf(r: SessionRecording): RecordingMeta {
  const { timeline: _t, ...meta } = r;
  return meta;
}

function userEntry(text: string, t_ms = 0) {
  return { t_ms, type: "user_transcript" as const, payload: { text, isFinal: true } };
}

function policyEntry(decision: string, t_ms = 50) {
  return { t_ms, type: "policy.decision" as const, payload: { decision } };
}

function endEntry(t_ms = 200) {
  return { t_ms, type: "session.end" as const };
}

// ── Mock SessionRecorder ──────────────────────────────────────────────────────

function buildMockRecorder(
  recordings: SessionRecording[],
): jest.Mocked<Pick<SessionRecorder, "listRecordings" | "loadRecording">> {
  return {
    listRecordings: jest.fn(() => recordings.map(metaOf)),
    loadRecording: jest.fn((id: string) => recordings.find((r) => r.sessionId === id) ?? null),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ConversationAnalyticsService", () => {

  // ── generateInsights() — shape ────────────────────────────────────────────

  describe("generateInsights() — response shape", () => {
    it("returns ConversationInsights with generatedAt", async () => {
      const recorder = buildMockRecorder([]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result).toHaveProperty("generatedAt");
      expect(typeof result.generatedAt).toBe("string");
      expect(Date.parse(result.generatedAt)).not.toBeNaN();
    });

    it("sessionCount matches loaded sessions", async () => {
      const recs = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.sessionCount).toBe(3);
    });

    it("dateRange.from and dateRange.to are populated", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", startedAt: "2026-03-01T09:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-10T09:00:00.000Z" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.dateRange.from).toBeTruthy();
      expect(result.dateRange.to).toBeTruthy();
    });

    it("empty session set returns empty clusters, FAQs, paths", async () => {
      const recorder = buildMockRecorder([]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.topicClusters).toHaveLength(0);
      expect(result.frequentQuestions).toHaveLength(0);
      expect(result.resolutionPaths).toHaveLength(0);
    });
  });

  // ── Topic clustering ──────────────────────────────────────────────────────

  describe("topic clustering", () => {
    it("assigns session to 'billing' cluster when user says 'billing'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("I have a billing question")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing).toBeDefined();
      expect(billing!.sessionCount).toBe(1);
    });

    it("assigns session to 'billing' cluster when user says 'invoice'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("can you send me an invoice")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing).toBeDefined();
      expect(billing!.sessionCount).toBe(1);
    });

    it("assigns session to 'technical' cluster when user says 'error'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("I keep getting an error message")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const technical = result.topicClusters.find((c) => c.label === "technical");
      expect(technical).toBeDefined();
      expect(technical!.sessionCount).toBe(1);
    });

    it("assigns session to 'technical' cluster when user says 'problem'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("there is a problem with my service")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const technical = result.topicClusters.find((c) => c.label === "technical");
      expect(technical).toBeDefined();
      expect(technical!.sessionCount).toBe(1);
    });

    it("assigns unmatched session to 'general_inquiry'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("hello")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const general = result.topicClusters.find((c) => c.label === "general_inquiry");
      expect(general).toBeDefined();
      expect(general!.sessionCount).toBe(1);
    });

    it("topicClusters array always has a general_inquiry entry when sessions exist", async () => {
      const rec = makeRecording({ sessionId: "s1", timeline: [userEntry("hello")] });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const general = result.topicClusters.find((c) => c.label === "general_inquiry");
      expect(general).toBeDefined();
    });

    it("cluster.sessionCount is correct for multiple sessions", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("billing issue")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("billing problem")] }),
        makeRecording({ sessionId: "s3", timeline: [userEntry("hello")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // "billing" matches "bill" in "billing"
      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.sessionCount).toBe(2);
    });

    it("cluster.avgHandleTimeMs is computed from durationMs", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 10000, timeline: [userEntry("billing question")] }),
        makeRecording({ sessionId: "s2", durationMs: 20000, timeline: [userEntry("check my bill")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.avgHandleTimeMs).toBe(15000);
    });

    it("cluster.escalationRate is 0 when no sessions have escalations", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("billing question")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 2, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.escalationRate).toBe(0);
    });

    it("cluster.escalationRate is 1 when all sessions escalate", async () => {
      const recs = [
        makeRecording({
          sessionId: "s1",
          timeline: [userEntry("billing complaint")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 0, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          timeline: [userEntry("billing dispute")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 0, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.escalationRate).toBe(1);
    });

    it("cluster.sentimentBreakdown counts dominant sentiments correctly", async () => {
      const recs = [
        makeRecording({
          sessionId: "s1",
          timeline: [userEntry("billing question")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
            sentiment: { dominantSentiment: "positive", averageScore: 0.9, escalationTriggered: false, readingCount: 3 },
          },
        }),
        makeRecording({
          sessionId: "s2",
          timeline: [userEntry("bill charge")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
            sentiment: { dominantSentiment: "frustrated", averageScore: 0.2, escalationTriggered: true, readingCount: 2 },
          },
        }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.sentimentBreakdown["positive"]).toBe(1);
      expect(billing?.sentimentBreakdown["frustrated"]).toBe(1);
    });
  });

  // ── FAQ extraction ────────────────────────────────────────────────────────

  describe("frequentQuestions", () => {
    it("groups identical normalized utterances", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("What is my balance?")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("What is my balance?")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.frequentQuestions.length).toBeGreaterThan(0);
      const faq = result.frequentQuestions[0];
      expect(faq.occurrences).toBe(2);
    });

    it("frequentQuestions sorted by occurrences desc", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("reset password")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("reset password")] }),
        makeRecording({ sessionId: "s3", timeline: [userEntry("reset password")] }),
        makeRecording({ sessionId: "s4", timeline: [userEntry("check balance")] }),
        makeRecording({ sessionId: "s5", timeline: [userEntry("check balance")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.frequentQuestions[0].occurrences).toBeGreaterThanOrEqual(
        result.frequentQuestions[1].occurrences,
      );
    });

    it("unique utterance appearing once has occurrences=1 when totalSessions < 10", async () => {
      const rec = makeRecording({ sessionId: "s1", timeline: [userEntry("unique question abc")] });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("unique"));
      expect(faq?.occurrences).toBe(1);
    });

    it("same utterance in 3 sessions has occurrences=3", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("track my order please")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("track my order please")] }),
        makeRecording({ sessionId: "s3", timeline: [userEntry("track my order please")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("track"));
      expect(faq?.occurrences).toBe(3);
    });
  });

  // ── Resolution paths ──────────────────────────────────────────────────────

  describe("resolutionPaths", () => {
    it("sessions with the same event sequence are grouped together", async () => {
      const makeResolvedRec = (id: string) =>
        makeRecording({
          sessionId: id,
          timeline: [
            userEntry("hello", 0),
            { t_ms: 100, type: "transcript", payload: { text: "hi", isFinal: true } },
            endEntry(200),
          ],
        });

      const recs = [makeResolvedRec("s1"), makeResolvedRec("s2")];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // Both sessions share the same path, so there should be one path with occurrences=2
      expect(result.resolutionPaths.length).toBeGreaterThan(0);
      expect(result.resolutionPaths[0].occurrences).toBe(2);
    });

    it("outcomeLabel is 'escalated' when escalate is in path", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [
          userEntry("I want to speak to a manager", 0),
          policyEntry("escalate", 50),
          endEntry(200),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const path = result.resolutionPaths[0];
      expect(path.outcomeLabel).toBe("escalated");
    });

    it("outcomeLabel is 'resolved' when no escalate or refuse in path", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [
          userEntry("hello", 0),
          policyEntry("allow", 50),
          endEntry(200),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const path = result.resolutionPaths[0];
      expect(path.outcomeLabel).toBe("resolved");
    });
  });

  // ── Handle time by topic ──────────────────────────────────────────────────

  describe("handleTimeByTopic", () => {
    it("avgMs is computed correctly per topic", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 5000, timeline: [userEntry("billing help")] }),
        makeRecording({ sessionId: "s2", durationMs: 7000, timeline: [userEntry("bill payment")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.handleTimeByTopic.find((h) => h.topicLabel === "billing");
      expect(billing?.avgMs).toBe(6000);
    });

    it("sessions with no durationMs are excluded from handle time stats", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: null, timeline: [userEntry("billing question")] }),
        makeRecording({ sessionId: "s2", durationMs: 10000, timeline: [userEntry("billing issue")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.handleTimeByTopic.find((h) => h.topicLabel === "billing");
      expect(billing?.sampleCount).toBe(1);
      expect(billing?.avgMs).toBe(10000);
    });
  });

  // ── Overall stats ─────────────────────────────────────────────────────────

  describe("overallStats", () => {
    it("avgHandleTimeMs is computed across all sessions with duration", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 10000 }),
        makeRecording({ sessionId: "s2", durationMs: 20000 }),
        makeRecording({ sessionId: "s3", durationMs: null }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.overallStats.avgHandleTimeMs).toBe(15000);
    });

    it("p50HandleTimeMs is correct (median of durations)", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 10000 }),
        makeRecording({ sessionId: "s2", durationMs: 20000 }),
        makeRecording({ sessionId: "s3", durationMs: 30000 }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // floor(3 * 0.5) = floor(1.5) = 1 → sorted[1] = 20000
      expect(result.overallStats.p50HandleTimeMs).toBe(20000);
    });

    it("p95HandleTimeMs is correct for sample set", async () => {
      // 20 values: 1000-20000 in steps of 1000
      const recs = Array.from({ length: 20 }, (_, i) =>
        makeRecording({ sessionId: `s${i}`, durationMs: (i + 1) * 1000 }),
      );
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // floor(20 * 0.95) = floor(19) = 19 → sorted[19] = 20000
      expect(result.overallStats.p95HandleTimeMs).toBe(20000);
    });

    it("overallEscalationRate is computed correctly", async () => {
      const recs = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 0, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s3",
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.overallStats.overallEscalationRate).toBeCloseTo(1 / 3);
    });

    it("overallResolutionRate + overallEscalationRate = 1", async () => {
      const recs = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(
        result.overallStats.overallResolutionRate + result.overallStats.overallEscalationRate,
      ).toBeCloseTo(1);
    });
  });

  // ── Filter options ────────────────────────────────────────────────────────

  describe("filter options", () => {
    it("tenantId filter: only sessions for that tenant", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", tenantId: "acme" }),
        makeRecording({ sessionId: "s2", tenantId: "acme" }),
        makeRecording({ sessionId: "s3", tenantId: "other" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ tenantId: "acme" });

      expect(result.sessionCount).toBe(2);
    });

    it("from date filter excludes sessions before that date", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", startedAt: "2026-01-01T10:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-15T10:00:00.000Z" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ from: "2026-03-01T00:00:00.000Z" });

      expect(result.sessionCount).toBe(1);
    });

    it("to date filter excludes sessions after that date", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", startedAt: "2026-01-01T10:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-15T10:00:00.000Z" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ to: "2026-02-01T00:00:00.000Z" });

      expect(result.sessionCount).toBe(1);
    });

    it("maxSessions cap is respected", async () => {
      const recs = Array.from({ length: 10 }, (_, i) =>
        makeRecording({ sessionId: `s${i}` }),
      );
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ maxSessions: 3 });

      expect(result.sessionCount).toBeLessThanOrEqual(3);
    });
  });
});
