/**
 * Knowledge Base API Router — provides HTTP endpoints for managing per-tenant
 * FAQ knowledge base entries with text similarity search.
 *
 * Endpoints:
 *   GET    /tenants/:tenantId/kb             — list entries (optional ?tag=x&source=manual)
 *   POST   /tenants/:tenantId/kb             — create entry { question, answer, tags? }
 *   GET    /tenants/:tenantId/kb/search      — search ?q=text, returns top 3, increments hits
 *   GET    /tenants/:tenantId/kb/:entryId    — get single entry
 *   PUT    /tenants/:tenantId/kb/:entryId    — patch { question?, answer?, tags? }
 *   DELETE /tenants/:tenantId/kb/:entryId    — delete single entry
 *   DELETE /tenants/:tenantId/kb             — clear all entries for tenant
 */

import { Router } from "express";
import type { KnowledgeBaseStore } from "../services/KnowledgeBaseStore.js";

// ── Validation helpers ────────────────────────────────────────────────

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidId(value: string): boolean {
  return VALID_ID_PATTERN.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// ── Router factory ────────────────────────────────────────────────────

/** Router for /tenants/:tenantId/kb — knowledge base entry CRUD and text similarity search. */
export function createKnowledgeRouter(store: KnowledgeBaseStore): Router {
  const router = Router();

  /** Validate tenantId on all routes. */
  router.use("/:tenantId/kb", (req, res, next) => {
    if (!isValidId(req.params.tenantId)) {
      res.status(400).json({ error: "Invalid tenantId format" });
      return;
    }
    next();
  });

  /** GET /tenants/:tenantId/kb — list entries with optional filters. */
  router.get("/:tenantId/kb", (req, res) => {
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    const source = typeof req.query.source === "string" ? req.query.source : undefined;

    const validSource =
      source === "manual" || source === "extracted" ? source : undefined;

    const entries = store.listEntries(req.params.tenantId, {
      tag,
      source: validSource,
    });

    res.json({ tenantId: req.params.tenantId, entries, count: entries.length });
  });

  /** POST /tenants/:tenantId/kb — create a new entry. */
  router.post("/:tenantId/kb", (req, res) => {
    const { question, answer, tags } = req.body ?? {};

    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "question is required and must be a string" });
      return;
    }

    if (!answer || typeof answer !== "string") {
      res.status(400).json({ error: "answer is required and must be a string" });
      return;
    }

    if (tags !== undefined && !isStringArray(tags)) {
      res.status(400).json({ error: "tags must be an array of strings" });
      return;
    }

    const entry = store.addEntry({
      tenantId: req.params.tenantId,
      question,
      answer,
      tags,
    });

    res.status(201).json(entry);
  });

  /** GET /tenants/:tenantId/kb/search — text similarity search. */
  router.get("/:tenantId/kb/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";

    const results = store.search(req.params.tenantId, q);

    // Increment hit counts for surfaced results
    for (const entry of results) {
      store.incrementHit(entry.id);
    }

    res.json({ tenantId: req.params.tenantId, results, count: results.length });
  });

  /** GET /tenants/:tenantId/kb/:entryId — get a single entry. */
  router.get("/:tenantId/kb/:entryId", (req, res) => {
    if (!isValidId(req.params.entryId)) {
      res.status(400).json({ error: "Invalid entryId format" });
      return;
    }

    const entry = store.getEntry(req.params.entryId);
    if (!entry || entry.tenantId !== req.params.tenantId) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    res.json(entry);
  });

  /** PUT /tenants/:tenantId/kb/:entryId — patch an entry. */
  router.put("/:tenantId/kb/:entryId", (req, res) => {
    if (!isValidId(req.params.entryId)) {
      res.status(400).json({ error: "Invalid entryId format" });
      return;
    }

    const { question, answer, tags } = req.body ?? {};

    if (question === undefined && answer === undefined && tags === undefined) {
      res.status(400).json({
        error: "At least one of question, answer, or tags must be provided",
      });
      return;
    }

    if (question !== undefined && typeof question !== "string") {
      res.status(400).json({ error: "question must be a string" });
      return;
    }

    if (answer !== undefined && typeof answer !== "string") {
      res.status(400).json({ error: "answer must be a string" });
      return;
    }

    if (tags !== undefined && !isStringArray(tags)) {
      res.status(400).json({ error: "tags must be an array of strings" });
      return;
    }

    // Verify entry belongs to tenant before updating
    const existing = store.getEntry(req.params.entryId);
    if (!existing || existing.tenantId !== req.params.tenantId) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (question !== undefined) patch.question = question;
    if (answer !== undefined) patch.answer = answer;
    if (tags !== undefined) patch.tags = tags;

    const updated = store.updateEntry(req.params.entryId, patch);
    if (!updated) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    res.json(updated);
  });

  /** DELETE /tenants/:tenantId/kb/:entryId — delete a single entry. */
  router.delete("/:tenantId/kb/:entryId", (req, res) => {
    if (!isValidId(req.params.entryId)) {
      res.status(400).json({ error: "Invalid entryId format" });
      return;
    }

    // Verify entry belongs to tenant
    const existing = store.getEntry(req.params.entryId);
    if (!existing || existing.tenantId !== req.params.tenantId) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    store.deleteEntry(req.params.entryId);
    res.status(204).send();
  });

  /** DELETE /tenants/:tenantId/kb — clear all entries for a tenant. */
  router.delete("/:tenantId/kb", (req, res) => {
    store.clearTenant(req.params.tenantId);
    res.status(204).send();
  });

  return router;
}
