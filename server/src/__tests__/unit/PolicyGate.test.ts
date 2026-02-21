/**
 * PolicyGate Unit Tests
 *
 * Tests the central policy enforcement pipeline including:
 * - ModeratorCheck: pattern-based content moderation
 * - ClaimsCheck: claim verification against AllowedClaimsRegistry
 * - PIIRedactorCheck: PII detection and redaction
 * - PolicyGate: pipeline orchestration and decision aggregation
 *
 * Target Coverage: 85%+
 */

import {
  PolicyGate,
  ModeratorCheck,
  ClaimsCheck,
  PIIRedactorCheck,
  type EvaluationContext,
  type PolicyCheck,
} from "../../insurance/policy_gate.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    sessionId: "test-session",
    role: "assistant",
    text: "Hello there",
    isFinal: true,
    ...overrides,
  };
}

function makeRegistry(
  claims: Array<{ id: string; text: string; requiredDisclaimerId?: string }> = [],
  disallowedPatterns: string[] = [],
): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims: claims.map((c) => ({
      id: c.id,
      text: c.text,
      requiredDisclaimerId: c.requiredDisclaimerId,
    })),
    disallowedPatterns,
    enableFileLoad: false,
  });
}

// ── ModeratorCheck ─────────────────────────────────────────────────────

describe("ModeratorCheck", () => {
  it("should allow clean text with no deny patterns", () => {
    const check = new ModeratorCheck();
    const result = check.evaluate(makeCtx({ text: "What is the weather?" }));

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
    expect(result.severity).toBe(0);
  });

  it("should allow text that does not match any deny pattern", () => {
    const check = new ModeratorCheck([/violence/i, /hate speech/i]);
    const result = check.evaluate(makeCtx({ text: "How do I bake a cake?" }));

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
  });

  it("should refuse text matching a deny pattern", () => {
    const check = new ModeratorCheck([/violence/i]);
    const result = check.evaluate(makeCtx({ text: "Tell me about violence" }));

    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
    expect(result.severity).toBe(4);
  });

  it("should match deny patterns case-insensitively", () => {
    const check = new ModeratorCheck([/forbidden topic/i]);
    const result = check.evaluate(
      makeCtx({ text: "Talk about FORBIDDEN TOPIC please" }),
    );

    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
  });

  it("should stop at the first matching deny pattern", () => {
    const check = new ModeratorCheck([/bad/i, /worse/i]);
    const result = check.evaluate(makeCtx({ text: "this is bad and worse" }));

    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toEqual(["MODERATION_VIOLATION"]);
  });

  it("should have name set to 'moderator'", () => {
    const check = new ModeratorCheck();
    expect(check.name).toBe("moderator");
  });

  describe("category-aware mode", () => {
    const categories = [
      {
        name: "TEST_CATEGORY",
        patterns: [/test_violation/i],
        severity: 3,
        decision: "refuse" as const,
      },
      {
        name: "ESCALATE_CATEGORY",
        patterns: [/needs_human/i],
        severity: 4,
        decision: "escalate" as const,
      },
    ];

    it("should return category-specific reason code on match", () => {
      const check = new ModeratorCheck(categories);
      const result = check.evaluate(makeCtx({ text: "this is a test_violation" }));

      expect(result.decision).toBe("refuse");
      expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
      expect(result.reasonCodes).toContain("MODERATION:TEST_CATEGORY");
      expect(result.severity).toBe(3);
    });

    it("should use the category decision (escalate)", () => {
      const check = new ModeratorCheck(categories);
      const result = check.evaluate(makeCtx({ text: "this needs_human help" }));

      expect(result.decision).toBe("escalate");
      expect(result.reasonCodes).toContain("MODERATION:ESCALATE_CATEGORY");
      expect(result.severity).toBe(4);
    });

    it("should allow clean text", () => {
      const check = new ModeratorCheck(categories);
      const result = check.evaluate(makeCtx({ text: "perfectly fine text" }));

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
    });

    it("should stop at the first matching category", () => {
      const overlapping = [
        { name: "FIRST", patterns: [/overlap/i], severity: 3, decision: "refuse" as const },
        { name: "SECOND", patterns: [/overlap/i], severity: 4, decision: "escalate" as const },
      ];
      const check = new ModeratorCheck(overlapping);
      const result = check.evaluate(makeCtx({ text: "this has overlap content" }));

      expect(result.reasonCodes).toContain("MODERATION:FIRST");
      expect(result.reasonCodes).not.toContain("MODERATION:SECOND");
    });
  });
});

// ── ClaimsCheck ────────────────────────────────────────────────────────

describe("ClaimsCheck", () => {
  const FDA_CLAIM = { id: "CLAIM-001", text: "Our product is FDA approved" };
  const SAFE_CLAIM = {
    id: "CLAIM-002",
    text: "Our product has been tested in clinical trials",
    requiredDisclaimerId: "DISC-001",
  };

  it("should have name set to 'claims_checker'", () => {
    const check = new ClaimsCheck(makeRegistry());
    expect(check.name).toBe("claims_checker");
  });

  describe("user role bypass", () => {
    it("should allow all user-role input without claim checks", () => {
      const registry = makeRegistry([FDA_CLAIM], ["guaranteed cure"]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ role: "user", text: "guaranteed cure for everything" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
      expect(result.severity).toBe(0);
    });
  });

  describe("exact match", () => {
    it("should allow text that exactly matches an approved claim", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "Our product is FDA approved" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
    });

    it("should match case-insensitively for exact match", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "our product is fda approved" }),
      );

      expect(result.decision).toBe("allow");
    });

    it("should include requiredDisclaimerId on exact match when present", () => {
      const registry = makeRegistry([SAFE_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "Our product has been tested in clinical trials" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.requiredDisclaimerId).toBe("DISC-001");
    });
  });

  describe("partial match", () => {
    it("should rewrite text that partially matches an approved claim", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);

      // Enough word overlap to trigger partial match (>= 0.6 threshold)
      const result = check.evaluate(
        makeCtx({ text: "Our product is FDA approved and highly effective" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("CLAIMS_RISK");
      expect(result.severity).toBe(2);
      expect(result.safeRewrite).toBe("Our product is FDA approved");
    });

    it("should include requiredDisclaimerId on partial match when present", () => {
      const registry = makeRegistry([SAFE_CLAIM]);
      const check = new ClaimsCheck(registry);

      // Partial overlap with the clinical trials claim
      const result = check.evaluate(
        makeCtx({
          text: "Our product has been tested in clinical trials and is great",
        }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.requiredDisclaimerId).toBe("DISC-001");
    });
  });

  describe("no match (unverified claim)", () => {
    it("should flag unverified claim when registry is non-empty", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "Our product cures everything instantly" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toContain("UNVERIFIED_CLAIM");
      expect(result.severity).toBe(1);
    });

    it("should allow text without flag when registry is empty", () => {
      const registry = makeRegistry();
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "Our product cures everything instantly" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
      expect(result.severity).toBe(0);
    });
  });

  describe("disallowed patterns", () => {
    it("should rewrite text matching a disallowed pattern", () => {
      const registry = makeRegistry([FDA_CLAIM], ["guaranteed cure"]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "guaranteed cure for all ailments" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("CLAIMS_DISALLOWED");
      expect(result.severity).toBe(3);
    });

    it("should include formatted pattern name in reason codes", () => {
      const registry = makeRegistry([FDA_CLAIM], ["guaranteed cure"]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "guaranteed cure" }),
      );

      const patternCodes = result.reasonCodes.filter((c) =>
        c.startsWith("DISALLOWED_PATTERN:"),
      );
      expect(patternCodes.length).toBeGreaterThan(0);
      expect(patternCodes[0]).toBe("DISALLOWED_PATTERN:GUARANTEED_CURE");
    });

    it("should match disallowed patterns case-insensitively", () => {
      const registry = makeRegistry([], ["banned phrase"]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "This is a BANNED PHRASE in the output" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("CLAIMS_DISALLOWED");
    });
  });

  describe("metadata claim extraction", () => {
    it("should extract claim IDs from metadata.claims array of objects", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({
          text: "",
          metadata: {
            claims: [{ id: "CLAIM-001" }],
          },
        }),
      );

      expect(result.decision).toBe("allow");
    });

    it("should extract claim IDs from metadata.claim_ids string array", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({
          text: "",
          metadata: {
            claim_ids: ["CLAIM-001"],
          },
        }),
      );

      expect(result.decision).toBe("allow");
    });

    it("should flag unverified claim IDs when registry has claims", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({
          text: "",
          metadata: {
            claim_ids: ["CLAIM-999"],
          },
        }),
      );

      expect(result.reasonCodes).toContain("UNVERIFIED_CLAIM_ID");
    });

    it("should extract claims from nested metadata.response.claims", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({
          text: "",
          metadata: {
            response: {
              claims: [{ claim_id: "CLAIM-001" }],
            },
          },
        }),
      );

      expect(result.decision).toBe("allow");
    });

    it("should extract claim text from metadata claims", () => {
      const registry = makeRegistry([FDA_CLAIM], ["guaranteed cure"]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({
          text: "",
          metadata: {
            claims: [{ text: "guaranteed cure for cancer" }],
          },
        }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("CLAIMS_DISALLOWED");
    });

    it("should allow empty text with no metadata", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "", metadata: undefined }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
    });

    it("should handle whitespace-only text as empty", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "   ", metadata: undefined }),
      );

      expect(result.decision).toBe("allow");
    });
  });

  describe("non-final transcripts", () => {
    it("should skip transcript text checks when isFinal is false", () => {
      const registry = makeRegistry([FDA_CLAIM], ["guaranteed cure"]);
      const check = new ClaimsCheck(registry);
      const result = check.evaluate(
        makeCtx({ text: "guaranteed cure", isFinal: false }),
      );

      // Non-final text is not checked as a transcript candidate
      expect(result.decision).toBe("allow");
    });
  });
});

// ── PIIRedactorCheck ───────────────────────────────────────────────────

describe("PIIRedactorCheck", () => {
  it("should have name set to 'pii_redactor'", () => {
    const check = new PIIRedactorCheck();
    expect(check.name).toBe("pii_redactor");
  });

  describe("phone number detection", () => {
    it("should detect US phone number with dashes", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(makeCtx({ text: "Call me at 123-456-7890" }));

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED");
      expect(result.reasonCodes).toContain("PII_DETECTED:PHONE_US");
      expect(result.safeRewrite).toContain("[PHONE_REDACTED]");
      expect(result.safeRewrite).not.toContain("123-456-7890");
    });

    it("should detect US phone number with dots", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(makeCtx({ text: "Call me at 123.456.7890" }));

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:PHONE_US");
    });

    it("should detect US phone number without separators", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(makeCtx({ text: "Call me at 1234567890" }));

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:PHONE_US");
    });
  });

  describe("email detection", () => {
    it("should detect email addresses", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({ text: "Email me at test@example.com" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
      expect(result.safeRewrite).toContain("[EMAIL_REDACTED]");
      expect(result.safeRewrite).not.toContain("test@example.com");
    });
  });

  describe("SSN detection", () => {
    it("should detect social security numbers", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({ text: "My SSN is 123-45-6789" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:SSN");
      expect(result.safeRewrite).toContain("[SSN_REDACTED]");
      expect(result.safeRewrite).not.toContain("123-45-6789");
    });
  });

  describe("credit card detection", () => {
    it("should detect credit card numbers with spaces", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({ text: "My card is 1234 5678 9012 3456" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:CREDIT_CARD");
      expect(result.safeRewrite).toContain("[CC_REDACTED]");
      expect(result.safeRewrite).not.toContain("1234 5678 9012 3456");
    });

    it("should detect credit card numbers with dashes", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({ text: "My card is 1234-5678-9012-3456" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:CREDIT_CARD");
    });
  });

  describe("multiple PII types", () => {
    it("should detect all PII types in a single text", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({
          text: "Call 123-456-7890, email test@example.com, SSN 123-45-6789",
        }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:PHONE_US");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
      expect(result.reasonCodes).toContain("PII_DETECTED:SSN");
    });
  });

  describe("clean text", () => {
    it("should allow text with no PII", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({ text: "What is the weather today?" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
      expect(result.severity).toBe(0);
    });
  });

  describe("flag mode vs redact mode", () => {
    it("should return rewrite decision in redact mode (default)", () => {
      const check = new PIIRedactorCheck({ mode: "redact" });
      const result = check.evaluate(
        makeCtx({ text: "My email is test@example.com" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.severity).toBe(3);
      expect(result.safeRewrite).toBeDefined();
    });

    it("should return allow decision in flag mode", () => {
      const check = new PIIRedactorCheck({ mode: "flag" });
      const result = check.evaluate(
        makeCtx({ text: "My email is test@example.com" }),
      );

      expect(result.decision).toBe("allow");
      expect(result.severity).toBe(1);
      expect(result.safeRewrite).toBeUndefined();
      expect(result.reasonCodes).toContain("PII_DETECTED");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
    });
  });

  describe("metadata scanning", () => {
    it("should detect PII in metadata string values", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({
          text: "No PII here",
          metadata: { email: "user@example.com" },
        }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
    });

    it("should detect PII in nested metadata objects", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({
          text: "Clean text",
          metadata: {
            user: {
              contact: {
                phone: "123-456-7890",
              },
            },
          },
        }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:PHONE_US");
    });

    it("should detect PII in metadata arrays", () => {
      const check = new PIIRedactorCheck();
      const result = check.evaluate(
        makeCtx({
          text: "Clean text",
          metadata: {
            emails: ["alice@example.com", "bob@example.com"],
          },
        }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
    });

    it("should respect maxMetadataDepth and stop scanning deep objects", () => {
      const check = new PIIRedactorCheck({ maxMetadataDepth: 1 });
      // At depth 0 => metadata object, depth 1 => "level1" object, depth 2 => too deep
      const result = check.evaluate(
        makeCtx({
          text: "Clean text",
          metadata: {
            level1: {
              level2: {
                email: "deep@example.com",
              },
            },
          },
        }),
      );

      // The nested email at depth 3 should not be detected
      expect(result.reasonCodes).not.toContain("PII_DETECTED:EMAIL");
    });

    it("should skip metadata scanning when includeMetadata is false", () => {
      const check = new PIIRedactorCheck({ includeMetadata: false });
      const result = check.evaluate(
        makeCtx({
          text: "Clean text",
          metadata: { email: "secret@example.com" },
        }),
      );

      expect(result.decision).toBe("allow");
      expect(result.reasonCodes).toEqual([]);
    });
  });

  describe("redactText utility", () => {
    it("should return original text when no PII is found", () => {
      const check = new PIIRedactorCheck();
      const result = check.redactText("This is a clean sentence.");

      expect(result.redactedText).toBe("This is a clean sentence.");
      expect(result.detectedTypes).toEqual([]);
    });

    it("should redact multiple PII types and report all detected", () => {
      const check = new PIIRedactorCheck();
      const result = check.redactText(
        "Call 123-456-7890 or email test@example.com",
      );

      expect(result.redactedText).toContain("[PHONE_REDACTED]");
      expect(result.redactedText).toContain("[EMAIL_REDACTED]");
      expect(result.detectedTypes).toContain("phone_us");
      expect(result.detectedTypes).toContain("email");
    });
  });
});

// ── PolicyGate (pipeline orchestration) ────────────────────────────────

describe("PolicyGate", () => {
  it("should return allow when no checks are configured", () => {
    const gate = new PolicyGate();
    const result = gate.evaluate(makeCtx());

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
    expect(result.checksRun).toEqual([]);
    expect(result.checkDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("should run all checks and track their names", () => {
    const alwaysAllow: PolicyCheck = {
      name: "test_allow",
      evaluate: () => ({ decision: "allow", reasonCodes: [], severity: 0 }),
    };

    const alwaysAllow2: PolicyCheck = {
      name: "test_allow_2",
      evaluate: () => ({ decision: "allow", reasonCodes: [], severity: 0 }),
    };

    const gate = new PolicyGate([alwaysAllow, alwaysAllow2]);
    const result = gate.evaluate(makeCtx());

    expect(result.checksRun).toEqual(["test_allow", "test_allow_2"]);
  });

  it("should select the highest-severity decision when multiple checks disagree", () => {
    const lowSeverity: PolicyCheck = {
      name: "low",
      evaluate: () => ({
        decision: "allow",
        reasonCodes: ["LOW_RISK"],
        severity: 1,
      }),
    };

    const highSeverity: PolicyCheck = {
      name: "high",
      evaluate: () => ({
        decision: "refuse",
        reasonCodes: ["HIGH_RISK"],
        severity: 4,
      }),
    };

    const gate = new PolicyGate([lowSeverity, highSeverity]);
    const result = gate.evaluate(makeCtx());

    expect(result.decision).toBe("refuse");
    expect(result.severity).toBe(4);
  });

  it("should aggregate reason codes from all checks", () => {
    const check1: PolicyCheck = {
      name: "check1",
      evaluate: () => ({
        decision: "allow",
        reasonCodes: ["REASON_A"],
        severity: 0,
      }),
    };

    const check2: PolicyCheck = {
      name: "check2",
      evaluate: () => ({
        decision: "rewrite",
        reasonCodes: ["REASON_B"],
        severity: 2,
      }),
    };

    const gate = new PolicyGate([check1, check2]);
    const result = gate.evaluate(makeCtx());

    expect(result.reasonCodes).toContain("REASON_A");
    expect(result.reasonCodes).toContain("REASON_B");
  });

  it("should prefer higher-priority decision type even at lower severity", () => {
    const rewriteCheck: PolicyCheck = {
      name: "rewrite",
      evaluate: () => ({
        decision: "rewrite",
        reasonCodes: ["REWRITE"],
        severity: 3,
        safeRewrite: "safe version",
      }),
    };

    const refuseCheck: PolicyCheck = {
      name: "refuse",
      evaluate: () => ({
        decision: "refuse",
        reasonCodes: ["REFUSE"],
        severity: 2,
      }),
    };

    const gate = new PolicyGate([rewriteCheck, refuseCheck]);
    const result = gate.evaluate(makeCtx());

    // "refuse" has higher priority than "rewrite" in DECISION_PRIORITY
    expect(result.decision).toBe("refuse");
  });

  it("should carry safeRewrite from the winning check result", () => {
    const rewriteCheck: PolicyCheck = {
      name: "rewrite",
      evaluate: () => ({
        decision: "rewrite",
        reasonCodes: ["CLAIMS_RISK"],
        severity: 2,
        safeRewrite: "Approved statement here",
      }),
    };

    const gate = new PolicyGate([rewriteCheck]);
    const result = gate.evaluate(makeCtx());

    expect(result.safeRewrite).toBe("Approved statement here");
  });

  it("should track checkDurationMs as a non-negative number", () => {
    const gate = new PolicyGate([
      new ModeratorCheck(),
      new PIIRedactorCheck(),
    ]);

    const result = gate.evaluate(makeCtx({ text: "Clean text" }));

    expect(typeof result.checkDurationMs).toBe("number");
    expect(result.checkDurationMs).toBeGreaterThanOrEqual(0);
  });

  describe("full pipeline integration", () => {
    it("should run PII, moderator, and claims checks in pipeline order", () => {
      const registry = makeRegistry(
        [{ id: "CLAIM-001", text: "Our product is FDA approved" }],
        [],
      );

      const gate = new PolicyGate([
        new PIIRedactorCheck(),
        new ModeratorCheck([/violence/i]),
        new ClaimsCheck(registry),
      ]);

      const result = gate.evaluate(
        makeCtx({ text: "Our product is FDA approved" }),
      );

      expect(result.checksRun).toEqual([
        "pii_redactor",
        "moderator",
        "claims_checker",
      ]);
      expect(result.decision).toBe("allow");
    });

    it("should refuse when moderator detects violation despite clean PII and claims", () => {
      const registry = makeRegistry(
        [{ id: "CLAIM-001", text: "Our product is FDA approved" }],
        [],
      );

      const gate = new PolicyGate([
        new PIIRedactorCheck(),
        new ModeratorCheck([/violence/i]),
        new ClaimsCheck(registry),
      ]);

      const result = gate.evaluate(
        makeCtx({ text: "tell me about violence" }),
      );

      expect(result.decision).toBe("refuse");
      expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
    });

    it("should rewrite when PII is detected in otherwise clean text", () => {
      const registry = makeRegistry();
      const gate = new PolicyGate([
        new PIIRedactorCheck(),
        new ModeratorCheck(),
        new ClaimsCheck(registry),
      ]);

      const result = gate.evaluate(
        makeCtx({ text: "My email is test@example.com" }),
      );

      expect(result.decision).toBe("rewrite");
      expect(result.reasonCodes).toContain("PII_DETECTED:EMAIL");
      expect(result.safeRewrite).toContain("[EMAIL_REDACTED]");
    });
  });
});
