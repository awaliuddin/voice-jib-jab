/**
 * VoiceTriggerService — manages webhook-driven voice session triggers.
 *
 * Handles the lifecycle of programmatic voice sessions initiated via
 * POST /voice/trigger. Each trigger pre-allocates a sessionId and tracks
 * whether the session will connect via WebSocket or SIP (stub).
 *
 * When a session completes, the service fires a callback (HTTP POST) to the
 * callbackUrl provided at trigger creation time. Callbacks are fire-and-forget:
 * errors are logged but never propagated.
 */

import { randomUUID } from "crypto";

// ── Public Types ──────────────────────────────────────────────────────────

/** Inbound request to programmatically initiate a voice session. */
export interface TriggerRequest {
  tenantId: string;
  callbackUrl: string;
  context?: string;
  phoneNumber?: string;
  metadata?: Record<string, string>;
}

/** Persistent record tracking a triggered session's lifecycle and connection details. */
export interface TriggerRecord {
  triggerId: string;
  sessionId: string;
  tenantId: string;
  callbackUrl: string;
  context?: string;
  phoneNumber?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  status: "pending_ws" | "pending_sip" | "active" | "completed" | "failed";
  wsUrl: string | null;
  sipTrunk: string | null;
}

/** Payload POSTed to the callbackUrl when a triggered session completes or fails. */
export interface SessionCallbackPayload {
  triggerId: string;
  sessionId: string;
  tenantId: string;
  status: "completed" | "failed";
  durationMs: number | null;
  transcript: Array<{ role: string; text: string }>;
  policyDecisions: Array<{
    decision: string;
    reasonCodes: string[];
    severity: number;
  }>;
  metadata?: Record<string, string>;
}

// ── Service ───────────────────────────────────────────────────────────────

/** Manages webhook-driven voice session triggers with fire-and-forget callbacks. */
export class VoiceTriggerService {
  private triggers = new Map<string, TriggerRecord>();
  private pendingBySession = new Map<string, string>();

  constructor(
    private readonly serverUrl: string,
    private readonly systemConfigStore: {
      get(): { sipTrunk: string | null };
    },
  ) {}

  /**
   * Create a new trigger record. Allocates a sessionId and determines
   * whether the session connects via WebSocket or SIP based on current
   * system configuration and whether a phoneNumber was provided.
   */
  createTrigger(req: TriggerRequest): TriggerRecord {
    const triggerId = randomUUID();
    const sessionId = randomUUID();
    const sipTrunk = this.systemConfigStore.get().sipTrunk;
    const useSip = sipTrunk !== null && typeof req.phoneNumber === "string" && req.phoneNumber.length > 0;

    const wsBase = this.serverUrl.replace(/^http/, "ws");
    const record: TriggerRecord = {
      triggerId,
      sessionId,
      tenantId: req.tenantId,
      callbackUrl: req.callbackUrl,
      context: req.context,
      phoneNumber: req.phoneNumber,
      metadata: req.metadata,
      createdAt: new Date().toISOString(),
      status: useSip ? "pending_sip" : "pending_ws",
      wsUrl: useSip ? null : `${wsBase}?sessionId=${sessionId}`,
      sipTrunk: sipTrunk,
    };

    this.triggers.set(triggerId, record);
    this.pendingBySession.set(sessionId, triggerId);

    return record;
  }

  /**
   * Mark a trigger as active. Called when the WebSocket connection is
   * established for the pre-allocated sessionId.
   */
  activateTrigger(sessionId: string): void {
    const triggerId = this.pendingBySession.get(sessionId);
    if (!triggerId) return;

    const record = this.triggers.get(triggerId);
    if (!record) return;

    record.status = "active";
  }

  /**
   * Complete a trigger -- fire the callback and mark as completed.
   * Fire-and-forget: does NOT await the HTTP POST.
   */
  completeTrigger(
    sessionId: string,
    payload: Omit<
      SessionCallbackPayload,
      "triggerId" | "sessionId" | "tenantId" | "metadata"
    >,
  ): void {
    const triggerId = this.pendingBySession.get(sessionId);
    if (!triggerId) return;

    const record = this.triggers.get(triggerId);
    if (!record) return;

    record.status = "completed";
    this.pendingBySession.delete(sessionId);

    const fullPayload: SessionCallbackPayload = {
      triggerId: record.triggerId,
      sessionId: record.sessionId,
      tenantId: record.tenantId,
      ...payload,
      metadata: record.metadata,
    };

    // Fire-and-forget -- intentionally not awaited
    void this.sendCallback(record, fullPayload);
  }

  /**
   * Retrieve a trigger record by its triggerId.
   */
  getTrigger(triggerId: string): TriggerRecord | null {
    return this.triggers.get(triggerId) ?? null;
  }

  /**
   * Retrieve a trigger record by the pre-allocated sessionId.
   */
  getTriggerBySession(sessionId: string): TriggerRecord | null {
    const triggerId = this.pendingBySession.get(sessionId);
    if (!triggerId) return null;
    return this.triggers.get(triggerId) ?? null;
  }

  /**
   * List all trigger records.
   */
  listTriggers(): TriggerRecord[] {
    return Array.from(this.triggers.values());
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * POST callback payload to the trigger's callbackUrl.
   * All errors are swallowed (fire-and-forget).
   */
  private async sendCallback(
    record: TriggerRecord,
    payload: SessionCallbackPayload,
  ): Promise<void> {
    try {
      await fetch(record.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn(
        `[VoiceTrigger] Callback to ${record.callbackUrl} failed:`,
        error,
      );
    }
  }
}
