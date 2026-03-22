/**
 * RequestTracker Unit Tests
 *
 * Covers in-flight request counting middleware and graceful-drain logic.
 *
 * Scenarios:
 * - getCount() starts at 0
 * - middleware increments on request start, decrements on res "finish"
 * - middleware decrements on res "close" and does NOT double-decrement when
 *   both "finish" and "close" fire (common in HTTP/1.1 keep-alive flows)
 * - waitForDrain() resolves true immediately when count is already 0
 * - waitForDrain() resolves true once the in-flight request finishes
 * - waitForDrain() resolves false when timeout elapses before drain
 * - count never goes below 0
 */

import { EventEmitter } from "events";
import { RequestTracker } from "../../middleware/requestTracker.js";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake Response that supports event emitter semantics. */
function makeFakeRes(): Response & EventEmitter {
  const emitter = new EventEmitter();
  return emitter as unknown as Response & EventEmitter;
}

/** Minimal fake Request (content irrelevant to tracker). */
function makeFakeReq(): Request {
  return {} as Request;
}

/** Invoke the middleware and capture the next() call. */
function runMiddleware(
  tracker: RequestTracker,
  res: Response
): { nextCalled: boolean } {
  const state = { nextCalled: false };
  const next: NextFunction = () => {
    state.nextCalled = true;
  };
  tracker.middleware()(makeFakeReq(), res, next);
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RequestTracker", () => {
  describe("getCount()", () => {
    it("starts at 0 before any requests", () => {
      const tracker = new RequestTracker();
      expect(tracker.getCount()).toBe(0);
    });
  });

  describe("middleware()", () => {
    it("increments count when a request begins", () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);
      expect(tracker.getCount()).toBe(1);
    });

    it("calls next()", () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      const { nextCalled } = runMiddleware(tracker, res);
      expect(nextCalled).toBe(true);
    });

    it("decrements count when res emits 'finish'", () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);
      expect(tracker.getCount()).toBe(1);
      res.emit("finish");
      expect(tracker.getCount()).toBe(0);
    });

    it("decrements count when res emits 'close'", () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);
      expect(tracker.getCount()).toBe(1);
      res.emit("close");
      expect(tracker.getCount()).toBe(0);
    });

    it("does not double-decrement when both 'finish' and 'close' fire", () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);
      expect(tracker.getCount()).toBe(1);
      res.emit("finish");
      res.emit("close"); // second event must be a no-op
      expect(tracker.getCount()).toBe(0);
    });

    it("tracks multiple concurrent requests independently", () => {
      const tracker = new RequestTracker();
      const res1 = makeFakeRes();
      const res2 = makeFakeRes();
      const res3 = makeFakeRes();

      runMiddleware(tracker, res1);
      runMiddleware(tracker, res2);
      runMiddleware(tracker, res3);
      expect(tracker.getCount()).toBe(3);

      res1.emit("finish");
      expect(tracker.getCount()).toBe(2);

      res2.emit("close");
      expect(tracker.getCount()).toBe(1);

      res3.emit("finish");
      expect(tracker.getCount()).toBe(0);
    });

    it("count never goes below 0", () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);
      res.emit("finish");
      res.emit("finish"); // spurious second emission
      expect(tracker.getCount()).toBe(0);
    });
  });

  describe("waitForDrain()", () => {
    it("resolves true immediately when count is already 0", async () => {
      const tracker = new RequestTracker();
      const result = await tracker.waitForDrain(500);
      expect(result).toBe(true);
    });

    it("resolves true once the in-flight request finishes", async () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);

      // Finish the request after a short delay (less than timeout)
      setTimeout(() => res.emit("finish"), 60);

      const result = await tracker.waitForDrain(500);
      expect(result).toBe(true);
      expect(tracker.getCount()).toBe(0);
    });

    it("resolves false when timeout elapses before drain", async () => {
      const tracker = new RequestTracker();
      const res = makeFakeRes();
      runMiddleware(tracker, res);

      // Never finish the request — drain must time out
      const result = await tracker.waitForDrain(120);
      expect(result).toBe(false);
      expect(tracker.getCount()).toBe(1);

      // Clean up so the EventEmitter has no lingering references
      res.emit("finish");
    }, 500);

    it("resolves true if count drops to 0 before the deadline", async () => {
      const tracker = new RequestTracker();
      const res1 = makeFakeRes();
      const res2 = makeFakeRes();
      runMiddleware(tracker, res1);
      runMiddleware(tracker, res2);

      setTimeout(() => res1.emit("finish"), 30);
      setTimeout(() => res2.emit("finish"), 80);

      const result = await tracker.waitForDrain(500);
      expect(result).toBe(true);
    });
  });
});
