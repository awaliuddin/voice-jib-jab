/**
 * SlaMonitor — rolling-window SLA tracker for voice pipeline metrics.
 *
 * Records latency samples for named metrics, computes percentiles within
 * a configurable rolling window, and emits breach/critical events when
 * samples exceed configured thresholds.
 *
 * Design notes:
 *  - All samples are stored in-memory per metric.
 *  - Window pruning happens on every record() call.
 *  - Webhook uses global fetch (Node 18+); failures are non-fatal.
 *  - EventEmitter: "breach" on targetMs exceed, "critical" on criticalMs exceed.
 */

import { EventEmitter } from "events";

// ── SLA target definitions ────────────────────────────────────────────

/** Threshold configuration for a single SLA metric. */
export interface SlaTarget {
  name: string;
  /** SLA target threshold — breach at this level emits "breach" event. */
  targetMs: number;
  /** Critical threshold — breach at this level emits "critical" event and triggers webhook. */
  criticalMs: number;
  description: string;
}

/** Default SLA targets for core voice pipeline metrics. */
export const DEFAULT_SLA_TARGETS: Record<string, SlaTarget> = {
  ttfb: {
    name: "Time to First Byte",
    targetMs: 500,
    criticalMs: 1200,
    description: "Voice response latency",
  },
  policyEval: {
    name: "Policy Evaluation",
    targetMs: 100,
    criticalMs: 500,
    description: "OPA/gate evaluation time",
  },
  ttsLatency: {
    name: "TTS Latency",
    targetMs: 300,
    criticalMs: 800,
    description: "Text-to-speech generation",
  },
  sttLatency: {
    name: "STT Latency",
    targetMs: 200,
    criticalMs: 600,
    description: "Speech-to-text transcription",
  },
};

// ── Sample and stats types ────────────────────────────────────────────

/** A single latency measurement for a named metric. */
export interface LatencySample {
  metric: string;
  valueMs: number;
  sessionId?: string;
  /** Date.now() value at the time the sample was recorded. */
  timestamp: number;
}

/** Computed statistics for a single SLA metric within the rolling window. */
export interface SlaMetricStats {
  metric: string;
  target: SlaTarget;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** Count of samples exceeding targetMs. */
  breachCount: number;
  /** Count of samples exceeding criticalMs. */
  criticalBreachCount: number;
  /** breachCount / sampleCount * 100, or 0 when sampleCount is 0. */
  breachRatePct: number;
  /** 100 - breachRatePct (simplified uptime proxy). */
  uptimePct: number;
  /** ISO timestamp of the oldest sample in the current window. */
  windowStartedAt: string;
}

/** Overall SLA health status across all monitored metrics. */
export interface SlaStatus {
  overall: "ok" | "warning" | "critical";
  metrics: SlaMetricStats[];
  windowMinutes: number;
  evaluatedAt: string;
}

/** Event payload emitted when a latency sample breaches an SLA threshold. */
export interface SlaBreachEvent {
  metric: string;
  valueMs: number;
  targetMs: number;
  severity: "warning" | "critical";
  sessionId?: string;
  timestamp: string;
}

// ── SlaMonitor ────────────────────────────────────────────────────────

/**
 * Rolling-window SLA monitor that records latency samples, computes
 * p50/p95/p99 percentiles, and fires events on threshold breaches.
 *
 * Events:
 *  - "breach"   — emitted when sample > targetMs (severity: "warning")
 *  - "critical" — emitted when sample > criticalMs (severity: "critical")
 */
export class SlaMonitor extends EventEmitter {
  private readonly windowMs: number;
  private readonly windowMinutes: number;
  private readonly webhookUrl?: string;
  private readonly targets: Record<string, SlaTarget>;
  /** Per-metric sample buffers. */
  private readonly buffers: Map<string, LatencySample[]> = new Map();

  constructor(opts?: {
    windowMinutes?: number;
    webhookUrl?: string;
    targets?: Record<string, SlaTarget>;
  }) {
    super();
    this.windowMinutes = opts?.windowMinutes ?? 60;
    this.windowMs = this.windowMinutes * 60 * 1000;
    this.webhookUrl = opts?.webhookUrl;
    this.targets = opts?.targets ?? DEFAULT_SLA_TARGETS;

    // Pre-initialise per-metric buffers so getStatus() always sees all keys.
    for (const key of Object.keys(this.targets)) {
      this.buffers.set(key, []);
    }
  }

  /**
   * Record a new latency sample.
   *
   * Prunes samples older than the rolling window, then checks whether the
   * sample exceeds the warning and/or critical thresholds for its metric.
   *
   * @param sample - The latency sample to record
   */
  record(sample: LatencySample): void {
    const { metric, valueMs, sessionId, timestamp } = sample;

    if (!this.buffers.has(metric)) {
      this.buffers.set(metric, []);
    }
    const buf = this.buffers.get(metric)!;
    buf.push({ metric, valueMs, sessionId, timestamp });

    // Prune expired samples
    const cutoff = Date.now() - this.windowMs;
    let pruneIdx = 0;
    while (pruneIdx < buf.length && buf[pruneIdx].timestamp < cutoff) {
      pruneIdx++;
    }
    if (pruneIdx > 0) {
      buf.splice(0, pruneIdx);
    }

    const target = this.targets[metric];
    if (!target) return;

    if (valueMs > target.criticalMs) {
      const event: SlaBreachEvent = {
        metric,
        valueMs,
        targetMs: target.criticalMs,
        severity: "critical",
        sessionId,
        timestamp: new Date(timestamp).toISOString(),
      };
      this.emit("critical", event);
      void this.sendWebhook(event);
    } else if (valueMs > target.targetMs) {
      const event: SlaBreachEvent = {
        metric,
        valueMs,
        targetMs: target.targetMs,
        severity: "warning",
        sessionId,
        timestamp: new Date(timestamp).toISOString(),
      };
      this.emit("breach", event);
    }
  }

  /**
   * Compute current SLA status across all configured metrics.
   *
   * overall:
   *  - "ok"       — all breach rates < 5%
   *  - "warning"  — any breach rate >= 5% but < 20%
   *  - "critical" — any breach rate >= 20%
   */
  getStatus(): SlaStatus {
    const metrics = Object.entries(this.targets).map(([key, target]) =>
      this.computeStats(key, target),
    );

    let overall: "ok" | "warning" | "critical" = "ok";
    for (const m of metrics) {
      if (m.breachRatePct >= 20) {
        overall = "critical";
        break;
      } else if (m.breachRatePct >= 5) {
        overall = "warning";
      }
    }

    return {
      overall,
      metrics,
      windowMinutes: this.windowMinutes,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get stats for a single metric by key.
   *
   * @param metric - The metric key (e.g. "ttfb")
   * @returns SlaMetricStats or undefined if the metric is not configured
   */
  getMetricStats(metric: string): SlaMetricStats | undefined {
    const target = this.targets[metric];
    if (!target) return undefined;
    return this.computeStats(metric, target);
  }

  /**
   * Get all raw samples currently in the rolling window.
   *
   * @param metric - Optional filter; returns all metrics when omitted
   */
  getSamples(metric?: string): LatencySample[] {
    if (metric !== undefined) {
      return [...(this.buffers.get(metric) ?? [])];
    }
    const all: LatencySample[] = [];
    for (const buf of this.buffers.values()) {
      all.push(...buf);
    }
    return all;
  }

  /**
   * Remove all samples from all metric buffers.
   *
   * Used in tests and for manual window resets.
   */
  clear(): void {
    for (const key of this.buffers.keys()) {
      this.buffers.set(key, []);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private computeStats(key: string, target: SlaTarget): SlaMetricStats {
    const buf = this.buffers.get(key) ?? [];
    const sampleCount = buf.length;

    if (sampleCount === 0) {
      return {
        metric: key,
        target,
        sampleCount: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        breachCount: 0,
        criticalBreachCount: 0,
        breachRatePct: 0,
        uptimePct: 100,
        windowStartedAt: new Date().toISOString(),
      };
    }

    const sorted = [...buf].map((s) => s.valueMs).sort((a, b) => a - b);
    const p50Ms = sorted[Math.floor(sampleCount * 0.5)];
    const p95Ms = sorted[Math.floor(sampleCount * 0.95)];
    const p99Ms = sorted[Math.floor(sampleCount * 0.99)];

    const breachCount = buf.filter((s) => s.valueMs > target.targetMs).length;
    const criticalBreachCount = buf.filter(
      (s) => s.valueMs > target.criticalMs,
    ).length;
    const breachRatePct = (breachCount / sampleCount) * 100;
    const uptimePct = 100 - breachRatePct;

    const windowStartedAt = new Date(buf[0].timestamp).toISOString();

    return {
      metric: key,
      target,
      sampleCount,
      p50Ms,
      p95Ms,
      p99Ms,
      breachCount,
      criticalBreachCount,
      breachRatePct,
      uptimePct,
      windowStartedAt,
    };
  }

  /**
   * POST a breach event payload to the configured webhook URL.
   *
   * Failures are swallowed — webhook delivery is best-effort.
   */
  private async sendWebhook(event: SlaBreachEvent): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch {
      // Webhook failures are non-fatal
    }
  }
}
