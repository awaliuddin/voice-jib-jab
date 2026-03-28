/**
 * Prometheus HTTP metrics middleware — N-66.
 *
 * Records httpRequestsTotal and httpRequestDurationMs for every completed
 * HTTP request. Mounted early in the middleware stack so all routes are covered.
 *
 * Route normalisation: uses req.route?.path when available (set by Express after
 * routing) so parameterised routes like /sessions/:id appear as /sessions/:id
 * rather than /sessions/abc-123. Falls back to req.path for middleware-level
 * responses (e.g. 404, body-size limit).
 *
 * Design decisions:
 *   - Uses res.on("finish") so status and duration are final before recording.
 *   - Accepts optional custom instances for test isolation.
 */

import type { Request, Response, NextFunction } from "express";
import type { Counter, Histogram } from "prom-client";
import {
  httpRequestsTotal as defaultCounter,
  httpRequestDurationMs as defaultHistogram,
} from "../metrics/registry.js";

/** Options for injecting custom Prometheus counter/histogram instances. */
export interface PrometheusMiddlewareOptions {
  counter?: Counter<"method" | "route" | "status">;
  histogram?: Histogram<"method" | "route" | "status">;
}

/** Create Express middleware that records HTTP request count and duration via Prometheus. */
export function createPrometheusMiddleware(options: PrometheusMiddlewareOptions = {}) {
  const counter = options.counter ?? defaultCounter;
  const histogram = options.histogram ?? defaultHistogram;

  return function prometheusMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startMs = Date.now();

    res.on("finish", () => {
      const method = req.method;
      const route = (req.route?.path as string | undefined) ?? req.path;
      const status = String(res.statusCode);
      const durationMs = Date.now() - startMs;

      counter.inc({ method, route, status });
      histogram.observe({ method, route, status }, durationMs);
    });

    next();
  };
}
