/**
 * Playbooks API Router
 *
 * GET    /playbooks/suggest          — auto-suggest entries for conversation text
 * GET    /playbooks                  — list entries (?tenantId=&scenario=&enabled=)
 * GET    /playbooks/:entryId         — get single entry
 * POST   /playbooks                  — create entry
 * PUT    /playbooks/:entryId         — update entry (partial patch)
 * DELETE /playbooks/:entryId         — delete entry (204)
 *
 * NOTE: /suggest must be registered before /:entryId to avoid route shadowing.
 */

import { Router } from "express";
import type { PlaybookStore, PlaybookScenario } from "../services/PlaybookStore.js";

// ── Validation ─────────────────────────────────────────────────────────

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const VALID_SCENARIOS: PlaybookScenario[] = [
  "greeting",
  "escalation",
  "closing",
  "faq",
  "custom",
];

function isValidScenario(value: unknown): value is PlaybookScenario {
  return typeof value === "string" && (VALID_SCENARIOS as string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// ── Router factory ─────────────────────────────────────────────────────

/** Router for /playbooks — playbook entry CRUD and auto-suggest for conversation context. */
export function createPlaybooksRouter(store: PlaybookStore): Router {
  const router = Router();

  /**
   * GET /suggest — auto-suggest playbook entries for conversation context.
   * Registered BEFORE /:entryId to prevent route shadowing.
   *
   * Query: text (required), tenantId (optional), scenario (optional)
   */
  router.get("/suggest", (req, res) => {
    const text = req.query.text;

    if (typeof text !== "string" || text.trim() === "") {
      res.status(400).json({ error: "text query parameter is required" });
      return;
    }

    const tenantId = typeof req.query.tenantId === "string"
      ? req.query.tenantId
      : undefined;

    const scenarioRaw = req.query.scenario;
    const scenario = isValidScenario(scenarioRaw) ? scenarioRaw : undefined;

    const suggestions = store.suggestEntries(text, {
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(scenario !== undefined ? { scenario } : {}),
    });

    res.json({ suggestions, count: suggestions.length });
  });

  /**
   * GET / — list playbook entries with optional filters.
   *
   * Query: tenantId (optional), scenario (optional), enabled (optional "true"/"false")
   */
  router.get("/", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string"
      ? req.query.tenantId
      : undefined;

    const scenarioRaw = req.query.scenario;
    const scenario = isValidScenario(scenarioRaw) ? scenarioRaw : undefined;

    let enabled: boolean | undefined;
    if (req.query.enabled === "true") {
      enabled = true;
    } else if (req.query.enabled === "false") {
      enabled = false;
    }

    const entries = store.listEntries({
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(scenario !== undefined ? { scenario } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });

    res.json({ entries, count: entries.length });
  });

  /** GET /:entryId — get a single playbook entry. */
  router.get("/:entryId", (req, res) => {
    const { entryId } = req.params;

    if (!VALID_ID_PATTERN.test(entryId)) {
      res.status(400).json({ error: "Invalid entryId format" });
      return;
    }

    const entry = store.getEntry(entryId);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    res.json(entry);
  });

  /** POST / — create a new playbook entry. */
  router.post("/", (req, res) => {
    const body = req.body ?? {};

    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required and must be a string" });
      return;
    }

    if (!isValidScenario(body.scenario)) {
      res.status(400).json({
        error: `scenario is required and must be one of: ${VALID_SCENARIOS.join(", ")}`,
      });
      return;
    }

    if (!body.script || typeof body.script !== "string") {
      res.status(400).json({ error: "script is required and must be a string" });
      return;
    }

    if (body.keywords !== undefined && !isStringArray(body.keywords)) {
      res.status(400).json({ error: "keywords must be an array of strings" });
      return;
    }

    if (
      body.enabled !== undefined &&
      typeof body.enabled !== "boolean"
    ) {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    const entry = store.createEntry({
      name: body.name,
      scenario: body.scenario,
      script: body.script,
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
      tenantId: typeof body.tenantId === "string" ? body.tenantId : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    });

    res.status(201).json(entry);
  });

  /** PUT /:entryId — partially update a playbook entry. */
  router.put("/:entryId", (req, res) => {
    const { entryId } = req.params;

    if (!VALID_ID_PATTERN.test(entryId)) {
      res.status(400).json({ error: "Invalid entryId format" });
      return;
    }

    const existing = store.getEntry(entryId);
    if (!existing) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    const body = req.body ?? {};
    const patch: Parameters<typeof store.updateEntry>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        res.status(400).json({ error: "name must be a string" });
        return;
      }
      patch.name = body.name;
    }

    if (body.scenario !== undefined) {
      if (!isValidScenario(body.scenario)) {
        res.status(400).json({
          error: `scenario must be one of: ${VALID_SCENARIOS.join(", ")}`,
        });
        return;
      }
      patch.scenario = body.scenario;
    }

    if (body.script !== undefined) {
      if (typeof body.script !== "string") {
        res.status(400).json({ error: "script must be a string" });
        return;
      }
      patch.script = body.script;
    }

    if (body.keywords !== undefined) {
      if (!isStringArray(body.keywords)) {
        res.status(400).json({ error: "keywords must be an array of strings" });
        return;
      }
      patch.keywords = body.keywords;
    }

    if (body.tenantId !== undefined) {
      patch.tenantId = typeof body.tenantId === "string" ? body.tenantId : null;
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        res.status(400).json({ error: "enabled must be a boolean" });
        return;
      }
      patch.enabled = body.enabled;
    }

    const updated = store.updateEntry(entryId, patch);
    if (!updated) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    res.json(updated);
  });

  /** DELETE /:entryId — delete a playbook entry (204). */
  router.delete("/:entryId", (req, res) => {
    const { entryId } = req.params;

    if (!VALID_ID_PATTERN.test(entryId)) {
      res.status(400).json({ error: "Invalid entryId format" });
      return;
    }

    const deleted = store.deleteEntry(entryId);
    if (!deleted) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    res.status(204).send();
  });

  return router;
}
