/**
 * Tenant Compliance Router — per-tenant regulatory export.
 *
 * Endpoint:
 *   GET /tenants/:tenantId/compliance-report
 *
 * Returns a ComplianceReport aggregating all sessions for the given tenant,
 * with optional date-range filtering via `from` and `to` query parameters.
 * Designed for EU AI Act / enterprise compliance workflows.
 */

import { Router } from "express";
import type { SessionRecorder } from "../services/SessionRecorder.js";
import type { AnalyticsService } from "../services/AnalyticsService.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-session compliance data included in a tenant compliance report. */
export interface ComplianceSessionEntry {
  sessionId: string;
  startedAt: string;
  durationMs: number;
  policyDecisions: Array<{ decision: string; count: number }>;
  escalationCount: number;
  claimsChecked: number;
  complianceRate: number;
}

/** Aggregated compliance report for a tenant, with optional date-range filtering. */
export interface ComplianceReport {
  tenantId: string;
  generatedAt: string;
  period: {
    from: string | null;
    to: string | null;
  };
  summary: {
    totalSessions: number;
    totalPolicyDecisions: number;
    complianceRate: number;
    totalEscalations: number;
    totalClaimsChecked: number;
  };
  sessions: ComplianceSessionEntry[];
}

// ---------------------------------------------------------------------------
// Tenant ID validation
// ---------------------------------------------------------------------------

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create the tenant compliance router.
 *
 * @param recorder - SessionRecorder used to load full recordings (including timelines).
 * @param analytics - AnalyticsService used to enumerate sessions for a tenant.
 */
export function createTenantComplianceRouter(
  recorder: SessionRecorder,
  analytics: AnalyticsService,
): Router {
  const router = Router();

  /**
   * GET /tenants/:tenantId/compliance-report
   *
   * Path param:
   *   tenantId — must match /^[a-zA-Z0-9_-]+$/
   *
   * Query params:
   *   from  — optional ISO date string (inclusive lower bound on startedAt)
   *   to    — optional ISO date string (inclusive upper bound on startedAt)
   *   format — optional, only "json" supported (default)
   *
   * Returns 400 for invalid tenantId format.
   * Returns 404 when no sessions are found for the tenant.
   * Returns 200 with ComplianceReport on success.
   */
  router.get("/:tenantId/compliance-report", (req, res) => {
    const { tenantId } = req.params;

    if (!TENANT_ID_PATTERN.test(tenantId)) {
      res.status(400).json({ error: "Invalid tenantId format" });
      return;
    }

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;

    // Enumerate all sessions for this tenant using AnalyticsService metrics.
    // getAggregateMetrics returns sessions: SessionMetrics[] for the filter.
    const aggregate = analytics.getAggregateMetrics({ tenantId });
    let sessionMetrics = aggregate.sessions;

    // Apply date filters (ISO string comparison is lexicographically correct).
    if (from !== null) {
      sessionMetrics = sessionMetrics.filter((s) => s.startedAt >= from);
    }
    if (to !== null) {
      sessionMetrics = sessionMetrics.filter((s) => s.startedAt <= to);
    }

    if (sessionMetrics.length === 0) {
      res.status(404).json({ error: "No sessions found for tenant" });
      return;
    }

    // Build per-session compliance entries by loading full recordings.
    const sessionEntries: ComplianceSessionEntry[] = [];

    for (const metric of sessionMetrics) {
      const recording = recorder.loadRecording(metric.sessionId);
      if (recording === null || recording === undefined) {
        // Skip sessions whose recordings cannot be loaded.
        continue;
      }

      // Count claims.check events in the timeline.
      const claimsChecked = recording.timeline.filter(
        (entry) => entry.type === "claims.check",
      ).length;

      // Build policy decision breakdown as sorted array of { decision, count }.
      const policyDecisionEntries: Array<{ decision: string; count: number }> =
        Object.entries(recording.summary.policyDecisions)
          .filter(([, count]) => count > 0)
          .map(([decision, count]) => ({ decision, count }))
          .sort((a, b) => a.decision.localeCompare(b.decision));

      const totalDecisions = policyDecisionEntries.reduce(
        (sum, e) => sum + e.count,
        0,
      );
      const allowCount = recording.summary.policyDecisions.allow ?? 0;
      const rewriteCount = recording.summary.policyDecisions.rewrite ?? 0;
      const complianceRate =
        totalDecisions === 0
          ? 0
          : ((allowCount + rewriteCount) / totalDecisions) * 100;

      const escalationCount =
        recording.summary.policyDecisions.escalate ?? 0;

      sessionEntries.push({
        sessionId: recording.sessionId,
        startedAt: recording.startedAt,
        durationMs: recording.durationMs ?? 0,
        policyDecisions: policyDecisionEntries,
        escalationCount,
        claimsChecked,
        complianceRate,
      });
    }

    // If every session's recording was missing, treat as no data found.
    if (sessionEntries.length === 0) {
      res.status(404).json({ error: "No sessions found for tenant" });
      return;
    }

    // Aggregate summary across all loaded sessions.
    const totalPolicyDecisions = sessionEntries.reduce(
      (sum, s) =>
        sum + s.policyDecisions.reduce((ds, d) => ds + d.count, 0),
      0,
    );
    const totalEscalations = sessionEntries.reduce(
      (sum, s) => sum + s.escalationCount,
      0,
    );
    const totalClaimsChecked = sessionEntries.reduce(
      (sum, s) => sum + s.claimsChecked,
      0,
    );
    const totalAllowRewrite = sessionEntries.reduce((sum, s) => {
      // Recompute allow + rewrite count from policyDecisions array.
      const allowEntry = s.policyDecisions.find((d) => d.decision === "allow");
      const rewriteEntry = s.policyDecisions.find(
        (d) => d.decision === "rewrite",
      );
      return (
        sum + (allowEntry?.count ?? 0) + (rewriteEntry?.count ?? 0)
      );
    }, 0);
    const summaryComplianceRate =
      totalPolicyDecisions === 0
        ? 0
        : (totalAllowRewrite / totalPolicyDecisions) * 100;

    const report: ComplianceReport = {
      tenantId,
      generatedAt: new Date().toISOString(),
      period: { from, to },
      summary: {
        totalSessions: sessionEntries.length,
        totalPolicyDecisions,
        complianceRate: summaryComplianceRate,
        totalEscalations,
        totalClaimsChecked,
      },
      sessions: sessionEntries,
    };

    res.json(report);
  });

  return router;
}
