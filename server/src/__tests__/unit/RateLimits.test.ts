/**
 * Rate Limiter Config Constants Tests (N-41)
 *
 * Asserts the production rate limit values so any change to RATE_LIMITS is
 * a deliberate, reviewed, test-breaking commit — not a silent inline tweak.
 *
 * Also verifies structural integrity (all required fields present, types correct)
 * and enforces the security invariant that auth < admin < analytics/sessions.
 */

import { RATE_LIMITS } from "../../config/rateLimits.js";

describe("RATE_LIMITS constants (N-41)", () => {
  describe("structure", () => {
    const routes = ["auth", "admin", "voice", "analytics", "sessions"] as const;

    it.each(routes)("%s has windowMs, max, and message", (route) => {
      const cfg = RATE_LIMITS[route];
      expect(typeof cfg.windowMs).toBe("number");
      expect(typeof cfg.max).toBe("number");
      expect(typeof cfg.message).toBe("string");
      expect(cfg.message.length).toBeGreaterThan(0);
    });

    it.each(routes)("%s windowMs is positive", (route) => {
      expect(RATE_LIMITS[route].windowMs).toBeGreaterThan(0);
    });

    it.each(routes)("%s max is a positive integer", (route) => {
      const { max } = RATE_LIMITS[route];
      expect(max).toBeGreaterThan(0);
      expect(Number.isInteger(max)).toBe(true);
    });
  });

  describe("production values", () => {
    it("auth max is 20 req/min", () => {
      expect(RATE_LIMITS.auth.max).toBe(20);
      expect(RATE_LIMITS.auth.windowMs).toBe(60_000);
    });

    it("admin max is 30 req/min", () => {
      expect(RATE_LIMITS.admin.max).toBe(30);
      expect(RATE_LIMITS.admin.windowMs).toBe(60_000);
    });

    it("voice max is 10 req/min", () => {
      expect(RATE_LIMITS.voice.max).toBe(10);
      expect(RATE_LIMITS.voice.windowMs).toBe(60_000);
    });

    it("analytics max is 60 req/min", () => {
      expect(RATE_LIMITS.analytics.max).toBe(60);
      expect(RATE_LIMITS.analytics.windowMs).toBe(60_000);
    });

    it("sessions max is 60 req/min", () => {
      expect(RATE_LIMITS.sessions.max).toBe(60);
      expect(RATE_LIMITS.sessions.windowMs).toBe(60_000);
    });
  });

  describe("security invariants", () => {
    it("auth limit is stricter than admin (key mgmt needs tightest control)", () => {
      expect(RATE_LIMITS.auth.max).toBeLessThan(RATE_LIMITS.admin.max);
    });

    it("voice limit is strictest of all (real-time surface, not a dashboard)", () => {
      const allMax = Object.values(RATE_LIMITS).map((c) => c.max);
      expect(RATE_LIMITS.voice.max).toBe(Math.min(...allMax));
    });

    it("all error messages contain 'rate limit'", () => {
      for (const cfg of Object.values(RATE_LIMITS)) {
        expect(cfg.message.toLowerCase()).toContain("rate limit");
      }
    });

    it("all windows are the same (60s) — consistent behaviour across routes", () => {
      const windows = Object.values(RATE_LIMITS).map((c) => c.windowMs);
      const unique = new Set(windows);
      expect(unique.size).toBe(1);
      expect([...unique][0]).toBe(60_000);
    });
  });
});
