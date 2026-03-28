/**
 * ConfigValidator — Pre-session configuration and reachability validator.
 *
 * Runs all checks concurrently via Promise.allSettled and returns a
 * structured report so the caller can decide whether to allow a session
 * to start.
 *
 * Checks:
 *  - reachability.openai   — HTTP probe; 401/403 means the server is up
 *  - reachability.chromadb — /api/v1/heartbeat must return 200
 *  - policy.opaBundle      — Bundle file must exist when OPA is enabled
 *  - tenantConfig          — tenantId must be non-empty; disabled flag checked
 *  - audioConfig           — sampleRate in [8000,48000], channelCount in [1,2]
 *  - storageDir            — dirname(config.storage.databasePath) must be writable
 */

import * as fsp from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config/index.js";

// ── Public types ───────────────────────────────────────────────────────

/** Result of a single validation check with pass/fail, message, and timing. */
export interface ValidationResult {
  check: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

/** Caller-supplied overrides and runtime values to validate before session start. */
export interface ConfigValidationRequest {
  tenantId?: string;
  tenantConfig?: Record<string, unknown>;
  audioConfig?: {
    sampleRate?: number;
    channelCount?: number;
  };
  opaEnabled?: boolean;
  openAiBaseUrl?: string;
  chromaDbUrl?: string;
}

/** Consolidated validation report with per-check results and overall validity. */
export interface ConfigValidationResponse {
  /** true only if ALL checks passed */
  valid: boolean;
  checks: ValidationResult[];
  durationMs: number;
  timestamp: string;
}

// ── ConfigValidator ────────────────────────────────────────────────────

/** Pre-session configuration and reachability validator running checks concurrently. */
export class ConfigValidator {
  constructor(private readonly config: ServerConfig) {}

  /**
   * Run all validation checks concurrently and return a consolidated report.
   *
   * Uses Promise.allSettled so a thrown error inside one check never prevents
   * the others from completing. Each check is individually timed.
   *
   * @param req - Caller-supplied overrides and runtime values to validate
   * @returns ConfigValidationResponse — always resolves, never rejects
   */
  async validate(req: ConfigValidationRequest): Promise<ConfigValidationResponse> {
    const overallStart = Date.now();

    const checkFns = [
      () => this.checkOpenAi(req.openAiBaseUrl),
      () => this.checkChromaDb(req.chromaDbUrl),
      () => this.checkOpaBundle(req.opaEnabled),
      () => this.checkTenant(req.tenantId, req.tenantConfig),
      () => this.checkAudio(req.audioConfig),
      () => this.checkStorageDir(),
    ];

    const settled = await Promise.allSettled(checkFns.map((fn) => fn()));

    const checks: ValidationResult[] = settled.map((outcome) => {
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      // A check function itself threw unexpectedly — treat as failure
      const err = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
      return {
        check: "unknown",
        passed: false,
        message: `Unexpected error: ${err}`,
        durationMs: 0,
      };
    });

    const valid = checks.every((c) => c.passed);

    return {
      valid,
      checks,
      durationMs: Date.now() - overallStart,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Individual checks ────────────────────────────────────────────────

  /**
   * Probe the OpenAI API endpoint.
   *
   * 401/403 responses mean the server is reachable (auth fails, but up).
   * Any other non-ok status or a network error is a failure.
   */
  private async checkOpenAi(openAiBaseUrl?: string): Promise<ValidationResult> {
    const check = "reachability.openai";
    const start = Date.now();
    const url = openAiBaseUrl ?? "https://api.openai.com";

    try {
      const res = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(5000),
        headers: { Authorization: "Bearer test" },
      });

      if (res.ok || res.status === 401 || res.status === 403) {
        return {
          check,
          passed: true,
          message: `OpenAI reachable (HTTP ${res.status})`,
          durationMs: Date.now() - start,
        };
      }

      return {
        check,
        passed: false,
        message: `OpenAI returned HTTP ${res.status}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        check,
        passed: false,
        message: `OpenAI unreachable: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Probe the ChromaDB heartbeat endpoint.
   *
   * Expects HTTP 200; any other status or network error is a failure.
   */
  private async checkChromaDb(chromaDbUrl?: string): Promise<ValidationResult> {
    const check = "reachability.chromadb";
    const start = Date.now();
    const url = chromaDbUrl ?? "http://localhost:8000";

    try {
      const res = await fetch(`${url}/api/v1/heartbeat`, {
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        return {
          check,
          passed: true,
          message: `ChromaDB reachable (HTTP ${res.status})`,
          durationMs: Date.now() - start,
        };
      }

      return {
        check,
        passed: false,
        message: `ChromaDB returned HTTP ${res.status}`,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        check,
        passed: false,
        message: `ChromaDB unreachable: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Verify the OPA policy bundle file exists.
   *
   * Skipped (passes) when OPA is not enabled. Uses the bundle path from
   * config unless overridden by the request.
   */
  private async checkOpaBundle(opaEnabled?: boolean): Promise<ValidationResult> {
    const check = "policy.opaBundle";
    const start = Date.now();

    const enabled = opaEnabled ?? this.config.opa.enabled;

    if (!enabled) {
      return {
        check,
        passed: true,
        message: "OPA disabled, skipping",
        durationMs: Date.now() - start,
      };
    }

    const bundlePath = this.config.opa.bundlePath;

    try {
      await fsp.access(bundlePath);
      return {
        check,
        passed: true,
        message: `OPA bundle found at ${bundlePath}`,
        durationMs: Date.now() - start,
      };
    } catch {
      return {
        check,
        passed: false,
        message: `OPA bundle not found at ${bundlePath}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Validate tenant identity and configuration.
   *
   * - tenantId must be non-empty
   * - if tenantConfig is provided, tenant must not be disabled
   */
  private async checkTenant(
    tenantId?: string,
    tenantConfig?: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const check = "tenantConfig";
    const start = Date.now();

    if (!tenantId) {
      return {
        check,
        passed: false,
        message: "tenantId is required",
        durationMs: Date.now() - start,
      };
    }

    if (tenantConfig !== undefined && tenantConfig.disabled === true) {
      return {
        check,
        passed: false,
        message: "Tenant is disabled",
        durationMs: Date.now() - start,
      };
    }

    return {
      check,
      passed: true,
      message: `Tenant "${tenantId}" is valid`,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Validate audio configuration parameters.
   *
   * Ranges:
   *  - sampleRate: 8000–48000 Hz
   *  - channelCount: 1–2
   *
   * When no audioConfig is provided, defaults are assumed valid.
   */
  private async checkAudio(
    audioConfig?: ConfigValidationRequest["audioConfig"],
  ): Promise<ValidationResult> {
    const check = "audioConfig";
    const start = Date.now();

    if (audioConfig === undefined) {
      return {
        check,
        passed: true,
        message: "No audio config provided, using defaults",
        durationMs: Date.now() - start,
      };
    }

    const { sampleRate, channelCount } = audioConfig;

    if (sampleRate !== undefined) {
      if (sampleRate < 8000 || sampleRate > 48000) {
        return {
          check,
          passed: false,
          message: `sampleRate ${sampleRate} is out of range [8000, 48000]`,
          durationMs: Date.now() - start,
        };
      }
    }

    if (channelCount !== undefined) {
      if (channelCount < 1 || channelCount > 2) {
        return {
          check,
          passed: false,
          message: `channelCount ${channelCount} is out of range [1, 2]`,
          durationMs: Date.now() - start,
        };
      }
    }

    return {
      check,
      passed: true,
      message: "Audio config is valid",
      durationMs: Date.now() - start,
    };
  }

  /**
   * Verify that the storage directory is writable.
   *
   * Uses the dirname of config.storage.databasePath as the target directory.
   */
  private async checkStorageDir(): Promise<ValidationResult> {
    const check = "storageDir";
    const start = Date.now();
    const dir = path.dirname(this.config.storage.databasePath);

    try {
      await fsp.access(dir, fsConstants.W_OK);
      return {
        check,
        passed: true,
        message: `Storage directory is writable: ${dir}`,
        durationMs: Date.now() - start,
      };
    } catch {
      return {
        check,
        passed: false,
        message: `Storage directory is not writable: ${dir}`,
        durationMs: Date.now() - start,
      };
    }
  }
}
