/**
 * Voice API Router — provides HTTP endpoints for webhook-driven voice
 * session triggers.
 *
 * Endpoints:
 *   POST /voice/trigger             — create a new voice trigger
 *   GET  /voice/triggers            — list all triggers
 *   GET  /voice/triggers/:triggerId — get a single trigger
 *   POST /voice/triggers/:triggerId/complete — manually complete (test helper)
 */

import { Router } from "express";
import type { VoiceTriggerService } from "../services/VoiceTriggerService.js";

export function createVoiceRouter(
  triggerService: VoiceTriggerService,
  _serverUrl: string,
): Router {
  const router = Router();

  /**
   * POST /trigger — create a new webhook-driven voice session trigger.
   *
   * Body: { tenantId, callbackUrl, context?, phoneNumber?, metadata? }
   * Returns 202 with the TriggerRecord subset needed by the caller.
   */
  router.post("/trigger", (req, res) => {
    const { tenantId, callbackUrl, context, phoneNumber, metadata } = req.body;

    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    if (!callbackUrl || typeof callbackUrl !== "string") {
      res.status(400).json({ error: "callbackUrl is required" });
      return;
    }

    // Validate URL format
    try {
      new URL(callbackUrl);
    } catch {
      res.status(400).json({ error: "callbackUrl must be a valid URL" });
      return;
    }

    // Reject path traversal in tenantId
    if (tenantId.includes("../") || tenantId.includes("..\\")) {
      res.status(400).json({ error: "tenantId contains invalid characters" });
      return;
    }

    // Validate phoneNumber format if provided
    if (phoneNumber !== undefined && phoneNumber !== null) {
      if (typeof phoneNumber !== "string" || !/^\+?[\d\s\-().]+$/.test(phoneNumber)) {
        res.status(400).json({ error: "phoneNumber format is invalid" });
        return;
      }
    }

    const record = triggerService.createTrigger({
      tenantId,
      callbackUrl,
      context,
      phoneNumber,
      metadata,
    });

    res.status(202).json({
      triggerId: record.triggerId,
      sessionId: record.sessionId,
      status: record.status,
      wsUrl: record.wsUrl,
      sipTrunk: record.sipTrunk,
      createdAt: record.createdAt,
    });
  });

  /**
   * GET /triggers — list all trigger records.
   */
  router.get("/triggers", (_req, res) => {
    const triggers = triggerService.listTriggers();
    res.json({ triggers, count: triggers.length });
  });

  /**
   * GET /triggers/:triggerId — get a single trigger record.
   */
  router.get("/triggers/:triggerId", (req, res) => {
    const record = triggerService.getTrigger(req.params.triggerId);
    if (!record) {
      res.status(404).json({ error: "Trigger not found" });
      return;
    }
    res.json(record);
  });

  /**
   * POST /triggers/:triggerId/complete — manually complete a trigger.
   * Useful for testing callback delivery without a real voice session.
   */
  router.post("/triggers/:triggerId/complete", (req, res) => {
    const record = triggerService.getTrigger(req.params.triggerId);
    if (!record) {
      res.status(404).json({ error: "Trigger not found" });
      return;
    }

    const {
      transcript = [],
      policyDecisions = [],
      durationMs = null,
    } = req.body ?? {};

    triggerService.completeTrigger(record.sessionId, {
      status: "completed",
      durationMs,
      transcript,
      policyDecisions,
    });

    res.json({ status: "completed", triggerId: record.triggerId });
  });

  return router;
}
