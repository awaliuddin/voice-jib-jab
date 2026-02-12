/**
 * Tests for Lane C Policy and Fallback Scenarios
 *
 * Verifies the interaction between Lane C, the LaneArbitrator, and the
 * FallbackPlanner when a policy cancellation event occurs.
 */

import { jest } from "@jest/globals";
import { LaneArbitrator } from "../../orchestrator/LaneArbitrator.js";
import { LaneB } from "../../lanes/LaneB.js";
import { FallbackPlanner } from "../../insurance/fallback_planner.js";
import { AuditTrail } from "../../insurance/audit_trail.js";

jest.mock("../../lanes/LaneB.js");
jest.mock("../../insurance/fallback_planner.js");
jest.mock("../../insurance/audit_trail.js");

describe("Lane C Policy Cancel and Fallback Integration", () => {
  let arbitrator: LaneArbitrator;
  let laneB: jest.Mocked<LaneB>;
  let fallbackPlanner: jest.Mocked<FallbackPlanner>;
  let auditTrail: jest.Mocked<AuditTrail>;
  const sessionId = "policy-test-session";

  beforeEach(() => {
    laneB = new (jest.requireMock("../../lanes/LaneB.js").LaneB)() as jest.Mocked<LaneB>;
    fallbackPlanner = new (jest.requireMock("../../insurance/fallback_planner.js").FallbackPlanner)() as jest.Mocked<FallbackPlanner>;
    auditTrail = new (jest.requireMock("../../insurance/audit_trail.js").AuditTrail)() as jest.Mocked<AuditTrail>;

    // Mock LaneB methods
    laneB.getIsResponding.mockReturnValue(false);
    laneB.hasFirstAudioEmitted.mockReturnValue(false);
    laneB.getTTFB.mockReturnValue(null);
    laneB.cancel.mockResolvedValue(undefined);

    // Mock FallbackPlanner methods
    fallbackPlanner.isEnabled.mockReturnValue(true);

    // Mock AuditTrail methods
    auditTrail.log = jest.fn();

    // Create LaneArbitrator with real logic but mocked dependencies
    arbitrator = new LaneArbitrator(sessionId, {
      laneAEnabled: true,
      minDelayBeforeReflexMs: 50,
      maxReflexDurationMs: 500,
      auditTrail: auditTrail,
    });

    arbitrator.startSession();
  });

  afterEach(() => {
    arbitrator.endSession();
    jest.clearAllMocks();
  });

  describe("when Lane B is playing", () => {
    it("should stop Lane B, trigger fallback, and log audit events", () => {
      // Arrange: Set state to B_PLAYING
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");

      const stopLaneBSpy = jest.spyOn(arbitrator, "emit");
      const playFallbackSpy = jest.spyOn(arbitrator, "emit");

      // Act: Trigger policy cancellation
      arbitrator.onPolicyCancel();

      // Assert: Verify state and events
      expect(stopLaneBSpy).toHaveBeenCalledWith("stop_lane_b");
      expect(playFallbackSpy).toHaveBeenCalledWith("play_fallback");
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("fallback");

      // Assert: Verify audit trail logging
      expect(auditTrail.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.state.transition",
          details: expect.objectContaining({
            from: "B_PLAYING",
            to: "FALLBACK_PLAYING",
            trigger: "policy_cancel",
          }),
        })
      );
      expect(auditTrail.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.owner.transition",
          details: expect.objectContaining({
            from: "B",
            to: "fallback",
            trigger: "policy_cancel",
          }),
        })
      );
    });
  });

  describe("when Lane A is playing", () => {
    jest.useFakeTimers();
    it("should stop Lane A, trigger fallback, and log audit events", () => {
      // Arrange: Set state to A_PLAYING
      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100);
      expect(arbitrator.getState()).toBe("A_PLAYING");

      const stopReflexSpy = jest.spyOn(arbitrator, "emit");
      const playFallbackSpy = jest.spyOn(arbitrator, "emit");

      // Act: Trigger policy cancellation
      arbitrator.onPolicyCancel();

      // Assert: Verify state and events
      expect(stopReflexSpy).toHaveBeenCalledWith("stop_reflex");
      expect(playFallbackSpy).toHaveBeenCalledWith("play_fallback");
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("fallback");

      // Assert: Verify audit trail logging
      expect(auditTrail.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.state.transition",
          details: expect.objectContaining({
            from: "A_PLAYING",
            to: "FALLBACK_PLAYING",
            trigger: "policy_cancel",
          }),
        })
      );
    });
  });

  describe("T-012: Lane C Policy Cancel and Fallback", () => {
    it("should stop Lane B audio, execute fallback, and log audit trail when policy is cancelled", () => {
      // Arrange: Set state to B_RESPONDING (after user speech ends and Lane B is ready)
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("B");

      const stopLaneBSpy = jest.spyOn(arbitrator, "emit");
      const playFallbackSpy = jest.spyOn(arbitrator, "emit");

      // Act: Trigger policy cancellation from Lane C
      arbitrator.onPolicyCancel();

      // Assert: Verify Lane B is cancelled and fallback is triggered
      expect(laneB.cancel).toHaveBeenCalledTimes(1);
      expect(stopLaneBSpy).toHaveBeenCalledWith("stop_lane_b");
      expect(playFallbackSpy).toHaveBeenCalledWith("play_fallback");

      // Assert: Verify correct arbitration state transitions
      expect(arbitrator.getState()).toBe("FALLBACK_PLAYING");
      expect(arbitrator.getCurrentOwner()).toBe("fallback");

      // Assert: AuditTrail logs all relevant events
      expect(auditTrail.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.state.transition",
          details: expect.objectContaining({
            from: "B_PLAYING",
            to: "FALLBACK_PLAYING",
            trigger: "policy_cancel",
          }),
        }),
      );
      expect(auditTrail.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "arbitration.owner.transition",
          details: expect.objectContaining({
            from: "B",
            to: "fallback",
            trigger: "policy_cancel",
          }),
        }),
      );
    });
  });

  describe("Fallback Execution", () => {
    it("should trigger the FallbackPlanner when a policy is cancelled", () => {
      // Arrange
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      arbitrator.on("play_fallback", () => {
        fallbackPlanner.trigger({} as any);
      });

      // Act
      arbitrator.onPolicyCancel();

      // Assert
      expect(fallbackPlanner.trigger).toHaveBeenCalled();
    });

    it("should transition to LISTENING if fallback is disabled", () => {
      // Arrange
      fallbackPlanner.isEnabled.mockReturnValue(false);
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      const onFallbackCompleteSpy = jest.spyOn(arbitrator, "onFallbackComplete");
      arbitrator.on("play_fallback", () => {
        if (!fallbackPlanner.isEnabled()) {
          arbitrator.onFallbackComplete();
        }
      });

      // Act
      arbitrator.onPolicyCancel();

      // Assert
      expect(fallbackPlanner.trigger).not.toHaveBeenCalled();
      expect(onFallbackCompleteSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("LISTENING");
    });
  });
});
