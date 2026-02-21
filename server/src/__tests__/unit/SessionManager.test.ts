/**
 * SessionManager Unit Tests
 *
 * Tests the full session lifecycle: creation, state transitions, idle timeout,
 * touch (activity refresh), ending (with cleanup delay), and active-session
 * queries.  EventBus and uuid are mocked so the tests run in isolation.
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
    offSession: jest.fn(),
  },
}));

let uuidCounter = 0;
jest.mock("uuid", () => ({
  v4: jest.fn(() => `mock-uuid-${++uuidCounter}`),
}));

import { SessionManager } from "../../orchestrator/SessionManager.js";
import { eventBus } from "../../orchestrator/EventBus.js";

// ── Helpers ─────────────────────────────────────────────────────────────

const mockedEmit = eventBus.emit as jest.Mock;
const mockedOffSession = eventBus.offSession as jest.Mock;

// ── Tests ───────────────────────────────────────────────────────────────

describe("SessionManager", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    uuidCounter = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── constructor ─────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should default to 30-minute idle timeout", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      // Advance to just under 30 minutes — session should still be alive
      jest.advanceTimersByTime(30 * 60 * 1000 - 1);
      expect(manager.getSession(session.id)?.state).not.toBe("ended");

      // Advance past 30 minutes — session should be ended
      jest.advanceTimersByTime(2);
      expect(manager.getSession(session.id)?.state).toBe("ended");
    });

    it("should accept a custom idle-time in minutes", () => {
      const manager = new SessionManager(5);
      const session = manager.createSession();

      jest.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(manager.getSession(session.id)?.state).not.toBe("ended");

      jest.advanceTimersByTime(2);
      expect(manager.getSession(session.id)?.state).toBe("ended");
    });
  });

  // ── createSession ───────────────────────────────────────────────────

  describe("createSession()", () => {
    it("should return a session with a uuid, timestamps, and 'idle' state", () => {
      const now = Date.now();
      const manager = new SessionManager();
      const session = manager.createSession();

      expect(session.id).toMatch(/^mock-uuid-/);
      expect(session.createdAt).toBeGreaterThanOrEqual(now);
      expect(session.lastActivityAt).toBeGreaterThanOrEqual(now);
      expect(session.state).toBe("idle");
    });

    it("should store the provided metadata on the session", () => {
      const manager = new SessionManager();
      const meta = { userId: "u-42", locale: "en-US" };
      const session = manager.createSession(meta);

      expect(session.metadata).toEqual(meta);
    });

    it("should default metadata to an empty object", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      expect(session.metadata).toEqual({});
    });

    it("should emit a session.start event via eventBus", () => {
      const manager = new SessionManager();
      const meta = { tenant: "acme" };
      manager.createSession(meta);

      expect(mockedEmit).toHaveBeenCalledTimes(1);
      expect(mockedEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "orchestrator",
          type: "session.start",
          payload: { metadata: meta },
        }),
      );
    });

    it("should include event_id, session_id, and t_ms in the emitted event", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      const emittedEvent = mockedEmit.mock.calls[0][0];
      expect(typeof emittedEvent.event_id).toBe("string");
      expect(emittedEvent.event_id.length).toBeGreaterThan(0);
      expect(emittedEvent.session_id).toBe(session.id);
      expect(typeof emittedEvent.t_ms).toBe("number");
    });

    it("should set up a session timeout", () => {
      const manager = new SessionManager(1); // 1-minute timeout
      const session = manager.createSession();
      jest.clearAllMocks();

      jest.advanceTimersByTime(60 * 1000);

      // The timeout should have triggered endSession, which emits session.end
      expect(mockedEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session.end" }),
      );
      expect(manager.getSession(session.id)?.state).toBe("ended");
    });

    it("should make the session retrievable via getSession", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      expect(manager.getSession(session.id)).toBe(session);
    });
  });

  // ── getSession ──────────────────────────────────────────────────────

  describe("getSession()", () => {
    it("should return the session for a valid ID", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      const fetched = manager.getSession(session.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(session.id);
    });

    it("should return undefined for an unknown ID", () => {
      const manager = new SessionManager();
      expect(manager.getSession("nonexistent-id")).toBeUndefined();
    });
  });

  // ── updateSessionState ──────────────────────────────────────────────

  describe("updateSessionState()", () => {
    it("should update the session state", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      manager.updateSessionState(session.id, "listening");
      expect(manager.getSession(session.id)?.state).toBe("listening");

      manager.updateSessionState(session.id, "responding");
      expect(manager.getSession(session.id)?.state).toBe("responding");
    });

    it("should update lastActivityAt to the current time", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      const originalActivity = session.lastActivityAt;

      jest.advanceTimersByTime(5000);
      manager.updateSessionState(session.id, "listening");

      expect(session.lastActivityAt).toBeGreaterThan(originalActivity);
    });

    it("should reset the idle timeout", () => {
      const manager = new SessionManager(1); // 1-minute timeout
      const session = manager.createSession();

      // Advance 50 seconds, then touch via state update — should reset timer
      jest.advanceTimersByTime(50_000);
      manager.updateSessionState(session.id, "listening");

      // Advance another 50 seconds — still within the fresh 60s window
      jest.advanceTimersByTime(50_000);
      expect(manager.getSession(session.id)?.state).toBe("listening");

      // Advance past the full 60s from the last reset
      jest.advanceTimersByTime(11_000);
      expect(manager.getSession(session.id)?.state).toBe("ended");
    });

    it("should throw an Error for an unknown session ID", () => {
      const manager = new SessionManager();

      expect(() => {
        manager.updateSessionState("does-not-exist", "listening");
      }).toThrow("Session not found: does-not-exist");
    });
  });

  // ── touchSession ────────────────────────────────────────────────────

  describe("touchSession()", () => {
    it("should update lastActivityAt to the current time", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      const originalActivity = session.lastActivityAt;

      jest.advanceTimersByTime(3000);
      manager.touchSession(session.id);

      expect(session.lastActivityAt).toBeGreaterThan(originalActivity);
    });

    it("should reset the idle timeout", () => {
      const manager = new SessionManager(1); // 1-minute timeout
      const session = manager.createSession();

      jest.advanceTimersByTime(50_000);
      manager.touchSession(session.id);

      // 50s after touch — still alive
      jest.advanceTimersByTime(50_000);
      expect(manager.getSession(session.id)?.state).not.toBe("ended");

      // Past the 60s since last touch
      jest.advanceTimersByTime(11_000);
      expect(manager.getSession(session.id)?.state).toBe("ended");
    });

    it("should be a no-op for an unknown session ID (no throw)", () => {
      const manager = new SessionManager();

      expect(() => {
        manager.touchSession("no-such-session");
      }).not.toThrow();
    });
  });

  // ── endSession ──────────────────────────────────────────────────────

  describe("endSession()", () => {
    it("should set the session state to 'ended'", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      manager.endSession(session.id);
      expect(session.state).toBe("ended");
    });

    it("should clear the idle timeout", () => {
      const manager = new SessionManager(1);
      const session = manager.createSession();
      jest.clearAllMocks();

      manager.endSession(session.id);

      // Advance past the original timeout — no second session.end should fire
      jest.advanceTimersByTime(60 * 1000 + 1);
      // Only the one explicit endSession call should have emitted
      expect(mockedEmit).toHaveBeenCalledTimes(1);
    });

    it("should emit a session.end event with reason and duration_ms", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      jest.clearAllMocks();

      jest.advanceTimersByTime(10_000);
      manager.endSession(session.id, "manual_stop");

      expect(mockedEmit).toHaveBeenCalledTimes(1);
      const endEvent = mockedEmit.mock.calls[0][0];
      expect(endEvent.type).toBe("session.end");
      expect(endEvent.session_id).toBe(session.id);
      expect(endEvent.payload.reason).toBe("manual_stop");
      expect(typeof endEvent.payload.duration_ms).toBe("number");
      expect(endEvent.payload.duration_ms).toBeGreaterThanOrEqual(10_000);
    });

    it("should call eventBus.offSession to clean up handlers", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      manager.endSession(session.id);

      expect(mockedOffSession).toHaveBeenCalledWith(session.id);
    });

    it("should be a no-op for an unknown session ID", () => {
      const manager = new SessionManager();
      jest.clearAllMocks();

      // Should not throw and should not emit
      manager.endSession("ghost-session");

      expect(mockedEmit).not.toHaveBeenCalled();
      expect(mockedOffSession).not.toHaveBeenCalled();
    });

    it("should delete the session from the map after 5000ms delay", () => {
      const manager = new SessionManager();
      const session = manager.createSession();

      manager.endSession(session.id);

      // Session still present immediately after ending
      expect(manager.getSession(session.id)).toBeDefined();

      // Advance past the 5000ms cleanup delay
      jest.advanceTimersByTime(5000);
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it("should use default reason 'user_ended' when no reason is given", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      jest.clearAllMocks();

      manager.endSession(session.id);

      const endEvent = mockedEmit.mock.calls[0][0];
      expect(endEvent.payload.reason).toBe("user_ended");
    });

    it("should accept and use a custom reason string", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      jest.clearAllMocks();

      manager.endSession(session.id, "network_disconnect");

      const endEvent = mockedEmit.mock.calls[0][0];
      expect(endEvent.payload.reason).toBe("network_disconnect");
    });
  });

  // ── setupSessionTimeout (integration via public API) ────────────────

  describe("session idle timeout (integration)", () => {
    it("should auto-end a session after maxIdleTimeMs elapses", () => {
      const manager = new SessionManager(2); // 2 minutes
      const session = manager.createSession();
      jest.clearAllMocks();

      jest.advanceTimersByTime(2 * 60 * 1000);

      expect(session.state).toBe("ended");
      expect(mockedEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.end",
          payload: expect.objectContaining({ reason: "timeout" }),
        }),
      );
    });

    it("should reset the timeout when updateSessionState is called", () => {
      const manager = new SessionManager(1); // 1 minute
      const session = manager.createSession();

      // 55 seconds in — update state, which should reset the timer
      jest.advanceTimersByTime(55_000);
      manager.updateSessionState(session.id, "responding");

      // 55 seconds later (110s total) — still alive because timer was reset
      jest.advanceTimersByTime(55_000);
      expect(session.state).toBe("responding");

      // Push past the fresh 60s window
      jest.advanceTimersByTime(6_000);
      expect(session.state).toBe("ended");
    });

    it("should reset the timeout when touchSession is called", () => {
      const manager = new SessionManager(1); // 1 minute
      const session = manager.createSession();

      jest.advanceTimersByTime(55_000);
      manager.touchSession(session.id);

      jest.advanceTimersByTime(55_000);
      expect(session.state).not.toBe("ended");

      jest.advanceTimersByTime(6_000);
      expect(session.state).toBe("ended");
    });
  });

  // ── getActiveSessions ───────────────────────────────────────────────

  describe("getActiveSessions()", () => {
    it("should return only sessions whose state is not 'ended'", () => {
      const manager = new SessionManager();
      const s1 = manager.createSession();
      const s2 = manager.createSession();
      const s3 = manager.createSession();

      manager.endSession(s2.id);

      const active = manager.getActiveSessions();
      const activeIds = active.map((s) => s.id);

      expect(activeIds).toContain(s1.id);
      expect(activeIds).not.toContain(s2.id);
      expect(activeIds).toContain(s3.id);
      expect(active).toHaveLength(2);
    });

    it("should return an empty array when no sessions exist", () => {
      const manager = new SessionManager();
      expect(manager.getActiveSessions()).toEqual([]);
    });

    it("should exclude sessions in various non-idle active states that were ended", () => {
      const manager = new SessionManager();
      const s1 = manager.createSession();
      manager.updateSessionState(s1.id, "listening");

      const s2 = manager.createSession();
      manager.updateSessionState(s2.id, "responding");
      manager.endSession(s2.id);

      const active = manager.getActiveSessions();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(s1.id);
      expect(active[0].state).toBe("listening");
    });
  });

  // ── getSessionCount ─────────────────────────────────────────────────

  describe("getSessionCount()", () => {
    it("should return 0 for a fresh manager", () => {
      const manager = new SessionManager();
      expect(manager.getSessionCount()).toBe(0);
    });

    it("should return the correct count after creating sessions", () => {
      const manager = new SessionManager();
      manager.createSession();
      manager.createSession();
      manager.createSession();

      expect(manager.getSessionCount()).toBe(3);
    });

    it("should still count ended sessions until the cleanup delay passes", () => {
      const manager = new SessionManager();
      const session = manager.createSession();
      manager.endSession(session.id);

      // Ended but not yet cleaned up
      expect(manager.getSessionCount()).toBe(1);

      // After 5000ms cleanup delay the session is removed
      jest.advanceTimersByTime(5000);
      expect(manager.getSessionCount()).toBe(0);
    });
  });
});
