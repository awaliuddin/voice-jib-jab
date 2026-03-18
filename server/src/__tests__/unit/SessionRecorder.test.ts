/**
 * SessionRecorder + Sessions Router Unit Tests
 *
 * Tests the session recording service that captures events in memory during
 * a session and flushes to disk on end, plus the HTTP API router for listing,
 * viewing, and replaying recordings.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { Event } from "../../schemas/events.js";

// ── Mock EventBus ────────────────────────────────────────────────────────

const sessionHandlerMap = new Map<string, Array<(event: Event) => void>>();

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn((sessionId: string, handler: (event: Event) => void) => {
      if (!sessionHandlerMap.has(sessionId)) {
        sessionHandlerMap.set(sessionId, []);
      }
      sessionHandlerMap.get(sessionId)!.push(handler);
    }),
    offSession: jest.fn((sessionId: string) => {
      sessionHandlerMap.delete(sessionId);
    }),
  },
}));

// ── Mock audit_trail for the router ──────────────────────────────────────

const mockLoadSessionTimeline = jest.fn();

jest.mock("../../insurance/audit_trail.js", () => ({
  loadSessionTimeline: (...args: unknown[]) => mockLoadSessionTimeline(...args),
}));

import { SessionRecorder, type SessionRecording } from "../../services/SessionRecorder.js";
import { eventBus } from "../../orchestrator/EventBus.js";

// ── Helper: emit event to the session handler ────────────────────────────

function emitToSession(sessionId: string, event: Event): void {
  const handlers = sessionHandlerMap.get(sessionId) ?? [];
  for (const handler of handlers) {
    handler(event);
  }
}

function makeEvent(overrides: Record<string, unknown> & { session_id: string; type: string }): Event {
  return {
    event_id: randomUUID(),
    t_ms: Date.now(),
    source: "orchestrator",
    payload: {},
    ...overrides,
  } as unknown as Event;
}

// ── Test setup ───────────────────────────────────────────────────────────

let testDir: string;
let recorder: SessionRecorder;

beforeEach(() => {
  jest.clearAllMocks();
  sessionHandlerMap.clear();
  testDir = join(tmpdir(), `session-recorder-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  recorder = new SessionRecorder({ recordingsDir: testDir, retentionDays: 7 });
});

afterEach(() => {
  // Clean up test directory
  try {
    const files = readdirSync(testDir);
    for (const f of files) {
      unlinkSync(join(testDir, f));
    }
  } catch {
    // directory may not exist
  }
});

// ── SessionRecorder tests ────────────────────────────────────────────────

describe("SessionRecorder", () => {
  describe("constructor and config", () => {
    it("exposes recordingsDir from config", () => {
      expect(recorder.recordingsDir).toBe(testDir);
    });
  });

  describe("startRecording()", () => {
    it("creates an in-memory buffer and subscribes to events", () => {
      recorder.startRecording("sess-1", "tenant-A");
      expect(eventBus.onSession).toHaveBeenCalledWith("sess-1", expect.any(Function));
    });

    it("is idempotent — calling twice for the same sessionId is a no-op", () => {
      recorder.startRecording("sess-1");
      recorder.startRecording("sess-1");
      // onSession should only be called once
      expect(eventBus.onSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("event capture", () => {
    const sessionId = "sess-capture";
    const baseTime = 1700000000000;

    beforeEach(() => {
      // Use a fixed start time
      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      recorder.startRecording(sessionId, "tenant-B");
      (Date.now as jest.Mock).mockReturnValue(baseTime + 100);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("captures policy.decision entry in recording", async () => {
      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "policy.decision",
        source: "laneC",
        t_ms: baseTime + 50,
        payload: { decision: "allow", reason_codes: ["ok"], severity: 0 },
      }));

      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      expect(recording).not.toBeNull();
      const policyEntries = recording!.timeline.filter((e) => e.type === "policy.decision");
      expect(policyEntries).toHaveLength(1);
      expect(policyEntries[0].payload).toMatchObject({ decision: "allow" });
    });

    it("increments turnCount on user_transcript with isFinal=true", async () => {
      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "user_transcript",
        source: "client",
        t_ms: baseTime + 10,
        payload: { text: "hello", confidence: 0.95, isFinal: true, timestamp: baseTime + 10 },
      }));

      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "user_transcript",
        source: "client",
        t_ms: baseTime + 20,
        payload: { text: "interim", confidence: 0.5, isFinal: false, timestamp: baseTime + 20 },
      }));

      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      expect(recording!.summary.turnCount).toBe(1);
    });

    it("counts audio.chunk in summary but excludes from timeline when storeRawAudio=false", async () => {
      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "audio.chunk",
        source: "client",
        t_ms: baseTime + 5,
        payload: { size: 1024 },
      }));

      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "audio.chunk",
        source: "laneB",
        t_ms: baseTime + 6,
        payload: { size: 2048 },
      }));

      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      expect(recording!.summary.audioInputChunks).toBe(1);
      expect(recording!.summary.audioOutputChunks).toBe(1);
      // No audio.chunk entries in timeline
      expect(recording!.timeline.filter((e) => e.type === "audio.chunk")).toHaveLength(0);
    });

    it("includes audio.chunk in timeline when storeRawAudio=true", async () => {
      const rawRecorder = new SessionRecorder({
        recordingsDir: testDir,
        storeRawAudio: true,
      });

      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      rawRecorder.startRecording("sess-raw");
      (Date.now as jest.Mock).mockReturnValue(baseTime + 100);

      emitToSession("sess-raw", makeEvent({
        session_id: "sess-raw",
        type: "audio.chunk",
        source: "client",
        t_ms: baseTime + 5,
        payload: { size: 1024 },
      }));

      await rawRecorder.stopRecording("sess-raw");
      const recording = rawRecorder.loadRecording("sess-raw");
      expect(recording!.timeline.filter((e) => e.type === "audio.chunk")).toHaveLength(1);
    });

    it("accumulates policyDecisions counts correctly", async () => {
      const decisions = ["allow", "allow", "refuse", "escalate"];
      for (const decision of decisions) {
        emitToSession(sessionId, makeEvent({
          session_id: sessionId,
          type: "policy.decision",
          source: "laneC",
          t_ms: baseTime + 10,
          payload: { decision, reason_codes: [], severity: 0 },
        }));
      }

      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      expect(recording!.summary.policyDecisions.allow).toBe(2);
      expect(recording!.summary.policyDecisions.refuse).toBe(1);
      expect(recording!.summary.policyDecisions.escalate).toBe(1);
    });

    it("computes durationMs from endedAt - startedAt", async () => {
      (Date.now as jest.Mock).mockReturnValue(baseTime + 5000);
      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      expect(recording!.durationMs).toBeGreaterThanOrEqual(5000);
    });

    it("captures control.audit events", async () => {
      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "control.audit",
        source: "laneC",
        t_ms: baseTime + 30,
        payload: { evaluationId: "eval-1", decision: "allow" },
      }));

      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      const auditEntries = recording!.timeline.filter((e) => e.type === "control.audit");
      expect(auditEntries).toHaveLength(1);
    });

    it("captures control.override events", async () => {
      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "control.override",
        source: "laneC",
        t_ms: baseTime + 40,
        payload: { evaluationId: "eval-2", originalDecision: "allow", effectiveDecision: "refuse" },
      }));

      await recorder.stopRecording(sessionId);
      const recording = recorder.loadRecording(sessionId);
      const overrideEntries = recording!.timeline.filter((e) => e.type === "control.override");
      expect(overrideEntries).toHaveLength(1);
    });

    it("auto-flushes on session.end event", () => {
      emitToSession(sessionId, makeEvent({
        session_id: sessionId,
        type: "session.end",
        source: "orchestrator",
        t_ms: baseTime + 100,
        payload: { reason: "user_ended" },
      }));

      // File should exist after auto-flush
      const recording = recorder.loadRecording(sessionId);
      expect(recording).not.toBeNull();
      expect(recording!.sessionId).toBe(sessionId);
    });
  });

  describe("stopRecording()", () => {
    it("writes file to disk and cleans up in-memory buffer", async () => {
      recorder.startRecording("sess-stop");
      await recorder.stopRecording("sess-stop");

      const filePath = join(testDir, "sess-stop.json");
      expect(existsSync(filePath)).toBe(true);

      const data = JSON.parse(readFileSync(filePath, "utf-8")) as SessionRecording;
      expect(data.sessionId).toBe("sess-stop");
    });

    it("is safe to call on unknown sessionId (no-op)", async () => {
      await expect(recorder.stopRecording("nonexistent")).resolves.toBeUndefined();
    });

    it("unsubscribes from eventBus", async () => {
      recorder.startRecording("sess-unsub");
      await recorder.stopRecording("sess-unsub");
      expect(eventBus.offSession).toHaveBeenCalledWith("sess-unsub");
    });
  });

  describe("loadRecording()", () => {
    it("returns parsed recording for existing file", async () => {
      recorder.startRecording("sess-load");
      await recorder.stopRecording("sess-load");

      const recording = recorder.loadRecording("sess-load");
      expect(recording).not.toBeNull();
      expect(recording!.sessionId).toBe("sess-load");
    });

    it("returns null for missing file", () => {
      expect(recorder.loadRecording("nonexistent")).toBeNull();
    });

    it("returns timeline sorted by t_ms", async () => {
      const baseTime = 1700000000000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);
      recorder.startRecording("sess-sort");

      // Emit events out of order
      emitToSession("sess-sort", makeEvent({
        session_id: "sess-sort",
        type: "control.audit",
        source: "laneC",
        t_ms: baseTime + 200,
        payload: { evaluationId: "b" },
      }));

      emitToSession("sess-sort", makeEvent({
        session_id: "sess-sort",
        type: "control.audit",
        source: "laneC",
        t_ms: baseTime + 50,
        payload: { evaluationId: "a" },
      }));

      (Date.now as jest.Mock).mockReturnValue(baseTime + 300);
      await recorder.stopRecording("sess-sort");
      jest.restoreAllMocks();

      const recording = recorder.loadRecording("sess-sort");
      expect(recording!.timeline.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < recording!.timeline.length; i++) {
        expect(recording!.timeline[i].t_ms).toBeGreaterThanOrEqual(recording!.timeline[i - 1].t_ms);
      }
    });
  });

  describe("listRecordings()", () => {
    it("returns array without timeline field", async () => {
      recorder.startRecording("sess-list-1");
      await recorder.stopRecording("sess-list-1");

      const list = recorder.listRecordings();
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe("sess-list-1");
      expect((list[0] as any).timeline).toBeUndefined();
    });

    it("sorted by startedAt descending", async () => {
      const base = 1700000000000;

      jest.spyOn(Date, "now").mockReturnValue(base);
      recorder.startRecording("sess-old");
      (Date.now as jest.Mock).mockReturnValue(base + 100);
      await recorder.stopRecording("sess-old");

      (Date.now as jest.Mock).mockReturnValue(base + 5000);
      recorder.startRecording("sess-new");
      (Date.now as jest.Mock).mockReturnValue(base + 5100);
      await recorder.stopRecording("sess-new");

      jest.restoreAllMocks();

      const list = recorder.listRecordings();
      expect(list).toHaveLength(2);
      expect(list[0].sessionId).toBe("sess-new");
      expect(list[1].sessionId).toBe("sess-old");
    });

    it("returns empty array when directory does not exist", () => {
      const noDir = new SessionRecorder({ recordingsDir: "/tmp/nonexistent-" + randomUUID() });
      expect(noDir.listRecordings()).toEqual([]);
    });
  });

  describe("pruneOldRecordings()", () => {
    it("deletes files older than retentionDays and keeps newer ones", async () => {
      // Write a recording with a very old startedAt
      const oldRecording: SessionRecording = {
        sessionId: "sess-ancient",
        startedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 1000).toISOString(),
        durationMs: 1000,
        tenantId: null,
        timeline: [],
        summary: { turnCount: 0, policyDecisions: {}, audioInputChunks: 0, audioOutputChunks: 0 },
      };
      writeFileSync(join(testDir, "sess-ancient.json"), JSON.stringify(oldRecording));

      // Write a recent recording
      recorder.startRecording("sess-recent");
      await recorder.stopRecording("sess-recent");

      const deleted = recorder.pruneOldRecordings();
      expect(deleted).toBe(1);
      expect(existsSync(join(testDir, "sess-ancient.json"))).toBe(false);
      expect(existsSync(join(testDir, "sess-recent.json"))).toBe(true);
    });

    it("returns count of deleted files", () => {
      // No old files — should return 0
      const deleted = recorder.pruneOldRecordings();
      expect(deleted).toBe(0);
    });
  });

  describe("tenantId", () => {
    it("stores tenantId in the recording", async () => {
      recorder.startRecording("sess-tenant", "tenant-X");
      await recorder.stopRecording("sess-tenant");
      const recording = recorder.loadRecording("sess-tenant");
      expect(recording!.tenantId).toBe("tenant-X");
    });

    it("defaults to null when no tenantId provided", async () => {
      recorder.startRecording("sess-no-tenant");
      await recorder.stopRecording("sess-no-tenant");
      const recording = recorder.loadRecording("sess-no-tenant");
      expect(recording!.tenantId).toBeNull();
    });
  });
});

// ── Sessions Router tests ────────────────────────────────────────────────

describe("Sessions Router", () => {
  // Use a lightweight approach — call the route handlers directly via supertest-like mocking
  let mockReq: any;
  let mockRes: any;
  let routerHandlers: Map<string, Function>;

  beforeEach(async () => {
    // Import the router factory
    const { createSessionsRouter } = await import("../../api/sessions.js");
    const router = createSessionsRouter(recorder);

    // Extract registered route handlers
    routerHandlers = new Map();
    for (const layer of (router as any).stack) {
      if (layer.route) {
        const method = Object.keys(layer.route.methods)[0];
        const path = layer.route.path;
        const handler = layer.route.stack[0].handle;
        routerHandlers.set(`${method}:${path}`, handler);
      }
    }

    mockRes = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };
  });

  it("GET /sessions returns 200 with array", () => {
    mockReq = {};
    const handler = routerHandlers.get("get:/");
    handler!(mockReq, mockRes);
    expect(mockRes.json).toHaveBeenCalledWith(expect.any(Array));
  });

  it("GET /sessions/:id returns 404 for unknown session", () => {
    mockReq = { params: { id: "unknown-session" } };
    const handler = routerHandlers.get("get:/:id");
    handler!(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Recording not found" });
  });

  it("GET /sessions/:id returns 200 for known recording", async () => {
    recorder.startRecording("sess-api");
    await recorder.stopRecording("sess-api");

    mockReq = { params: { id: "sess-api" } };
    const handler = routerHandlers.get("get:/:id");
    handler!(mockReq, mockRes);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-api" }),
    );
  });

  it("GET /sessions/:id/replay returns 200 for known session", async () => {
    mockLoadSessionTimeline.mockResolvedValue([
      {
        event_id: "e1",
        session_id: "sess-replay",
        t_ms: 1000,
        source: "laneC",
        type: "policy.decision",
        payload: { decision: "allow" },
      },
    ]);

    mockReq = { params: { id: "sess-replay" } };
    const handler = routerHandlers.get("get:/:id/replay");
    await handler!(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-replay",
        timeline: expect.any(Array),
        summary: expect.objectContaining({
          eventCount: 1,
          policyDecisions: { allow: 1 },
        }),
      }),
    );
  });

  it("GET /sessions/:id/replay returns 404 for unknown session", async () => {
    mockLoadSessionTimeline.mockResolvedValue([]);

    mockReq = { params: { id: "sess-unknown" } };
    const handler = routerHandlers.get("get:/:id/replay");
    await handler!(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "No audit trail found for session" });
  });
});
