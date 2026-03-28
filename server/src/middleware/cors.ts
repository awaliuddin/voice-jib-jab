/**
 * CORS middleware (N-40)
 *
 * Behaviour:
 *  - ALLOWED_ORIGINS unset / "*"  → wildcard (dev/open mode, same as before N-40)
 *  - ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"
 *    → allowlist mode: reflects Origin header only when it matches the list;
 *      rejects unlisted origins with 403.
 *
 * Always sets Access-Control-Allow-Headers so browser pre-flight requests
 * for X-API-Key succeed.
 *
 * Pre-flight OPTIONS requests are terminated with 204 when the origin is
 * allowed, so they don't travel further into the middleware stack.
 */

import type { Request, Response, NextFunction } from "express";

export interface CorsOptions {
  /** Comma-separated list of allowed origins, or "*" for wildcard. */
  allowedOrigins: string;
}

const ALLOWED_HEADERS = "Origin, X-Requested-With, Content-Type, Accept, X-API-Key, X-Request-ID";
const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

/** Create Express middleware that enforces CORS origin allowlist or wildcard mode. */
export function createCorsMiddleware(options: CorsOptions) {
  const raw = options.allowedOrigins.trim();
  const wildcard = raw === "" || raw === "*";

  // Parse the allowlist once at startup
  const allowlist: Set<string> = wildcard
    ? new Set()
    : new Set(raw.split(",").map((o) => o.trim()).filter(Boolean));

  return function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;

    if (wildcard) {
      res.header("Access-Control-Allow-Origin", "*");
    } else if (origin && allowlist.has(origin)) {
      // Reflect the matched origin so cookies/credentials work correctly
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    } else if (origin) {
      // Origin present but not in allowlist — reject
      res.status(403).json({ error: "CORS: origin not allowed" });
      return;
    }
    // No Origin header (non-browser / server-to-server) — pass through

    res.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.header("Access-Control-Allow-Methods", ALLOWED_METHODS);

    // Terminate pre-flight without reaching route handlers
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  };
}
