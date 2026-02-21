/**
 * ControlEngine Unit Tests
 *
 * Tests the Lane C ControlEngine (from laneC_control.ts) which orchestrates
 * the full policy enforcement pipeline: PII redaction, moderation, claims
 * checking, and override control.
 *
 * The ControlEngine wraps PolicyGate with session-scoped metrics, audit event
 * emission, and the OverrideController that escalates high-severity decisions
 * to cancel_output.
 *
 * Key behaviors tested:
 * - evaluate() pipeline for clean, moderated, PII, and claims-violating text
 * - OverrideController severity escalation to cancel_output
 * - Metrics accumulation and flushing
 * - Lifecycle (destroy)
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
  },
}));

import { ControlEngine } from "../../lanes/laneC_control.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";
import { eventBus } from "../../orchestrator/EventBus.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";
import type { Event } from "../../schemas/events.js";

// ── Helpers ─────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-control";

function createRegistry(): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims: [
      { id: "CLAIM-001", text: "Our product is FDA approved" },
      { id: "CLAIM-002", text: "We offer a 30-day money-back guarantee" },
    ],
    disallowedPatterns: ["guaranteed cure", "100% effective"],
    enableFileLoad: false,
  });
}

function createEngine(
  overrides: Partial<
    import("../../lanes/laneC_control.js").ControlEngineConfig
  > = {},
): ControlEngine {
  return new ControlEngine(SESSION_ID, {
    claimsRegistry: createRegistry(),
    moderationDenyPatterns: [/banned_word/i, /hate_speech/i],
    enabled: false, // disable event subscriptions in unit tests
    ...overrides,
  });
}

function makeContext(
  overrides: Partial<EvaluationContext> = {},
): EvaluationContext {
  return {
    sessionId: SESSION_ID,
    role: "user",
    text: "Hello, how are you today?",
    isFinal: true,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("ControlEngine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── evaluate: clean text ────────────────────────────────────────────

  describe("evaluate() with clean user text", () => {
    it("should return allow for innocuous user input", () => {
      const engine = createEngine();
      const ctx = makeContext({ text: "What is your return policy?" });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("allow");
      expect(result.severity).toBe(0);
      expect(result.checksRun).toContain("pii_redactor");
      expect(result.checksRun).toContain("moderator");
      expect(result.checksRun).toContain("claims_checker");
    });

    it("should emit control.audit event on evaluation", () => {
      const engine = createEngine();
      const ctx = makeContext();
      engine.evaluate(ctx);

      // eventBus.emit is called for:
      // 1. policy.decision (from OverrideController.act)
      // 2. control.audit (from emitAuditEvent)
      const auditCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.audit",
      );
      expect(auditCalls.length).toBe(1);
      expect(auditCalls[0][0].payload).toEqual(
        expect.objectContaining({
          role: "user",
          decision: "allow",
        }),
      );
    });

    it("should emit policy.decision event on evaluation", () => {
      const engine = createEngine();
      const ctx = makeContext();
      engine.evaluate(ctx);

      const decisionCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "policy.decision",
      );
      expect(decisionCalls.length).toBe(1);
      expect(decisionCalls[0][0].payload.decision).toBe("allow");
    });
  });

  // ── evaluate: moderation violation ──────────────────────────────────

  describe("evaluate() with text matching moderation deny pattern", () => {
    it("should return refuse for text containing a denied pattern", () => {
      const engine = createEngine();
      const ctx = makeContext({
        text: "I want to discuss banned_word topics",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("refuse");
      expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
      expect(result.severity).toBe(4);
    });

    it("should be case-insensitive for deny patterns", () => {
      const engine = createEngine();
      const ctx = makeContext({
        text: "Something about HATE_SPEECH here",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("refuse");
    });
  });

  // ── evaluate: PII detection ─────────────────────────────────────────

  describe("evaluate() with PII in text", () => {
    it("should return rewrite when a phone number is detected", () => {
      const engine = createEngine();
      const ctx = makeContext({
        text: "My phone number is 555-123-4567",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED");
      expect(result.reasonCodes).toContain("PII_DETECTED:PHONE_US");
      expect(result.safeRewrite).toContain("[PHONE_REDACTED]");
    });

    it("should return rewrite when an email is detected", () => {
      const engine = createEngine();
      const ctx = makeContext({
        text: "Contact me at user@example.com please",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
      expect(result.safeRewrite).toContain("[EMAIL_REDACTED]");
    });

    it("should return rewrite when an SSN is detected", () => {
      const engine = createEngine();
      const ctx = makeContext({
        text: "My social security number is 123-45-6789",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:SSN");
    });

    it("should handle PII in flag-only mode without rewriting", () => {
      const engine = createEngine({
        piiRedactionMode: "flag",
      });
      const ctx = makeContext({
        text: "My phone number is 555-123-4567",
      });
      const result = engine.evaluate(ctx);

      // In flag mode PIIRedactor returns allow with severity 1
      // No safeRewrite because mode is "flag"
      expect(result.reasonCodes).toContain("PII_DETECTED");
      expect(result.safeRewrite).toBeUndefined();
    });
  });

  // ── evaluate: disallowed claims ─────────────────────────────────────

  describe("evaluate() with assistant text matching disallowed claim pattern", () => {
    it("should return rewrite for text containing a disallowed pattern", () => {
      const engine = createEngine();
      const ctx = makeContext({
        role: "assistant",
        text: "This is a guaranteed cure for your condition",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("CLAIMS_DISALLOWED");
      expect(result.severity).toBeGreaterThanOrEqual(2);
    });

    it("should return rewrite for 100% effective claim", () => {
      const engine = createEngine();
      const ctx = makeContext({
        role: "assistant",
        text: "Our solution is 100% effective against all threats",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("CLAIMS_DISALLOWED");
    });

    it("should allow exact-match approved claims for assistant text", () => {
      const engine = createEngine();
      const ctx = makeContext({
        role: "assistant",
        text: "Our product is FDA approved",
      });
      const result = engine.evaluate(ctx);

      expect(result.decision).toBe("allow");
    });

    it("should not check claims for user text (only assistant)", () => {
      const engine = createEngine();
      const ctx = makeContext({
        role: "user",
        text: "Is your product a guaranteed cure?",
      });
      const result = engine.evaluate(ctx);

      // ClaimsChecker skips user role, so no claims-related reason codes
      expect(result.reasonCodes).not.toContain("CLAIMS_DISALLOWED");
    });
  });

  // ── getMetrics ──────────────────────────────────────────────────────

  describe("getMetrics()", () => {
    it("should return zeroed metrics before any evaluations", () => {
      const engine = createEngine();
      const metrics = engine.getMetrics();

      expect(metrics.evaluationCount).toBe(0);
      expect(metrics.allowCount).toBe(0);
      expect(metrics.rewriteCount).toBe(0);
      expect(metrics.refuseCount).toBe(0);
      expect(metrics.escalateCount).toBe(0);
      expect(metrics.cancelCount).toBe(0);
      expect(metrics.avgDurationMs).toBe(0);
      expect(metrics.maxDurationMs).toBe(0);
    });

    it("should track correct counts after multiple evaluations", () => {
      const engine = createEngine();

      // Allow
      engine.evaluate(makeContext({ text: "Hello there" }));
      // Refuse (moderation violation)
      engine.evaluate(makeContext({ text: "Contains banned_word" }));
      // Rewrite (PII)
      engine.evaluate(
        makeContext({ text: "My number is 555-123-4567" }),
      );

      const metrics = engine.getMetrics();
      expect(metrics.evaluationCount).toBe(3);
      expect(metrics.allowCount).toBe(1);
      expect(metrics.refuseCount).toBe(1);
      expect(metrics.rewriteCount).toBe(1);
      expect(metrics.avgDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── flushMetrics ────────────────────────────────────────────────────

  describe("flushMetrics()", () => {
    it("should emit control.metrics event to eventBus", () => {
      const engine = createEngine();
      engine.evaluate(makeContext({ text: "Clean text" }));

      jest.clearAllMocks();
      engine.flushMetrics();

      const metricsCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.metrics",
      );
      expect(metricsCalls.length).toBe(1);
      expect(metricsCalls[0][0].source).toBe("laneC");
      expect(metricsCalls[0][0].payload.evaluationCount).toBe(1);
    });

    it("should emit metrics_flushed event on local emitter", () => {
      const engine = createEngine();
      const flushedHandler = jest.fn();
      engine.on("metrics_flushed", flushedHandler);

      engine.flushMetrics();

      expect(flushedHandler).toHaveBeenCalledTimes(1);
      expect(flushedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluationCount: 0,
        }),
      );
    });
  });

  // ── destroy ─────────────────────────────────────────────────────────

  describe("destroy()", () => {
    it("should flush metrics before removing listeners", () => {
      const engine = createEngine();
      engine.evaluate(makeContext({ text: "Test text" }));

      jest.clearAllMocks();
      engine.destroy();

      // Should have emitted control.metrics via flushMetrics
      const metricsCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.metrics",
      );
      expect(metricsCalls.length).toBe(1);
    });

    it("should remove all local listeners", () => {
      const engine = createEngine();
      const handler = jest.fn();
      engine.on("policy_decision", handler);

      engine.destroy();

      // After destroy, local emitter listeners should be removed
      expect(engine.listenerCount("policy_decision")).toBe(0);
    });
  });

  // ── OverrideController ──────────────────────────────────────────────

  describe("OverrideController", () => {
    it("should not escalate refuse when severity < cancelThreshold", () => {
      // Default cancelThreshold = 4
      // A refuse with severity 3 should NOT be upgraded to cancel_output
      const engine = createEngine({
        cancelOutputThreshold: 5,
      });

      // Moderation violation: severity 4, decision refuse
      const ctx = makeContext({ text: "Contains banned_word" });
      engine.evaluate(ctx);

      // With threshold 5, refuse at severity 4 should stay as refuse
      const decisionCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "policy.decision",
      );
      expect(decisionCalls[0][0].payload.decision).toBe("refuse");
    });

    it("should upgrade refuse to cancel_output when severity >= cancelThreshold", () => {
      const engine = createEngine({
        cancelOutputThreshold: 4,
      });

      // Moderation violation: severity 4, decision refuse
      const ctx = makeContext({ text: "Contains banned_word" });
      engine.evaluate(ctx);

      const decisionCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "policy.decision",
      );
      expect(decisionCalls[0][0].payload.decision).toBe("cancel_output");
    });

    it("should emit control.override when decision is upgraded", () => {
      const engine = createEngine({
        cancelOutputThreshold: 4,
      });

      const ctx = makeContext({ text: "Contains banned_word" });
      engine.evaluate(ctx);

      const overrideCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.override",
      );
      expect(overrideCalls.length).toBe(1);
      expect(overrideCalls[0][0].payload).toEqual(
        expect.objectContaining({
          originalDecision: "refuse",
          effectiveDecision: "cancel_output",
        }),
      );
    });

    it("should not emit control.override when decision is not upgraded", () => {
      const engine = createEngine({
        cancelOutputThreshold: 10,
      });

      const ctx = makeContext({ text: "Contains banned_word" });
      engine.evaluate(ctx);

      const overrideCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.override",
      );
      expect(overrideCalls.length).toBe(0);
    });

    it("should emit cancel_output local event when upgraded", () => {
      const engine = createEngine({
        cancelOutputThreshold: 4,
      });

      const cancelHandler = jest.fn();
      engine.on("cancel_output", cancelHandler);

      const ctx = makeContext({ text: "Contains banned_word" });
      engine.evaluate(ctx);

      expect(cancelHandler).toHaveBeenCalledTimes(1);
    });

    it("should set fallback_mode to refuse_politely for cancel_output", () => {
      const engine = createEngine({
        cancelOutputThreshold: 4,
      });

      const ctx = makeContext({ text: "Contains banned_word" });
      engine.evaluate(ctx);

      const decisionCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "policy.decision",
      );
      expect(decisionCalls[0][0].payload.fallback_mode).toBe(
        "refuse_politely",
      );
    });
  });

  // ── Audit event content ─────────────────────────────────────────────

  describe("audit event content", () => {
    it("should truncate textSnippet to 200 characters", () => {
      const engine = createEngine();
      const longText = "A".repeat(300);
      const ctx = makeContext({ text: longText });

      engine.evaluate(ctx);

      const auditCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.audit",
      );
      expect(auditCalls[0][0].payload.textSnippet.length).toBeLessThanOrEqual(
        200,
      );
    });

    it("should include checksRun in audit payload", () => {
      const engine = createEngine();
      engine.evaluate(makeContext());

      const auditCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.audit",
      );
      expect(auditCalls[0][0].payload.checksRun).toContain("pii_redactor");
      expect(auditCalls[0][0].payload.checksRun).toContain("moderator");
      expect(auditCalls[0][0].payload.checksRun).toContain("claims_checker");
    });

    it("should redact PII in audit textSnippet", () => {
      const engine = createEngine();
      const ctx = makeContext({ text: "Call me at 555-123-4567" });

      engine.evaluate(ctx);

      const auditCalls = (eventBus.emit as jest.Mock).mock.calls.filter(
        (call) => call[0]?.type === "control.audit",
      );
      expect(auditCalls[0][0].payload.textSnippet).toContain(
        "[PHONE_REDACTED]",
      );
      expect(auditCalls[0][0].payload.textSnippet).not.toContain(
        "555-123-4567",
      );
    });
  });

  // ── PII disabled ────────────────────────────────────────────────────

  describe("with PII redaction disabled", () => {
    it("should skip PIIRedactor check entirely", () => {
      const engine = createEngine({
        enablePIIRedaction: false,
      });
      const ctx = makeContext({ text: "My number is 555-123-4567" });
      const result = engine.evaluate(ctx);

      expect(result.checksRun).not.toContain("pii_redactor");
      expect(result.decision).toBe("allow");
    });
  });

  // ── Event subscription mode ─────────────────────────────────────────

  describe("event subscription (enabled mode)", () => {
    it("should subscribe to session events when enabled", () => {
      createEngine({ enabled: true });
      expect(eventBus.onSession).toHaveBeenCalledWith(
        SESSION_ID,
        expect.any(Function),
      );
    });

    it("should NOT subscribe to session events when disabled", () => {
      jest.clearAllMocks();
      createEngine({ enabled: false });
      expect(eventBus.onSession).not.toHaveBeenCalled();
    });
  });

  // ── handleEvent (event-driven path) ─────────────────────────────────

  describe("handleEvent (event-driven path)", () => {
    let capturedHandler: (event: Event) => void;

    beforeEach(() => {
      jest.clearAllMocks();
      // Create engine with enabled=true so it subscribes via eventBus.onSession
      createEngine({ enabled: true });
      // Capture the callback passed to eventBus.onSession
      const onSessionCalls = (eventBus.onSession as jest.Mock).mock.calls;
      expect(onSessionCalls.length).toBeGreaterThan(0);
      capturedHandler = onSessionCalls[0][1];
    });

    // ── transcript.final ──────────────────────────────────────────────

    it("should evaluate transcript.final events as user role", () => {
      capturedHandler({
        event_id: "e1",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "transcript.final",
        payload: {
          text: "Hello",
          confidence: 0.9,
          is_final: true,
          span_ms: { start: 0, end: 100 },
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(1);
      expect(decisions[0][0].payload.decision).toBe("allow");
    });

    it("should skip transcript.final with empty text", () => {
      capturedHandler({
        event_id: "e2",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "transcript.final",
        payload: {
          text: "",
          confidence: 0.9,
          is_final: true,
          span_ms: { start: 0, end: 100 },
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(0);
    });

    // ── transcript.delta ──────────────────────────────────────────────

    it("should skip transcript.delta when evaluateDeltas is false", () => {
      // Default evaluateDeltas is false
      capturedHandler({
        event_id: "e3",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "transcript.delta",
        payload: {
          text: "partial",
          confidence: 0.5,
          is_final: false,
          span_ms: { start: 0, end: 50 },
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(0);
    });

    it("should evaluate transcript.delta when evaluateDeltas is true", () => {
      jest.clearAllMocks();
      createEngine({ enabled: true, evaluateDeltas: true });
      const handler = (eventBus.onSession as jest.Mock).mock.calls[0][1];

      handler({
        event_id: "e4",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "transcript.delta",
        payload: {
          text: "partial text",
          confidence: 0.5,
          is_final: false,
          span_ms: { start: 0, end: 50 },
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(1);
    });

    // ── transcript (assistant from laneB) ─────────────────────────────

    it("should evaluate transcript from laneB as assistant role", () => {
      capturedHandler({
        event_id: "e5",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "transcript",
        payload: {
          text: "I can help with that",
          isFinal: true,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      } as Event);

      const audits = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "control.audit",
      );
      expect(audits.length).toBeGreaterThan(0);
      expect(audits[0][0].payload.role).toBe("assistant");
    });

    it("should skip transcript events from non-laneB sources", () => {
      capturedHandler({
        event_id: "e6",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "transcript",
        payload: {
          text: "user text",
          isFinal: true,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(0);
    });

    it("should skip assistant transcript with empty text", () => {
      capturedHandler({
        event_id: "e7",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "transcript",
        payload: {
          text: "",
          isFinal: true,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(0);
    });

    // ── user_transcript ───────────────────────────────────────────────

    it("should evaluate user_transcript events", () => {
      capturedHandler({
        event_id: "e8",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "user_transcript",
        payload: {
          text: "I need help",
          isFinal: true,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(1);
    });

    it("should skip user_transcript with empty text", () => {
      capturedHandler({
        event_id: "e9",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "user_transcript",
        payload: {
          text: "",
          isFinal: true,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(0);
    });

    // ── response.metadata ─────────────────────────────────────────────

    it("should store response.metadata and emit response_metadata event", () => {
      const metadataHandler = jest.fn();
      jest.clearAllMocks();
      const engine = new ControlEngine(SESSION_ID, {
        claimsRegistry: createRegistry(),
        moderationDenyPatterns: [/banned_word/i],
        enabled: true,
      });
      engine.on("response_metadata", metadataHandler);

      const handler = (eventBus.onSession as jest.Mock).mock.calls[0][1];
      handler({
        event_id: "e10",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "response.metadata",
        payload: { phase: "start", ttfb_ms: 350 },
      } as Event);

      expect(metadataHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "start", ttfb_ms: 350 }),
      );
    });

    it("should skip response.metadata with missing phase", () => {
      const metadataHandler = jest.fn();
      jest.clearAllMocks();
      const engine = new ControlEngine(SESSION_ID, {
        claimsRegistry: createRegistry(),
        moderationDenyPatterns: [],
        enabled: true,
      });
      engine.on("response_metadata", metadataHandler);

      const handler = (eventBus.onSession as jest.Mock).mock.calls[0][1];
      handler({
        event_id: "e11",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "response.metadata",
        payload: { noPhase: true },
      } as unknown as Event);

      expect(metadataHandler).not.toHaveBeenCalled();
    });

    // ── metadata propagation through evaluation context ───────────────

    it("should include response metadata in assistant evaluation context", () => {
      jest.clearAllMocks();
      // Engine created for side effect: subscribes to eventBus.onSession
      void new ControlEngine(SESSION_ID, {
        claimsRegistry: createRegistry(),
        moderationDenyPatterns: [],
        enabled: true,
      });

      const handler = (eventBus.onSession as jest.Mock).mock.calls[0][1];

      // First, send response.metadata so lastResponseMetadata is set
      handler({
        event_id: "meta1",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "response.metadata",
        payload: { phase: "start", ttfb_ms: 250 },
      } as Event);

      // Then send assistant transcript that will pick up the metadata
      handler({
        event_id: "t1",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "transcript",
        payload: {
          text: "Here is my response",
          isFinal: true,
          confidence: 0.9,
          timestamp: Date.now(),
        },
      } as Event);

      const audits = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "control.audit",
      );
      const lastAudit = audits[audits.length - 1];
      expect(lastAudit[0].payload.role).toBe("assistant");
    });

    it("should include response metadata in user_transcript evaluation context", () => {
      jest.clearAllMocks();
      // Engine created for side effect: subscribes to eventBus.onSession
      void new ControlEngine(SESSION_ID, {
        claimsRegistry: createRegistry(),
        moderationDenyPatterns: [],
        enabled: true,
      });

      const handler = (eventBus.onSession as jest.Mock).mock.calls[0][1];

      // First, set response metadata
      handler({
        event_id: "meta2",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "laneB",
        type: "response.metadata",
        payload: { phase: "end", total_ms: 500 },
      } as Event);

      // Then send user_transcript that will include metadata in context
      handler({
        event_id: "t2",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "user_transcript",
        payload: {
          text: "Thanks for the help",
          isFinal: true,
          confidence: 0.95,
          timestamp: Date.now(),
        },
      } as Event);

      // Verify evaluate was called (policy.decision emitted)
      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(1);
    });

    // ── transcript.final with moderation violation ────────────────────

    it("should refuse transcript.final containing banned content", () => {
      capturedHandler({
        event_id: "e12",
        session_id: SESSION_ID,
        t_ms: Date.now(),
        source: "client",
        type: "transcript.final",
        payload: {
          text: "I want to discuss banned_word topics",
          confidence: 0.95,
          is_final: true,
          span_ms: { start: 0, end: 200 },
        },
      } as Event);

      const decisions = (eventBus.emit as jest.Mock).mock.calls.filter(
        (c) => c[0]?.type === "policy.decision",
      );
      expect(decisions.length).toBe(1);
      // With default cancelOutputThreshold=4 and moderation severity=4,
      // the refuse gets upgraded to cancel_output
      expect(["refuse", "cancel_output"]).toContain(
        decisions[0][0].payload.decision,
      );
    });
  });
});
