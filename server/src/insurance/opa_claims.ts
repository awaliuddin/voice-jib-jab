/**
 * OpaClaimsCheck — Two-tier claims verification using OPA threshold evaluation.
 *
 * Tier 1: AllowedClaimsRegistry computes TF-IDF cosine similarity score
 *         (VectorStore) against the approved claims corpus.
 * Tier 2: OpaEvaluator evaluates the score against a configurable threshold
 *         and returns allow/refuse as a declarative Rego rule.
 *
 * Falls back to registry match result when OPA is not initialized.
 * Disallowed patterns are checked before similarity scoring.
 */

import type { EvaluationContext, PolicyCheck, CheckResult } from "../insurance/policy_gate.js";
import type { OpaEvaluator } from "../insurance/opa_evaluator.js";
import { AllowedClaimsRegistry } from "../insurance/allowed_claims_registry.js";

/** Configuration for OPA-backed claims verification. */
export interface OpaClaimsConfig {
  registry: AllowedClaimsRegistry;
  /** Cosine similarity threshold for claim acceptance (default 0.6) */
  threshold: number;
}

/** Two-tier claims check: TF-IDF/embedding similarity scored against an OPA threshold. */
export class OpaClaimsCheck implements PolicyCheck {
  readonly name = "opa_claims";
  private readonly evaluator: OpaEvaluator;
  private readonly registry: AllowedClaimsRegistry;
  private readonly threshold: number;

  constructor(evaluator: OpaEvaluator, config: OpaClaimsConfig) {
    this.evaluator = evaluator;
    this.registry = config.registry;
    this.threshold = config.threshold;
  }

  async evaluate(ctx: EvaluationContext): Promise<CheckResult> {
    // Disallowed patterns take priority — checked before similarity scoring.
    const disallowed = this.registry.matchDisallowedPatterns(ctx.text);
    if (disallowed.matched) {
      return {
        decision: "refuse",
        reasonCodes: ["CLAIMS_VIOLATION", "CLAIMS:DISALLOWED_PATTERN"],
        severity: 3,
      };
    }

    // Tier 1: similarity scoring — dense embedding when initialized, TF-IDF fallback.
    const similarityScore = this.registry.isEmbeddingInitialized
      ? await this.registry.getEmbeddingSimilarityScore(ctx.text)
      : this.registry.getSimilarityScore(ctx.text);

    // When OPA is not initialized, fall back to threshold comparison directly.
    if (!this.evaluator.isInitialized) {
      if (similarityScore >= this.threshold) {
        return { decision: "allow", reasonCodes: [], severity: 0 };
      }
      return {
        decision: "refuse",
        reasonCodes: ["CLAIMS_VIOLATION", "CLAIMS:UNVERIFIED"],
        severity: 3,
      };
    }

    // Tier 2: OPA evaluates similarity score against threshold.
    const opaResult = this.evaluator.evaluateClaimsCheck({
      claims_check: {
        similarity_score: similarityScore,
        threshold: this.threshold,
      },
    }, ctx.tenantId);

    if (opaResult.decision === "allow") {
      return { decision: "allow", reasonCodes: [], severity: 0 };
    }

    return {
      decision: opaResult.decision,
      reasonCodes: [
        "CLAIMS_VIOLATION",
        opaResult.reasonCode ?? "CLAIMS:UNVERIFIED",
      ],
      severity: opaResult.severity,
    };
  }
}
