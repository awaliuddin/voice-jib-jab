/**
 * Minimal in-memory rate limiter middleware.
 *
 * No external dependencies required. Tracks request counts per IP within
 * a sliding window. Suitable for single-instance deployments; does not
 * persist across restarts or share state across processes.
 */

import type { Request, Response, NextFunction } from "express";

export interface RateLimiterOptions {
  /** Duration of the rate-limit window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per IP within the window. */
  max: number;
  /** JSON error message returned when the limit is exceeded. */
  message: string;
}

interface HitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const hits = new Map<string, HitEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > options.max) {
      return res.status(429).json({ error: options.message });
    }

    next();
  };
}
