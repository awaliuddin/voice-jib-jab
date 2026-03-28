/**
 * Webhooks API
 *
 * GET    /webhooks                        — list all webhooks (filter: ?tenantId=)
 * POST   /webhooks                        — create a webhook
 * GET    /webhooks/deliveries             — list all deliveries (filter: ?tenantId=)
 * POST   /webhooks/test                   — send a test delivery
 * GET    /webhooks/:webhookId             — get one webhook
 * PATCH  /webhooks/:webhookId             — update a webhook
 * DELETE /webhooks/:webhookId             — delete a webhook (204)
 * GET    /webhooks/:webhookId/deliveries  — list deliveries for a webhook
 */

import { Router } from "express";
import type { WebhookService, WebhookEventType } from "../services/WebhookService.js";

// ── Router factory ─────────────────────────────────────────────────────

/** Router for /webhooks — webhook CRUD, delivery history, and test delivery. */
export function createWebhooksRouter(service: WebhookService): Router {
  const router = Router();

  // ── GET /webhooks ──────────────────────────────────────────────────

  /**
   * List all webhooks, with optional tenantId filter.
   *
   * Query params:
   *   tenantId — return only webhooks belonging to this tenant
   *
   * Returns: WebhookConfig[]
   */
  router.get("/", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    res.json(service.listWebhooks(tenantId));
  });

  // ── GET /webhooks/deliveries ───────────────────────────────────────
  // Must be registered BEFORE /:webhookId so Express routes it correctly.

  /**
   * List all deliveries across all webhooks.
   *
   * Query params:
   *   tenantId — filter to deliveries for this tenant
   *
   * Returns: WebhookDelivery[]
   */
  router.get("/deliveries", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    res.json(service.listDeliveries(undefined, tenantId));
  });

  // ── POST /webhooks/test ────────────────────────────────────────────
  // Must be registered BEFORE /:webhookId to avoid param collision.

  /**
   * Send a test delivery to a specific webhook.
   *
   * Body: { webhookId: string, event: WebhookEventType }
   *
   * Returns 200 + WebhookDelivery on success.
   * Returns 404 when the webhookId is not found.
   */
  router.post("/test", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const webhookId = typeof body.webhookId === "string" ? body.webhookId : undefined;
    const event = typeof body.event === "string" ? (body.event as WebhookEventType) : undefined;

    if (!webhookId) {
      res.status(400).json({ error: "webhookId is required" });
      return;
    }

    const webhook = service.getWebhook(webhookId);
    if (!webhook) {
      res.status(404).json({ error: `Webhook not found: ${webhookId}` });
      return;
    }

    const testEvent = event ?? "call_start";
    const payload = {
      event: testEvent,
      tenantId: webhook.tenantId,
      sessionId: "test",
      timestamp: new Date().toISOString(),
      data: { test: true },
    };

    // Deliver directly to this webhook regardless of subscription filter
    // by temporarily wrapping the delivery logic
    const deliveries = await service.deliver(webhook.tenantId, testEvent, payload);

    // If the webhook is inactive or doesn't subscribe to this event, deliver
    // directly by activating delivery via a raw send path.
    // If no delivery happened (inactive/unsubscribed webhook), run it directly.
    if (deliveries.length === 0) {
      // Force delivery to the specific webhook by using its config directly
      const directDelivery = await deliverDirectly(service, webhook, testEvent, payload);
      res.json(directDelivery);
      return;
    }

    // Return the delivery for this specific webhook
    const thisDelivery = deliveries.find((d) => d.webhookId === webhookId);
    res.json(thisDelivery ?? deliveries[0]);
  });

  // ── POST /webhooks ─────────────────────────────────────────────────

  /**
   * Create a new webhook.
   *
   * Body: { tenantId, url, events, secret?, active?, description? }
   *
   * Returns 201 + WebhookConfig on success.
   * Returns 400 when tenantId, url, or events are missing/invalid.
   */
  router.post("/", (req, res) => {
    const body = req.body as Record<string, unknown>;

    if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (typeof body.url !== "string" || body.url.trim() === "") {
      res.status(400).json({ error: "url is required" });
      return;
    }
    if (!Array.isArray(body.events) || (body.events as unknown[]).length === 0) {
      res.status(400).json({ error: "events must be a non-empty array" });
      return;
    }

    const webhook = service.createWebhook({
      tenantId: body.tenantId,
      url: body.url,
      events: body.events as WebhookEventType[],
      secret: typeof body.secret === "string" ? body.secret : undefined,
      active: typeof body.active === "boolean" ? body.active : true,
      description: typeof body.description === "string" ? body.description : undefined,
    });

    res.status(201).json(webhook);
  });

  // ── GET /webhooks/:webhookId ───────────────────────────────────────

  /**
   * Get a single webhook by ID.
   *
   * Returns 200 + WebhookConfig, or 404 when not found.
   */
  router.get("/:webhookId", (req, res) => {
    const { webhookId } = req.params;
    const webhook = service.getWebhook(webhookId);

    if (!webhook) {
      res.status(404).json({ error: `Webhook not found: ${webhookId}` });
      return;
    }

    res.json(webhook);
  });

  // ── PATCH /webhooks/:webhookId ─────────────────────────────────────

  /**
   * Update mutable fields on a webhook.
   *
   * Body: partial { url, events, secret, active, description }
   *
   * Returns 200 + updated WebhookConfig, or 404 when not found.
   */
  router.patch("/:webhookId", (req, res) => {
    const { webhookId } = req.params;
    const body = req.body as Record<string, unknown>;

    const updated = service.updateWebhook(webhookId, {
      url: typeof body.url === "string" ? body.url : undefined,
      events: Array.isArray(body.events)
        ? (body.events as WebhookEventType[])
        : undefined,
      secret: typeof body.secret === "string" ? body.secret : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    });

    if (!updated) {
      res.status(404).json({ error: `Webhook not found: ${webhookId}` });
      return;
    }

    res.json(updated);
  });

  // ── DELETE /webhooks/:webhookId ────────────────────────────────────

  /**
   * Delete a webhook.
   *
   * Returns 204 on success, 404 when not found.
   */
  router.delete("/:webhookId", (req, res) => {
    const { webhookId } = req.params;
    const deleted = service.deleteWebhook(webhookId);

    if (!deleted) {
      res.status(404).json({ error: `Webhook not found: ${webhookId}` });
      return;
    }

    res.status(204).send();
  });

  // ── GET /webhooks/:webhookId/deliveries ────────────────────────────

  /**
   * List deliveries for a specific webhook.
   *
   * Returns 200 + WebhookDelivery[].
   */
  router.get("/:webhookId/deliveries", (req, res) => {
    const { webhookId } = req.params;
    res.json(service.listDeliveries(webhookId));
  });

  return router;
}

// ── Helpers ────────────────────────────────────────────────────────────

import { createHmac } from "node:crypto";
import type { WebhookConfig, WebhookDelivery, WebhookPayload } from "../services/WebhookService.js";

/**
 * Deliver directly to a single webhook bypassing active/event-filter checks.
 *
 * Used by the test endpoint to fire a delivery regardless of subscription state.
 */
async function deliverDirectly(
  _service: WebhookService,
  webhook: WebhookConfig,
  event: WebhookEventType,
  payload: WebhookPayload,
): Promise<WebhookDelivery> {
  const { v4: uuidv4 } = await import("uuid");
  const bodyStr = JSON.stringify(payload);
  const attemptedAt = new Date().toISOString();
  const start = Date.now();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (webhook.secret) {
    const sig = createHmac("sha256", webhook.secret).update(bodyStr).digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${sig}`;
  }

  let statusCode: number | undefined;
  let success = false;
  let error: string | undefined;

  try {
    const res = await fetch(webhook.url, { method: "POST", headers, body: bodyStr });
    statusCode = res.status;
    success = statusCode >= 200 && statusCode <= 299;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    deliveryId: uuidv4(),
    webhookId: webhook.webhookId,
    tenantId: webhook.tenantId,
    event,
    payload: payload as unknown as Record<string, unknown>,
    attemptedAt,
    statusCode,
    success,
    durationMs: Date.now() - start,
    error,
  };
}
