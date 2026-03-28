/**
 * Analytics API Router — provides HTTP endpoints for querying session
 * analytics and aggregate metrics.
 *
 * Endpoints:
 *   GET /analytics/sessions       — list sessions with aggregate metrics (filterable)
 *   GET /analytics/sessions/:id   — get metrics for a single session
 *   GET /analytics/summary        — aggregate metrics across all sessions
 *   GET /analytics/dashboard      — full aggregate + sentimentDistribution + callsPerDay + topPolicyViolations
 *   GET /analytics/tenants        — per-tenant comparison metrics
 *   GET /analytics/calls-per-day  — calls grouped by day (filterable)
 *   GET /analytics/export.csv     — call log as downloadable CSV
 */

import { Router } from "express";
import type { AnalyticsService, AnalyticsFilter } from "../services/AnalyticsService.js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ── Router factory ───────────────────────────────────────────────────

interface AnalyticsRouterDeps {
  analyticsService: AnalyticsService;
  loadRecording?: (sessionId: string) => unknown | null;
}

/** Router for /analytics — session metrics, aggregate summary, dashboard, tenant comparison, and CSV export. */
export function createAnalyticsRouter(
  analyticsService: AnalyticsService,
  loadRecording?: (sessionId: string) => unknown | null,
): Router {
  const router = Router();
  const deps: AnalyticsRouterDeps = { analyticsService, loadRecording };

  /**
   * GET /sessions — list sessions with aggregate metrics.
   * Query params: tenantId, from, to, limit, offset
   */
  router.get("/sessions", (req, res) => {
    const filter: AnalyticsFilter = {};

    if (typeof req.query.tenantId === "string" && req.query.tenantId) {
      filter.tenantId = req.query.tenantId;
    }

    // Validate date params
    if (typeof req.query.from === "string" && req.query.from) {
      if (isNaN(Date.parse(req.query.from))) {
        res.status(400).json({ error: "from must be a valid ISO date string" });
        return;
      }
      filter.fromDate = req.query.from;
    }
    if (typeof req.query.to === "string" && req.query.to) {
      if (isNaN(Date.parse(req.query.to))) {
        res.status(400).json({ error: "to must be a valid ISO date string" });
        return;
      }
      filter.toDate = req.query.to;
    }

    // Validate limit — reject invalid values, clamp valid values to range
    const rawLimit = parseInt(req.query.limit as string, 10);
    if (req.query.limit !== undefined && (!Number.isFinite(rawLimit) || rawLimit < 1)) {
      res.status(400).json({ error: `limit must be between 1 and ${MAX_LIMIT}` });
      return;
    }
    filter.limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // Validate offset
    const rawOffset = parseInt(req.query.offset as string, 10);
    if (req.query.offset !== undefined && (!Number.isFinite(rawOffset) || rawOffset < 0)) {
      res.status(400).json({ error: "offset must be >= 0" });
      return;
    }
    filter.offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const metrics = deps.analyticsService.getAggregateMetrics(filter);

    res.json({
      filter: {
        tenantId: filter.tenantId ?? null,
        from: filter.fromDate ?? null,
        to: filter.toDate ?? null,
        limit: filter.limit,
        offset: filter.offset,
      },
      metrics,
    });
  });

  /**
   * GET /sessions/:id — get metrics for a single session.
   */
  router.get("/sessions/:id", (req, res) => {
    const sessionId = req.params.id;

    // Try to find the session in the recordings list
    const allMetrics = deps.analyticsService.getAggregateMetrics({ limit: 10000 });
    const session = allMetrics.sessions.find((s) => s.sessionId === sessionId);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  });

  /**
   * GET /summary — aggregate metrics across all sessions (no filter).
   */
  router.get("/summary", (_req, res) => {
    const metrics = deps.analyticsService.getAggregateMetrics();
    res.json(metrics);
  });

  /**
   * GET /dashboard — full aggregate including sentimentDistribution, callsPerDay,
   * and topPolicyViolations (no filter applied).
   */
  router.get("/dashboard", (_req, res) => {
    const metrics = deps.analyticsService.getAggregateMetrics();
    res.json(metrics);
  });

  /**
   * GET /tenants — per-tenant comparison metrics across all sessions.
   */
  router.get("/tenants", (_req, res) => {
    const comparison = deps.analyticsService.getTenantComparison();
    res.json(comparison);
  });

  /**
   * GET /calls-per-day — calls grouped by ISO date, sorted ascending.
   * Query params: tenantId, from, to
   */
  router.get("/calls-per-day", (req, res) => {
    const filter: AnalyticsFilter = {};

    if (typeof req.query.tenantId === "string" && req.query.tenantId) {
      filter.tenantId = req.query.tenantId;
    }
    if (typeof req.query.from === "string" && req.query.from) {
      if (isNaN(Date.parse(req.query.from))) {
        res.status(400).json({ error: "from must be a valid ISO date string" });
        return;
      }
      filter.fromDate = req.query.from;
    }
    if (typeof req.query.to === "string" && req.query.to) {
      if (isNaN(Date.parse(req.query.to))) {
        res.status(400).json({ error: "to must be a valid ISO date string" });
        return;
      }
      filter.toDate = req.query.to;
    }

    const result = deps.analyticsService.getCallsPerDay(filter);
    res.json(result);
  });

  /**
   * GET /export.csv — download call log as CSV.
   * Query params: tenantId, from, to, limit
   * Columns: sessionId, tenantId, startedAt, durationMs, turnCount,
   *          qualityScore, complianceRate, escalationCount, policyDecisions
   */
  router.get("/export.csv", (req, res) => {
    const filter: AnalyticsFilter = {};

    if (typeof req.query.tenantId === "string" && req.query.tenantId) {
      filter.tenantId = req.query.tenantId;
    }
    if (typeof req.query.from === "string" && req.query.from) {
      if (isNaN(Date.parse(req.query.from))) {
        res.status(400).json({ error: "from must be a valid ISO date string" });
        return;
      }
      filter.fromDate = req.query.from;
    }
    if (typeof req.query.to === "string" && req.query.to) {
      if (isNaN(Date.parse(req.query.to))) {
        res.status(400).json({ error: "to must be a valid ISO date string" });
        return;
      }
      filter.toDate = req.query.to;
    }

    const rawLimit = parseInt(req.query.limit as string, 10);
    if (req.query.limit !== undefined && (!Number.isFinite(rawLimit) || rawLimit < 1)) {
      res.status(400).json({ error: `limit must be between 1 and ${MAX_LIMIT}` });
      return;
    }
    filter.limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const metrics = deps.analyticsService.getAggregateMetrics(filter);

    const CSV_HEADERS =
      "sessionId,tenantId,startedAt,durationMs,turnCount,qualityScore,complianceRate,escalationCount,policyDecisions";

    const rows = metrics.sessions.map((s) => {
      const policyDecisionsJson = JSON.stringify(s.policyDecisions).replace(/"/g, '""');
      return [
        s.sessionId,
        s.tenantId ?? "",
        s.startedAt,
        s.durationMs !== null ? String(s.durationMs) : "",
        String(s.turnCount),
        String(s.qualityScore),
        String(s.complianceRate),
        String(s.escalationCount),
        `"${policyDecisionsJson}"`,
      ].join(",");
    });

    const csv = [CSV_HEADERS, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="call-log.csv"');
    res.send(csv);
  });

  return router;
}
