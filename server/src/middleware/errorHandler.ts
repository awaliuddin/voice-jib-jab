/**
 * Global JSON error handler middleware — N-45.
 *
 * Catches any error passed to next(err) and returns a structured JSON
 * response, ensuring Express never leaks HTML 500 pages or raw stack
 * traces to clients in production.
 *
 * Behaviour:
 *   - Preserves err.status / err.statusCode when explicitly set by the
 *     throwing code (e.g. createError(400, "bad input")).
 *   - Falls back to 500 for all unrecognised errors.
 *   - In development (NODE_ENV === "development"), includes the error
 *     message in the response body to aid local debugging.
 *   - In production, returns only a generic "Internal server error" to
 *     prevent information disclosure.
 *   - Logs every 5xx to stderr with the X-Request-ID so it can be
 *     correlated with access logs.
 *
 * Mount AFTER all routes:
 *   app.use(jsonErrorHandler);
 */

import type { Request, Response, NextFunction } from "express";

/** An Error with optional HTTP status code fields. */
export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

/** Express error middleware that returns structured JSON and logs 5xx errors to stderr. */
export function jsonErrorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  // next must be declared even if unused — Express uses arity to detect error middleware
  _next: NextFunction,
): void {
  const status =
    typeof err.status === "number" && err.status >= 100 && err.status < 600
      ? err.status
      : typeof err.statusCode === "number" && err.statusCode >= 100 && err.statusCode < 600
        ? err.statusCode
        : 500;

  // Log server errors with request correlation ID for traceability.
  if (status >= 500) {
    const requestId = req.requestId ?? req.headers["x-request-id"] ?? "unknown";
    console.error(`[ErrorHandler] ${status} on ${req.method} ${req.path} — requestId=${String(requestId)}`, err);
  }

  const isDev = process.env.NODE_ENV === "development";
  const message =
    isDev && err.message
      ? err.message
      : status < 500
        ? err.message ?? "Bad request"
        : "Internal server error";

  res.status(status).json({ error: message });
}
