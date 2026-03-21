/**
 * WebhookRetryQueue — Automatic retry with exponential backoff and dead-letter handling.
 *
 * Wraps WebhookService.deliver() and adds guaranteed delivery semantics:
 *   - Exponential backoff: baseDelayMs * 2^attemptCount (1s, 2s, 4s, 8s, 16s at defaults)
 *   - Dead-letter queue for items that exhaust all retry attempts
 *   - JSON file persistence for queue and dead-letter state
 *   - Manual retry of dead-letter items via retryDeadLetter()
 *
 * Persistence: single JSON file at the path given to the constructor.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";
import type {
  WebhookService,
  WebhookEventType,
  WebhookPayload,
} from "./WebhookService.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface RetryQueueItem {
  itemId: string;
  webhookId: string;
  tenantId: string;
  event: WebhookEventType;
  payload: WebhookPayload;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  createdAt: string;
  lastError?: string;
}

export interface DeadLetterItem {
  itemId: string;
  webhookId: string;
  tenantId: string;
  event: WebhookEventType;
  payload: WebhookPayload;
  attemptCount: number;
  lastError: string;
  exhaustedAt: string;
  originalCreatedAt: string;
}

interface StorageFormat {
  queue: RetryQueueItem[];
  deadLetter: DeadLetterItem[];
}

export interface RetryQueueStats {
  queueDepth: number;
  deadLetterDepth: number;
  totalEnqueued: number;
}

export interface WebhookRetryQueueOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

// ── WebhookRetryQueue ──────────────────────────────────────────────────

export class WebhookRetryQueue {
  private readonly webhookService: WebhookService;
  private readonly storageFile: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private data: StorageFormat;
  private totalEnqueued: number;

  constructor(
    webhookService: WebhookService,
    storageFile: string,
    options?: WebhookRetryQueueOptions,
  ) {
    this.webhookService = webhookService;
    this.storageFile = storageFile;
    this.maxAttempts = options?.maxAttempts ?? 5;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.totalEnqueued = 0;
    this.data = this.load();
  }

  // ── Persistence ────────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { queue: [], deadLetter: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(
      this.storageFile,
      JSON.stringify(this.data, null, 2),
      "utf-8",
    );
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Add an event delivery to the retry queue.
   *
   * The item is scheduled for immediate processing (nextAttemptAt = now).
   * A webhookId of empty string is assigned until a matching webhook is
   * resolved during processQueue(); callers that know the webhookId may
   * pass it explicitly via the payload's tenantId context — the queue
   * itself is tenant-scoped, not webhook-scoped, mirroring deliver().
   *
   * @param tenantId - Tenant whose webhooks to target
   * @param event - The event type to deliver
   * @param payload - Full event payload
   * @returns The created RetryQueueItem
   */
  enqueue(
    tenantId: string,
    event: WebhookEventType,
    payload: WebhookPayload,
  ): RetryQueueItem {
    const item: RetryQueueItem = {
      itemId: uuidv4(),
      webhookId: "",
      tenantId,
      event,
      payload,
      attemptCount: 0,
      maxAttempts: this.maxAttempts,
      nextAttemptAt: Date.now(),
      createdAt: new Date().toISOString(),
    };

    this.data.queue.push(item);
    this.totalEnqueued += 1;
    this.save();
    return item;
  }

  /**
   * Process all queue items whose nextAttemptAt is at or before now.
   *
   * For each due item:
   *   - Calls webhookService.deliver(). Succeeds when the returned array
   *     is non-empty and every delivery has success === true.
   *   - On success: removes the item from the queue.
   *   - On failure: increments attemptCount and schedules the next retry
   *     using exponential backoff (baseDelayMs * 2^attemptCount after increment).
   *   - When attemptCount reaches maxAttempts: moves the item to dead-letter.
   *
   * @returns Count of items that were processed (attempted)
   */
  async processQueue(): Promise<number> {
    const now = Date.now();
    const due = this.data.queue.filter((item) => item.nextAttemptAt <= now);
    let processed = 0;

    for (const item of due) {
      processed += 1;

      let succeeded = false;
      let errorMessage = "No matching webhooks found";

      try {
        const deliveries = await this.webhookService.deliver(
          item.tenantId,
          item.event,
          item.payload,
        );

        if (
          deliveries.length > 0 &&
          deliveries.every((d) => d.success === true)
        ) {
          succeeded = true;
        } else if (deliveries.length > 0) {
          const failed = deliveries.find((d) => !d.success);
          errorMessage = failed?.error ?? `Delivery failed with status ${failed?.statusCode ?? "unknown"}`;
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      if (succeeded) {
        this.removeFromQueue(item.itemId);
      } else {
        item.attemptCount += 1;
        item.lastError = errorMessage;

        if (item.attemptCount >= item.maxAttempts) {
          this.moveToDeadLetter(item, errorMessage);
        } else {
          item.nextAttemptAt = Date.now() + this.baseDelayMs * Math.pow(2, item.attemptCount - 1);
        }
      }
    }

    if (processed > 0) {
      this.save();
    }

    return processed;
  }

  /**
   * Return all items in the retry queue, optionally filtered by tenantId.
   *
   * @param tenantId - Optional tenant filter
   * @returns Array of RetryQueueItem
   */
  getQueue(tenantId?: string): RetryQueueItem[] {
    if (tenantId === undefined) {
      return [...this.data.queue];
    }
    return this.data.queue.filter((item) => item.tenantId === tenantId);
  }

  /**
   * Return all dead-letter items, optionally filtered by tenantId.
   *
   * @param tenantId - Optional tenant filter
   * @returns Array of DeadLetterItem
   */
  getDeadLetter(tenantId?: string): DeadLetterItem[] {
    if (tenantId === undefined) {
      return [...this.data.deadLetter];
    }
    return this.data.deadLetter.filter((item) => item.tenantId === tenantId);
  }

  /**
   * Move a dead-letter item back to the active queue.
   *
   * Resets attemptCount to 0 and schedules it for immediate processing.
   *
   * @param itemId - The dead-letter item ID to retry
   * @returns The new RetryQueueItem, or null if itemId not found
   */
  retryDeadLetter(itemId: string): RetryQueueItem | null {
    const index = this.data.deadLetter.findIndex((d) => d.itemId === itemId);
    if (index === -1) return null;

    const dead = this.data.deadLetter[index];
    const item: RetryQueueItem = {
      itemId: dead.itemId,
      webhookId: dead.webhookId,
      tenantId: dead.tenantId,
      event: dead.event,
      payload: dead.payload,
      attemptCount: 0,
      maxAttempts: this.maxAttempts,
      nextAttemptAt: Date.now(),
      createdAt: dead.originalCreatedAt,
    };

    this.data.deadLetter.splice(index, 1);
    this.data.queue.push(item);
    this.save();
    return item;
  }

  /**
   * Remove a single item from the dead-letter queue.
   *
   * @param itemId - The dead-letter item ID to remove
   * @returns true if removed, false if not found
   */
  clearDeadLetter(itemId: string): boolean {
    const index = this.data.deadLetter.findIndex((d) => d.itemId === itemId);
    if (index === -1) return false;

    this.data.deadLetter.splice(index, 1);
    this.save();
    return true;
  }

  /**
   * Return current queue statistics.
   *
   * totalEnqueued counts all items enqueued since the last process restart
   * (in-memory counter, not persisted).
   *
   * @returns RetryQueueStats
   */
  getStats(): RetryQueueStats {
    return {
      queueDepth: this.data.queue.length,
      deadLetterDepth: this.data.deadLetter.length,
      totalEnqueued: this.totalEnqueued,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────

  private removeFromQueue(itemId: string): void {
    const index = this.data.queue.findIndex((i) => i.itemId === itemId);
    if (index !== -1) {
      this.data.queue.splice(index, 1);
    }
  }

  private moveToDeadLetter(item: RetryQueueItem, lastError: string): void {
    const dead: DeadLetterItem = {
      itemId: item.itemId,
      webhookId: item.webhookId,
      tenantId: item.tenantId,
      event: item.event,
      payload: item.payload,
      attemptCount: item.attemptCount,
      lastError,
      exhaustedAt: new Date().toISOString(),
      originalCreatedAt: item.createdAt,
    };

    this.removeFromQueue(item.itemId);
    this.data.deadLetter.push(dead);
  }
}
