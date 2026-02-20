/**
 * Tests for Lane C Policy and Fallback Scenarios
 *
 * Verifies the interaction between Lane C, the LaneArbitrator, and the
 * FallbackPlanner when a policy cancellation event occurs.
 */

import { LaneArbitrator } from "../../orchestrator/LaneArbitrator.js";

describe("Lane C Policy Cancel and Fallback Integration", () => {
  let arbitrator: LaneArbitrator;
  const sessionId = "policy-test-session";
  let auditLog: jest.Mock;

  beforeEach(() => {
    auditLog = jest.fn();

    const mockAuditTrail = { log: auditLog } as any;

    arbitrator = new LaneArbitrator(sessionId, {
      laneAEnabled: true,
      minDelayBeforeReflexMs: 50,
      maxReflexDurationMs: 500,
      auditTrail: mockAuditTrail,
    });

    arbitrator.startSession();
  });

  afterEach(() => {
    arbitrator.endSession();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("when Lane B is playing", () => {
    it("should stop Lane B, trigger fallback, and log audit events", () => {
      // Arrange: Set state to B_PLAYING
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");

      const emittedEvents: string[] = [];
      arbitrator.on("stop_lane_b", () => emittedEvents.push("stop_lane_b"));
      arbitrator.on("play_fallback", () => emittedEvents.push("play_fallback"));

      // Act: Trigger policy cancellation
      arbitrator.onPolicyCancel();

      // Assert: Verify state and events
      expect(emittedEvents).toContain("stop_lane_b");
      expect(emittedEvents).toContain("play_fallback");
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("fallback");

      // Assert: Verify audit trail logging
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.state.transition",
          payload: expect.objectContaining({
            from: "B_PLAYING",
            to: "FALLBACK_PLAYING",
            trigger: "policy_cancel",
          }),
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.owner.transition",
          payload: expect.objectContaining({
            from: "B",
            to: "fallback",
            trigger: "policy_cancel",
          }),
        }),
      );
    });
  });

  describe("when Lane A is playing", () => {
    it("should stop Lane A, trigger fallback, and log audit events", () => {
      jest.useFakeTimers();

      // Arrange: Set state to A_PLAYING
      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100);
      expect(arbitrator.getState()).toBe("A_PLAYING");

      const emittedEvents: string[] = [];
      arbitrator.on("stop_reflex", () => emittedEvents.push("stop_reflex"));
      arbitrator.on("play_fallback", () => emittedEvents.push("play_fallback"));

      // Act: Trigger policy cancellation
      arbitrator.onPolicyCancel();

      // Assert: Verify state and events
      expect(emittedEvents).toContain("stop_reflex");
      expect(emittedEvents).toContain("play_fallback");
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("fallback");

      // Assert: Verify audit trail logging
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.state.transition",
          payload: expect.objectContaining({
            from: "A_PLAYING",
            to: "FALLBACK_PLAYING",
            trigger: "policy_cancel",
          }),
        }),
      );

      jest.useRealTimers();
    });
  });

  describe("T-012: Lane C Policy Cancel and Fallback", () => {
    it("should stop Lane B audio, execute fallback, and log audit trail when policy is cancelled", () => {
      // Arrange: Set state to B_PLAYING
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("B");

      const emittedEvents: string[] = [];
      arbitrator.on("stop_lane_b", () => emittedEvents.push("stop_lane_b"));
      arbitrator.on("play_fallback", () => emittedEvents.push("play_fallback"));

      // Act: Trigger policy cancellation from Lane C
      arbitrator.onPolicyCancel();

      // Assert: Verify Lane B is cancelled and fallback is triggered
      expect(emittedEvents).toContain("stop_lane_b");
      expect(emittedEvents).toContain("play_fallback");

      // Assert: Verify correct arbitration state transitions
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("fallback");

      // Assert: AuditTrail logs all relevant events
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.state.transition",
          payload: expect.objectContaining({
            from: "B_PLAYING",
            to: "FALLBACK_PLAYING",
            trigger: "policy_cancel",
          }),
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.owner.transition",
          payload: expect.objectContaining({
            from: "B",
            to: "fallback",
            trigger: "policy_cancel",
          }),
        }),
      );
    });
  });

  describe("Fallback Execution", () => {
    it("should emit play_fallback when a policy is cancelled", () => {
      // Arrange
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      const playFallbackSpy = jest.fn();
      arbitrator.on("play_fallback", playFallbackSpy);

      // Act
      arbitrator.onPolicyCancel();

      // Assert
      expect(playFallbackSpy).toHaveBeenCalled();
    });

    it("should transition to LISTENING after fallback completes", () => {
      // Arrange
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      // Act
      arbitrator.onPolicyCancel();
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");

      // Simulate fallback completion
      arbitrator.onFallbackComplete();

      // Assert
      expect(arbitrator.getState()).toBe("LISTENING");
    });
  });
});
