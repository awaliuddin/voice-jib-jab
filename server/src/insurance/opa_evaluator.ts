/**
 * OpaEvaluator — Wraps @open-policy-agent/opa-wasm for in-process policy evaluation.
 *
 * Loads a pre-compiled OPA bundle (produced by `scripts/build-policy.sh`) and
 * evaluates the voice_jib_jab.policy Rego rules synchronously per request.
 *
 * Lifecycle:
 *   const evaluator = new OpaEvaluator(bundlePath);
 *   await evaluator.initialize();           // async: loads WASM bundle
 *   const out = evaluator.evaluate(input);  // sync: sub-millisecond evaluation
 *
 * PolicyGate accepts an optional OpaEvaluator in its constructor. When provided
 * and initialized, PolicyGate.evaluate() delegates aggregation to OPA rather than
 * the TypeScript DECISION_PRIORITY merge loop.
 */

import fs from "fs";
import type { PolicyDecision } from "../schemas/events.js";

// ── Input/Output types ─────────────────────────────────────────────────

export interface OpaCheckInput {
  name: string;
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  safeRewrite?: string;
  requiredDisclaimerId?: string;
}

export interface OpaInput {
  checks: OpaCheckInput[];
}

export interface OpaOutput {
  decision: PolicyDecision;
  severity: number;
  safeRewrite: string | null;
  requiredDisclaimerId: string | null;
}

export interface OpaModeratorInput {
  moderator_check: {
    categories: Array<{ name: string; score: number }>;
    thresholds: Record<string, number>;
    tenant_id?: string;
  };
}

export interface OpaModeratorOutput {
  decision: PolicyDecision;
  severity: number;
  reasonCode: string | null;
}

export interface OpaClaimsInput {
  claims_check: {
    similarity_score: number;
    threshold: number;
    tenant_id?: string;
  };
}

export interface OpaClaimsOutput {
  decision: PolicyDecision;
  severity: number;
  reasonCode: string | null;
}

// ── Internal OPA WASM types ────────────────────────────────────────────

interface OpaPolicy {
  evaluate(
    input: unknown,
  ): Array<{ expressions: Array<{ value: unknown }> }>;
}

interface OpaWasmModule {
  loadPolicy(data: ArrayBuffer | Buffer): Promise<OpaPolicy>;
}

// ── TenantPolicyData ───────────────────────────────────────────────────

export interface TenantPolicyData {
  /** Per-category moderation thresholds that override global config for this tenant. */
  moderationThresholds?: Record<string, number>;
  /** Cosine similarity threshold for claims evaluation for this tenant. */
  claimsThreshold?: number;
}

// ── OpaEvaluator ──────────────────────────────────────────────────────

export class OpaEvaluator {
  private policy: OpaPolicy | null = null;
  private readonly bundlePath: string;
  private readonly tenantPolicyData = new Map<string, TenantPolicyData>();

  constructor(bundlePath: string) {
    this.bundlePath = bundlePath;
  }

  /**
   * Load the pre-compiled OPA WASM bundle.
   * Must be called before evaluate(). Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.policy) return;

    const bundleData = fs.readFileSync(this.bundlePath);

    // Dynamic import so Jest can mock the module cleanly
    const opaWasm = (await import(
      "@open-policy-agent/opa-wasm"
    )) as OpaWasmModule;

    this.policy = await opaWasm.loadPolicy(bundleData);
  }

  /**
   * Register per-tenant policy data (threshold overrides).
   * When a tenantId is present in OPA input, these values override the
   * caller-supplied thresholds, enabling tenant-specific moderation policies.
   */
  setTenantPolicyData(tenantId: string, data: TenantPolicyData): void {
    this.tenantPolicyData.set(tenantId, data);
  }

  /** Remove policy data for a specific tenant (or all if no argument). */
  clearTenantPolicyData(tenantId?: string): void {
    if (tenantId !== undefined) {
      this.tenantPolicyData.delete(tenantId);
    } else {
      this.tenantPolicyData.clear();
    }
  }

  /** Get stored policy data for a tenant (undefined if not set). */
  getTenantPolicyData(tenantId: string): TenantPolicyData | undefined {
    return this.tenantPolicyData.get(tenantId);
  }

  /**
   * Evaluate the voice_jib_jab.policy rules against the given check results.
   * Returns the aggregated decision in sub-millisecond time.
   *
   * @throws {Error} if initialize() has not been called.
   */
  evaluate(input: OpaInput): OpaOutput {
    if (!this.policy) {
      throw new Error(
        "OpaEvaluator not initialized. Call initialize() before evaluate().",
      );
    }

    const results = this.policy.evaluate(input);

    // OPA returns: [{ expressions: [{ value: { result: {...} } }] }]
    const raw = results?.[0]?.expressions?.[0]?.value as
      | Record<string, unknown>
      | undefined;

    if (!raw) {
      return { decision: "allow", severity: 0, safeRewrite: null, requiredDisclaimerId: null };
    }

    // The entrypoint is voice_jib_jab/policy — OPA returns the full package document
    // When loaded via loadPolicy with entrypoint, value IS the result object directly.
    const resultObj = (raw.result ?? raw) as Record<string, unknown>;

    return {
      decision: (resultObj.decision as PolicyDecision | undefined) ?? "allow",
      severity: typeof resultObj.severity === "number" ? resultObj.severity : 0,
      safeRewrite:
        typeof resultObj.safeRewrite === "string" ? resultObj.safeRewrite : null,
      requiredDisclaimerId:
        typeof resultObj.requiredDisclaimerId === "string"
          ? resultObj.requiredDisclaimerId
          : null,
    };
  }

  /**
   * Evaluate the moderator_check rule against category scores and thresholds.
   * Returns the moderation decision in sub-millisecond time.
   *
   * @throws {Error} if initialize() has not been called.
   */
  evaluateModeratorCheck(input: OpaModeratorInput, tenantId?: string): OpaModeratorOutput {
    if (!this.policy) {
      throw new Error(
        "OpaEvaluator not initialized. Call initialize() before evaluateModeratorCheck().",
      );
    }

    // Merge tenant-specific thresholds if available
    let effectiveInput = input;
    if (tenantId) {
      const tenantData = this.tenantPolicyData.get(tenantId);
      if (tenantData?.moderationThresholds) {
        effectiveInput = {
          moderator_check: {
            ...input.moderator_check,
            thresholds: {
              ...input.moderator_check.thresholds,
              ...tenantData.moderationThresholds,
            },
            tenant_id: tenantId,
          },
        };
      }
    }

    const results = this.policy.evaluate(effectiveInput);

    const raw = results?.[0]?.expressions?.[0]?.value as
      | Record<string, unknown>
      | undefined;

    if (!raw) {
      return { decision: "allow", severity: 0, reasonCode: null };
    }

    // Unwrap moderator_check key if present (multi-entrypoint WASM format)
    const resultObj = (raw.moderator_check ?? raw) as Record<string, unknown>;

    return {
      decision: (resultObj.decision as PolicyDecision | undefined) ?? "allow",
      severity: typeof resultObj.severity === "number" ? resultObj.severity : 0,
      reasonCode:
        typeof resultObj.reason_code === "string" ? resultObj.reason_code : null,
    };
  }

  /**
   * Evaluate the claims_check rule against a cosine similarity score and threshold.
   * Returns the claims decision in sub-millisecond time.
   *
   * @throws {Error} if initialize() has not been called.
   */
  evaluateClaimsCheck(input: OpaClaimsInput, tenantId?: string): OpaClaimsOutput {
    if (!this.policy) {
      throw new Error(
        "OpaEvaluator not initialized. Call initialize() before evaluateClaimsCheck().",
      );
    }

    let effectiveInput = input;
    if (tenantId) {
      const tenantData = this.tenantPolicyData.get(tenantId);
      if (tenantData?.claimsThreshold !== undefined) {
        effectiveInput = {
          claims_check: {
            ...input.claims_check,
            threshold: tenantData.claimsThreshold,
            tenant_id: tenantId,
          },
        };
      }
    }

    const results = this.policy.evaluate(effectiveInput);

    const raw = results?.[0]?.expressions?.[0]?.value as
      | Record<string, unknown>
      | undefined;

    if (!raw) {
      return { decision: "refuse", severity: 3, reasonCode: "CLAIMS:UNVERIFIED" };
    }

    const resultObj = (raw.claims_check ?? raw) as Record<string, unknown>;

    return {
      decision: (resultObj.decision as PolicyDecision | undefined) ?? "refuse",
      severity: typeof resultObj.severity === "number" ? resultObj.severity : 3,
      reasonCode:
        typeof resultObj.reason_code === "string"
          ? resultObj.reason_code
          : "CLAIMS:UNVERIFIED",
    };
  }

  get isInitialized(): boolean {
    return this.policy !== null;
  }

  /**
   * For testing: inject a pre-constructed policy directly (bypasses file I/O).
   * @internal
   */
  _injectPolicy(policy: OpaPolicy): void {
    this.policy = policy;
  }
}
