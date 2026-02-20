/**
 * SessionManager Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager, SessionState } from "../state/SessionManager";

describe("SessionManager", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionManager = new SessionManager("ws://localhost:3000");
  });

  afterEach(() => {
    sessionManager.disconnect();
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should start in idle state", () => {
      expect(sessionManager.getState()).toBe("idle");
    });

    it("should transition to initializing on initialize()", async () => {
      const stateChanges: SessionState[] = [];
      sessionManager.setOnStateChange((state) => stateChanges.push(state));

      const initPromise = sessionManager.initialize();

      expect(stateChanges[0]).toBe("initializing");

      // Flush timers multiple times to allow the async fingerprint generation
      // to settle, then the WebSocket setTimeout(0) to fire, then initialize()
      // to complete. Each advanceTimersByTimeAsync settles pending microtasks
      // before advancing timers.
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      await initPromise;

      expect(stateChanges).toContain("connected");
    });
  });

  describe("state transitions", () => {
    it("should notify state changes", async () => {
      const callback = vi.fn();
      sessionManager.setOnStateChange(callback);

      const initPromise = sessionManager.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      expect(callback).toHaveBeenCalledWith("initializing");
      expect(callback).toHaveBeenCalledWith("connected");
    });

    it("should return current state", async () => {
      const initPromise = sessionManager.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      expect(sessionManager.getState()).toBe("connected");
    });
  });

  describe("metrics", () => {
    it("should return initial metrics", () => {
      const metrics = sessionManager.getMetrics();

      expect(metrics.ttfb).toBeNull();
      expect(metrics.turnLatency).toBeNull();
      expect(metrics.bargeInStop).toBeNull();
    });

    it("should notify metrics updates", async () => {
      const callback = vi.fn();
      sessionManager.setOnMetricsUpdate(callback);

      const initPromise = sessionManager.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      // Metrics updates happen during audio playback
      // Initial state has no updates
      expect(sessionManager.getMetrics()).toEqual({
        ttfb: null,
        turnLatency: null,
        bargeInStop: null,
      });
    });
  });

  describe("startTalking", () => {
    it("should not start when not connected", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await sessionManager.startTalking();

      expect(warnSpy).toHaveBeenCalled();
      expect(sessionManager.getState()).toBe("idle");

      warnSpy.mockRestore();
    });
  });

  describe("stopTalking", () => {
    it("should not throw when not talking", () => {
      expect(() => sessionManager.stopTalking()).not.toThrow();
    });
  });

  describe("bargeIn", () => {
    it("should not throw when no audio playing", async () => {
      const initPromise = sessionManager.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      await expect(sessionManager.bargeIn()).resolves.toBeUndefined();
    });
  });

  describe("disconnect", () => {
    it("should transition to idle state", async () => {
      const initPromise = sessionManager.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      sessionManager.disconnect();

      expect(sessionManager.getState()).toBe("idle");
    });

    it("should not throw when already idle", () => {
      expect(() => sessionManager.disconnect()).not.toThrow();
    });
  });

  describe("isAudioPlaying", () => {
    it("should return false when not playing", async () => {
      const initPromise = sessionManager.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      expect(sessionManager.isAudioPlaying()).toBe(false);
    });
  });
});
