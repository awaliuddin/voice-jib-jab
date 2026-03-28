/**
 * Intents API Router
 *
 * POST   /intents/detect              — classify text and log result
 * GET    /intents                     — list frequencies + logs (?tenantId, ?limit)
 * GET    /intents/config              — list template mappings (?tenantId)
 * POST   /intents/config              — create/update template mapping (201)
 * DELETE /intents/config/:intent      — remove template mapping (204)
 *
 * NOTE: Static paths (/detect, /config) are registered BEFORE /:anything
 * to avoid route shadowing.
 */

import { Router } from "express";
import type { IntentClassifier } from "../services/IntentClassifier.js";
import type { IntentStore } from "../services/IntentStore.js";
import { VALID_INTENTS } from "./intents-constants.js";

// ── Router factory ─────────────────────────────────────────────────────

/** Router for /intents — intent detection, frequency listing, and template mapping config. */
export function createIntentsRouter(
  classifier: IntentClassifier,
  store: IntentStore,
): Router {
  const router = Router();

  // ── POST /detect ─────────────────────────────────────────────────

  /**
   * Classify caller intent from text.
   *
   * Body: { text: string, tenantId?: string, sessionId?: string }
   * Returns: IntentResult + logEntry
   */
  router.post("/detect", (req, res) => {
    const body = req.body ?? {};

    if (!body.text || typeof body.text !== "string" || body.text.trim() === "") {
      res.status(400).json({ error: "text is required and must be a non-empty string" });
      return;
    }

    const { text } = body;
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : null;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

    const result = classifier.classify(text);

    const logEntry = store.logDetection({
      tenantId,
      sessionId,
      text,
      intent: result.intent,
      confidence: result.confidence,
    });

    res.json({ ...result, logEntry });
  });

  // ── GET / ─────────────────────────────────────────────────────────

  /**
   * Retrieve intent detection frequencies and recent log entries.
   *
   * Query: tenantId (optional), limit (optional, default 50)
   */
  router.get("/", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string"
      ? req.query.tenantId
      : undefined;

    const limitRaw = req.query.limit;
    const limit = limitRaw !== undefined ? parseInt(String(limitRaw), 10) : 50;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;

    const frequencies = store.getFrequencies(tenantId);
    const logs = store.listLogs(tenantId, safeLimit);
    const total = Object.values(frequencies).reduce((sum, n) => sum + n, 0);

    res.json({ frequencies, total, logs });
  });

  // ── GET /config ───────────────────────────────────────────────────

  /**
   * List intent-to-template mappings.
   *
   * Query: tenantId (optional)
   */
  router.get("/config", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string"
      ? req.query.tenantId
      : undefined;

    const mappings = store.listMappings(tenantId);
    res.json({ mappings, count: mappings.length });
  });

  // ── POST /config ──────────────────────────────────────────────────

  /**
   * Create or update an intent-to-template mapping.
   *
   * Body: { intent: CallerIntent, templateId: string, tenantId?: string }
   * Returns 201 with created/updated mapping.
   */
  router.post("/config", (req, res) => {
    const body = req.body ?? {};

    if (!body.intent || typeof body.intent !== "string") {
      res.status(400).json({ error: "intent is required" });
      return;
    }

    if (!(VALID_INTENTS as string[]).includes(body.intent)) {
      res.status(400).json({
        error: `intent must be one of: ${VALID_INTENTS.join(", ")}`,
      });
      return;
    }

    if (!body.templateId || typeof body.templateId !== "string") {
      res.status(400).json({ error: "templateId is required and must be a string" });
      return;
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId : null;

    const mapping = store.setMapping(tenantId, body.intent, body.templateId);
    res.status(201).json(mapping);
  });

  // ── DELETE /config/:intent ────────────────────────────────────────

  /**
   * Remove an intent-to-template mapping.
   *
   * Params: intent (CallerIntent)
   * Query:  tenantId (optional, null if omitted)
   * Returns 204 on success, 404 if not found.
   */
  router.delete("/config/:intent", (req, res) => {
    const { intent } = req.params;

    if (!(VALID_INTENTS as string[]).includes(intent)) {
      res.status(400).json({
        error: `intent must be one of: ${VALID_INTENTS.join(", ")}`,
      });
      return;
    }

    const tenantId = typeof req.query.tenantId === "string"
      ? req.query.tenantId
      : null;

    const deleted = store.deleteMapping(tenantId, intent as import("../services/IntentClassifier.js").CallerIntent);
    if (!deleted) {
      res.status(404).json({ error: "Mapping not found" });
      return;
    }

    res.status(204).send();
  });

  return router;
}
