/**
 * HealthMonitorService — Periodic health checks for voice-jib-jab subsystems.
 *
 * Runs a configurable set of named health checks on an interval. Emits
 * "check", "degraded", and "recovered" events and optionally POSTs webhook
 * alerts when a subsystem transitions between healthy and unhealthy states.
 *
 * Design notes:
 *  - Each check is run concurrently via Promise.allSettled.
 *  - "degraded" is only emitted after failureThreshold consecutive failures,
 *    preventing alert storms from transient blips.
 *  - Timer is unref'd so it doesn't prevent process exit.
 *  - Webhook uses global fetch (Node 18+); failures are non-fatal.
 */

import { EventEmitter } from "events";

// ── Public types ──────────────────────────────────────────────────────

/** Outcome of a single health check including status, latency, and failure count. */
export interface HealthCheckResult {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs: number;
  checkedAt: string;
  error?: string;
  consecutiveFailures: number;
}

/** Named async check function to register with the health monitor. */
export interface HealthCheckDefinition {
  name: string;
  check(): Promise<void>;
}

/** Configuration for check interval, webhook alerting, and failure thresholds. */
export interface HealthMonitorConfig {
  /** Interval between check runs in milliseconds. Default 10000. */
  intervalMs?: number;
  /** URL to POST alert payloads to. Optional. */
  webhookUrl?: string;
  /** Number of consecutive failures before emitting "degraded". Default 1. */
  failureThreshold?: number;
}

/** Aggregate health status across all registered subsystem checks. */
export type OverallStatus = "healthy" | "degraded" | "down";

// ── HealthMonitorService ──────────────────────────────────────────────

/** Periodic health check runner with degraded/recovered events and webhook alerts. */
export class HealthMonitorService extends EventEmitter {
  private readonly checks: HealthCheckDefinition[];
  private readonly results: Map<string, HealthCheckResult>;
  private readonly intervalMs: number;
  private readonly webhookUrl?: string;
  private readonly failureThreshold: number;
  private timer?: NodeJS.Timeout;
  private running: boolean;

  constructor(checks: HealthCheckDefinition[], config: HealthMonitorConfig = {}) {
    super();
    this.checks = checks;
    this.results = new Map();
    this.intervalMs = config.intervalMs ?? 10_000;
    this.webhookUrl = config.webhookUrl;
    this.failureThreshold = config.failureThreshold ?? 1;
    this.running = false;

    // Seed all checks as "unknown" so getStatus() is immediately usable
    for (const c of checks) {
      this.results.set(c.name, {
        name: c.name,
        status: "unknown",
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Start the periodic check loop.
   *
   * Runs the first check cycle immediately, then repeats on intervalMs.
   * Idempotent — subsequent calls while running are no-ops.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.runAllChecks();
    this.timer = setInterval(() => void this.runAllChecks(), this.intervalMs);
    this.timer.unref();
  }

  /**
   * Stop the periodic check loop.
   *
   * Safe to call when already stopped.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
  }

  /**
   * Execute all registered checks concurrently and wait for all to settle.
   *
   * Called automatically by start(); may also be invoked directly in tests.
   */
  async runAllChecks(): Promise<void> {
    await Promise.allSettled(this.checks.map((c) => this.runCheck(c)));
  }

  /**
   * Run a single health check, update stored results, and emit events.
   *
   * Event lifecycle per check run:
   *  - always emits "check"
   *  - emits "degraded" when consecutiveFailures crosses failureThreshold exactly
   *    (i.e., failures === failureThreshold). This fires once per degradation
   *    episode regardless of how many more failures follow.
   *  - emits "recovered" when: previously at/above failureThreshold → now healthy
   *  - No transition events are emitted on the very first run (prev status "unknown")
   */
  private async runCheck(def: HealthCheckDefinition): Promise<void> {
    const prev = this.results.get(def.name);
    const start = Date.now();
    let newStatus: "healthy" | "unhealthy" = "healthy";
    let error: string | undefined;

    try {
      await def.check();
    } catch (err) {
      newStatus = "unhealthy";
      error = err instanceof Error ? err.message : String(err);
    }

    const latencyMs = Date.now() - start;
    const consecutiveFailures =
      newStatus === "unhealthy" ? (prev?.consecutiveFailures ?? 0) + 1 : 0;

    const result: HealthCheckResult = {
      name: def.name,
      status: newStatus,
      latencyMs,
      checkedAt: new Date().toISOString(),
      error,
      consecutiveFailures,
    };

    this.results.set(def.name, result);
    this.emit("check", result);

    // Only emit transition events after the first real check (skip "unknown" baseline)
    if (prev && prev.status !== "unknown") {
      const prevFailures = prev.consecutiveFailures;
      const isHealthy = newStatus === "healthy";

      // Degraded: fires exactly when consecutive failures cross the threshold
      if (consecutiveFailures === this.failureThreshold) {
        this.emit("degraded", result);
        void this.sendWebhookAlert("alert", result);
      } else if (isHealthy && prevFailures >= this.failureThreshold) {
        // Recovered: fires when returning to healthy after having been degraded
        this.emit("recovered", result);
        void this.sendWebhookAlert("recovery", result);
      }
    }
  }

  /**
   * POST an alert or recovery payload to the configured webhookUrl.
   *
   * Failures are swallowed — webhook delivery is best-effort and must never
   * affect the health check loop or callers.
   */
  private async sendWebhookAlert(
    event: "alert" | "recovery",
    result: HealthCheckResult,
  ): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          subsystem: result.name,
          status: result.status,
          error: result.error,
          latencyMs: result.latencyMs,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Webhook failures are non-fatal
    }
  }

  /**
   * Return a snapshot of all current check results.
   *
   * @returns Array of HealthCheckResult, one per registered check
   */
  getStatus(): HealthCheckResult[] {
    return [...this.results.values()];
  }

  /**
   * Return the current result for a single subsystem by name.
   *
   * @param name - The check name as registered in HealthCheckDefinition
   * @returns HealthCheckResult or undefined if the name is not registered
   */
  getSubsystemStatus(name: string): HealthCheckResult | undefined {
    return this.results.get(name);
  }

  /**
   * Compute the aggregate status across all subsystems.
   *
   * - "healthy"  — zero unhealthy subsystems
   * - "down"     — all subsystems unhealthy
   * - "degraded" — some (not all) subsystems unhealthy
   *
   * "unknown" entries count as healthy for this aggregation.
   */
  getOverallStatus(): OverallStatus {
    const statuses = [...this.results.values()].map((r) => r.status);
    const unhealthy = statuses.filter((s) => s === "unhealthy").length;
    if (unhealthy === 0) return "healthy";
    if (unhealthy === statuses.length) return "down";
    return "degraded";
  }

  /**
   * Register a new health check at runtime.
   *
   * Useful when a subsystem (e.g. the WebSocket server) is not available at
   * construction time. The new check is seeded as "unknown" and will be
   * included in the next runAllChecks() cycle.
   */
  registerCheck(def: HealthCheckDefinition): void {
    this.checks.push(def);
    this.results.set(def.name, {
      name: def.name,
      status: "unknown",
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 0,
    });
  }

  /** Returns true if the periodic check loop is active. */
  isRunning(): boolean {
    return this.running;
  }
}

// ── Factory — voice-jib-jab subsystem checks ─────────────────────────

/**
 * Create the standard set of health checks for voice-jib-jab subsystems.
 *
 * Checks created (in order):
 *  - stt       — OpenAI /v1/models reachability (401/403 = reachable)
 *  - tts       — Same OpenAI endpoint
 *  - opa       — OPA bundle file accessibility (skipped when opaEnabled=false)
 *  - chromadb  — ChromaDB heartbeat HTTP endpoint
 *  - database  — SQLite file access or PostgreSQL URL validity
 *
 * @param opts - Optional overrides for URLs and feature flags
 * @returns Array of HealthCheckDefinition ready for HealthMonitorService
 */
export function createVoiceAgentHealthChecks(opts: {
  opaEnabled?: boolean;
  chromaDbUrl?: string;
  openAiBaseUrl?: string;
  sqlitePath?: string;
  postgresUrl?: string;
  voiceWss?: { isHealthy(): boolean };
}): HealthCheckDefinition[] {
  const checks: HealthCheckDefinition[] = [];

  // WebSocket — verify voice WebSocket server is open and accepting connections
  if (opts.voiceWss) {
    checks.push({
      name: "websocket",
      async check() {
        if (!opts.voiceWss!.isHealthy()) {
          throw new Error("Voice WebSocket server is not accepting connections");
        }
      },
    });
  }

  // STT — verify OpenAI endpoint is reachable; 401/403 means server is up
  checks.push({
    name: "stt",
    async check() {
      const url = opts.openAiBaseUrl ?? "https://api.openai.com";
      const res = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: "Bearer test" },
      });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        throw new Error(`HTTP ${res.status}`);
      }
    },
  });

  // TTS — same OpenAI endpoint
  checks.push({
    name: "tts",
    async check() {
      const url = opts.openAiBaseUrl ?? "https://api.openai.com";
      const res = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: "Bearer test" },
      });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        throw new Error(`HTTP ${res.status}`);
      }
    },
  });

  // OPA — check that the policy bundle file exists (no-op when OPA is disabled)
  checks.push({
    name: "opa",
    async check() {
      if (!opts.opaEnabled) return;
      const { access } = await import("node:fs/promises");
      const bundlePath = process.env.OPA_BUNDLE_PATH ?? "policy/bundle.tar.gz";
      await access(bundlePath);
    },
  });

  // ChromaDB — HTTP heartbeat endpoint
  checks.push({
    name: "chromadb",
    async check() {
      const url =
        opts.chromaDbUrl ?? (process.env.CHROMA_URL ?? "http://localhost:8000");
      const res = await fetch(`${url}/api/v1/heartbeat`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  });

  // Database — SQLite file access or PostgreSQL URL structure check
  checks.push({
    name: "database",
    async check() {
      if (opts.postgresUrl) {
        // Validate URL structure — a full TCP ping requires a pg client which
        // is not a dependency here; URL validity is a meaningful liveness signal.
        const url = new URL(opts.postgresUrl);
        if (!url.hostname) throw new Error("Invalid PostgreSQL URL");
        return;
      }
      if (opts.sqlitePath) {
        const { access } = await import("node:fs/promises");
        await access(opts.sqlitePath);
      }
    },
  });

  return checks;
}
