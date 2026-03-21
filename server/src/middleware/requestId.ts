/**
 * requestId — Request Correlation ID Middleware (N-37)
 *
 * Reads X-Request-ID from the inbound request header. If absent, generates a
 * new UUID v4. Attaches the ID to `req.requestId` for downstream use (logging,
 * audit events) and echoes it in the response as X-Request-ID.
 *
 * This enables log correlation across services and distributed tracing without
 * an external tracing library.
 */

import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

/** Max length allowed for a client-supplied X-Request-ID (prevent log injection). */
const MAX_REQUEST_ID_LENGTH = 128;

/** Validate that a client-supplied ID contains only safe characters. */
function isSafeRequestId(value: string): boolean {
  return /^[a-zA-Z0-9\-_.]+$/.test(value);
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  let requestId: string;

  if (
    typeof incoming === "string" &&
    incoming.length > 0 &&
    incoming.length <= MAX_REQUEST_ID_LENGTH &&
    isSafeRequestId(incoming)
  ) {
    requestId = incoming;
  } else {
    requestId = randomUUID();
  }

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}
