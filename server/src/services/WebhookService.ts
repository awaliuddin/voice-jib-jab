/**
 * WebhookService — Per-tenant webhook configuration and delivery tracking.
 *
 * Manages webhook endpoints that receive voice event notifications.
 * Supports HMAC-SHA256 request signing, per-tenant filtering, and
 * delivery audit history with a rolling cap of 1000 records.
 *
 * Persistence: single JSON file at the path given to initWebhookService().
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createHmac } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────

export type WebhookEventType =
  | "call_start"
  | "call_end"
  | "escalation"
  | "policy_violation"
  | "sentiment_alert"
  | "quality_alert";

export interface WebhookConfig {
  webhookId: string;
  tenantId: string;
  url: string;
  events: WebhookEventType[];
  secret?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export interface WebhookDelivery {
  deliveryId: string;
  webhookId: string;
  tenantId: string;
  event: WebhookEventType;
  payload: Record<string, unknown>;
  attemptedAt: string;
  statusCode?: number;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface WebhookPayload {
  event: WebhookEventType;
  tenantId: string;
  sessionId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface StorageFormat {
  webhooks: WebhookConfig[];
  deliveries: WebhookDelivery[];
}

const MAX_DELIVERIES = 1000;

// ── WebhookService ─────────────────────────────────────────────────────

export class WebhookService {
  private storageFile: string;
  private data: StorageFormat;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.data = this.load();
  }

  // ── Persistence ────────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { webhooks: [], deliveries: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(this.storageFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  /**
   * Create a new webhook configuration.
   *
   * Assigns a UUID, timestamps, and persists immediately.
   * Throws if url is empty or events array is empty.
   *
   * @param config - Webhook fields excluding generated properties
   * @returns The created WebhookConfig
   */
  createWebhook(
    config: Omit<WebhookConfig, "webhookId" | "createdAt" | "updatedAt">,
  ): WebhookConfig {
    if (!config.url || config.url.trim() === "") {
      throw new Error("url is required and must be non-empty");
    }
    if (!config.events || config.events.length === 0) {
      throw new Error("events array must be non-empty");
    }

    const now = new Date().toISOString();
    const webhook: WebhookConfig = {
      webhookId: uuidv4(),
      tenantId: config.tenantId,
      url: config.url,
      events: config.events,
      secret: config.secret,
      active: config.active ?? true,
      createdAt: now,
      updatedAt: now,
      description: config.description,
    };

    this.data.webhooks.push(webhook);
    this.save();
    return webhook;
  }

  /**
   * Get a webhook by its ID.
   *
   * @param webhookId - The webhook UUID
   * @returns The webhook or undefined if not found
   */
  getWebhook(webhookId: string): WebhookConfig | undefined {
    return this.data.webhooks.find((w) => w.webhookId === webhookId);
  }

  /**
   * List webhooks, optionally filtered by tenantId.
   *
   * @param tenantId - Optional tenant filter
   * @returns Array of matching webhooks
   */
  listWebhooks(tenantId?: string): WebhookConfig[] {
    if (tenantId === undefined) {
      return [...this.data.webhooks];
    }
    return this.data.webhooks.filter((w) => w.tenantId === tenantId);
  }

  /**
   * Update mutable fields on a webhook.
   *
   * Sets updatedAt to now and persists. Returns undefined when not found.
   *
   * @param webhookId - The webhook to update
   * @param updates - Fields to apply
   * @returns Updated WebhookConfig or undefined
   */
  updateWebhook(
    webhookId: string,
    updates: Partial<
      Pick<WebhookConfig, "url" | "events" | "secret" | "active" | "description">
    >,
  ): WebhookConfig | undefined {
    const webhook = this.data.webhooks.find((w) => w.webhookId === webhookId);
    if (!webhook) return undefined;

    if (updates.url !== undefined) webhook.url = updates.url;
    if (updates.events !== undefined) webhook.events = updates.events;
    if (updates.secret !== undefined) webhook.secret = updates.secret;
    if (updates.active !== undefined) webhook.active = updates.active;
    if (updates.description !== undefined) webhook.description = updates.description;
    webhook.updatedAt = new Date().toISOString();

    this.save();
    return webhook;
  }

  /**
   * Delete a webhook by ID.
   *
   * @param webhookId - The webhook to delete
   * @returns true if deleted, false if not found
   */
  deleteWebhook(webhookId: string): boolean {
    const index = this.data.webhooks.findIndex((w) => w.webhookId === webhookId);
    if (index === -1) return false;
    this.data.webhooks.splice(index, 1);
    this.save();
    return true;
  }

  // ── Delivery ───────────────────────────────────────────────────────

  /**
   * Deliver an event payload to all matching active webhooks for the tenant.
   *
   * For each webhook subscribed to this event type, POSTs the payload as JSON.
   * When a secret is configured, adds an X-Webhook-Signature header using
   * HMAC-SHA256. Errors are caught and recorded — this method never throws.
   * Delivery history is capped at 1000 entries (oldest dropped first).
   *
   * @param tenantId - Tenant whose webhooks to target
   * @param event - The event type being delivered
   * @param payload - The full event payload to send
   * @returns Array of WebhookDelivery records (one per matched webhook)
   */
  async deliver(
    tenantId: string,
    event: WebhookEventType,
    payload: WebhookPayload,
  ): Promise<WebhookDelivery[]> {
    const matching = this.data.webhooks.filter(
      (w) => w.tenantId === tenantId && w.active && w.events.includes(event),
    );

    const deliveries: WebhookDelivery[] = [];

    for (const webhook of matching) {
      const delivery = await this.sendToWebhook(webhook, event, payload);
      deliveries.push(delivery);
      this.data.deliveries.push(delivery);
    }

    // Cap deliveries at MAX_DELIVERIES
    if (this.data.deliveries.length > MAX_DELIVERIES) {
      this.data.deliveries = this.data.deliveries.slice(
        this.data.deliveries.length - MAX_DELIVERIES,
      );
    }

    if (deliveries.length > 0) {
      this.save();
    }

    return deliveries;
  }

  /**
   * Send a single webhook delivery attempt.
   *
   * Catches all errors and records them in the delivery record.
   */
  private async sendToWebhook(
    webhook: WebhookConfig,
    event: WebhookEventType,
    payload: WebhookPayload,
  ): Promise<WebhookDelivery> {
    const bodyStr = JSON.stringify(payload);
    const attemptedAt = new Date().toISOString();
    const start = Date.now();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (webhook.secret) {
      const sig = createHmac("sha256", webhook.secret)
        .update(bodyStr)
        .digest("hex");
      headers["X-Webhook-Signature"] = `sha256=${sig}`;
    }

    let statusCode: number | undefined;
    let success = false;
    let error: string | undefined;

    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: bodyStr,
      });
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

  /**
   * List delivery records, optionally filtered by webhookId and/or tenantId.
   *
   * @param webhookId - Optional webhook filter
   * @param tenantId - Optional tenant filter
   * @returns Array of matching delivery records
   */
  listDeliveries(webhookId?: string, tenantId?: string): WebhookDelivery[] {
    let deliveries = [...this.data.deliveries];
    if (webhookId !== undefined) {
      deliveries = deliveries.filter((d) => d.webhookId === webhookId);
    }
    if (tenantId !== undefined) {
      deliveries = deliveries.filter((d) => d.tenantId === tenantId);
    }
    return deliveries;
  }

  /**
   * Get a single delivery record by ID.
   *
   * @param deliveryId - The delivery UUID
   * @returns The delivery or undefined if not found
   */
  getDelivery(deliveryId: string): WebhookDelivery | undefined {
    return this.data.deliveries.find((d) => d.deliveryId === deliveryId);
  }
}

// ── Singleton factory ──────────────────────────────────────────────────

let _instance: WebhookService | undefined;

/**
 * Initialize the module-level WebhookService singleton.
 *
 * @param storageFile - Absolute path to the JSON persistence file
 * @returns The initialized service instance
 */
export function initWebhookService(storageFile: string): WebhookService {
  _instance = new WebhookService(storageFile);
  return _instance;
}

/**
 * Module-level singleton proxy.
 *
 * Delegates all method calls to the instance created by initWebhookService().
 * Throws if the service has not been initialized.
 */
export const webhookService: WebhookService = new Proxy(
  {} as WebhookService,
  {
    get(_target, prop) {
      if (!_instance) {
        throw new Error(
          "WebhookService not initialized — call initWebhookService() first",
        );
      }
      const value = (_instance as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_instance);
      }
      return value;
    },
  },
);
