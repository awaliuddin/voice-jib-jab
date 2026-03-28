/**
 * Memory API Router — provides HTTP endpoints for managing per-tenant
 * cross-session conversation memory.
 *
 * Endpoints:
 *   GET    /tenants/:tenantId/memory            — list all memory entries
 *   POST   /tenants/:tenantId/memory            — add a memory entry
 *   DELETE /tenants/:tenantId/memory            — clear all tenant memory
 *   DELETE /tenants/:tenantId/memory/:entryId   — delete a specific entry
 */

import { Router } from "express";
import type { ConversationMemoryStore } from "../services/ConversationMemoryStore.js";

// ── Constants ─────────────────────────────────────────────────────────

const MAX_FACT_LENGTH = 500;

// ── Validation helpers ────────────────────────────────────────────────

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// ── Router factory ────────────────────────────────────────────────────

/** Router for /tenants/:tenantId/memory — per-tenant cross-session memory CRUD. */
export function createMemoryRouter(store: ConversationMemoryStore): Router {
  const router = Router();

  /** GET /tenants/:tenantId/memory — list all memory entries for a tenant. */
  router.get("/:tenantId/memory", (req, res) => {
    const entries = store.getForTenant(req.params.tenantId);
    res.json({
      tenantId: req.params.tenantId,
      entries,
      count: entries.length,
    });
  });

  /** POST /tenants/:tenantId/memory — add a new memory entry. */
  router.post("/:tenantId/memory", (req, res) => {
    const { fact, tags } = req.body ?? {};

    if (!fact || typeof fact !== "string") {
      res.status(400).json({ error: "fact is required and must be a string" });
      return;
    }

    if (fact.length > MAX_FACT_LENGTH) {
      res.status(400).json({
        error: `fact must not exceed ${MAX_FACT_LENGTH} characters`,
      });
      return;
    }

    if (tags !== undefined && !isStringArray(tags)) {
      res.status(400).json({ error: "tags must be an array of strings" });
      return;
    }

    const entry = store.add({
      tenantId: req.params.tenantId,
      fact,
      tags,
      source: "manual",
    });

    res.status(201).json(entry);
  });

  /** DELETE /tenants/:tenantId/memory — clear all memory for a tenant. */
  router.delete("/:tenantId/memory", (req, res) => {
    store.clearTenant(req.params.tenantId);
    res.status(204).send();
  });

  /** DELETE /tenants/:tenantId/memory/:entryId — delete a specific entry. */
  router.delete("/:tenantId/memory/:entryId", (req, res) => {
    const deleted = store.deleteEntry(req.params.tenantId, req.params.entryId);
    if (!deleted) {
      res.status(404).json({ error: "Memory entry not found" });
      return;
    }
    res.status(204).send();
  });

  return router;
}
