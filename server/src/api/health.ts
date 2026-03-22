/**
 * Health Monitor API
 *
 * GET /health/live       — liveness probe (always 200 while process runs)
 * GET /health/ready      — readiness probe (503 when any critical subsystem is down)
 * GET /health/subsystems — returns all subsystem statuses and overall health
 */

import { Router } from "express";
import type { HealthMonitorService } from "../services/HealthMonitorService.js";

// ── Router factory ────────────────────────────────────────────────

/**
 * Create an Express router for the health monitor endpoints.
 *
 * @param monitor - The HealthMonitorService instance to query
 * @returns Configured Express Router
 */
export function createHealthRouter(monitor: HealthMonitorService): Router {
  const router = Router();

  // ── GET /health/live ──────────────────────────────────────────

  /**
   * Liveness probe — always returns 200 while the process is alive.
   *
   * K8s uses this to detect deadlocked containers. Must never perform
   * dependency checks; a slow or unavailable downstream service must not
   * cause this endpoint to return a non-200 response.
   *
   * Response body:
   *   live      — always true
   *   uptime    — process uptime in seconds
   *   pid       — process ID
   *   timestamp — ISO timestamp of when this response was generated
   */
  router.get("/live", (_req, res) => {
    res.json({
      live: true,
      uptime: process.uptime(),
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /health/ready ─────────────────────────────────────────

  /**
   * Readiness probe — reports whether the server is ready to accept traffic.
   *
   * Returns 503 only when the overall system status is "down". A "degraded"
   * status still returns 200 so the load-balancer keeps routing traffic while
   * partial degradation is investigated. Used by load-balancers and
   * orchestrators to gate traffic, distinct from the startup-flag /ready in
   * index.ts which K8s uses as a startup probe.
   *
   * Response body (200):
   *   ready     — true
   *   overall   — "healthy" | "degraded"
   *   timestamp — ISO timestamp of when this response was generated
   *
   * Response body (503):
   *   ready     — false
   *   reason    — human-readable explanation
   *   overall   — "down"
   *   timestamp — ISO timestamp of when this response was generated
   */
  router.get("/ready", (_req, res) => {
    const overall = monitor.getOverallStatus();
    if (overall === "down") {
      return res.status(503).json({
        ready: false,
        reason: "One or more critical subsystems are down",
        overall,
        timestamp: new Date().toISOString(),
      });
    }
    return res.json({
      ready: true,
      overall,
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /health/subsystems ────────────────────────────────────

  /**
   * Return overall system status and the status of all subsystems.
   *
   * Response body:
   *   overall    — "healthy" | "degraded" | "down"
   *   subsystems — array of SubsystemStatus objects
   *   checkedAt  — ISO timestamp of when this response was generated
   */
  router.get("/subsystems", (_req, res) => {
    res.json({
      overall: monitor.getOverallStatus(),
      subsystems: monitor.getStatus(),
      checkedAt: new Date().toISOString(),
    });
  });

  return router;
}
