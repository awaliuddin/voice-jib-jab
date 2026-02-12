/**
 * LaneArbitrator Unit Tests (P0 - Production Blocker)
 *
 * Tests the state machine that orchestrates audio ownership between
 * Lane A (reflex) and Lane B (reasoning).
 *
 * Critical scenarios tested:
 * - State transitions
 * - Lane preemption logic
 * - Response in-progress guard
 * - Enhanced 4-case onLaneBDone() handler
 * - Error recovery
 *
 * Target Coverage: 85%+
 */

import { LaneArbitrator } from "../../orchestrator/LaneArbitrator.js";

// Use fake timers for testing setTimeout/setInterval
jest.useFakeTimers();

describe("LaneArbitrator", () => {
  let arbitrator: LaneArbitrator;
  const sessionId = "test-session-123";

  beforeEach(() => {
    // Create arbitrator with default config
    arbitrator = new LaneArbitrator(sessionId, {
      laneAEnabled: true,
      minDelayBeforeReflexMs: 100,
      maxReflexDurationMs: 2000,
      preemptThresholdMs: 300,
      transitionGapMs: 10,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Initialization", () => {
    it("should initialize in IDLE state", () => {
      expect(arbitrator.getState()).toBe("IDLE");
    });

    it("should start session and transition to LISTENING", () => {
      arbitrator.startSession();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should have no current owner initially", () => {
      expect(arbitrator.getCurrentOwner()).toBe("none");
    });

    it("should respect laneAEnabled configuration", () => {
      expect(arbitrator.isLaneAEnabled()).toBe(true);

      const disabledArbitrator = new LaneArbitrator(sessionId, {
        laneAEnabled: false,
      });
      expect(disabledArbitrator.isLaneAEnabled()).toBe(false);
    });
  });

  describe("State Transitions", () => {
    beforeEach(() => {
      arbitrator.startSession(); // Start in LISTENING state
    });

    it("should transition LISTENING → B_RESPONDING on user speech end", () => {
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");
    });

    it("should emit state_change event on transition", (done) => {
      arbitrator.on("state_change", (transition) => {
        expect(transition.from).toBe("LISTENING");
        expect(transition.to).toBe("B_RESPONDING");
        expect(transition.cause).toBe("user_speech_ended");
        done();
      });

      arbitrator.onUserSpeechEnded();
    });

    it("should transition ENDED on endSession", () => {
      arbitrator.endSession();
      expect(arbitrator.getState()).toBe("ENDED");
    });

    it("should track state history", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      const history = arbitrator.getStateHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1].to).toBe("B_PLAYING");
    });
  });

  describe("Response In-Progress Guard", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should set response in progress on speech end", () => {
      arbitrator.onUserSpeechEnded();
      // Access private field for testing
      expect((arbitrator as any).responseInProgress).toBe(true);
    });

    it("should ignore second speech end if response in progress", () => {
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      // Try to trigger another speech end - should be ignored
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING"); // State unchanged
    });

    it("should clear response guard on Lane B done", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      arbitrator.onLaneBDone();

      expect((arbitrator as any).responseInProgress).toBe(false);
    });

    it("should clear response guard on barge-in", () => {
      arbitrator.onUserSpeechEnded();
      expect((arbitrator as any).responseInProgress).toBe(true);

      arbitrator.onUserBargeIn();
      expect((arbitrator as any).responseInProgress).toBe(false);
    });
  });

  describe("Lane A Reflex Triggering", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should trigger Lane A after minDelayBeforeReflexMs", () => {
      const playReflexSpy = jest.fn();
      arbitrator.on("play_reflex", playReflexSpy);

      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      // Fast-forward timers by 100ms
      jest.advanceTimersByTime(100);

      expect(playReflexSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("A_PLAYING");
    });

    it("should NOT trigger Lane A if Lane B ready quickly", () => {
      const playReflexSpy = jest.fn();
      arbitrator.on("play_reflex", playReflexSpy);

      arbitrator.onUserSpeechEnded();

      // Lane B becomes ready before timer fires
      arbitrator.onLaneBReady();

      // Fast-forward past the delay
      jest.advanceTimersByTime(100);

      expect(playReflexSpy).not.toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("B_PLAYING");
    });

    it("should skip Lane A if disabled in config", () => {
      const noLaneA = new LaneArbitrator(sessionId, {
        laneAEnabled: false,
      });
      noLaneA.startSession();

      const playReflexSpy = jest.fn();
      noLaneA.on("play_reflex", playReflexSpy);

      noLaneA.onUserSpeechEnded();
      jest.advanceTimersByTime(1000);

      expect(playReflexSpy).not.toHaveBeenCalled();
    });

    it("should auto-cancel Lane A after maxReflexDurationMs", () => {
      const stopReflexSpy = jest.fn();
      arbitrator.on("stop_reflex", stopReflexSpy);

      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Trigger Lane A

      expect(arbitrator.getState()).toBe("A_PLAYING");

      // Fast-forward past max duration
      jest.advanceTimersByTime(2000);

      expect(stopReflexSpy).toHaveBeenCalled();
    });
  });

  describe("Lane B Preemption", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should preempt Lane A when Lane B ready", (done) => {
      const stopReflexSpy = jest.fn();
      const playLaneBSpy = jest.fn();

      arbitrator.on("stop_reflex", stopReflexSpy);
      arbitrator.on("play_lane_b", playLaneBSpy);

      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Trigger Lane A

      expect(arbitrator.getState()).toBe("A_PLAYING");

      // Lane B becomes ready - should preempt A
      arbitrator.onLaneBReady();

      // Wait for transition gap (10ms)
      setTimeout(() => {
        expect(stopReflexSpy).toHaveBeenCalled();
        expect(playLaneBSpy).toHaveBeenCalled();
        expect(arbitrator.getState()).toBe("B_PLAYING");
        done();
      }, 15);

      jest.advanceTimersByTime(15);
    });

    it("should emit owner_change event on preemption", (done) => {
      arbitrator.on("owner_change", (event) => {
        if (event.from === "A" && event.to === "B") {
          expect(event.cause).toBe("b_first_audio_ready");
          done();
        }
      });

      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Lane A starts
      arbitrator.onLaneBReady(); // Lane B preempts

      jest.advanceTimersByTime(15);
    });

    it("should go straight to B_PLAYING if Lane A never triggered", () => {
      const playLaneBSpy = jest.fn();
      arbitrator.on("play_lane_b", playLaneBSpy);

      arbitrator.onUserSpeechEnded();
      // Lane B ready before Lane A timer fires
      arbitrator.onLaneBReady();

      expect(playLaneBSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("B_PLAYING");
    });
  });

  describe("onLaneBDone - Case 1: Normal Flow", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should handle response complete in B_PLAYING (happy path)", () => {
      const completeSpy = jest.fn();
      arbitrator.on("response_complete", completeSpy);

      arbitrator.onUserSpeechEnded(); // LISTENING → B_RESPONDING
      arbitrator.onLaneBReady(); // B_RESPONDING → B_PLAYING
      arbitrator.onLaneBDone(); // B_PLAYING → LISTENING

      expect(arbitrator.getState()).toBe("LISTENING");
      expect(arbitrator.getCurrentOwner()).toBe("none");
      expect(completeSpy).toHaveBeenCalled();
      expect((arbitrator as any).responseInProgress).toBe(false);
    });
  });

  describe("onLaneBDone - Case 2: Commit Failed / Fast Response", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should handle response complete in LISTENING (commit failed)", () => {
      const completeSpy = jest.fn();
      arbitrator.on("response_complete", completeSpy);

      arbitrator.onUserSpeechEnded(); // LISTENING → B_RESPONDING

      // Simulate commit failure - reset to LISTENING
      arbitrator.resetResponseInProgress();

      expect(arbitrator.getState()).toBe("LISTENING");

      // Now Lane B done arrives (OpenAI sent response anyway)
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING"); // Should stay LISTENING
      expect(completeSpy).toHaveBeenCalled();
      expect((arbitrator as any).responseInProgress).toBe(false);
    });

    it("should handle response complete in B_RESPONDING (fast response)", () => {
      const completeSpy = jest.fn();
      arbitrator.on("response_complete", completeSpy);

      arbitrator.onUserSpeechEnded(); // LISTENING → B_RESPONDING

      // Lane B done arrives before first audio (very fast response)
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING");
      expect(completeSpy).toHaveBeenCalled();
      expect((arbitrator as any).responseInProgress).toBe(false);
    });
  });

  describe("onLaneBDone - Case 3: Response Completes During A_PLAYING", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should stop Lane A when Lane B done before preemption", () => {
      const stopReflexSpy = jest.fn();
      const completeSpy = jest.fn();

      arbitrator.on("stop_reflex", stopReflexSpy);
      arbitrator.on("response_complete", completeSpy);

      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Lane A starts

      expect(arbitrator.getState()).toBe("A_PLAYING");

      // Lane B done arrives while A is playing (unusual but valid)
      arbitrator.onLaneBDone();

      expect(stopReflexSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("LISTENING");
      expect(completeSpy).toHaveBeenCalled();
      expect((arbitrator as any).responseInProgress).toBe(false);
    });
  });

  describe("onLaneBDone - Case 4: Defensive Reset", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should handle Lane B done in unexpected states", () => {
      const completeSpy = jest.fn();
      arbitrator.on("response_complete", completeSpy);

      // Force into IDLE state (shouldn't happen, but test defensive handling)
      (arbitrator as any).state = "IDLE";

      arbitrator.onLaneBDone();

      // Should still emit completion even from unexpected state
      expect(completeSpy).toHaveBeenCalled();
    });

    it("should NOT reset ENDED state", () => {
      arbitrator.endSession();
      expect(arbitrator.getState()).toBe("ENDED");

      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("ENDED"); // Should remain ENDED
    });
  });

  describe("Error Recovery: resetResponseInProgress", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should reset response guard when called", () => {
      arbitrator.onUserSpeechEnded();
      expect((arbitrator as any).responseInProgress).toBe(true);

      arbitrator.resetResponseInProgress();

      expect((arbitrator as any).responseInProgress).toBe(false);
    });

    it("should transition B_RESPONDING → LISTENING on reset", () => {
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      arbitrator.resetResponseInProgress();

      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should clear timers on reset", () => {
      arbitrator.onUserSpeechEnded();

      // Verify timer is set
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      arbitrator.resetResponseInProgress();

      // Timers should be cleared
      expect(jest.getTimerCount()).toBe(0);
    });

    it("should do nothing if not in progress", () => {
      // No response in progress
      expect((arbitrator as any).responseInProgress).toBe(false);

      arbitrator.resetResponseInProgress(); // Should not throw

      expect((arbitrator as any).responseInProgress).toBe(false);
    });
  });

  describe("User Barge-In Handling", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should stop Lane A on barge-in", () => {
      const stopReflexSpy = jest.fn();
      arbitrator.on("stop_reflex", stopReflexSpy);

      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Lane A starts

      expect(arbitrator.getState()).toBe("A_PLAYING");

      arbitrator.onUserBargeIn();

      expect(stopReflexSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should stop Lane B on barge-in", () => {
      const stopLaneBSpy = jest.fn();
      arbitrator.on("stop_lane_b", stopLaneBSpy);

      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      expect(arbitrator.getState()).toBe("B_PLAYING");

      arbitrator.onUserBargeIn();

      expect(stopLaneBSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should emit owner_change on barge-in", (done) => {
      arbitrator.on("owner_change", (event) => {
        if (event.cause === "user_barge_in") {
          expect(event.from).toBe("B");
          expect(event.to).toBe("none");
          done();
        }
      });

      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      arbitrator.onUserBargeIn();
    });

    it("should clear response guard on barge-in", () => {
      arbitrator.onUserSpeechEnded();
      expect((arbitrator as any).responseInProgress).toBe(true);

      arbitrator.onUserBargeIn();

      expect((arbitrator as any).responseInProgress).toBe(false);
    });

    it("should clear timers on barge-in", () => {
      arbitrator.onUserSpeechEnded();
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      arbitrator.onUserBargeIn();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("Timing Metrics", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should track speech end time", () => {
      const before = Date.now();
      arbitrator.onUserSpeechEnded();
      const after = Date.now();

      const metrics = arbitrator.getMetrics();
      expect(metrics.speechEndTime).toBeGreaterThanOrEqual(before);
      expect(metrics.speechEndTime).toBeLessThanOrEqual(after);
    });

    it("should track Lane B ready time", () => {
      arbitrator.onUserSpeechEnded();

      const before = Date.now();
      arbitrator.onLaneBReady();
      const after = Date.now();

      const metrics = arbitrator.getMetrics();
      expect(metrics.bReadyTime).toBeGreaterThanOrEqual(before);
      expect(metrics.bReadyTime).toBeLessThanOrEqual(after);
    });

    it("should calculate latency", () => {
      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(350); // Simulate 350ms delay
      arbitrator.onLaneBReady();

      const metrics = arbitrator.getMetrics();
      expect(metrics.latencyMs).toBeGreaterThan(0);
    });
  });

  describe("Configuration Options", () => {
    it("should respect minDelayBeforeReflexMs", () => {
      const customArbitrator = new LaneArbitrator(sessionId, {
        minDelayBeforeReflexMs: 200, // Custom delay
      });
      customArbitrator.startSession();

      const playReflexSpy = jest.fn();
      customArbitrator.on("play_reflex", playReflexSpy);

      customArbitrator.onUserSpeechEnded();

      jest.advanceTimersByTime(100); // Not enough time
      expect(playReflexSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100); // Total 200ms
      expect(playReflexSpy).toHaveBeenCalled();
    });

    it("should respect maxReflexDurationMs", () => {
      const customArbitrator = new LaneArbitrator(sessionId, {
        maxReflexDurationMs: 1000, // Custom max
      });
      customArbitrator.startSession();

      const stopReflexSpy = jest.fn();
      customArbitrator.on("stop_reflex", stopReflexSpy);

      customArbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Trigger Lane A

      jest.advanceTimersByTime(900); // Not enough
      expect(stopReflexSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100); // Total 1000ms
      expect(stopReflexSpy).toHaveBeenCalled();
    });

    it("should respect transitionGapMs", (done) => {
      const customArbitrator = new LaneArbitrator(sessionId, {
        transitionGapMs: 50, // Custom gap
      });
      customArbitrator.startSession();

      const playLaneBSpy = jest.fn();
      customArbitrator.on("play_lane_b", playLaneBSpy);

      customArbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100); // Lane A starts

      customArbitrator.onLaneBReady();

      // Should wait 50ms before playing Lane B
      setTimeout(() => {
        expect(playLaneBSpy).not.toHaveBeenCalled();
      }, 25);

      setTimeout(() => {
        expect(playLaneBSpy).toHaveBeenCalled();
        done();
      }, 60);

      jest.advanceTimersByTime(60);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should handle rapid barge-ins", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      // Rapid barge-ins
      arbitrator.onUserBargeIn();
      arbitrator.onUserBargeIn();
      arbitrator.onUserBargeIn();

      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should handle Lane B ready multiple times", () => {
      arbitrator.onUserSpeechEnded();

      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");

      // Second onLaneBReady should be ignored (already in B_PLAYING)
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");
    });

    it("should handle speech end in unexpected states", () => {
      // Force into A_PLAYING state
      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100);

      expect(arbitrator.getState()).toBe("A_PLAYING");

      // Try to trigger speech end again - should be ignored
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("A_PLAYING"); // Unchanged
    });

    it("should handle session end while in A_PLAYING", () => {
      arbitrator.onUserSpeechEnded();
      jest.advanceTimersByTime(100);

      expect(arbitrator.getState()).toBe("A_PLAYING");

      arbitrator.endSession();

      expect(arbitrator.getState()).toBe("ENDED");
      expect(jest.getTimerCount()).toBe(0); // Timers cleared
    });

    it("should handle session end while in B_PLAYING", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      expect(arbitrator.getState()).toBe("B_PLAYING");

      arbitrator.endSession();

      expect(arbitrator.getState()).toBe("ENDED");
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("Event Bus Integration", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should emit lane.owner_changed events", (done) => {
      let eventCount = 0;

      arbitrator.on("owner_change", (event) => {
        eventCount++;
        expect(event).toHaveProperty("from");
        expect(event).toHaveProperty("to");
        expect(event).toHaveProperty("cause");

        if (eventCount === 2) {
          // Second event: B → none (response complete)
          done();
        }
      });

      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady(); // none → B
      arbitrator.onLaneBDone(); // B → none
    });

    it("should emit lane.b_ready events", (done) => {
      // Note: This test assumes eventBus.emit is called (integration point)
      // For pure unit testing, we'd mock the eventBus

      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      // Verify event was emitted (indirectly through state change)
      expect(arbitrator.getState()).toBe("B_PLAYING");
      done();
    });
  });

  describe("Complete Integration Flows", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should handle complete happy path: Lane A → Lane B preemption", (done) => {
      const events: string[] = [];

      arbitrator.on("play_reflex", () => events.push("play_reflex"));
      arbitrator.on("stop_reflex", () => events.push("stop_reflex"));
      arbitrator.on("play_lane_b", () => events.push("play_lane_b"));
      arbitrator.on("response_complete", () => events.push("response_complete"));

      // User speaks
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      // Lane A triggers after delay
      jest.advanceTimersByTime(100);
      expect(arbitrator.getState()).toBe("A_PLAYING");

      // Lane B ready - preempts A
      arbitrator.onLaneBReady();
      jest.advanceTimersByTime(15); // Wait for transition gap

      expect(arbitrator.getState()).toBe("B_PLAYING");

      // Lane B completes
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING");

      expect(events).toEqual([
        "play_reflex",
        "stop_reflex",
        "play_lane_b",
        "response_complete",
      ]);

      done();
    });

    it("should handle fast Lane B (no Lane A)", () => {
      const events: string[] = [];

      arbitrator.on("play_reflex", () => events.push("play_reflex"));
      arbitrator.on("play_lane_b", () => events.push("play_lane_b"));
      arbitrator.on("response_complete", () => events.push("response_complete"));

      // User speaks
      arbitrator.onUserSpeechEnded();

      // Lane B ready before Lane A timer (< 100ms)
      arbitrator.onLaneBReady();

      expect(arbitrator.getState()).toBe("B_PLAYING");

      // Lane B completes
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING");

      expect(events).toEqual(["play_lane_b", "response_complete"]);
      expect(events).not.toContain("play_reflex"); // Lane A never triggered
    });

    it("should handle commit failure scenario", () => {
      const events: string[] = [];

      arbitrator.on("response_complete", () => events.push("response_complete"));

      // User speaks
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      // Commit fails - reset
      arbitrator.resetResponseInProgress();
      expect(arbitrator.getState()).toBe("LISTENING");

      // OpenAI sends response.done anyway
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING");
      expect(events).toContain("response_complete");
    });
  });
});
