/**
 * SLA Monitor API
 *
 * GET /sla/status    — returns SlaStatus JSON
 * GET /sla/dashboard — returns self-contained HTML dashboard
 */

import { Router } from "express";
import type { SlaMonitor } from "../services/SlaMonitor.js";
import { slaDashboardHtml } from "./slaDashboard.js";

// ── Router factory ─────────────────────────────────────────────────

/**
 * Create an Express router for SLA monitor endpoints.
 *
 * @param monitor - The SlaMonitor instance to query
 * @returns Configured Express Router
 */
export function createSlaRouter(monitor: SlaMonitor): Router {
  const router = Router();

  // ── GET /sla/status ──────────────────────────────────────────

  /**
   * Return current SLA status for all configured metrics.
   *
   * Response body: SlaStatus
   *   overall        — "ok" | "warning" | "critical"
   *   metrics        — array of SlaMetricStats
   *   windowMinutes  — rolling window size in minutes
   *   evaluatedAt    — ISO timestamp of evaluation
   */
  router.get("/status", (_req, res) => {
    res.json(monitor.getStatus());
  });

  // ── GET /sla/dashboard ───────────────────────────────────────

  /**
   * Serve a self-contained HTML dashboard that auto-refreshes every 10s.
   */
  router.get("/dashboard", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(slaDashboardHtml());
  });

  return router;
}
