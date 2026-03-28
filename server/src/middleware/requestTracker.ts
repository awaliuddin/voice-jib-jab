import type { Request, Response, NextFunction } from "express";

/** Tracks in-flight HTTP requests for graceful shutdown draining. */
export class RequestTracker {
  private count = 0;

  /** Express middleware — increments count on request, decrements on finish/close. */
  middleware() {
    return (_req: Request, res: Response, next: NextFunction): void => {
      this.count++;
      let decremented = false;
      const decrement = () => {
        if (decremented) return;
        decremented = true;
        this.count = Math.max(0, this.count - 1);
      };
      res.once("finish", decrement);
      res.once("close", decrement);
      next();
    };
  }

  /** Current number of in-flight requests. */
  getCount(): number {
    return this.count;
  }

  /**
   * Resolves when in-flight count reaches 0 or timeoutMs elapses.
   * Polls every 50ms.
   * @returns true if drained cleanly, false if timed out
   */
  async waitForDrain(timeoutMs = 5_000): Promise<boolean> {
    if (this.count === 0) return true;
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const poll = () => {
        if (this.count === 0) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
    });
  }
}
