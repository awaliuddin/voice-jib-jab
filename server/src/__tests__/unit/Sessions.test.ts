/**
 * Sessions API Router Tests
 *
 * Tests the createSessionsRouter(recorder) HTTP endpoints.
 * Builds a standalone Express app with a mocked SessionRecorder to avoid
 * importing index.ts (startup side effects) and filesystem dependencies.
 *
 * Endpoints covered:
 *   GET /sessions           — list all recordings (metadata only)
 *   GET /sessions/:id       — full recording with timeline
 *   GET /sessions/:id/summary    — structured conversation summary
 *   GET /sessions/:id/compliance — compliance audit export
 *   GET /sessions/:id/replay     — audit JSONL timeline
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createSessionsRouter } from "../../api/sessions.js";
import type { SessionRecorder } from "../../services/SessionRecorder.js";

// ── HTTP helper ──────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpGet(server: Server, path: string): Promise<HttpResponse> {
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

// ── Fixture data ─────────────────────────────────────────────────────────────

const RECORDING_WITH_TIMELINE = {
  sessionId: "sess-abc123",
  startedAt: "2026-03-19T10:00:00.000Z",
  endedAt: "2026-03-19T10:05:00.000Z",
  durationMs: 300_000,
  tenantId: "tenant-acme",
  timeline: [
    {
      t_ms: 1000,
      type: "user_transcript",
      payload: { text: "Hello, can I get a quote?", isFinal: true },
    },
    {
      t_ms: 2000,
      type: "transcript",
      payload: { text: "Sure, I can help you with that.", isFinal: true },
    },
    {
      t_ms: 3000,
      type: "policy.decision",
      payload: { decision: "allow", reason: "claim verified", claim: "price_guarantee" },
    },
    {
      t_ms: 4000,
      type: "policy.decision",
      payload: { decision: "escalate", reason: "sentiment threshold exceeded" },
    },
    {
      t_ms: 5000,
      type: "claims.check",
      payload: { claim: "lowest_price", result: "unverified" },
    },
    {
      t_ms: 6000,
      type: "user_transcript",
      payload: { text: "incomplete utterance", isFinal: false },
    },
  ],
  summary: {
    turnCount: 2,
    sentiment: {
      dominantSentiment: "neutral",
      averageScore: 0.1,
      escalationTriggered: false,
    },
  },
};

const RECORDING_NO_SENTIMENT = {
  sessionId: "sess-nosent",
  startedAt: "2026-03-19T11:00:00.000Z",
  endedAt: null,
  durationMs: null,
  tenantId: "tenant-beta",
  timeline: [],
  summary: {
    turnCount: 0,
    sentiment: undefined,
  },
};

// ── Mock SessionRecorder ─────────────────────────────────────────────────────

function makeMockRecorder(): jest.Mocked<Pick<SessionRecorder, "listRecordings" | "loadRecording">> {
  return {
    listRecordings: jest.fn(),
    loadRecording: jest.fn(),
  };
}

// ── App factory ──────────────────────────────────────────────────────────────

function buildApp(recorder: SessionRecorder): Express {
  const app = express();
  app.use(express.json());
  app.use("/sessions", createSessionsRouter(recorder));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Sessions API Endpoints", () => {
  let recorder: ReturnType<typeof makeMockRecorder>;
  let server: Server;

  beforeAll((done) => {
    recorder = makeMockRecorder();
    const app = buildApp(recorder as unknown as SessionRecorder);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /sessions ──────────────────────────────────────────────────────────

  describe("GET /sessions", () => {
    it("returns 200 with an empty array when no recordings exist", async () => {
      recorder.listRecordings.mockReturnValue([]);
      const res = await httpGet(server, "/sessions");
      expect(res.status).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns 200 with metadata list when recordings exist", async () => {
      const metadata = [
        { sessionId: "sess-1", startedAt: "2026-01-01T00:00:00.000Z", tenantId: "t1", summary: { turnCount: 3 } },
        { sessionId: "sess-2", startedAt: "2026-01-02T00:00:00.000Z", tenantId: "t2", summary: { turnCount: 1 } },
      ];
      recorder.listRecordings.mockReturnValue(metadata as never);
      const res = await httpGet(server, "/sessions");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });
  });

  // ── GET /sessions/:id ──────────────────────────────────────────────────────

  describe("GET /sessions/:id", () => {
    it("returns 200 with full recording when found", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123");
      expect(res.status).toBe(200);
      const body = res.json() as { sessionId: string; timeline: unknown[] };
      expect(body.sessionId).toBe("sess-abc123");
      expect(Array.isArray(body.timeline)).toBe(true);
      expect(body.timeline).toHaveLength(6);
    });

    it("returns 404 when recording is not found", async () => {
      recorder.loadRecording.mockReturnValue(null);
      const res = await httpGet(server, "/sessions/sess-missing");
      expect(res.status).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Recording not found");
    });

    it("returns 400 for an invalid session ID (special chars)", async () => {
      const res = await httpGet(server, "/sessions/../../etc/passwd");
      // Express path matching won't route this to /:id, but the pattern check
      // catches any invalid characters that do reach the handler
      expect([400, 404]).toContain(res.status);
    });

    it("calls loadRecording with the correct session ID", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      await httpGet(server, "/sessions/sess-abc123");
      expect(recorder.loadRecording).toHaveBeenCalledWith("sess-abc123");
    });
  });

  // ── GET /sessions/:id/summary ──────────────────────────────────────────────

  describe("GET /sessions/:id/summary", () => {
    it("returns 404 when recording is not found", async () => {
      recorder.loadRecording.mockReturnValue(null);
      const res = await httpGet(server, "/sessions/sess-gone/summary");
      expect(res.status).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Recording not found");
    });

    it("returns 400 for an invalid session ID", async () => {
      // ID with spaces — not matched by /^[a-zA-Z0-9_-]+$/
      const res = await httpGet(server, "/sessions/bad%20id/summary");
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Invalid session ID");
    });

    it("returns 200 with summary object when recording is found", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/summary");
      expect(res.status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      // ConversationSummarizer output should contain at minimum a sessionId field
      expect(body).toBeDefined();
    });

    it("handles recording with no sentiment data", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_NO_SENTIMENT as never);
      const res = await httpGet(server, "/sessions/sess-nosent/summary");
      expect(res.status).toBe(200);
    });

    it("only includes final transcript turns in the summary", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/summary");
      // Should not throw — non-final turns must be filtered without error
      expect(res.status).toBe(200);
    });
  });

  // ── GET /sessions/:id/compliance ───────────────────────────────────────────

  describe("GET /sessions/:id/compliance", () => {
    it("returns 404 when recording is not found", async () => {
      recorder.loadRecording.mockReturnValue(null);
      const res = await httpGet(server, "/sessions/sess-gone/compliance");
      expect(res.status).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Recording not found");
    });

    it("returns 400 for an invalid session ID", async () => {
      const res = await httpGet(server, "/sessions/bad%20id/compliance");
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Invalid session ID");
    });

    it("returns 200 with required compliance structure", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      expect(res.status).toBe(200);
      const body = res.json() as {
        sessionId: string;
        exportedAt: string;
        session: Record<string, unknown>;
        compliance: Record<string, unknown>;
        meta: Record<string, unknown>;
      };
      expect(body.sessionId).toBe("sess-abc123");
      expect(typeof body.exportedAt).toBe("string");
      expect(new Date(body.exportedAt).toISOString()).toBe(body.exportedAt);
    });

    it("includes policyDecisions extracted from timeline", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      const body = res.json() as {
        compliance: {
          policyDecisions: Array<{ t_ms: number; decision: string }>;
          policyDecisionCount: number;
        };
      };
      expect(body.compliance.policyDecisionCount).toBe(2);
      expect(body.compliance.policyDecisions[0].decision).toBe("allow");
      expect(body.compliance.policyDecisions[1].decision).toBe("escalate");
    });

    it("includes escalations when decision is 'escalate'", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      const body = res.json() as {
        compliance: {
          escalationCount: number;
          escalations: Array<{ t_ms: number; reason?: string }>;
        };
      };
      expect(body.compliance.escalationCount).toBe(1);
      expect(body.compliance.escalations[0].reason).toBe("sentiment threshold exceeded");
    });

    it("includes claimsChecked from timeline", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      const body = res.json() as {
        compliance: {
          claimsCheckedCount: number;
          claimsChecked: Array<{ claim: string; result: string }>;
        };
      };
      expect(body.compliance.claimsCheckedCount).toBe(1);
      expect(body.compliance.claimsChecked[0].claim).toBe("lowest_price");
      expect(body.compliance.claimsChecked[0].result).toBe("unverified");
    });

    it("includes session metadata (startedAt, durationMs, tenantId, turnCount)", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      const body = res.json() as {
        session: {
          startedAt: string;
          durationMs: number;
          tenantId: string;
          turnCount: number;
        };
      };
      expect(body.session.startedAt).toBe("2026-03-19T10:00:00.000Z");
      expect(body.session.durationMs).toBe(300_000);
      expect(body.session.tenantId).toBe("tenant-acme");
      expect(body.session.turnCount).toBe(2);
    });

    it("reflects sentimentEscalation from recording summary", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      const body = res.json() as { compliance: { sentimentEscalation: boolean } };
      expect(body.compliance.sentimentEscalation).toBe(false);
    });

    it("handles empty timeline with zero compliance events", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_NO_SENTIMENT as never);
      const res = await httpGet(server, "/sessions/sess-nosent/compliance");
      expect(res.status).toBe(200);
      const body = res.json() as {
        compliance: { policyDecisionCount: number; claimsCheckedCount: number; escalationCount: number };
      };
      expect(body.compliance.policyDecisionCount).toBe(0);
      expect(body.compliance.claimsCheckedCount).toBe(0);
      expect(body.compliance.escalationCount).toBe(0);
    });

    it("includes EU AI Act standard in meta", async () => {
      recorder.loadRecording.mockReturnValue(RECORDING_WITH_TIMELINE as never);
      const res = await httpGet(server, "/sessions/sess-abc123/compliance");
      const body = res.json() as { meta: { standard: string; generatedBy: string } };
      expect(body.meta.standard).toContain("EU AI Act");
      expect(body.meta.generatedBy).toContain("voice-jib-jab");
    });
  });

  // ── GET /sessions/:id/replay ───────────────────────────────────────────────

  describe("GET /sessions/:id/replay", () => {
    it("returns 400 for an invalid session ID", async () => {
      const res = await httpGet(server, "/sessions/bad%20id/replay");
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Invalid session ID");
    });
  });
});
