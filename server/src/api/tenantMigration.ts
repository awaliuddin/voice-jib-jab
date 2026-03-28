/**
 * Tenant Migration API Router
 *
 * Provides HTTP endpoints for exporting and importing tenant configurations.
 *
 * Endpoints:
 *   GET  /tenants/:tenantId/export  — download full tenant config as JSON
 *   POST /tenants/:tenantId/import  — import a TenantExport into this tenant
 */

import { Router } from "express";
import type { TenantConfigMigrator } from "../services/TenantConfigMigrator.js";
import type { TenantExport } from "../services/TenantConfigMigrator.js";

// ── Router factory ────────────────────────────────────────────────────

/** Router for /tenants/:tenantId — tenant config export (JSON download) and import. */
export function createTenantMigrationRouter(
  migrator: TenantConfigMigrator,
): Router {
  const router = Router();

  /**
   * GET /tenants/:tenantId/export
   *
   * Exports the full configuration for a tenant as a JSON attachment.
   * Returns 404 if the tenant does not exist.
   */
  router.get("/tenants/:tenantId/export", async (req, res) => {
    const { tenantId } = req.params;

    try {
      const exported = await migrator.exportTenant(tenantId);

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tenant-${tenantId}-export.json"`,
      );
      res.status(200).json(exported);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.startsWith("Tenant not found:")) {
        res.status(404).json({ error: message });
        return;
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /tenants/:tenantId/import
   *
   * Imports a TenantExport payload into the specified target tenant.
   * Pass ?overwrite=true to replace existing items.
   * Returns 200 with an ImportResult on success.
   * Returns 400 for invalid payloads (missing version or sourceTenantId).
   */
  router.post("/tenants/:tenantId/import", async (req, res) => {
    const { tenantId } = req.params;
    const overwrite = req.query["overwrite"] === "true";
    const body = req.body as Partial<TenantExport> | undefined;

    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Request body is required" });
      return;
    }

    if (!body.version) {
      res.status(400).json({ error: "Invalid export: missing version" });
      return;
    }

    if (!body.sourceTenantId) {
      res.status(400).json({ error: "Invalid export: missing sourceTenantId" });
      return;
    }

    try {
      const result = await migrator.importTenant(body as TenantExport, tenantId, {
        overwrite,
      });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (
        message.startsWith("Unsupported export version") ||
        message.startsWith("Invalid export")
      ) {
        res.status(400).json({ error: message });
        return;
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
