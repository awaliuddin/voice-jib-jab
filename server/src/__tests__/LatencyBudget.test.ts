/**
 * LatencyBudget Unit Tests
 */

import { LatencyBudget } from "../insurance/LatencyBudget.js";

describe("LatencyBudget", () => {
  let latencyBudget: LatencyBudget;
  const sessionId = "test-session";

  beforeEach(() => {
    latencyBudget = new LatencyBudget();
  });

  afterEach(() => {
    latencyBudget.clearSession(sessionId);
  });

  describe("recordTTFB", () => {
    it("should record TTFB values", () => {
      latencyBudget.recordTTFB(sessionId, 300);
      latencyBudget.recordTTFB(sessionId, 400);
      latencyBudget.recordTTFB(sessionId, 500);

      const stats = latencyBudget.getSessionStats(sessionId);
      expect(stats?.ttfb.count).toBe(3);
    });

    it("should calculate p50 correctly", () => {
      // Add values: 100, 200, 300, 400, 500
      latencyBudget.recordTTFB(sessionId, 300);
      latencyBudget.recordTTFB(sessionId, 100);
      latencyBudget.recordTTFB(sessionId, 500);
      latencyBudget.recordTTFB(sessionId, 200);
      latencyBudget.recordTTFB(sessionId, 400);

      const stats = latencyBudget.getSessionStats(sessionId);
      expect(stats?.ttfb.p50).toBe(300);
    });

    it("should calculate p95 correctly", () => {
      // Add 100 values from 10-1000
      for (let i = 1; i <= 100; i++) {
        latencyBudget.recordTTFB(sessionId, i * 10);
      }

      const stats = latencyBudget.getSessionStats(sessionId);
      // p95 is at index floor(100 * 0.95) = 95, which is value 960
      expect(stats?.ttfb.p95).toBeGreaterThanOrEqual(950);
      expect(stats?.ttfb.p95).toBeLessThanOrEqual(960);
    });
  });

  describe("recordTurnLatency", () => {
    it("should record turn latency values", () => {
      latencyBudget.recordTurnLatency(sessionId, 800);
      latencyBudget.recordTurnLatency(sessionId, 1000);

      const stats = latencyBudget.getSessionStats(sessionId);
      expect(stats?.turnLatency.count).toBe(2);
    });
  });

  describe("recordBargeInStop", () => {
    it("should record barge-in latency values", () => {
      latencyBudget.recordBargeInStop(sessionId, 150);
      latencyBudget.recordBargeInStop(sessionId, 200);

      const stats = latencyBudget.getSessionStats(sessionId);
      expect(stats?.bargeInStop.count).toBe(2);
    });

    it("should track p95 against target", () => {
      // Add values under 250ms target
      for (let i = 0; i < 95; i++) {
        latencyBudget.recordBargeInStop(sessionId, 100);
      }
      // Add values over target
      for (let i = 0; i < 5; i++) {
        latencyBudget.recordBargeInStop(sessionId, 300);
      }

      const stats = latencyBudget.getSessionStats(sessionId);
      expect(stats?.bargeInStop.p95).toBeLessThanOrEqual(300);
    });
  });

  describe("getSessionStats", () => {
    it("should return null for unknown session", () => {
      const stats = latencyBudget.getSessionStats("unknown-session");
      expect(stats).toBeNull();
    });

    it("should calculate all metrics correctly", () => {
      latencyBudget.recordTTFB(sessionId, 350);
      latencyBudget.recordTurnLatency(sessionId, 1000);
      latencyBudget.recordBargeInStop(sessionId, 180);

      const stats = latencyBudget.getSessionStats(sessionId);

      expect(stats?.ttfb.count).toBe(1);
      expect(stats?.ttfb.p50).toBe(350);
      expect(stats?.turnLatency.count).toBe(1);
      expect(stats?.bargeInStop.count).toBe(1);
    });
  });

  describe("getAggregateStats", () => {
    it("should return zeroes for empty data", () => {
      const stats = latencyBudget.getAggregateStats();

      expect(stats.ttfb.count).toBe(0);
      expect(stats.ttfb.p50).toBe(0);
      expect(stats.ttfb.p95).toBe(0);
      expect(stats.turnLatency.count).toBe(0);
      expect(stats.bargeInStop.count).toBe(0);
    });

    it("should aggregate across sessions", () => {
      latencyBudget.recordTTFB("session-1", 300);
      latencyBudget.recordTTFB("session-2", 400);

      const stats = latencyBudget.getAggregateStats();
      expect(stats.ttfb.count).toBe(2);
    });
  });

  describe("clearSession", () => {
    it("should clear metrics for a session", () => {
      latencyBudget.recordTTFB(sessionId, 300);
      latencyBudget.recordTurnLatency(sessionId, 1000);
      latencyBudget.recordBargeInStop(sessionId, 150);

      latencyBudget.clearSession(sessionId);

      const stats = latencyBudget.getSessionStats(sessionId);
      expect(stats).toBeNull();
    });
  });

  describe("mark and timeSince", () => {
    it("should mark timestamps", () => {
      latencyBudget.mark(sessionId, "start");

      // Wait a small amount
      const timeSince = latencyBudget.timeSince(sessionId, "start");
      expect(timeSince).toBeGreaterThanOrEqual(0);
      expect(timeSince).toBeLessThan(100);
    });

    it("should return null for unknown marker", () => {
      const timeSince = latencyBudget.timeSince(sessionId, "unknown");
      expect(timeSince).toBeNull();
    });

    it("should return null for unknown session", () => {
      const timeSince = latencyBudget.timeSince("unknown", "start");
      expect(timeSince).toBeNull();
    });
  });
});
