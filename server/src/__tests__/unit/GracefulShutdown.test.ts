/**
 * GracefulShutdown Tests (N-38)
 *
 * Verifies coordinated shutdown: all targets closed concurrently, idempotency,
 * force-exit on timeout, error resilience, and signal registration.
 */

import { GracefulShutdown, type ShutdownTarget } from "../../services/GracefulShutdown.js";

function makeTarget(
  behaviour: "immediate" | "error" | "throw" | "never" = "immediate",
): ShutdownTarget {
  return {
    close(callback?: (err?: Error) => void): void {
      if (behaviour === "immediate") {
        callback?.();
      } else if (behaviour === "error") {
        callback?.(new Error("close failed"));
      } else if (behaviour === "throw") {
        throw new Error("close threw");
      }
      // "never" — callback is never called (simulates hanging target)
    },
  };
}

describe("GracefulShutdown", () => {
  let exitFn: jest.Mock;

  beforeEach(() => {
    exitFn = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("shutdown()", () => {
    it("calls close() on all targets", async () => {
      const t1 = { close: jest.fn((cb?: (err?: Error) => void) => cb?.()) };
      const t2 = { close: jest.fn((cb?: (err?: Error) => void) => cb?.()) };
      const sd = new GracefulShutdown([t1, t2], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      expect(t1.close).toHaveBeenCalledTimes(1);
      expect(t2.close).toHaveBeenCalledTimes(1);
    });

    it("calls exitFn(0) after all targets close", async () => {
      const sd = new GracefulShutdown([makeTarget(), makeTarget()], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      expect(exitFn).toHaveBeenCalledWith(0);
    });

    it("is idempotent — second call is a no-op", async () => {
      const t = { close: jest.fn((cb?: (err?: Error) => void) => cb?.()) };
      const sd = new GracefulShutdown([t], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      await sd.shutdown("SIGTERM");
      expect(t.close).toHaveBeenCalledTimes(1);
      expect(exitFn).toHaveBeenCalledTimes(1);
    });

    it("continues when one target errors in callback", async () => {
      const t1 = makeTarget("error");
      const t2 = makeTarget("immediate");
      const sd = new GracefulShutdown([t1, t2], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      expect(exitFn).toHaveBeenCalledWith(0);
    });

    it("continues when one target throws synchronously", async () => {
      const t1 = makeTarget("throw");
      const t2 = makeTarget("immediate");
      const sd = new GracefulShutdown([t1, t2], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      expect(exitFn).toHaveBeenCalledWith(0);
    });

    it("works with zero targets", async () => {
      const sd = new GracefulShutdown([], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      expect(exitFn).toHaveBeenCalledWith(0);
    });

    it("force-exits with code 1 after timeout when target never closes", async () => {
      const t = makeTarget("never");
      const sd = new GracefulShutdown([t], 500, exitFn);
      // fire-and-forget — the promise never resolves when target never calls its callback
      void sd.shutdown("SIGTERM");
      // Advance fake timers past the timeout threshold
      jest.advanceTimersByTime(501);
      // Drain microtasks so the timeout callback executes
      await Promise.resolve();
      expect(exitFn).toHaveBeenCalledWith(1);
    });

    it("does NOT call exitFn(1) before timeout elapses", async () => {
      const t = makeTarget("never");
      const sd = new GracefulShutdown([t], 1000, exitFn);
      void sd.shutdown("SIGTERM");
      jest.advanceTimersByTime(999);
      await Promise.resolve();
      expect(exitFn).not.toHaveBeenCalledWith(1);
    });

    it("logs the signal name", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const sd = new GracefulShutdown([], 10_000, exitFn);
      await sd.shutdown("SIGINT");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("SIGINT"));
      logSpy.mockRestore();
    });

    it("closes targets concurrently (both close() calls happen before either resolves)", async () => {
      const order: string[] = [];
      const t1: ShutdownTarget = {
        close(cb?: (err?: Error) => void) {
          order.push("t1-start");
          // Defer resolve to next microtask
          Promise.resolve().then(() => {
            order.push("t1-end");
            cb?.();
          });
        },
      };
      const t2: ShutdownTarget = {
        close(cb?: (err?: Error) => void) {
          order.push("t2-start");
          Promise.resolve().then(() => {
            order.push("t2-end");
            cb?.();
          });
        },
      };
      const sd = new GracefulShutdown([t1, t2], 10_000, exitFn);
      await sd.shutdown("SIGTERM");
      // Both starts should appear before both ends (concurrent, not sequential)
      expect(order.indexOf("t1-start")).toBeLessThan(order.indexOf("t1-end"));
      expect(order.indexOf("t2-start")).toBeLessThan(order.indexOf("t2-end"));
      expect(order.slice(0, 2)).toContain("t1-start");
      expect(order.slice(0, 2)).toContain("t2-start");
    });
  });

  describe("register()", () => {
    it("adds SIGTERM listener to process", () => {
      const before = process.listenerCount("SIGTERM");
      const sd = new GracefulShutdown([], 10_000, exitFn);
      sd.register();
      expect(process.listenerCount("SIGTERM")).toBe(before + 1);
      // Clean up
      process.removeAllListeners("SIGTERM");
    });

    it("adds SIGINT listener to process", () => {
      const before = process.listenerCount("SIGINT");
      const sd = new GracefulShutdown([], 10_000, exitFn);
      sd.register();
      expect(process.listenerCount("SIGINT")).toBe(before + 1);
      // Clean up
      process.removeAllListeners("SIGINT");
    });
  });
});
