/**
 * Rate limiter configuration constants (N-41)
 *
 * Centralises all per-route rate limit settings so they can be:
 *   - imported and asserted in tests (no inline magic numbers)
 *   - reviewed by ops/security without reading index.ts
 *   - updated in one place without hunting across the codebase
 *
 * All windows are 60 seconds. Adjust `max` to tune per-route budgets.
 */

import type { RateLimiterOptions } from "../middleware/rateLimiter.js";

export const RATE_LIMITS = {
  /** Key management endpoints — tight limit to prevent brute-force key creation. */
  auth: {
    windowMs: 60_000,
    max: 20,
    message: "Auth API rate limit exceeded",
  } satisfies RateLimiterOptions,

  /** Admin configuration endpoints — moderate; admin operations are infrequent. */
  admin: {
    windowMs: 60_000,
    max: 30,
    message: "Admin API rate limit exceeded",
  } satisfies RateLimiterOptions,

  /** Voice trigger endpoints — tight; real-time voice calls should not be hammered. */
  voice: {
    windowMs: 60_000,
    max: 10,
    message: "Voice API rate limit exceeded",
  } satisfies RateLimiterOptions,

  /** Analytics read endpoints — generous; dashboards poll frequently. */
  analytics: {
    windowMs: 60_000,
    max: 60,
    message: "Analytics API rate limit exceeded",
  } satisfies RateLimiterOptions,

  /** Session read/write endpoints — generous; session operations are frequent. */
  sessions: {
    windowMs: 60_000,
    max: 60,
    message: "Sessions API rate limit exceeded",
  } satisfies RateLimiterOptions,
} as const;
