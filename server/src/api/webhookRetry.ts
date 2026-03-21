/**
 * Webhook Retry Queue API
 *
 * GET    /webhooks/queue                     — list retry queue items (?tenantId=)
 * GET    /webhooks/dead-letter               — list dead-letter items (?tenantId=)
 * GET    /webhooks/retry-stats               — { queueDepth, deadLetterDepth, totalEnqueued }
 * POST   /webhooks/process-queue             — manually trigger processQueue()
 * POST   /webhooks/dead-letter/:itemId/retry — move dead-letter item back to queue
 * DELETE /webhooks/dead-letter/:itemId       — clear one dead-letter item
 *
 * Static routes are registered before parameterised routes to avoid Express
 * routing collisions with /:webhookId peers in the parent webhooks router.
 */

import { Router } from "express";
import type { WebhookRetryQueue } from "../services/WebhookRetryQueue.js";

// ── Router factory ─────────────────────────────────────────────────────

/**
 * Create the webhook retry queue router.
 *
 * Mount this alongside (not inside) the main webhooks router so that its
 * static paths do not collide with /:webhookId parameter routes.
 *
 * @param queue - The WebhookRetryQueue instance to delegate to
 * @returns Express Router
 */
export function createWebhookRetryRouter(queue: WebhookRetryQueue): Router {
  const router = Router();

  // ── GET /webhooks/queue ────────────────────────────────────────────

  /**
   * List all items currently in the retry queue.
   *
   * Query params:
   *   tenantId — filter to items for this tenant
   *
   * Returns: RetryQueueItem[]
   */
  router.get("/queue", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    res.json(queue.getQueue(tenantId));
  });

  // ── GET /webhooks/dead-letter ──────────────────────────────────────

  /**
   * List all items in the dead-letter queue.
   *
   * Query params:
   *   tenantId — filter to items for this tenant
   *
   * Returns: DeadLetterItem[]
   */
  router.get("/dead-letter", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    res.json(queue.getDeadLetter(tenantId));
  });

  // ── GET /webhooks/retry-stats ──────────────────────────────────────

  /**
   * Return current queue statistics.
   *
   * Returns: { queueDepth, deadLetterDepth, totalEnqueued }
   */
  router.get("/retry-stats", (_req, res) => {
    res.json(queue.getStats());
  });

  // ── POST /webhooks/process-queue ───────────────────────────────────

  /**
   * Manually trigger a processQueue() run.
   *
   * Useful for operational tooling and integration testing.
   *
   * Returns: { processed: number }
   */
  router.post("/process-queue", async (_req, res) => {
    const processed = await queue.processQueue();
    res.json({ processed });
  });

  // ── POST /webhooks/dead-letter/:itemId/retry ───────────────────────
  // Parameterised routes registered AFTER all static routes.

  /**
   * Move a dead-letter item back to the active retry queue.
   *
   * Returns 200 + RetryQueueItem on success.
   * Returns 404 when the itemId is not found.
   */
  router.post("/dead-letter/:itemId/retry", (req, res) => {
    const { itemId } = req.params;
    const item = queue.retryDeadLetter(itemId);

    if (!item) {
      res.status(404).json({ error: `Dead-letter item not found: ${itemId}` });
      return;
    }

    res.json(item);
  });

  // ── DELETE /webhooks/dead-letter/:itemId ───────────────────────────

  /**
   * Remove a single item from the dead-letter queue.
   *
   * Returns 204 on success, 404 when not found.
   */
  router.delete("/dead-letter/:itemId", (req, res) => {
    const { itemId } = req.params;
    const removed = queue.clearDeadLetter(itemId);

    if (!removed) {
      res.status(404).json({ error: `Dead-letter item not found: ${itemId}` });
      return;
    }

    res.status(204).send();
  });

  return router;
}
