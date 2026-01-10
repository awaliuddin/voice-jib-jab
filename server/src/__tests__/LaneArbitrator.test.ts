/**
 * Tests for LaneArbitrator state machine
 */

import {
  LaneArbitrator,
  ArbitratorState,
} from "../orchestrator/LaneArbitrator.js";

describe("LaneArbitrator", () => {
  let arbitrator: LaneArbitrator;

  beforeEach(() => {
    arbitrator = new LaneArbitrator("test-session-123");
  });

  afterEach(() => {
    // Clean up timers by ending the session
    arbitrator.endSession();
  });

  describe("initialization", () => {
    it("should start in IDLE state", () => {
      expect(arbitrator.getState()).toBe("IDLE");
    });

    it("should have no audio owner initially", () => {
      expect(arbitrator.getCurrentOwner()).toBe("none");
    });

    it("should have Lane A enabled by default", () => {
      expect(arbitrator.isLaneAEnabled()).toBe(true);
    });
  });

  describe("session lifecycle", () => {
    it("should transition to LISTENING on startSession", () => {
      arbitrator.startSession();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should transition to ENDED on endSession", () => {
      arbitrator.startSession();
      arbitrator.endSession();
      expect(arbitrator.getState()).toBe("ENDED");
    });

    it("should emit state_change events", () => {
      const states: ArbitratorState[] = [];
      arbitrator.on("state_change", (transition) => {
        states.push(transition.to);
      });

      arbitrator.startSession();
      arbitrator.endSession();

      expect(states).toEqual(["LISTENING", "ENDED"]);
    });
  });

  describe("user speech ended flow", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should transition to B_RESPONDING when user speech ends", () => {
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");
    });

    it("should emit play_reflex after delay when Lane A enabled", (done) => {
      arbitrator.on("play_reflex", () => {
        expect(arbitrator.getState()).toBe("A_PLAYING");
        done();
      });

      arbitrator.onUserSpeechEnded();
    }, 500);

    it("should not emit play_reflex when Lane A disabled", (done) => {
      const arbitratorNoA = new LaneArbitrator("test-session-no-a", {
        laneAEnabled: false,
      });
      arbitratorNoA.startSession();

      let reflexCalled = false;
      arbitratorNoA.on("play_reflex", () => {
        reflexCalled = true;
      });

      arbitratorNoA.onUserSpeechEnded();

      setTimeout(() => {
        expect(reflexCalled).toBe(false);
        expect(arbitratorNoA.getState()).toBe("B_RESPONDING");
        done();
      }, 300);
    });
  });

  describe("Lane B ready flow", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should transition to B_PLAYING when Lane B is ready", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");
    });

    it("should set owner to B when Lane B is ready", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getCurrentOwner()).toBe("B");
    });

    it("should emit owner_change event", (done) => {
      arbitrator.on("owner_change", (change) => {
        if (change.to === "B") {
          expect(change.cause).toBe("b_first_audio_ready");
          done();
        }
      });

      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
    });

    it("should stop Lane A when Lane B preempts", (done) => {
      // First trigger Lane A
      arbitrator.on("play_reflex", () => {
        // Now trigger Lane B ready
        arbitrator.on("stop_reflex", () => {
          done();
        });
        arbitrator.onLaneBReady();
      });

      arbitrator.onUserSpeechEnded();
    }, 500);
  });

  describe("Lane B done flow", () => {
    beforeEach(() => {
      arbitrator.startSession();
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
    });

    it("should transition to LISTENING when Lane B is done", () => {
      arbitrator.onLaneBDone();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should set owner to none when Lane B is done", () => {
      arbitrator.onLaneBDone();
      expect(arbitrator.getCurrentOwner()).toBe("none");
    });

    it("should emit response_complete event", (done) => {
      arbitrator.on("response_complete", () => {
        done();
      });
      arbitrator.onLaneBDone();
    });
  });

  describe("barge-in handling", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should transition to LISTENING on barge-in from A_PLAYING", (done) => {
      arbitrator.on("play_reflex", () => {
        arbitrator.onUserBargeIn();
        expect(arbitrator.getState()).toBe("LISTENING");
        done();
      });
      arbitrator.onUserSpeechEnded();
    }, 500);

    it("should transition to LISTENING on barge-in from B_PLAYING", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");

      arbitrator.onUserBargeIn();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should emit stop_reflex on barge-in during Lane A", (done) => {
      arbitrator.on("play_reflex", () => {
        arbitrator.on("stop_reflex", () => {
          done();
        });
        arbitrator.onUserBargeIn();
      });
      arbitrator.onUserSpeechEnded();
    }, 500);

    it("should emit stop_lane_b on barge-in during Lane B", (done) => {
      arbitrator.on("stop_lane_b", () => {
        done();
      });

      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      arbitrator.onUserBargeIn();
    });

    it("should set owner to none on barge-in", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      expect(arbitrator.getCurrentOwner()).toBe("B");

      arbitrator.onUserBargeIn();
      expect(arbitrator.getCurrentOwner()).toBe("none");
    });
  });

  describe("metrics tracking", () => {
    beforeEach(() => {
      arbitrator.startSession();
    });

    it("should track speech end time", () => {
      arbitrator.onUserSpeechEnded();
      const metrics = arbitrator.getMetrics();
      expect(metrics.speechEndTime).not.toBeNull();
    });

    it("should track Lane B ready time", () => {
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      const metrics = arbitrator.getMetrics();
      expect(metrics.bReadyTime).not.toBeNull();
    });

    it("should calculate latency between speech end and B ready", () => {
      arbitrator.onUserSpeechEnded();
      // Small delay to ensure measurable latency
      arbitrator.onLaneBReady();
      const metrics = arbitrator.getMetrics();
      expect(metrics.latencyMs).not.toBeNull();
      expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("state history", () => {
    it("should record state transitions", () => {
      arbitrator.startSession();
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();
      arbitrator.onLaneBDone();

      const history = arbitrator.getStateHistory();
      expect(history.length).toBeGreaterThanOrEqual(4);
      expect(history[0].to).toBe("LISTENING");
    });
  });

  describe("configuration", () => {
    it("should respect custom config", () => {
      const customArbitrator = new LaneArbitrator("custom-session", {
        laneAEnabled: false,
        minDelayBeforeReflexMs: 500,
      });

      expect(customArbitrator.isLaneAEnabled()).toBe(false);
    });
  });
});
