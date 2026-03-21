/**
 * Quota API
 *
 * GET    /tenants/:tenantId/quota          — get quota config (defaults when not set)
 * PUT    /tenants/:tenantId/quota          — upsert quota config
 * DELETE /tenants/:tenantId/quota          — delete quota config (resets to defaults)
 * GET    /tenants/:tenantId/usage          — get usage for current month (?month=YYYY-MM)
 * POST   /tenants/:tenantId/usage/record   — record minutes { minutes: number }
 */

import { Router } from "express";
import type { TenantQuotaService } from "../services/TenantQuotaService.js";

// ── Router factory ──────────────────────────────────────────────────────

export function createQuotaRouter(service: TenantQuotaService): Router {
  const router = Router({ mergeParams: true });

  // ── GET /tenants/:tenantId/quota ──────────────────────────────────

  /**
   * Get quota configuration for a tenant.
   *
   * When no quota has been configured, returns the system defaults with
   * isDefault: true. The tenantId in the path is reflected in the response.
   *
   * Returns: TenantQuotaConfig | DefaultQuotaResponse
   */
  router.get("/:tenantId/quota", (req, res) => {
    const { tenantId } = req.params;
    const quota = service.getQuota(tenantId);

    if (!quota) {
      res.json({
        tenantId,
        requestsPerMinute: 60,
        maxConcurrentSessions: 5,
        monthlyMinutesQuota: 0,
        updatedAt: null,
        isDefault: true,
      });
      return;
    }

    res.json(quota);
  });

  // ── PUT /tenants/:tenantId/quota ──────────────────────────────────

  /**
   * Upsert quota configuration for a tenant.
   *
   * Body: partial { requestsPerMinute, maxConcurrentSessions, monthlyMinutesQuota }
   *
   * Returns 200 + TenantQuotaConfig.
   * Returns 400 when a field is present but has an invalid type.
   */
  router.put("/:tenantId/quota", (req, res) => {
    const { tenantId } = req.params;
    const body = req.body as Record<string, unknown>;

    if (
      body.requestsPerMinute !== undefined &&
      typeof body.requestsPerMinute !== "number"
    ) {
      res.status(400).json({ error: "requestsPerMinute must be a number" });
      return;
    }

    if (
      body.maxConcurrentSessions !== undefined &&
      typeof body.maxConcurrentSessions !== "number"
    ) {
      res.status(400).json({ error: "maxConcurrentSessions must be a number" });
      return;
    }

    if (
      body.monthlyMinutesQuota !== undefined &&
      typeof body.monthlyMinutesQuota !== "number"
    ) {
      res.status(400).json({ error: "monthlyMinutesQuota must be a number" });
      return;
    }

    const config = service.setQuota(tenantId, {
      requestsPerMinute:
        typeof body.requestsPerMinute === "number"
          ? body.requestsPerMinute
          : undefined,
      maxConcurrentSessions:
        typeof body.maxConcurrentSessions === "number"
          ? body.maxConcurrentSessions
          : undefined,
      monthlyMinutesQuota:
        typeof body.monthlyMinutesQuota === "number"
          ? body.monthlyMinutesQuota
          : undefined,
    });

    res.json(config);
  });

  // ── DELETE /tenants/:tenantId/quota ───────────────────────────────

  /**
   * Delete quota configuration for a tenant (resets to defaults).
   *
   * Returns 204 on success.
   * Returns 404 when no quota config exists for this tenant.
   */
  router.delete("/:tenantId/quota", (req, res) => {
    const { tenantId } = req.params;
    const deleted = service.deleteQuota(tenantId);

    if (!deleted) {
      res
        .status(404)
        .json({ error: `No quota config found for tenant: ${tenantId}` });
      return;
    }

    res.status(204).send();
  });

  // ── GET /tenants/:tenantId/usage ──────────────────────────────────

  /**
   * Get usage record for a tenant.
   *
   * Query params:
   *   month — "YYYY-MM" key; defaults to current month
   *
   * When no usage has been recorded, returns a zeroed record.
   *
   * Returns: TenantUsageRecord
   */
  router.get("/:tenantId/usage", (req, res) => {
    const { tenantId } = req.params;
    const monthKey =
      typeof req.query.month === "string" ? req.query.month : undefined;

    const usage = service.getUsage(tenantId, monthKey);
    const resolvedMonthKey = monthKey ?? service.getCurrentMonthKey();

    if (!usage) {
      res.json({
        tenantId,
        monthKey: resolvedMonthKey,
        minutesUsed: 0,
        sessionsStarted: 0,
        updatedAt: null,
      });
      return;
    }

    res.json(usage);
  });

  // ── POST /tenants/:tenantId/usage/record ──────────────────────────

  /**
   * Record audio minutes for a tenant (billing hook).
   *
   * Body: { minutes: number }
   *
   * Returns 200 + updated TenantUsageRecord.
   * Returns 400 when minutes is missing or not a number.
   */
  router.post("/:tenantId/usage/record", (req, res) => {
    const { tenantId } = req.params;
    const body = req.body as Record<string, unknown>;

    if (typeof body.minutes !== "number") {
      res.status(400).json({ error: "minutes must be a number" });
      return;
    }

    service.recordSessionMinutes(tenantId, body.minutes);

    const usage = service.getUsage(tenantId);
    res.json(usage);
  });

  return router;
}
