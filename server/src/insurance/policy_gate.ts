/**
 * PolicyGate - Central decision-making interface for policy enforcement.
 *
 * The PolicyGate evaluates proposed content (user input or assistant response)
 * against a pipeline of policy checks and returns a binding PolicyDecision.
 * Lane B is contractually bound to obey PolicyGate decisions.
 *
 * Design decisions:
 * - The gate runs checks sequentially in severity order: PII first (redact or
 *   flag based on config), then moderation (may refuse/escalate), then claims
 *   (may rewrite or require disclaimer). First non-allow decision wins.
 * - The gate is stateless per evaluation — all session context is passed in
 *   via EvaluationContext.
 * - Each check returns a CheckResult; the gate merges reason_codes and picks
 *   the highest-severity decision.
 * - The gate itself does NOT emit events. The ControlEngine wraps the gate
 *   and handles event emission, keeping the gate purely functional and testable.
 */

import {
  AllowedClaimsRegistry,
  ClaimMatchResult,
} from "./allowed_claims_registry.js";
import { PolicyDecision } from "../schemas/events.js";
import type { ModerationCategory } from "./moderation_patterns.js";

// ── Check result returned by each individual policy check ──────────────

export interface CheckResult {
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number; // 0 = info, 1 = low, 2 = medium, 3 = high, 4 = critical
  safeRewrite?: string;
  requiredDisclaimerId?: string;
}

// ── Context supplied to the gate for each evaluation ───────────────────

export interface EvaluationContext {
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  isFinal: boolean;
  metadata?: Record<string, unknown>;
}

// ── Gate result (aggregated) ───────────────────────────────────────────

export interface GateResult {
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  safeRewrite?: string;
  requiredDisclaimerId?: string;
  checkDurationMs: number;
  checksRun: string[];
}

// ── Individual check interfaces (implemented by subcomponents) ─────────

export interface PolicyCheck {
  readonly name: string;
  evaluate(ctx: EvaluationContext): CheckResult;
}

// ── Moderator check ───────────────────────────────────────────────────

/**
 * Pattern-based content moderation with categorized deny patterns.
 *
 * Supports two construction modes:
 * - Legacy: `new ModeratorCheck(regexArray)` — all matches return generic MODERATION_VIOLATION
 * - Categorized: `new ModeratorCheck(categoryArray)` — matches return MODERATION:<CATEGORY_NAME>
 *
 * Each category can specify its own decision (refuse vs escalate) and severity.
 * Self-harm triggers "escalate" for human handoff; most others trigger "refuse".
 */
export class ModeratorCheck implements PolicyCheck {
  readonly name = "moderator";

  private categories: ModerationCategory[];
  private denyPatterns: RegExp[];

  constructor(patternsOrCategories?: RegExp[] | ModerationCategory[]) {
    if (
      !patternsOrCategories ||
      patternsOrCategories.length === 0
    ) {
      this.categories = [];
      this.denyPatterns = [];
    } else if (patternsOrCategories[0] instanceof RegExp) {
      this.categories = [];
      this.denyPatterns = patternsOrCategories as RegExp[];
    } else {
      this.categories = patternsOrCategories as ModerationCategory[];
      this.denyPatterns = [];
    }
  }

  evaluate(ctx: EvaluationContext): CheckResult {
    const text = ctx.text.toLowerCase();

    // Check categorized patterns first (named, with per-category decisions)
    for (const category of this.categories) {
      for (const pattern of category.patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          return {
            decision: category.decision,
            reasonCodes: [
              "MODERATION_VIOLATION",
              `MODERATION:${category.name}`,
            ],
            severity: category.severity,
          };
        }
      }
    }

    // Fall back to legacy patterns (generic reason code)
    for (const pattern of this.denyPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        return {
          decision: "refuse",
          reasonCodes: ["MODERATION_VIOLATION"],
          severity: 4,
        };
      }
    }

    return { decision: "allow", reasonCodes: [], severity: 0 };
  }
}

// ── ClaimsChecker check ────────────────────────────────────────────────

export class ClaimsCheck implements PolicyCheck {
  readonly name = "claims_checker";

  private registry: AllowedClaimsRegistry;

  constructor(registry: AllowedClaimsRegistry) {
    this.registry = registry;
  }

  evaluate(ctx: EvaluationContext): CheckResult {
    // Only check assistant output (not user input)
    if (ctx.role !== "assistant") {
      return { decision: "allow", reasonCodes: [], severity: 0 };
    }

    const { transcriptTexts, metadataTexts, claimIds } =
      this.collectClaimCandidates(ctx);
    const textCandidates = [
      ...(ctx.isFinal ? transcriptTexts : []),
      ...metadataTexts,
    ];

    if (textCandidates.length === 0 && claimIds.length === 0) {
      return { decision: "allow", reasonCodes: [], severity: 0 };
    }

    const results: CheckResult[] = [];

    for (const text of textCandidates) {
      results.push(this.evaluateTextClaim(text));
    }

    for (const claimId of claimIds) {
      results.push(this.evaluateClaimId(claimId));
    }

    return this.mergeResults(results);
  }

  private evaluateTextClaim(text: string): CheckResult {
    const disallowed = this.registry.matchDisallowedPatterns(text);
    if (disallowed.matched) {
      const match = this.registry.matchText(text);
      const approvedClaim = match.claimId
        ? this.registry.getById(match.claimId)
        : null;
      const reasonCodes = [
        "CLAIMS_DISALLOWED",
        ...disallowed.patterns.map((pattern) =>
          this.formatDisallowedPattern(pattern),
        ),
      ];
      return {
        decision: "rewrite",
        reasonCodes,
        severity: 3,
        safeRewrite: approvedClaim?.text,
        requiredDisclaimerId: match.requiredDisclaimerId ?? undefined,
      };
    }

    const match: ClaimMatchResult = this.registry.matchText(text);

    if (match.matchType === "exact") {
      // Exact match — allow, but may require disclaimer
      return {
        decision: "allow",
        reasonCodes: [],
        severity: 0,
        requiredDisclaimerId: match.requiredDisclaimerId ?? undefined,
      };
    }

    if (match.matchType === "partial") {
      // Partial match — rewrite to approved version
      const approvedClaim = match.claimId
        ? this.registry.getById(match.claimId)
        : null;

      return {
        decision: "rewrite",
        reasonCodes: ["CLAIMS_RISK"],
        severity: 2,
        safeRewrite: approvedClaim?.text,
        requiredDisclaimerId: match.requiredDisclaimerId ?? undefined,
      };
    }

    // No match at all — if registry is non-empty, this is an unverified claim
    if (this.registry.size > 0) {
      return {
        decision: "allow", // Don't block; just flag for audit
        reasonCodes: ["UNVERIFIED_CLAIM"],
        severity: 1,
      };
    }

    return { decision: "allow", reasonCodes: [], severity: 0 };
  }

  private evaluateClaimId(claimId: string): CheckResult {
    if (!claimId) {
      return { decision: "allow", reasonCodes: [], severity: 0 };
    }

    const approvedClaim = this.registry.getById(claimId);
    if (approvedClaim) {
      return {
        decision: "allow",
        reasonCodes: [],
        severity: 0,
        requiredDisclaimerId: approvedClaim.requiredDisclaimerId ?? undefined,
      };
    }

    if (this.registry.size > 0) {
      return {
        decision: "allow",
        reasonCodes: ["UNVERIFIED_CLAIM_ID"],
        severity: 1,
      };
    }

    return { decision: "allow", reasonCodes: [], severity: 0 };
  }

  private collectClaimCandidates(ctx: EvaluationContext): {
    transcriptTexts: string[];
    metadataTexts: string[];
    claimIds: string[];
  } {
    const transcriptTexts: string[] = [];
    if (ctx.text && ctx.text.trim().length > 0) {
      transcriptTexts.push(ctx.text.trim());
    }

    const metadataTexts: string[] = [];
    const claimIds: string[] = [];

    if (ctx.metadata && typeof ctx.metadata === "object") {
      const metadata = ctx.metadata as Record<string, unknown>;
      const sources: unknown[] = [
        metadata.claims,
        metadata.claim_ids,
        metadata.response &&
          typeof metadata.response === "object" &&
          (metadata.response as Record<string, unknown>).claims,
        metadata.response &&
          typeof metadata.response === "object" &&
          (metadata.response as Record<string, unknown>).claim_ids,
      ].filter((value) => value !== undefined);

      for (const source of sources) {
        const { texts, ids } = this.parseClaimSource(source);
        metadataTexts.push(...texts);
        claimIds.push(...ids);
      }
    }

    return {
      transcriptTexts,
      metadataTexts: Array.from(new Set(metadataTexts)),
      claimIds: Array.from(new Set(claimIds)),
    };
  }

  private parseClaimSource(source: unknown): {
    texts: string[];
    ids: string[];
  } {
    const texts: string[] = [];
    const ids: string[] = [];

    if (Array.isArray(source)) {
      for (const entry of source) {
        const { texts: entryTexts, ids: entryIds } =
          this.parseClaimSource(entry);
        texts.push(...entryTexts);
        ids.push(...entryIds);
      }
      return { texts, ids };
    }

    if (typeof source === "string") {
      if (source.trim().length === 0) {
        return { texts, ids };
      }
      if (this.looksLikeClaimId(source)) {
        ids.push(source.trim());
      } else {
        texts.push(source.trim());
      }
      return { texts, ids };
    }

    if (source && typeof source === "object") {
      const record = source as Record<string, unknown>;
      const id =
        typeof record.id === "string"
          ? record.id
          : typeof record.claim_id === "string"
            ? record.claim_id
            : undefined;
      const text =
        typeof record.text === "string"
          ? record.text
          : typeof record.claim === "string"
            ? record.claim
            : undefined;

      if (id && id.trim().length > 0) {
        ids.push(id.trim());
      }
      if (text && text.trim().length > 0) {
        texts.push(text.trim());
      }
    }

    return { texts, ids };
  }

  private looksLikeClaimId(value: string): boolean {
    return /^CLAIM-\d{3,}$/i.test(value.trim());
  }

  private formatDisallowedPattern(pattern: string): string {
    const normalized = pattern
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `DISALLOWED_PATTERN:${normalized || "UNKNOWN"}`;
  }

  private mergeResults(results: CheckResult[]): CheckResult {
    if (results.length === 0) {
      return { decision: "allow", reasonCodes: [], severity: 0 };
    }

    const decisionPriority: Record<PolicyDecision, number> = {
      allow: 0,
      rewrite: 1,
      refuse: 2,
      escalate: 3,
      cancel_output: 4,
    };

    let winningResult: CheckResult = {
      decision: "allow",
      reasonCodes: [],
      severity: 0,
    };

    const reasonCodes: string[] = [];
    let requiredDisclaimerId: string | undefined;

    for (const result of results) {
      reasonCodes.push(...result.reasonCodes);

      if (!requiredDisclaimerId && result.requiredDisclaimerId) {
        requiredDisclaimerId = result.requiredDisclaimerId;
      }

      const currentPriority = decisionPriority[winningResult.decision];
      const newPriority = decisionPriority[result.decision];

      if (
        newPriority > currentPriority ||
        (newPriority === currentPriority &&
          result.severity > winningResult.severity)
      ) {
        winningResult = result;
      }
    }

    const dedupedReasonCodes = Array.from(new Set(reasonCodes));

    return {
      decision: winningResult.decision,
      reasonCodes: dedupedReasonCodes,
      severity: winningResult.severity,
      safeRewrite: winningResult.safeRewrite,
      requiredDisclaimerId:
        winningResult.requiredDisclaimerId ?? requiredDisclaimerId,
    };
  }
}

// ── PIIRedactor check ──────────────────────────────────────────────────

/**
 * Regex-based PII detection stub.
 * Production: use a dedicated PII detection service (e.g., Presidio, AWS Comprehend).
 */
export class PIIRedactorCheck implements PolicyCheck {
  readonly name = "pii_redactor";

  private patterns: Array<{ name: string; regex: RegExp; replacement: string }>;
  private mode: "redact" | "flag";
  private includeMetadata: boolean;
  private redactMetadata: boolean;
  private maxMetadataDepth: number;

  constructor(config: PIIRedactorConfig = {}) {
    const defaultPatterns = [
      {
        name: "phone_us",
        regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
        replacement: "[PHONE_REDACTED]",
      },
      {
        name: "email",
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: "[EMAIL_REDACTED]",
      },
      {
        name: "ssn",
        regex: /\b\d{3}-\d{2}-\d{4}\b/g,
        replacement: "[SSN_REDACTED]",
      },
      {
        name: "credit_card",
        regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
        replacement: "[CC_REDACTED]",
      },
    ];

    this.patterns = config.patterns ?? defaultPatterns;
    this.mode = config.mode ?? "redact";
    this.includeMetadata = config.includeMetadata ?? true;
    this.redactMetadata = config.redactMetadata ?? true;
    this.maxMetadataDepth = config.maxMetadataDepth ?? 4;
  }

  /**
   * Redact PII from a single text string and return detected types.
   * This is safe to call for audit or tool-call sanitation.
   */
  redactText(text: string): PIIRedactionResult {
    let redacted = text;
    const detectedTypes: string[] = [];

    for (const { name, regex, replacement } of this.patterns) {
      // Reset regex state for global patterns
      regex.lastIndex = 0;
      if (regex.test(redacted)) {
        detectedTypes.push(name);
        regex.lastIndex = 0;
        redacted = redacted.replace(regex, replacement);
      }
    }

    return {
      redactedText: redacted,
      detectedTypes: Array.from(new Set(detectedTypes)),
    };
  }

  evaluate(ctx: EvaluationContext): CheckResult {
    const textResult = this.redactText(ctx.text);
    const metadataResult = this.includeMetadata
      ? this.redactMetadataValue(ctx.metadata, 0, new WeakSet())
      : { redactedValue: ctx.metadata, detectedTypes: [] };

    const detectedTypes = Array.from(
      new Set([...textResult.detectedTypes, ...metadataResult.detectedTypes]),
    );

    if (detectedTypes.length > 0) {
      const reasonCodes = [
        "PII_DETECTED",
        ...detectedTypes.map((t) => `PII_DETECTED:${t.toUpperCase()}`),
      ];
      const shouldRedact = this.mode === "redact";
      return {
        decision: shouldRedact ? "rewrite" : "allow",
        reasonCodes,
        severity: shouldRedact ? 3 : 1,
        safeRewrite: shouldRedact ? textResult.redactedText : undefined,
      };
    }

    return { decision: "allow", reasonCodes: [], severity: 0 };
  }

  private redactMetadataValue(
    value: unknown,
    depth: number,
    seen: WeakSet<object>,
  ): { redactedValue: unknown; detectedTypes: string[] } {
    if (depth > this.maxMetadataDepth) {
      return { redactedValue: value, detectedTypes: [] };
    }

    if (typeof value === "string") {
      const result = this.redactText(value);
      return {
        redactedValue: this.redactMetadata ? result.redactedText : value,
        detectedTypes: result.detectedTypes,
      };
    }

    if (!value || typeof value !== "object") {
      return { redactedValue: value, detectedTypes: [] };
    }

    if (seen.has(value)) {
      return { redactedValue: value, detectedTypes: [] };
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const redactedArray: unknown[] = [];
      const detectedTypes: string[] = [];

      for (const entry of value) {
        const result = this.redactMetadataValue(entry, depth + 1, seen);
        detectedTypes.push(...result.detectedTypes);
        if (this.redactMetadata) {
          redactedArray.push(result.redactedValue);
        }
      }

      return {
        redactedValue: this.redactMetadata ? redactedArray : value,
        detectedTypes: Array.from(new Set(detectedTypes)),
      };
    }

    const record = value as Record<string, unknown>;
    const redactedRecord: Record<string, unknown> = {};
    const detectedTypes: string[] = [];

    for (const [key, entry] of Object.entries(record)) {
      const result = this.redactMetadataValue(entry, depth + 1, seen);
      detectedTypes.push(...result.detectedTypes);
      if (this.redactMetadata) {
        redactedRecord[key] = result.redactedValue;
      }
    }

    return {
      redactedValue: this.redactMetadata ? redactedRecord : value,
      detectedTypes: Array.from(new Set(detectedTypes)),
    };
  }
}

export interface PIIRedactionResult {
  redactedText: string;
  detectedTypes: string[];
}

export interface PIIRedactorConfig {
  mode?: "redact" | "flag";
  includeMetadata?: boolean;
  redactMetadata?: boolean;
  maxMetadataDepth?: number;
  patterns?: Array<{ name: string; regex: RegExp; replacement: string }>;
}

// ── Stub aliases (spec naming) ─────────────────────────────────────────

/**
 * Spec-aligned stub names for Lane C components.
 * These alias the concrete check implementations above.
 */
export class Moderator extends ModeratorCheck {}
export class ClaimsChecker extends ClaimsCheck {}
export class PIIRedactor extends PIIRedactorCheck {}

// ── PolicyGate (aggregator) ────────────────────────────────────────────

const DECISION_PRIORITY: Record<PolicyDecision, number> = {
  allow: 0,
  rewrite: 1,
  refuse: 2,
  escalate: 3,
  cancel_output: 4,
};

export class PolicyGate {
  private checks: PolicyCheck[];

  constructor(checks: PolicyCheck[] = []) {
    // Sort by implicit severity: PII → Moderator → Claims → any custom
    this.checks = checks;
  }

  /**
   * Run all checks and return the merged result.
   * First non-allow at the highest severity wins.
   * Short-circuits on cancel_output or critical-severity refuse/escalate
   * to avoid wasted work after a terminal decision.
   */
  evaluate(ctx: EvaluationContext): GateResult {
    const start = Date.now();
    const checksRun: string[] = [];
    const allReasonCodes: string[] = [];

    let winningResult: CheckResult = {
      decision: "allow",
      reasonCodes: [],
      severity: 0,
    };

    for (const check of this.checks) {
      checksRun.push(check.name);
      const result = check.evaluate(ctx);

      allReasonCodes.push(...result.reasonCodes);

      // Higher-priority decision wins; break ties by severity
      const currentPriority = DECISION_PRIORITY[winningResult.decision];
      const newPriority = DECISION_PRIORITY[result.decision];

      if (
        newPriority > currentPriority ||
        (newPriority === currentPriority &&
          result.severity > winningResult.severity)
      ) {
        winningResult = result;
      }

      // Short-circuit: no check can override cancel_output, and critical
      // refuse/escalate will be upgraded to cancel_output by OverrideController
      if (
        winningResult.decision === "cancel_output" ||
        (winningResult.severity >= 4 &&
          (winningResult.decision === "refuse" ||
            winningResult.decision === "escalate"))
      ) {
        break;
      }
    }

    return {
      decision: winningResult.decision,
      reasonCodes: allReasonCodes,
      severity: winningResult.severity,
      safeRewrite: winningResult.safeRewrite,
      requiredDisclaimerId: winningResult.requiredDisclaimerId,
      checkDurationMs: Date.now() - start,
      checksRun,
    };
  }
}
