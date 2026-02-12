/**
 * Lane C — ControlEngine
 *
 * Operates in parallel with Lane A (reflex) and Lane B (reasoning).
 * Responsible for policy enforcement, moderation, PII redaction,
 * claims verification, and audit/metrics emission.
 *
 * ControlEngine is NOT a content generator. It never produces user-facing
 * audio or text. Its sole purpose is governance: deciding whether Lane B's
 * output is allowed, needs rewriting, should be refused, or must be cancelled.
 *
 * ── Architecture ───────────────────────────────────────────────────────
 *
 *   EventBus                ControlEngine
 *  ─────────┐            ┌──────────────────────────────────────┐
 *           │  transcript │  ┌───────────┐                      │
 *  user ──► ├───────────► │  │ Moderator │                      │
 *           │            │  └─────┬─────┘                      │
 *           │            │        ▼                             │
 *           │  response  │  ┌───────────────┐                  │
 *  laneB ─► ├───────────► │  │ PIIRedactor   │                  │
 *           │            │  └─────┬─────────┘                  │
 *           │            │        ▼                             │
 *           │            │  ┌───────────────┐                  │
 *           │            │  │ ClaimsChecker │                  │
 *           │            │  └─────┬─────────┘                  │
 *           │            │        ▼                             │
 *           │            │  ┌────────────────────┐             │
 *           │            │  │ OverrideController │─► EventBus  │
 *           │            │  └────────────────────┘             │
 *           │            └──────────────────────────────────────┘
 *  ─────────┘
 *
 * ── Event flow ─────────────────────────────────────────────────────────
 *
 * Input events consumed (via EventBus):
 *   - transcript.final  — user's final transcript segment
 *   - transcript.delta  — streaming partial transcript (low-confidence, audit only)
 *   - transcript        — assistant transcript from Lane B (UserTranscriptEvent alias)
 *   - user_transcript   — user transcript relayed through Lane B
 *   - response.metadata — Lane B response lifecycle metadata (start/end)
 *
 * Output events emitted (via EventBus):
 *   - policy.decision       — allow/rewrite/refuse/escalate/cancel_output
 *   - control.audit         — audit trail entry for every evaluation
 *   - control.metrics       — per-evaluation latency and hit-rate metrics
 *
 * ── Design constraints ────────────────────────────────────────────────
 *
 * 1. Non-blocking by default. Evaluations complete synchronously (sub-1ms
 *    for stub implementations). A future async path (e.g., OpenAI Moderation
 *    API) can be added without changing the public interface by making
 *    `evaluate` return a `Promise<GateResult>`.
 *
 * 2. The ControlEngine owns the OverrideController, which translates
 *    high-severity decisions into actionable commands. The orchestrator
 *    (LaneArbitrator) listens to `policy.decision` events and acts on
 *    `cancel_output` by stopping Lane B.
 *
 * 3. The ControlEngine is instantiated per-session (like Lane A / Lane B)
 *    so it can carry session-scoped state if needed (e.g., cumulative
 *    severity, repeat-offender tracking).
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../orchestrator/EventBus.js";
import type {
  PolicyDecision,
  PolicyDecisionPayload,
  PolicyEvent,
  ControlOverridePayload,
  Event,
  ResponseMetadataPayload,
  FallbackMode,
} from "../schemas/events.js";
import {
  PolicyGate,
  GateResult,
  EvaluationContext,
  PolicyCheck,
  Moderator,
  ClaimsChecker,
  PIIRedactor,
} from "../insurance/policy_gate.js";
import { AllowedClaimsRegistry } from "../insurance/allowed_claims_registry.js";

// ── Configuration ──────────────────────────────────────────────────────

export interface ControlEngineConfig {
  enabled: boolean;
  /** Deny-list regex patterns for the Moderator stub */
  moderationDenyPatterns: RegExp[];
  /** Claims registry (injected; may be shared across sessions) */
  claimsRegistry: AllowedClaimsRegistry;
  /** Whether to evaluate non-final (delta) transcripts */
  evaluateDeltas: boolean;
  /** Severity threshold at which OverrideController emits cancel_output */
  cancelOutputThreshold: number; // severity >= this → cancel_output
  /** Enable PII redaction checks */
  enablePIIRedaction: boolean;
  /** PII handling mode: redact (rewrite) or flag only */
  piiRedactionMode: "redact" | "flag";
  /** Whether PIIRedactor scans metadata fields */
  piiScanMetadata: boolean;
}

const DEFAULT_CONFIG: ControlEngineConfig = {
  enabled: true,
  moderationDenyPatterns: [],
  claimsRegistry: new AllowedClaimsRegistry(),
  evaluateDeltas: false,
  cancelOutputThreshold: 4, // only critical severity triggers cancel
  enablePIIRedaction: true,
  piiRedactionMode: "redact",
  piiScanMetadata: true,
};

function resolveFallbackMode(
  decision: PolicyDecision,
): FallbackMode | undefined {
  switch (decision) {
    case "escalate":
      return "escalate_to_human";
    case "refuse":
    case "cancel_output":
      return "refuse_politely";
    case "rewrite":
      return "ask_clarifying_question";
    default:
      return undefined;
  }
}

// ── Audit event payload ────────────────────────────────────────────────

export interface AuditEventPayload {
  evaluationId: string;
  role: "user" | "assistant";
  textSnippet: string; // first 200 chars, redacted
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  checksRun: string[];
  durationMs: number;
}

// ── Metrics event payload ──────────────────────────────────────────────

export interface MetricsEventPayload {
  evaluationCount: number;
  allowCount: number;
  rewriteCount: number;
  refuseCount: number;
  escalateCount: number;
  cancelCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

// ── OverrideController ─────────────────────────────────────────────────

/**
 * Translates policy gate results into concrete override actions.
 * Emits policy.decision events to the EventBus and local EventEmitter
 * events that the websocket handler / orchestrator can act on.
 */
class OverrideController {
  private sessionId: string;
  private emitter: EventEmitter;
  private cancelThreshold: number;

  constructor(
    sessionId: string,
    emitter: EventEmitter,
    cancelThreshold: number,
  ) {
    this.sessionId = sessionId;
    this.emitter = emitter;
    this.cancelThreshold = cancelThreshold;
  }

  /**
   * Process a gate result and emit appropriate events.
   */
  act(result: GateResult, _ctx: EvaluationContext, evaluationId: string): void {
    // Upgrade severe refuse/escalate to cancel_output if audio is live
    let effectiveDecision = result.decision;
    if (
      result.severity >= this.cancelThreshold &&
      (result.decision === "refuse" || result.decision === "escalate")
    ) {
      effectiveDecision = "cancel_output";
    }

    if (effectiveDecision !== result.decision) {
      const overridePayload: ControlOverridePayload = {
        evaluationId,
        originalDecision: result.decision,
        effectiveDecision,
        reasonCodes: result.reasonCodes,
        severity: result.severity,
        cancelThreshold: this.cancelThreshold,
      };

      const overrideEvent: Event = {
        event_id: uuidv4(),
        session_id: this.sessionId,
        t_ms: Date.now(),
        source: "laneC",
        type: "control.override",
        payload: overridePayload,
      };

      eventBus.emit(overrideEvent);
      this.emitter.emit("override", overridePayload);
    }

    const fallbackMode = resolveFallbackMode(effectiveDecision);
    const payload: PolicyDecisionPayload = {
      decision: effectiveDecision,
      reason_codes: result.reasonCodes,
      severity: result.severity,
      safe_rewrite: result.safeRewrite,
      required_disclaimer_id: result.requiredDisclaimerId,
      ...(fallbackMode ? { fallback_mode: fallbackMode } : {}),
    };

    const event: PolicyEvent = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneC",
      type: "policy.decision",
      payload,
    };

    // Emit to global event bus (orchestrator listens here)
    eventBus.emit(event);

    // Emit locally so the websocket handler can react directly
    this.emitter.emit("policy_decision", payload);

    // Emit specific signals for critical actions
    if (effectiveDecision === "cancel_output") {
      this.emitter.emit("cancel_output", payload);
    }
  }
}

// ── ControlEngine (Lane C) ─────────────────────────────────────────────

export class ControlEngine extends EventEmitter {
  private sessionId: string;
  private config: ControlEngineConfig;
  private gate: PolicyGate;
  private override: OverrideController;
  private piiRedactor: PIIRedactor | null = null;
  private lastResponseMetadata: ResponseMetadataPayload | null = null;

  // Session-scoped metrics
  private evaluationCount = 0;
  private decisionCounts: Record<PolicyDecision, number> = {
    allow: 0,
    rewrite: 0,
    refuse: 0,
    escalate: 0,
    cancel_output: 0,
  };
  private durationSamples: number[] = [];

  constructor(sessionId: string, config: Partial<ControlEngineConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Build the policy check pipeline (order matters: PII → Moderator → Claims)
    const checks: PolicyCheck[] = [];
    if (this.config.enablePIIRedaction) {
      this.piiRedactor = new PIIRedactor({
        mode: this.config.piiRedactionMode,
        includeMetadata: this.config.piiScanMetadata,
      });
      checks.push(this.piiRedactor);
    }
    checks.push(
      new Moderator(this.config.moderationDenyPatterns),
      new ClaimsChecker(this.config.claimsRegistry),
    );
    this.gate = new PolicyGate(checks);

    this.override = new OverrideController(
      sessionId,
      this,
      this.config.cancelOutputThreshold,
    );

    if (this.config.enabled) {
      this.subscribeToEvents();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Evaluate arbitrary text through the full policy pipeline.
   * Can be called directly (e.g., before a tool call) in addition to
   * the automatic event-driven path.
   */
  evaluate(ctx: EvaluationContext): GateResult {
    const evaluationId = uuidv4();
    const result = this.gate.evaluate(ctx);
    this.recordMetrics(result);
    this.emitAuditEvent(ctx, result, evaluationId);
    this.override.act(result, ctx, evaluationId);
    return result;
  }

  /**
   * Get accumulated metrics for this session.
   */
  getMetrics(): MetricsEventPayload {
    const totalDuration = this.durationSamples.reduce((a, b) => a + b, 0);
    return {
      evaluationCount: this.evaluationCount,
      allowCount: this.decisionCounts.allow,
      rewriteCount: this.decisionCounts.rewrite,
      refuseCount: this.decisionCounts.refuse,
      escalateCount: this.decisionCounts.escalate,
      cancelCount: this.decisionCounts.cancel_output,
      avgDurationMs:
        this.durationSamples.length > 0
          ? totalDuration / this.durationSamples.length
          : 0,
      maxDurationMs:
        this.durationSamples.length > 0
          ? Math.max(...this.durationSamples)
          : 0,
    };
  }

  /**
   * Emit a metrics snapshot to the event bus. Call periodically or at session end.
   */
  flushMetrics(): void {
    const metrics = this.getMetrics();

    const event: Event = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneC",
      type: "control.metrics",
      payload: metrics,
    };
    eventBus.emit(event);
    this.emit("metrics_flushed", metrics);
  }

  /**
   * Tear down event listeners. Call when the session ends.
   */
  destroy(): void {
    this.flushMetrics();
    // EventBus doesn't support targeted removal well, but we can clean up
    // our local emitter.
    this.removeAllListeners();
  }

  // ── Event subscriptions ────────────────────────────────────────────

  private subscribeToEvents(): void {
    // Listen for events on this session via the global event bus
    eventBus.onSession(this.sessionId, (event: Event) => {
      this.handleEvent(event);
    });
  }

  private handleEvent(event: Event): void {
    switch (event.type) {
      case "transcript.final":
        this.onTranscript(event, true);
        break;

      case "transcript.delta":
        if (this.config.evaluateDeltas) {
          this.onTranscript(event, false);
        }
        break;

      // Assistant transcript from Lane B
      case "transcript":
        if (event.source === "laneB") {
          this.onAssistantTranscript(event);
        }
        break;

      // User transcript relayed via Lane B
      case "user_transcript":
        this.onUserTranscript(event);
        break;

      case "response.metadata":
        this.onResponseMetadata(event);
        break;
    }
  }

  private onTranscript(event: Event, isFinal: boolean): void {
    const payload = event.payload as {
      text?: string;
      confidence?: number;
      is_final?: boolean;
    };
    if (!payload.text) return;

    this.evaluate({
      sessionId: this.sessionId,
      role: "user",
      text: payload.text,
      isFinal,
    });
  }

  private onAssistantTranscript(event: Event): void {
    const payload = event.payload as {
      text?: string;
      isFinal?: boolean;
      confidence?: number;
    };
    if (!payload.text) return;

    this.evaluate({
      sessionId: this.sessionId,
      role: "assistant",
      text: payload.text,
      isFinal: payload.isFinal ?? false,
      metadata: this.lastResponseMetadata
        ? { response: this.lastResponseMetadata }
        : undefined,
    });
  }

  private onUserTranscript(event: Event): void {
    const payload = event.payload as {
      text?: string;
      isFinal?: boolean;
      confidence?: number;
    };
    if (!payload.text) return;

    this.evaluate({
      sessionId: this.sessionId,
      role: "user",
      text: payload.text,
      isFinal: payload.isFinal ?? false,
      metadata: this.lastResponseMetadata
        ? { response: this.lastResponseMetadata }
        : undefined,
    });
  }

  private onResponseMetadata(event: Event): void {
    const payload = event.payload as ResponseMetadataPayload;
    if (!payload || typeof payload.phase !== "string") return;
    this.lastResponseMetadata = payload;
    this.emit("response_metadata", payload);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private recordMetrics(result: GateResult): void {
    this.evaluationCount++;
    this.decisionCounts[result.decision]++;
    this.durationSamples.push(result.checkDurationMs);
  }

  private emitAuditEvent(
    ctx: EvaluationContext,
    result: GateResult,
    evaluationId: string,
  ): void {
    const redactedText = this.piiRedactor
      ? this.piiRedactor.redactText(ctx.text).redactedText
      : ctx.text;
    const auditPayload: AuditEventPayload = {
      evaluationId,
      role: ctx.role,
      textSnippet: redactedText.slice(0, 200),
      decision: result.decision,
      reasonCodes: result.reasonCodes,
      severity: result.severity,
      checksRun: result.checksRun,
      durationMs: result.checkDurationMs,
    };

    const event: Event = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneC",
      type: "control.audit",
      payload: auditPayload,
    };
    eventBus.emit(event);
    this.emit("audit", auditPayload);
  }
}
