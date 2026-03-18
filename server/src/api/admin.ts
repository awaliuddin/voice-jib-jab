/**
 * Admin API Router — provides HTTP endpoints for managing tenants and
 * mutable system configuration at runtime.
 *
 * Endpoints:
 *   POST   /admin/tenants      — create a new tenant
 *   GET    /admin/tenants      — list all tenants
 *   GET    /admin/tenants/:id  — get a single tenant
 *   PUT    /admin/tenants/:id  — update a tenant
 *   DELETE /admin/tenants/:id  — delete a tenant
 *   GET    /admin/config       — get current system config
 *   PUT    /admin/config       — update system config
 */

import { Router } from "express";
import type { TenantRegistry } from "../services/TenantRegistry.js";
import type { SystemConfigStore } from "../services/SystemConfigStore.js";

// ── Validation helpers ────────────────────────────────────────────────

const VALID_POLICY_LEVELS = ["strict", "standard", "permissive"] as const;
const VALID_MODERATION_SENSITIVITIES = ["low", "medium", "high"] as const;
const VALID_TTS_ENGINES = ["openai", "stub"] as const;

function isValidPolicyLevel(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (VALID_POLICY_LEVELS as readonly string[]).includes(value)
  );
}

function isValidModerationSensitivity(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (VALID_MODERATION_SENSITIVITIES as readonly string[]).includes(value)
  );
}

function isValidTtsEngine(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (VALID_TTS_ENGINES as readonly string[]).includes(value)
  );
}

// ── Router factory ────────────────────────────────────────────────────

export function createAdminRouter(
  tenantRegistry: TenantRegistry,
  systemConfigStore: SystemConfigStore,
): Router {
  const router = Router();

  // ── Tenant endpoints ──────────────────────────────────────────────

  /** POST /tenants — create a new tenant. */
  router.post("/tenants", (req, res) => {
    const { tenantId, name, policyLevel } = req.body ?? {};

    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!isValidPolicyLevel(policyLevel)) {
      res.status(400).json({
        error: `policyLevel must be one of: ${VALID_POLICY_LEVELS.join(", ")}`,
      });
      return;
    }

    try {
      const tenant = tenantRegistry.createTenant({
        tenantId,
        name,
        policyLevel,
        claimsThreshold: req.body.claimsThreshold,
        claims: req.body.claims ?? [],
        disallowedPatterns: req.body.disallowedPatterns ?? [],
        moderationThresholds: req.body.moderationThresholds,
      });
      res.status(201).json(tenant);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        res.status(409).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  /** GET /tenants — list all tenants. */
  router.get("/tenants", (_req, res) => {
    const tenants = tenantRegistry.listTenants();
    res.json({ tenants, count: tenants.length });
  });

  /** GET /tenants/:id — get a single tenant. */
  router.get("/tenants/:id", (req, res) => {
    const tenant = tenantRegistry.getTenant(req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.json(tenant);
  });

  /** PUT /tenants/:id — update a tenant. */
  router.put("/tenants/:id", (req, res) => {
    try {
      const { tenantId: _tid, createdAt: _ca, ...update } = req.body ?? {};
      const tenant = tenantRegistry.updateTenant(req.params.id, update);
      res.json(tenant);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  /** DELETE /tenants/:id — delete a tenant. */
  router.delete("/tenants/:id", (req, res) => {
    const deleted = tenantRegistry.deleteTenant(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.status(204).send();
  });

  // ── System config endpoints ───────────────────────────────────────

  /** GET /config — get current mutable system config. */
  router.get("/config", (_req, res) => {
    res.json(systemConfigStore.get());
  });

  /** PUT /config — update mutable system config. */
  router.put("/config", (req, res) => {
    const patch = req.body ?? {};

    if (
      patch.moderationSensitivity !== undefined &&
      !isValidModerationSensitivity(patch.moderationSensitivity)
    ) {
      res.status(400).json({
        error: `moderationSensitivity must be one of: ${VALID_MODERATION_SENSITIVITIES.join(", ")}`,
      });
      return;
    }

    if (
      patch.ttsEngine !== undefined &&
      !isValidTtsEngine(patch.ttsEngine)
    ) {
      res.status(400).json({
        error: `ttsEngine must be one of: ${VALID_TTS_ENGINES.join(", ")}`,
      });
      return;
    }

    const updated = systemConfigStore.update(patch);
    res.json(updated);
  });

  return router;
}
