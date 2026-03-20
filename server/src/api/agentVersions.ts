/**
 * Agent Version Management API
 *
 * GET    /agent-versions                         — list versions (?agentId= required)
 * POST   /agent-versions                         — create version (201)
 * GET    /agent-versions/deployments             — list deployments (?tenantId=)
 * POST   /agent-versions/deployments             — deploy version (201)
 * POST   /agent-versions/deployments/canary      — set canary (200)
 * DELETE /agent-versions/deployments/canary      — clear canary (200)
 * POST   /agent-versions/deployments/rollback    — rollback (200)
 * POST   /agent-versions/resolve                 — resolve version for session (200)
 * GET    /agent-versions/:versionId              — get one version (200/404)
 * POST   /agent-versions/:versionId/mark-stable  — mark stable (200/404)
 * DELETE /agent-versions/:versionId              — delete version (204/404/409)
 *
 * IMPORTANT: static sub-paths are registered BEFORE /:versionId to prevent
 * Express treating them as version IDs.
 */

import { Router } from "express";
import type { AgentVersionStore } from "../services/AgentVersionStore.js";

// ── Router factory ─────────────────────────────────────────────────────

export function createAgentVersionsRouter(store: AgentVersionStore): Router {
  const router = Router();

  // ── GET /agent-versions ─────────────────────────────────────────────

  /**
   * List versions for an agent.
   *
   * Query params:
   *   agentId — required; the logical agent identifier
   *
   * Returns sorted array of AgentVersion (versionNumber desc).
   * Returns 400 when agentId is missing.
   */
  router.get("/", (req, res) => {
    const agentId =
      typeof req.query.agentId === "string" ? req.query.agentId.trim() : undefined;

    if (!agentId) {
      res.status(400).json({ error: "agentId query parameter is required" });
      return;
    }

    const versions = store.listVersions(agentId);
    res.json({ versions });
  });

  // ── POST /agent-versions ────────────────────────────────────────────

  /**
   * Create a new agent version.
   *
   * Body: { agentId, label, config, createdBy?, changelog? }
   *
   * Returns 201 + the created AgentVersion on success.
   * Returns 400 when required fields are missing or label is empty.
   */
  router.post("/", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    if (typeof body.label !== "string" || body.label.trim() === "") {
      res.status(400).json({ error: "label is required" });
      return;
    }
    if (!body.config || typeof body.config !== "object") {
      res.status(400).json({ error: "config is required" });
      return;
    }

    try {
      const version = store.createVersion(
        body.agentId.trim(),
        body.label.trim(),
        body.config as Record<string, unknown>,
        {
          createdBy: typeof body.createdBy === "string" ? body.createdBy : undefined,
          changelog: typeof body.changelog === "string" ? body.changelog : undefined,
        },
      );
      res.status(201).json(version);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ── Static sub-paths — MUST be registered before /:versionId ────────

  // ── GET /agent-versions/deployments ────────────────────────────────

  /**
   * List deployments.
   *
   * Query params:
   *   tenantId — optional filter
   *
   * Returns array of TenantDeployment.
   */
  router.get("/deployments", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const deployments = store.listDeployments(tenantId);
    res.json({ deployments });
  });

  // ── POST /agent-versions/deployments/canary ─────────────────────────

  /**
   * Set a canary deployment.
   *
   * Body: { tenantId, agentId, canaryVersionId, canaryPercent }
   *
   * Returns 200 + updated TenantDeployment.
   * Returns 400 for validation failures or missing fields.
   * Returns 404 if no deployment exists for the (tenantId, agentId) pair.
   */
  router.post("/deployments/canary", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    if (typeof body.canaryVersionId !== "string" || body.canaryVersionId.trim() === "") {
      res.status(400).json({ error: "canaryVersionId is required" });
      return;
    }
    if (typeof body.canaryPercent !== "number") {
      res.status(400).json({ error: "canaryPercent is required" });
      return;
    }

    try {
      const deployment = store.setCanary(
        body.tenantId.trim(),
        body.agentId.trim(),
        body.canaryVersionId.trim(),
        body.canaryPercent,
      );
      res.json(deployment);
    } catch (err: unknown) {
      const message = (err as Error).message;
      if (message.includes("No deployment found")) {
        res.status(404).json({ error: message });
      } else {
        res.status(400).json({ error: message });
      }
    }
  });

  // ── DELETE /agent-versions/deployments/canary ───────────────────────

  /**
   * Clear the canary deployment.
   *
   * Body: { tenantId, agentId }
   *
   * Returns 200 + updated TenantDeployment.
   * Returns 404 if no deployment exists.
   */
  router.delete("/deployments/canary", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const deployment = store.clearCanary(body.tenantId.trim(), body.agentId.trim());
    if (!deployment) {
      res.status(404).json({
        error: `No deployment found for tenant ${body.tenantId}, agent ${body.agentId}`,
      });
      return;
    }

    res.json(deployment);
  });

  // ── POST /agent-versions/deployments/rollback ───────────────────────

  /**
   * Rollback to the previous version.
   *
   * Body: { tenantId, agentId }
   *
   * Returns 200 + updated TenantDeployment.
   * Returns 400 when no previous version exists.
   */
  router.post("/deployments/rollback", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    try {
      const deployment = store.rollback(body.tenantId.trim(), body.agentId.trim());
      res.json(deployment);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ── POST /agent-versions/deployments ───────────────────────────────

  /**
   * Deploy a version to a tenant.
   *
   * Body: { tenantId, agentId, versionId, deployedBy? }
   *
   * Returns 201 + the TenantDeployment on success.
   * Returns 400 when required fields are missing.
   * Returns 404 when the versionId does not exist.
   */
  router.post("/deployments", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    if (typeof body.versionId !== "string" || body.versionId.trim() === "") {
      res.status(400).json({ error: "versionId is required" });
      return;
    }

    try {
      const deployment = store.deploy(
        body.tenantId.trim(),
        body.agentId.trim(),
        body.versionId.trim(),
        {
          deployedBy: typeof body.deployedBy === "string" ? body.deployedBy : undefined,
        },
      );
      res.status(201).json(deployment);
    } catch (err: unknown) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // ── POST /agent-versions/resolve ────────────────────────────────────

  /**
   * Resolve which version a session should use.
   *
   * Body: { tenantId, agentId, sessionId }
   *
   * Returns 200 + VersionRoutingResult on success.
   * Returns 404 when no deployment exists for the (tenantId, agentId) pair.
   */
  router.post("/resolve", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    if (typeof body.sessionId !== "string" || body.sessionId.trim() === "") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const result = store.resolveVersion(
      body.tenantId.trim(),
      body.agentId.trim(),
      body.sessionId.trim(),
    );

    if (!result) {
      res.status(404).json({
        error: `No deployment found for tenant ${body.tenantId}, agent ${body.agentId}`,
      });
      return;
    }

    res.json(result);
  });

  // ── GET /agent-versions/:versionId ──────────────────────────────────

  /**
   * Get a single version by ID.
   *
   * Returns 200 + AgentVersion, or 404 when not found.
   */
  router.get("/:versionId", (req, res) => {
    const { versionId } = req.params;
    const version = store.getVersion(versionId);

    if (!version) {
      res.status(404).json({ error: `Version not found: ${versionId}` });
      return;
    }

    res.json(version);
  });

  // ── POST /agent-versions/:versionId/mark-stable ─────────────────────

  /**
   * Mark a version as stable.
   *
   * Returns 200 + updated AgentVersion, or 404 when not found.
   */
  router.post("/:versionId/mark-stable", (req, res) => {
    const { versionId } = req.params;
    const version = store.markStable(versionId);

    if (!version) {
      res.status(404).json({ error: `Version not found: ${versionId}` });
      return;
    }

    res.json(version);
  });

  // ── DELETE /agent-versions/:versionId ───────────────────────────────

  /**
   * Delete a version.
   *
   * Returns 204 on success.
   * Returns 404 when the version is not found.
   * Returns 409 when the version is currently deployed.
   */
  router.delete("/:versionId", (req, res) => {
    const { versionId } = req.params;

    // Check existence before attempting delete to distinguish 404 vs 409
    const exists = store.getVersion(versionId);
    if (!exists) {
      res.status(404).json({ error: `Version not found: ${versionId}` });
      return;
    }

    const deleted = store.deleteVersion(versionId);
    if (!deleted) {
      res.status(409).json({ error: `Version ${versionId} is currently deployed and cannot be deleted` });
      return;
    }

    res.status(204).send();
  });

  return router;
}
