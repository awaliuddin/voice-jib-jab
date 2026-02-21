/**
 * LaneC Unit Tests
 *
 * Tests the Lane C policy decision emitter that validates required disclaimers
 * and publishes policy decisions to both the global EventBus and a local
 * EventEmitter.
 *
 * LaneC is the lightweight policy emitter (distinct from ControlEngine which
 * runs the full PolicyGate pipeline). It validates disclaimer IDs against the
 * DisclaimerLookup catalog before emitting events.
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

jest.mock("../../retrieval/DisclaimerLookup.js", () => ({
  lookupDisclaimer: jest.fn((id: string) => {
    if (id === "DISC-001") return "This is a disclaimer for testing.";
    if (id === "DISC-002") return "Another valid disclaimer.";
    return null;
  }),
}));

import { LaneC } from "../../lanes/LaneC.js";
import { eventBus } from "../../orchestrator/EventBus.js";
import { lookupDisclaimer } from "../../retrieval/DisclaimerLookup.js";
import type { PolicyDecisionPayload } from "../../schemas/events.js";

// ── Tests ───────────────────────────────────────────────────────────────

describe("LaneC", () => {
  const sessionId = "test-session-laneC";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should create a LaneC instance with the given sessionId", () => {
      const lane = new LaneC(sessionId);
      expect(lane).toBeInstanceOf(LaneC);
    });
  });

  // ── emitPolicyDecision ──────────────────────────────────────────────

  describe("emitPolicyDecision()", () => {
    it("should emit event to eventBus with correct structure", () => {
      const lane = new LaneC(sessionId);
      const payload: PolicyDecisionPayload = {
        decision: "allow",
        reason_codes: [],
        severity: 0,
      };

      lane.emitPolicyDecision(payload);

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: sessionId,
          source: "laneC",
          type: "policy.decision",
          payload: expect.objectContaining({
            decision: "allow",
            reason_codes: [],
            severity: 0,
          }),
        }),
      );
    });

    it("should emit event to local EventEmitter", () => {
      const lane = new LaneC(sessionId);
      const localHandler = jest.fn();
      lane.on("policy.decision", localHandler);

      const payload: PolicyDecisionPayload = {
        decision: "refuse",
        reason_codes: ["MODERATION_VIOLATION"],
        severity: 4,
      };

      lane.emitPolicyDecision(payload);

      expect(localHandler).toHaveBeenCalledTimes(1);
      expect(localHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "policy.decision",
          payload: expect.objectContaining({
            decision: "refuse",
          }),
        }),
      );
    });

    it("should include event_id and t_ms in emitted event", () => {
      const lane = new LaneC(sessionId);

      lane.emitPolicyDecision({
        decision: "allow",
        reason_codes: [],
        severity: 0,
      });

      const emittedEvent = (eventBus.emit as jest.Mock).mock.calls[0][0];
      expect(emittedEvent.event_id).toBeDefined();
      expect(typeof emittedEvent.event_id).toBe("string");
      expect(emittedEvent.event_id.length).toBeGreaterThan(0);
      expect(typeof emittedEvent.t_ms).toBe("number");
    });

    it("should keep valid disclaimer when lookupDisclaimer returns text", () => {
      const lane = new LaneC(sessionId);
      const payload: PolicyDecisionPayload = {
        decision: "allow",
        reason_codes: [],
        severity: 0,
        required_disclaimer_id: "DISC-001",
      };

      lane.emitPolicyDecision(payload);

      expect(lookupDisclaimer).toHaveBeenCalledWith("DISC-001");
      const emittedEvent = (eventBus.emit as jest.Mock).mock.calls[0][0];
      expect(emittedEvent.payload.required_disclaimer_id).toBe("DISC-001");
    });

    it("should remove missing disclaimer and log warning", () => {
      const lane = new LaneC(sessionId);
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const payload: PolicyDecisionPayload = {
        decision: "allow",
        reason_codes: [],
        severity: 0,
        required_disclaimer_id: "DISC-MISSING",
      };

      lane.emitPolicyDecision(payload);

      expect(lookupDisclaimer).toHaveBeenCalledWith("DISC-MISSING");
      expect(warnSpy).toHaveBeenCalledWith(
        "[LaneC] Missing disclaimer id: DISC-MISSING",
      );

      const emittedEvent = (eventBus.emit as jest.Mock).mock.calls[0][0];
      expect(emittedEvent.payload.required_disclaimer_id).toBeUndefined();

      warnSpy.mockRestore();
    });

    it("should pass through when no disclaimer is specified", () => {
      const lane = new LaneC(sessionId);

      const payload: PolicyDecisionPayload = {
        decision: "rewrite",
        reason_codes: ["CLAIMS_RISK"],
        severity: 2,
        safe_rewrite: "Corrected statement",
      };

      lane.emitPolicyDecision(payload);

      // lookupDisclaimer should NOT be called when no disclaimer ID is present
      expect(lookupDisclaimer).not.toHaveBeenCalled();

      const emittedEvent = (eventBus.emit as jest.Mock).mock.calls[0][0];
      expect(emittedEvent.payload.decision).toBe("rewrite");
      expect(emittedEvent.payload.safe_rewrite).toBe("Corrected statement");
    });

    it("should not mutate the original payload object", () => {
      const lane = new LaneC(sessionId);
      jest.spyOn(console, "warn").mockImplementation();

      const payload: PolicyDecisionPayload = {
        decision: "allow",
        reason_codes: [],
        severity: 0,
        required_disclaimer_id: "DISC-MISSING",
      };

      lane.emitPolicyDecision(payload);

      // The original payload should still have the disclaimer ID
      expect(payload.required_disclaimer_id).toBe("DISC-MISSING");
    });

    it("should handle payload with all optional fields populated", () => {
      const lane = new LaneC(sessionId);

      const payload: PolicyDecisionPayload = {
        decision: "rewrite",
        reason_codes: ["CLAIMS_RISK", "PII_DETECTED"],
        severity: 3,
        safe_rewrite: "A safe version of the response",
        required_disclaimer_id: "DISC-002",
        fallback_mode: "ask_clarifying_question",
      };

      lane.emitPolicyDecision(payload);

      const emittedEvent = (eventBus.emit as jest.Mock).mock.calls[0][0];
      expect(emittedEvent.payload).toEqual(
        expect.objectContaining({
          decision: "rewrite",
          reason_codes: ["CLAIMS_RISK", "PII_DETECTED"],
          severity: 3,
          safe_rewrite: "A safe version of the response",
          required_disclaimer_id: "DISC-002",
          fallback_mode: "ask_clarifying_question",
        }),
      );
    });
  });
});
