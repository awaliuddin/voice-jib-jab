/**
 * OpaModeratorCheck — OPA-backed content moderation with declarative threshold logic.
 *
 * Two-tier evaluation:
 *   Tier 1: Pattern matching (ModeratorCheck logic) — zero-latency, synchronous.
 *           Produces binary scores: 1.0 for matched category, 0.0 for all others.
 *   Tier 2: OPA threshold evaluation — `moderator_check` Rego rule applies
 *           configurable per-category thresholds and returns the binding decision.
 *
 * When OPA is not initialized, falls back to Tier 1 result (backward compatible).
 * This preserves sub-400ms latency even when OPA WASM is not yet loaded.
 *
 * Score model: binary 0/1 today. Future: OpenAI Moderation API provides
 * real float scores without changing this class or the OPA interface.
 */

import type { OpaEvaluator } from "./opa_evaluator.js";
import type { PolicyCheck, CheckResult, EvaluationContext } from "./policy_gate.js";
import type { ModerationCategory } from "./moderation_patterns.js";

// ── Config ─────────────────────────────────────────────────────────────

export interface OpaModeratorConfig {
  /** Moderation categories with patterns, severity, and decision. */
  categories: ModerationCategory[];
  /**
   * Per-category thresholds for OPA evaluation.
   * Keys are category names (e.g. "SELF_HARM", "JAILBREAK").
   * "default" key applies to any category without a specific threshold.
   * Example: { "default": 0.5, "SELF_HARM": 0.3 }
   */
  thresholds: Record<string, number>;
}

// ── OpaModeratorCheck ──────────────────────────────────────────────────

export class OpaModeratorCheck implements PolicyCheck {
  readonly name = "opa_moderator";

  private readonly evaluator: OpaEvaluator;
  private readonly config: OpaModeratorConfig;

  constructor(evaluator: OpaEvaluator, config: OpaModeratorConfig) {
    this.evaluator = evaluator;
    this.config = config;
  }

  evaluate(ctx: EvaluationContext): CheckResult {
    // ── Tier 1: pattern matching ──────────────────────────────────────
    // Find the first category whose patterns match the input text.
    const text = ctx.text.toLowerCase();
    let matchedCategory: ModerationCategory | null = null;

    outer: for (const category of this.config.categories) {
      for (const pattern of category.patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          matchedCategory = category;
          break outer;
        }
      }
    }

    // Build tier 1 result (pattern-match decision)
    const tier1Result: CheckResult = matchedCategory
      ? {
          decision: matchedCategory.decision,
          reasonCodes: [
            "MODERATION_VIOLATION",
            `MODERATION:${matchedCategory.name}`,
          ],
          severity: matchedCategory.severity,
        }
      : { decision: "allow", reasonCodes: [], severity: 0 };

    // ── Tier 2: OPA threshold evaluation ─────────────────────────────
    // When OPA is not initialized, fall back to tier 1 (backward compat).
    if (!this.evaluator.isInitialized) {
      return tier1Result;
    }

    // Build scores: 1.0 for the matched category, 0.0 for all others.
    const categories = this.config.categories.map((cat) => ({
      name: cat.name,
      score: matchedCategory?.name === cat.name ? 1.0 : 0.0,
    }));

    const opaResult = this.evaluator.evaluateModeratorCheck({
      moderator_check: {
        categories,
        thresholds: this.config.thresholds,
      },
    });

    if (opaResult.decision === "allow") {
      return { decision: "allow", reasonCodes: [], severity: 0 };
    }

    return {
      decision: opaResult.decision,
      reasonCodes: opaResult.reasonCode
        ? ["MODERATION_VIOLATION", opaResult.reasonCode]
        : tier1Result.reasonCodes,
      severity: opaResult.severity,
    };
  }
}
