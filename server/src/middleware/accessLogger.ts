/**
 * Structured access logger middleware — N-47.
 *
 * Logs one JSON line per completed HTTP request to stderr, enabling
 * correlation with error logs (which also carry X-Request-ID).
 *
 * Log format (JSON, one line per request):
 *   {
 *     "ts":        "<ISO 8601>",
 *     "method":    "GET",
 *     "path":      "/health",
 *     "status":    200,
 *     "ms":        12,
 *     "requestId": "abc-123"
 *   }
 *
 * Design decisions:
 *   - Uses `res.on("finish")` so the status code and duration are final.
 *   - Skips /health to avoid log spam from K8s liveness probes.
 *   - No dependency on morgan or any external logger — keeps the
 *     production bundle lean and the output format under our control.
 *   - Output goes to stderr (not stdout) so it can be separated from
 *     application output in container log drivers.
 *   - Configurable skip predicate for testing (default: skip /health).
 */

import type { Request, Response, NextFunction } from "express";

export interface AccessLoggerOptions {
  /** Return true to skip logging for this request. Default: skip /health. */
  skip?: (req: Request) => boolean;
  /** Output function. Default: process.stderr.write. Injected in tests. */
  write?: (line: string) => void;
}

const DEFAULT_SKIP = (req: Request): boolean => req.path === "/health";

/** Create Express middleware that emits one structured JSON log line per completed request. */
export function createAccessLogger(options: AccessLoggerOptions = {}) {
  const skip = options.skip ?? DEFAULT_SKIP;
  const write = options.write ?? ((line: string) => process.stderr.write(line));

  return function accessLogger(req: Request, res: Response, next: NextFunction): void {
    if (skip(req)) {
      next();
      return;
    }

    const startMs = Date.now();

    res.on("finish", () => {
      const entry = {
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - startMs,
        requestId: req.requestId ?? (req.headers["x-request-id"] as string | undefined) ?? undefined,
      };
      write(JSON.stringify(entry) + "\n");
    });

    next();
  };
}
