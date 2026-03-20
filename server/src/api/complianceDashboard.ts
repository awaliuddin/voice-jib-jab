/**
 * Compliance Dashboard Router — per-regulation compliance view across all tenants.
 *
 * Routes:
 *   GET /compliance-dashboard/overview              — ComplianceOverview JSON
 *   GET /compliance-dashboard/tenants/:tenantId     — TenantComplianceReport JSON
 *   GET /compliance-dashboard/tenants/:tenantId/certificate — HTML certificate
 *     ?format=pdf  — same HTML with Content-Type: application/pdf
 *   GET /compliance-dashboard/dashboard             — self-contained HTML dashboard
 */

import { Router } from "express";
import type { ComplianceDashboardService } from "../services/ComplianceDashboardService.js";
import { complianceDashboardPageHtml } from "./complianceDashboardHtml.js";

// ── Router factory ─────────────────────────────────────────────────────────

/**
 * Create the compliance dashboard router.
 *
 * @param service - ComplianceDashboardService instance
 * @returns Express Router
 */
export function createComplianceDashboardRouter(
  service: ComplianceDashboardService,
): Router {
  const router = Router();

  // ── GET /compliance-dashboard/overview ──────────────────────────────────

  router.get("/overview", async (_req, res) => {
    try {
      const overview = await service.generateOverview();
      res.json(overview);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  // ── GET /compliance-dashboard/tenants/:tenantId ──────────────────────────

  router.get("/tenants/:tenantId", async (req, res) => {
    const { tenantId } = req.params;
    try {
      const report = await service.evaluateTenant(tenantId);
      res.json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  // ── GET /compliance-dashboard/tenants/:tenantId/certificate ──────────────

  router.get("/tenants/:tenantId/certificate", async (req, res) => {
    const { tenantId } = req.params;
    const format = typeof req.query.format === "string" ? req.query.format : "html";

    let report;
    try {
      report = await service.evaluateTenant(tenantId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
      return;
    }

    if (!report.certificateEligible) {
      res.status(403).json({
        error: `Tenant "${tenantId}" is not certificate eligible. ` +
          `Current compliance score: ${report.complianceScorePct.toFixed(1)}%. ` +
          `A minimum score of 80% is required.`,
      });
      return;
    }

    const html = service.generateCertificateHtml(report);

    if (format === "pdf") {
      const filename = `compliance-certificate-${tenantId}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.send(html);
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // ── GET /compliance-dashboard/dashboard ──────────────────────────────────

  router.get("/dashboard", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(complianceDashboardPageHtml());
  });

  return router;
}
