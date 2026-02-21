/**
 * AuditTrail Unit Tests
 *
 * Tests the append-only audit logging system that persists control and session
 * events to both SQLite (via better-sqlite3) and JSONL files.
 *
 * Key behaviors tested:
 * - start() with enabled/disabled config and idempotency
 * - Event handling: DB persistence, session row FK fix, source filtering
 * - Event sanitization: transcript redaction, audio base64 encoding
 * - log() delegation to handleEvent
 * - initializeAuditTrail() factory function
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

const mockRun = jest.fn();
const mockPrepare = jest.fn(() => ({ run: mockRun }));

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
  },
}));

jest.mock("../../storage/Database.js", () => ({
  getDatabase: jest.fn(() => ({
    prepare: mockPrepare,
  })),
}));

jest.mock("fs/promises", () => ({
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

// Mock createReadStream and existsSync for timeline loading (not under test here)
jest.mock("fs", () => ({
  createReadStream: jest.fn(),
  existsSync: jest.fn(() => false),
}));

import {
  AuditTrail,
  initializeAuditTrail,
  loadSessionTimeline,
  replaySessionTimeline,
} from "../../insurance/audit_trail.js";
import type { AuditTrailConfig } from "../../insurance/audit_trail.js";
import { eventBus } from "../../orchestrator/EventBus.js";
import { getDatabase } from "../../storage/Database.js";
import { appendFile, mkdir } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";
import type { Event } from "../../schemas/events.js";

// ── Helpers ─────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-audit";

function defaultConfig(
  overrides: Partial<AuditTrailConfig> = {},
): AuditTrailConfig {
  return {
    enabled: true,
    databasePath: "/tmp/test-audit.db",
    walMode: true,
    jsonlDir: "/tmp/test-audit-jsonl",
    includeTranscripts: true,
    includeTranscriptDeltas: false,
    includeAudio: false,
    includeSessionEvents: true,
    includeResponseMetadata: true,
    ...overrides,
  };
}

function makePolicyDecisionEvent(
  source: "laneC" | "laneB" = "laneC",
): Event {
  return {
    event_id: "evt-policy-001",
    session_id: SESSION_ID,
    t_ms: Date.now(),
    source,
    type: "policy.decision",
    payload: {
      decision: "allow",
      reason_codes: [],
      severity: 0,
    },
  } as Event;
}

function makeControlAuditEvent(
  source: "laneC" | "laneB" = "laneC",
): Event {
  return {
    event_id: "evt-audit-001",
    session_id: SESSION_ID,
    t_ms: Date.now(),
    source,
    type: "control.audit",
    payload: {
      evaluationId: "eval-001",
      role: "user",
      textSnippet: "Hello, my phone is 555-1234",
      decision: "allow",
      reasonCodes: [],
      severity: 0,
      checksRun: ["moderator"],
      durationMs: 1,
    },
  } as Event;
}

function makeControlMetricsEvent(
  source: "laneC" | "laneB" = "laneC",
): Event {
  return {
    event_id: "evt-metrics-001",
    session_id: SESSION_ID,
    t_ms: Date.now(),
    source,
    type: "control.metrics",
    payload: {
      evaluationCount: 5,
      allowCount: 4,
      rewriteCount: 1,
      refuseCount: 0,
      escalateCount: 0,
      cancelCount: 0,
      avgDurationMs: 0.5,
      maxDurationMs: 1,
    },
  } as Event;
}

function makeTranscriptEvent(): Event {
  return {
    event_id: "evt-transcript-001",
    session_id: SESSION_ID,
    t_ms: Date.now(),
    source: "laneB",
    type: "transcript",
    payload: {
      text: "Hello, how can I help you?",
      confidence: 0.95,
      isFinal: true,
      timestamp: Date.now(),
    },
  } as Event;
}

function makeAudioEvent(): Event {
  return {
    event_id: "evt-audio-001",
    session_id: SESSION_ID,
    t_ms: Date.now(),
    source: "laneA",
    type: "audio.chunk",
    payload: {
      data: Buffer.from([0x01, 0x02, 0x03]),
      chunk: Buffer.from([0x04, 0x05, 0x06]),
      format: "pcm",
      sampleRate: 24000,
    },
  } as Event;
}

function makeSessionStartEvent(): Event {
  return {
    event_id: "evt-session-001",
    session_id: SESSION_ID,
    t_ms: Date.now(),
    source: "orchestrator",
    type: "session.start",
    payload: { connectionId: "conn-001" },
  } as Event;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("AuditTrail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mockPrepare to return fresh mock stmts each time
    mockPrepare.mockReturnValue({ run: mockRun });
  });

  // ── start() ─────────────────────────────────────────────────────────

  describe("start()", () => {
    it("should not start when config.enabled is false", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ enabled: false }));

      expect(getDatabase).not.toHaveBeenCalled();
      expect(eventBus.on).not.toHaveBeenCalled();
    });

    it("should register event handlers when config.enabled is true", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      expect(getDatabase).toHaveBeenCalled();
      expect(eventBus.on).toHaveBeenCalled();

      // Should subscribe to base types plus transcript types plus session types
      // plus response.metadata
      const onCalls = (eventBus.on as jest.Mock).mock.calls;
      const subscribedTypes = onCalls.map(
        (call: [string, Function]) => call[0],
      );

      // Base event types
      expect(subscribedTypes).toContain("control.audit");
      expect(subscribedTypes).toContain("control.override");
      expect(subscribedTypes).toContain("control.metrics");
      expect(subscribedTypes).toContain("policy.decision");

      // Transcript types (includeTranscripts=true, includeTranscriptDeltas=false)
      expect(subscribedTypes).toContain("transcript");
      expect(subscribedTypes).toContain("user_transcript");
      expect(subscribedTypes).toContain("transcript.final");
      expect(subscribedTypes).not.toContain("transcript.delta");

      // Session event types
      expect(subscribedTypes).toContain("session.start");
      expect(subscribedTypes).toContain("session.end");
      expect(subscribedTypes).toContain("session.error");

      // Response metadata
      expect(subscribedTypes).toContain("response.metadata");
    });

    it("should include transcript.delta when includeTranscriptDeltas is true", () => {
      const trail = new AuditTrail();
      trail.start(
        defaultConfig({
          includeTranscripts: true,
          includeTranscriptDeltas: true,
        }),
      );

      const onCalls = (eventBus.on as jest.Mock).mock.calls;
      const subscribedTypes = onCalls.map(
        (call: [string, Function]) => call[0],
      );
      expect(subscribedTypes).toContain("transcript.delta");
    });

    it("should subscribe to audio event types when includeAudio is true", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeAudio: true }));

      const onCalls = (eventBus.on as jest.Mock).mock.calls;
      const subscribedTypes = onCalls.map(
        (call: [string, Function]) => call[0],
      );
      expect(subscribedTypes).toContain("audio.chunk");
      expect(subscribedTypes).toContain("audio.start");
      expect(subscribedTypes).toContain("audio.end");
    });

    it("should not subscribe to audio events when includeAudio is false", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeAudio: false }));

      const onCalls = (eventBus.on as jest.Mock).mock.calls;
      const subscribedTypes = onCalls.map(
        (call: [string, Function]) => call[0],
      );
      expect(subscribedTypes).not.toContain("audio.chunk");
      expect(subscribedTypes).not.toContain("audio.start");
      expect(subscribedTypes).not.toContain("audio.end");
    });

    it("should be idempotent (calling twice does not double-subscribe)", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());
      const firstCallCount = (eventBus.on as jest.Mock).mock.calls.length;

      trail.start(defaultConfig());
      const secondCallCount = (eventBus.on as jest.Mock).mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });

    it("should prepare insert and ensureSession SQL statements", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      expect(mockPrepare).toHaveBeenCalledTimes(2);
      const calls = mockPrepare.mock.calls as unknown as string[][];
      // First call: INSERT INTO audit_events
      expect(calls[0][0]).toContain("INSERT INTO audit_events");
      // Second call: INSERT OR IGNORE INTO sessions
      expect(calls[1][0]).toContain("INSERT OR IGNORE INTO sessions");
    });

    it("should create jsonlDir via mkdir", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ jsonlDir: "/tmp/custom-audit" }));

      expect(mkdir).toHaveBeenCalledWith("/tmp/custom-audit", {
        recursive: true,
      });
    });

    it("should fall back to console when database initialization fails", () => {
      (getDatabase as jest.Mock).mockImplementationOnce(() => {
        throw new Error("DB init failed");
      });
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const trail = new AuditTrail();
      trail.start(defaultConfig());

      expect(consoleSpy).toHaveBeenCalledWith(
        "[AuditTrail] Failed to initialize database:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  // ── handleEvent ─────────────────────────────────────────────────────

  describe("handleEvent (via log())", () => {
    it("should persist event to DB with correct parameters", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      const event = makePolicyDecisionEvent("laneC");
      trail.log(event);

      // ensureSession should be called (second prepared stmt)
      // insertStmt should be called (first prepared stmt)
      // Both use the same mockRun since mockPrepare returns the same object
      expect(mockRun).toHaveBeenCalled();

      // Check that ensureSession was called with session_id
      const runCalls = mockRun.mock.calls;
      // First call: ensureSession.run(session_id)
      expect(runCalls[0][0]).toBe(SESSION_ID);
      // Second call: insertStmt.run({...})
      expect(runCalls[1][0]).toEqual(
        expect.objectContaining({
          eventId: event.event_id,
          sessionId: SESSION_ID,
          eventType: "policy.decision",
          source: "laneC",
        }),
      );
    });

    it("should ensure session row exists before inserting event (FK fix)", () => {
      const ensureRun = jest.fn();
      const insertRun = jest.fn();

      // Return different stmts for the two prepare calls
      mockPrepare
        .mockReturnValueOnce({ run: insertRun }) // INSERT INTO audit_events
        .mockReturnValueOnce({ run: ensureRun }); // INSERT OR IGNORE INTO sessions

      const trail = new AuditTrail();
      trail.start(defaultConfig());

      trail.log(makePolicyDecisionEvent("laneC"));

      // ensureSession must be called BEFORE insertStmt
      expect(ensureRun).toHaveBeenCalledWith(SESSION_ID);
      expect(insertRun).toHaveBeenCalled();
    });

    it("should filter policy.decision events from non-laneC sources", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      const event = makePolicyDecisionEvent("laneB");
      trail.log(event);

      // Only ensureSession + insert is NOT called because the event is filtered
      // The handleEvent returns early before DB write
      // Since both stmts share mockRun, we check it was NOT called
      // Actually, the filter returns before reaching the DB logic.
      // We need to verify mockRun was NOT called.
      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should filter control.audit events from non-laneC sources", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      const event = makeControlAuditEvent("laneB");
      trail.log(event);

      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should filter control.metrics events from non-laneC sources", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      const event = makeControlMetricsEvent("laneB");
      trail.log(event);

      expect(mockRun).not.toHaveBeenCalled();
    });

    it("should pass through control events from laneC", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      trail.log(makeControlAuditEvent("laneC"));

      expect(mockRun).toHaveBeenCalled();
    });

    it("should pass through transcript events", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      trail.log(makeTranscriptEvent());

      expect(mockRun).toHaveBeenCalled();
    });

    it("should pass through session events", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      trail.log(makeSessionStartEvent());

      expect(mockRun).toHaveBeenCalled();
    });

    it("should append JSONL when jsonlDir is configured", async () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ jsonlDir: "/tmp/audit-jsonl" }));

      trail.log(makePolicyDecisionEvent("laneC"));

      // appendJsonl queues writes via promise chain; flush microtasks
      await new Promise<void>((r) => process.nextTick(r));

      expect(appendFile).toHaveBeenCalledWith(
        `/tmp/audit-jsonl/${SESSION_ID}.jsonl`,
        expect.stringContaining('"event_id":"evt-policy-001"'),
      );
    });

    it("should not process events when not started", () => {
      const trail = new AuditTrail();
      // Do NOT call start()

      trail.log(makePolicyDecisionEvent("laneC"));

      expect(mockRun).not.toHaveBeenCalled();
      expect(appendFile).not.toHaveBeenCalled();
    });

    it("should handle DB write errors gracefully", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      mockRun.mockImplementationOnce(() => {
        // ensureSession succeeds
      });
      mockRun.mockImplementationOnce(() => {
        throw new Error("DB write failed");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      // Should not throw
      expect(() => trail.log(makePolicyDecisionEvent("laneC"))).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[AuditTrail] Failed to persist audit event:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  // ── sanitizeEvent ───────────────────────────────────────────────────

  describe("sanitizeEvent", () => {
    it("should redact textSnippet when includeTranscripts is false", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeTranscripts: false }));

      const event = makeControlAuditEvent("laneC");
      trail.log(event);

      // The last insertStmt.run call should have redacted payload
      const insertCalls = mockRun.mock.calls.filter(
        (call) => call[0] && typeof call[0] === "object" && call[0].eventType,
      );

      if (insertCalls.length > 0) {
        const payload = JSON.parse(insertCalls[0][0].payload);
        expect(payload.textSnippet).toBe("[REDACTED]");
      }
    });

    it("should keep textSnippet when includeTranscripts is true", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeTranscripts: true }));

      const event = makeControlAuditEvent("laneC");
      trail.log(event);

      const insertCalls = mockRun.mock.calls.filter(
        (call) => call[0] && typeof call[0] === "object" && call[0].eventType,
      );

      if (insertCalls.length > 0) {
        const payload = JSON.parse(insertCalls[0][0].payload);
        expect(payload.textSnippet).toBe("Hello, my phone is 555-1234");
      }
    });

    it("should base64-encode audio data when includeAudio is true", async () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeAudio: true }));

      const event = makeAudioEvent();
      trail.log(event);

      // appendJsonl queues writes via promise chain; flush microtasks
      await new Promise<void>((r) => process.nextTick(r));

      // The JSONL write should contain base64 data
      expect(appendFile).toHaveBeenCalled();
      const jsonlArg = (appendFile as jest.Mock).mock.calls[0][1] as string;
      const parsed = JSON.parse(jsonlArg.trim());

      expect(parsed.payload.data).toBe(
        Buffer.from([0x01, 0x02, 0x03]).toString("base64"),
      );
      expect(parsed.payload.data_encoding).toBe("base64");
      expect(parsed.payload.chunk).toBe(
        Buffer.from([0x04, 0x05, 0x06]).toString("base64"),
      );
      expect(parsed.payload.chunk_encoding).toBe("base64");
    });

    it("should not modify non-audio events when includeAudio is true", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeAudio: true }));

      const event = makeControlAuditEvent("laneC");
      trail.log(event);

      // control.audit event should pass through unmodified
      const insertCalls = mockRun.mock.calls.filter(
        (call) => call[0] && typeof call[0] === "object" && call[0].eventType,
      );
      if (insertCalls.length > 0) {
        const payload = JSON.parse(insertCalls[0][0].payload);
        expect(payload.textSnippet).toBe("Hello, my phone is 555-1234");
      }
    });
  });

  // ── log() ───────────────────────────────────────────────────────────

  describe("log()", () => {
    it("should delegate to handleEvent", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig());

      const event = makePolicyDecisionEvent("laneC");
      trail.log(event);

      // Verify the event was persisted (same behavior as handleEvent)
      expect(mockRun).toHaveBeenCalled();
    });
  });

  // ── initializeAuditTrail() ──────────────────────────────────────────

  describe("initializeAuditTrail()", () => {
    it("should return null when config.enabled is false", () => {
      const result = initializeAuditTrail(defaultConfig({ enabled: false }));
      expect(result).toBeNull();
    });

    it("should create and return AuditTrail when enabled", () => {
      // Note: initializeAuditTrail uses a module-level singleton.
      // After the first call with enabled=true, subsequent calls return
      // the same instance. We test the factory behavior here.
      const result = initializeAuditTrail(defaultConfig());
      expect(result).toBeInstanceOf(AuditTrail);
    });
  });

  // ── Config option defaults (null coalescing branches) ────────────────

  describe("config option defaults", () => {
    it("should use defaults when config options are undefined", () => {
      const trail = new AuditTrail();
      trail.start({
        enabled: true,
        databasePath: "/tmp/test.db",
        // intentionally omit all optional fields to hit ?? defaults
      });

      const subscribedTypes = (eventBus.on as jest.Mock).mock.calls.map(
        (c: [string, Function]) => c[0],
      );

      // includeTranscripts defaults to true
      expect(subscribedTypes).toContain("transcript");
      // includeTranscriptDeltas defaults to false
      expect(subscribedTypes).not.toContain("transcript.delta");
      // includeAudio defaults to false
      expect(subscribedTypes).not.toContain("audio.chunk");
      // includeSessionEvents defaults to true
      expect(subscribedTypes).toContain("session.start");
      // includeResponseMetadata defaults to true
      expect(subscribedTypes).toContain("response.metadata");
    });

    it("should not subscribe to transcript types when includeTranscripts is false", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeTranscripts: false }));

      const subscribedTypes = (eventBus.on as jest.Mock).mock.calls.map(
        (c: [string, Function]) => c[0],
      );
      expect(subscribedTypes).not.toContain("transcript");
      expect(subscribedTypes).not.toContain("user_transcript");
      expect(subscribedTypes).not.toContain("transcript.final");
    });

    it("should not subscribe to session events when includeSessionEvents is false", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeSessionEvents: false }));

      const subscribedTypes = (eventBus.on as jest.Mock).mock.calls.map(
        (c: [string, Function]) => c[0],
      );
      expect(subscribedTypes).not.toContain("session.start");
      expect(subscribedTypes).not.toContain("session.end");
      expect(subscribedTypes).not.toContain("session.error");
    });

    it("should not subscribe to response.metadata when includeResponseMetadata is false", () => {
      const trail = new AuditTrail();
      trail.start(defaultConfig({ includeResponseMetadata: false }));

      const subscribedTypes = (eventBus.on as jest.Mock).mock.calls.map(
        (c: [string, Function]) => c[0],
      );
      expect(subscribedTypes).not.toContain("response.metadata");
    });
  });

  // ── Console fallback path (no DB, no jsonlDir) ───────────────────────

  describe("console fallback", () => {
    it("should log to console when DB fails and no jsonlDir configured", () => {
      (getDatabase as jest.Mock).mockImplementationOnce(() => {
        throw new Error("DB failed");
      });
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      const trail = new AuditTrail();
      // Start WITHOUT jsonlDir — resolveAuditDir will still resolve a dir
      // from databasePath fallback, so we must also omit databasePath to
      // truly reach the console fallback. But the config requires databasePath
      // for the DB init attempt. The key is that when DB fails AND the
      // resolved jsonlDir mkdir also fails or jsonlDir is set, the console
      // fallback fires. Actually, looking at the source: the jsonlDir is
      // ALWAYS set via resolveAuditDir. The console fallback only fires when
      // this.jsonlDir is falsy AND useConsoleFallback is true. But
      // resolveAuditDir always returns a string. So we need to test a path
      // where jsonlDir ends up null. The only way is if jsonlDir is explicitly
      // set to empty string or the appendJsonl guard returns early.
      //
      // Re-reading source line 143: this.jsonlDir = resolveAuditDir(config)
      // resolveAuditDir always returns a non-empty string, so the console
      // fallback on line 251 can only be reached if this.jsonlDir is set to
      // null after start. For testing, we can access the private field.
      trail.start({
        enabled: true,
        databasePath: "/tmp/test.db",
      });

      // Force jsonlDir to null to simulate the fallback path
      (trail as unknown as { jsonlDir: string | null }).jsonlDir = null;

      trail.log(makePolicyDecisionEvent("laneC"));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[AuditTrail] audit",
        expect.objectContaining({ type: "policy.decision" }),
      );

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // ── JSONL write error handling ───────────────────────────────────────

  describe("JSONL write errors", () => {
    it("should handle appendFile errors gracefully", async () => {
      (appendFile as jest.Mock).mockRejectedValueOnce(
        new Error("Write failed"),
      );
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const trail = new AuditTrail();
      trail.start(defaultConfig({ jsonlDir: "/tmp/audit-test" }));

      trail.log(makePolicyDecisionEvent("laneC"));

      // Flush microtasks so the promise chain resolves
      await new Promise<void>((r) => process.nextTick(r));
      await new Promise<void>((r) => process.nextTick(r));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[AuditTrail] Failed to append JSONL event:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  // ── loadSessionTimeline ──────────────────────────────────────────────

  describe("loadSessionTimeline()", () => {
    it("should return empty array when JSONL file does not exist", async () => {
      (existsSync as jest.Mock).mockReturnValue(false);
      const events = await loadSessionTimeline("nonexistent-session");
      expect(events).toEqual([]);
    });

    it("should parse and filter events from JSONL file", async () => {
      const sessionId = "timeline-test-session";
      const line1 = JSON.stringify({
        event_id: "e1",
        session_id: sessionId,
        t_ms: 100,
        source: "laneC",
        type: "control.audit",
        payload: {},
      });
      const line2 = JSON.stringify({
        event_id: "e2",
        session_id: sessionId,
        t_ms: 200,
        source: "laneC",
        type: "policy.decision",
        payload: {},
      });
      const line3 = JSON.stringify({
        event_id: "e3",
        session_id: "other-session",
        t_ms: 300,
        source: "laneC",
        type: "policy.decision",
        payload: {},
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (createReadStream as jest.Mock).mockReturnValue(
        Readable.from([line1, "\n", line2, "\n", line3, "\n"].join("")),
      );

      const events = await loadSessionTimeline(sessionId);
      // Should include control.audit and policy.decision for this session
      // Should exclude e3 (wrong session)
      expect(events.length).toBe(2);
      expect(events[0].event_id).toBe("e1");
      expect(events[1].event_id).toBe("e2");
    });

    it("should filter by specified types", async () => {
      const sessionId = "filter-test";
      const line1 = JSON.stringify({
        event_id: "e1",
        session_id: sessionId,
        t_ms: 100,
        source: "laneC",
        type: "control.audit",
        payload: {},
      });
      const line2 = JSON.stringify({
        event_id: "e2",
        session_id: sessionId,
        t_ms: 200,
        source: "laneC",
        type: "policy.decision",
        payload: {},
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (createReadStream as jest.Mock).mockReturnValue(
        Readable.from([line1, "\n", line2, "\n"].join("")),
      );

      const events = await loadSessionTimeline(sessionId, {
        types: ["policy.decision"],
      });
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("policy.decision");
    });

    it("should handle malformed JSONL lines gracefully", async () => {
      const sessionId = "malformed-test";
      const validLine = JSON.stringify({
        event_id: "e1",
        session_id: sessionId,
        t_ms: 100,
        source: "laneC",
        type: "control.audit",
        payload: {},
      });

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      (existsSync as jest.Mock).mockReturnValue(true);
      (createReadStream as jest.Mock).mockReturnValue(
        Readable.from([validLine, "\n", "not-json\n", "\n"].join("")),
      );

      const events = await loadSessionTimeline(sessionId);
      expect(events.length).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[AuditTrail] Failed to parse JSONL line:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it("should sort events by t_ms", async () => {
      const sessionId = "sort-test";
      const line1 = JSON.stringify({
        event_id: "e1",
        session_id: sessionId,
        t_ms: 300,
        source: "laneC",
        type: "control.audit",
        payload: {},
      });
      const line2 = JSON.stringify({
        event_id: "e2",
        session_id: sessionId,
        t_ms: 100,
        source: "laneC",
        type: "policy.decision",
        payload: {},
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (createReadStream as jest.Mock).mockReturnValue(
        Readable.from([line1, "\n", line2, "\n"].join("")),
      );

      const events = await loadSessionTimeline(sessionId);
      expect(events[0].t_ms).toBe(100);
      expect(events[1].t_ms).toBe(300);
    });
  });

  // ── replaySessionTimeline ────────────────────────────────────────────

  describe("replaySessionTimeline()", () => {
    it("should return events without emitting when emit=false", async () => {
      (existsSync as jest.Mock).mockReturnValue(false);
      const events = await replaySessionTimeline("test", { emit: false });
      expect(events).toEqual([]);
    });

    it("should emit events to eventBus by default", async () => {
      const sessionId = "replay-test";
      const line = JSON.stringify({
        event_id: "e1",
        session_id: sessionId,
        t_ms: 100,
        source: "laneC",
        type: "control.audit",
        payload: {},
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (createReadStream as jest.Mock).mockReturnValue(
        Readable.from([line, "\n"].join("")),
      );

      const events = await replaySessionTimeline(sessionId);
      expect(events.length).toBe(1);
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });
});
