/**
 * Routing API Router -- HTTP endpoints for call routing rules and queue management.
 *
 * Endpoints:
 *   GET    /routing/rules               -- list rules (optional ?tenantId=x)
 *   POST   /routing/rules               -- create rule
 *   PUT    /routing/rules/:ruleId       -- update rule
 *   DELETE /routing/rules/:ruleId       -- delete rule (204)
 *   POST   /routing/evaluate            -- evaluate session meta against rules
 *   GET    /routing/queue               -- all queue statuses
 *   GET    /routing/queue/:tenantId     -- queue status for tenant
 *   POST   /routing/queue/enqueue       -- enqueue a session
 *   POST   /routing/queue/dequeue       -- dequeue next session
 */

import { Router } from "express";
import type { RoutingEngine } from "../services/RoutingEngine.js";
import type { CallQueueService } from "../services/CallQueueService.js";

// -- Validation helpers -----------------------------------------------------

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidId(value: string): boolean {
  return VALID_ID_PATTERN.test(value);
}

// -- Router factory ---------------------------------------------------------

/** Router for /routing — call routing rules CRUD, rule evaluation, and queue management. */
export function createRoutingRouter(engine: RoutingEngine, queue: CallQueueService): Router {
  const router = Router();

  // ── Rules CRUD ──────────────────────────────────────────────────────

  /** GET /rules -- list active rules with optional tenantId filter. */
  router.get("/rules", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const rules = engine.getRules(tenantId);
    res.json({ rules, count: rules.length });
  });

  /** POST /rules -- create a new routing rule. */
  router.post("/rules", (req, res) => {
    const body = req.body ?? {};

    if (body.tenantId !== null && body.tenantId !== undefined && typeof body.tenantId !== "string") {
      res.status(400).json({ error: "tenantId must be a string or null" });
      return;
    }

    if (typeof body.priority !== "number") {
      res.status(400).json({ error: "priority is required and must be a number" });
      return;
    }

    if (!body.conditions || typeof body.conditions !== "object") {
      res.status(400).json({ error: "conditions is required and must be an object" });
      return;
    }

    if (typeof body.targetTemplateId !== "string") {
      res.status(400).json({ error: "targetTemplateId is required and must be a string" });
      return;
    }

    if (typeof body.active !== "boolean") {
      res.status(400).json({ error: "active is required and must be a boolean" });
      return;
    }

    const rule = engine.addRule({
      tenantId: body.tenantId ?? null,
      priority: body.priority,
      conditions: body.conditions,
      targetTemplateId: body.targetTemplateId,
      maxConcurrentSessions: typeof body.maxConcurrentSessions === "number" ? body.maxConcurrentSessions : null,
      active: body.active,
    });

    res.status(201).json(rule);
  });

  /** PUT /rules/:ruleId -- update an existing routing rule. */
  router.put("/rules/:ruleId", (req, res) => {
    if (!isValidId(req.params.ruleId)) {
      res.status(400).json({ error: "Invalid ruleId format" });
      return;
    }

    const existing = engine.getRule(req.params.ruleId);
    if (!existing) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (body.tenantId !== undefined) {
      patch.tenantId = body.tenantId === null ? null : String(body.tenantId);
    }
    if (typeof body.priority === "number") patch.priority = body.priority;
    if (body.conditions && typeof body.conditions === "object") patch.conditions = body.conditions;
    if (typeof body.targetTemplateId === "string") patch.targetTemplateId = body.targetTemplateId;
    if (typeof body.maxConcurrentSessions === "number") {
      patch.maxConcurrentSessions = body.maxConcurrentSessions;
    } else if (body.maxConcurrentSessions === null) {
      patch.maxConcurrentSessions = null;
    }
    if (typeof body.active === "boolean") patch.active = body.active;

    const updated = engine.updateRule(req.params.ruleId, patch);
    if (!updated) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.json(updated);
  });

  /** DELETE /rules/:ruleId -- delete a routing rule. */
  router.delete("/rules/:ruleId", (req, res) => {
    if (!isValidId(req.params.ruleId)) {
      res.status(400).json({ error: "Invalid ruleId format" });
      return;
    }

    const deleted = engine.deleteRule(req.params.ruleId);
    if (!deleted) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    res.status(204).send();
  });

  // ── Evaluate ────────────────────────────────────────────────────────

  /** POST /evaluate -- evaluate routing for a session. */
  router.post("/evaluate", (req, res) => {
    const body = req.body ?? {};

    if (typeof body.tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required and must be a string" });
      return;
    }

    const decision = engine.evaluate({
      tenantId: body.tenantId,
      language: typeof body.language === "string" ? body.language : undefined,
      topic: typeof body.topic === "string" ? body.topic : undefined,
      callerType: body.callerType === "new" || body.callerType === "returning" ? body.callerType : undefined,
    });

    res.json(decision);
  });

  // ── Queue ───────────────────────────────────────────────────────────

  /** GET /queue -- all non-empty queue statuses. */
  router.get("/queue", (_req, res) => {
    const statuses = queue.getAllQueueStatuses();
    res.json({ queues: statuses, count: statuses.length });
  });

  /** GET /queue/:tenantId -- queue status for a specific tenant. */
  router.get("/queue/:tenantId", (req, res) => {
    const status = queue.getQueueStatus(req.params.tenantId);
    res.json(status);
  });

  /** POST /queue/enqueue -- add a session to its tenant queue. */
  router.post("/queue/enqueue", (req, res) => {
    const body = req.body ?? {};

    if (typeof body.sessionId !== "string") {
      res.status(400).json({ error: "sessionId is required and must be a string" });
      return;
    }

    if (typeof body.tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required and must be a string" });
      return;
    }

    const entry = queue.enqueue(body.sessionId, body.tenantId);
    res.status(201).json(entry);
  });

  /** POST /queue/dequeue -- remove next session from tenant queue. */
  router.post("/queue/dequeue", (req, res) => {
    const body = req.body ?? {};

    if (typeof body.tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required and must be a string" });
      return;
    }

    const sessionId = queue.dequeue(body.tenantId);
    if (sessionId === null) {
      res.status(204).send();
      return;
    }

    res.json({ sessionId });
  });

  return router;
}
