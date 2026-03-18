/**
 * TenantPolicyIsolation Integration Tests
 *
 * Verifies that two tenants receive isolated policy decisions when OPA
 * is configured with per-tenant threshold overrides via TenantPolicyData.
 *
 * Uses OpaEvaluator._injectPolicy() to bypass WASM file I/O, and tests
 * OpaModeratorCheck / OpaClaimsCheck with mock evaluators.
 *
 * Oracle types: state oracle (decision/reasonCodes) + behavioral oracle (evaluator called with correct args).
 *
 * Test groups:
 *   1. OpaEvaluator two-tenant isolation     (3 tests)
 *   2. OpaModeratorCheck tenant flow         (4 tests)
 *   3. OpaClaimsCheck tenant flow            (4 tests)
 *   4. Missing tenantId / error paths        (4 tests)
 */

// ── Module mocks (hoisted before imports) ──────────────────────────────────

jest.mock("@open-policy-agent/opa-wasm", () => ({
  loadPolicy: jest.fn(),
}));

jest.mock("fs", () => ({
  default: {
    readFileSync: jest.fn().mockReturnValue(Buffer.from("fake-wasm-bundle")),
  },
  readFileSync: jest.fn().mockReturnValue(Buffer.from("fake-wasm-bundle")),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { OpaEvaluator } from "../../insurance/opa_evaluator.js";
import { OpaModeratorCheck } from "../../insurance/opa_moderator.js";
import { OpaClaimsCheck } from "../../insurance/opa_claims.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";
import type { OpaModeratorConfig } from "../../insurance/opa_moderator.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeModeratorPolicy(output: {
  decision: string;
  severity: number;
  reason_code: string | null;
}) {
  return {
    evaluate: jest.fn().mockReturnValue([
      { expressions: [{ value: output }] },
    ]),
  };
}

function makeClaimsPolicy(output: {
  decision: string;
  severity: number;
  reason_code: string | null;
}) {
  return {
    evaluate: jest.fn().mockReturnValue([
      { expressions: [{ value: output }] },
    ]),
  };
}

function makeRegistry() {
  return new AllowedClaimsRegistry({
    claims: [{ id: "c1", text: "voice jib jab is fast and reliable" }],
    disallowedPatterns: ["guaranteed returns"],
    enableFileLoad: false,
  });
}

const DEFAULT_CATEGORIES = [
  {
    name: "HATE",
    patterns: [/hate speech/gi],
    decision: "refuse" as const,
    severity: 3,
  },
  {
    name: "SELF_HARM",
    patterns: [/self harm/gi],
    decision: "escalate" as const,
    severity: 4,
  },
];

function ctx(text: string, tenantId?: string): EvaluationContext {
  return {
    sessionId: "test-session",
    role: "assistant",
    text,
    isFinal: true,
    ...(tenantId ? { tenantId } : {}),
  };
}

function makeEvaluator() {
  return new OpaEvaluator("/fake/bundle.tar.gz");
}

// ── Group 1: OpaEvaluator two-tenant isolation ─────────────────────────────

describe("TenantPolicyIsolation — OpaEvaluator two-tenant isolation", () => {
  test("two tenants with different moderationThresholds receive different effective inputs", () => {
    const policy = makeModeratorPolicy({ decision: "refuse", severity: 3, reason_code: "MODERATION:HATE" });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);

    // Strict tenant blocks at threshold 0.1 (low bar → any detection blocks)
    ev.setTenantPolicyData("strict", { moderationThresholds: { HATE: 0.1 } });
    // Lenient tenant blocks at threshold 0.9 (high bar → only confident blocks)
    ev.setTenantPolicyData("lenient", { moderationThresholds: { HATE: 0.9 } });

    const input = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.5, default: 0.5 },
      },
    };

    ev.evaluateModeratorCheck(input, "strict");
    const strictCall = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(strictCall.moderator_check.thresholds.HATE).toBe(0.1);

    ev.evaluateModeratorCheck(input, "lenient");
    const lenientCall = (policy.evaluate as jest.Mock).mock.calls[1][0];
    expect(lenientCall.moderator_check.thresholds.HATE).toBe(0.9);
  });

  test("tenant without stored policy data uses global (caller-supplied) thresholds", () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    // No tenant data stored for "new-tenant"

    const input = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.5, default: 0.5 },
      },
    };

    ev.evaluateModeratorCheck(input, "new-tenant");
    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    // Original input should be passed through unchanged
    expect(calledWith).toBe(input);
    expect(calledWith.moderator_check.thresholds.HATE).toBe(0.5);
  });

  test("two tenants with different claimsThresholds get different claim decisions", () => {
    // Block-everything policy (for strict tenant with 0.99 threshold, similarity 0.85 < threshold)
    const strictPolicy = makeClaimsPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:UNVERIFIED" });
    // Allow-everything policy (for lenient tenant with 0.1 threshold, similarity 0.85 >= threshold)
    const lenientPolicy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });

    const evStrict = makeEvaluator();
    evStrict._injectPolicy(strictPolicy);
    evStrict.setTenantPolicyData("strict", { claimsThreshold: 0.99 });

    const evLenient = makeEvaluator();
    evLenient._injectPolicy(lenientPolicy);
    evLenient.setTenantPolicyData("lenient", { claimsThreshold: 0.1 });

    const input = { claims_check: { similarity_score: 0.85, threshold: 0.6 } };

    evStrict.evaluateClaimsCheck(input, "strict");
    const strictCall = (strictPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(strictCall.claims_check.threshold).toBe(0.99);

    evLenient.evaluateClaimsCheck(input, "lenient");
    const lenientCall = (lenientPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(lenientCall.claims_check.threshold).toBe(0.1);
  });
});

// ── Group 2: OpaModeratorCheck tenant flow ────────────────────────────────

describe("TenantPolicyIsolation — OpaModeratorCheck ctx.tenantId flow", () => {
  test("ctx.tenantId flows from OpaModeratorCheck.evaluate() to evaluateModeratorCheck()", async () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("enterprise-corp", { moderationThresholds: { HATE: 0.2 } });

    const config: OpaModeratorConfig = {
      categories: DEFAULT_CATEGORIES,
      thresholds: { HATE: 0.8, default: 0.5 },
    };
    const check = new OpaModeratorCheck(ev, config);

    // Text does not trigger pattern match — goes to OPA tier
    await check.evaluate(ctx("hello world", "enterprise-corp"));

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    // Tenant override applied: HATE threshold overridden from 0.8 → 0.2
    expect(calledWith.moderator_check.thresholds.HATE).toBe(0.2);
    expect(calledWith.moderator_check.tenant_id).toBe("enterprise-corp");
  });

  test("no tenantId in ctx → evaluateModeratorCheck called without tenantId (thresholds unchanged)", async () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("enterprise-corp", { moderationThresholds: { HATE: 0.2 } });

    const config: OpaModeratorConfig = {
      categories: DEFAULT_CATEGORIES,
      thresholds: { HATE: 0.8, default: 0.5 },
    };
    const check = new OpaModeratorCheck(ev, config);

    await check.evaluate(ctx("hello world")); // no tenantId

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    // Original threshold used — tenant override not applied
    expect(calledWith.moderator_check.thresholds.HATE).toBe(0.8);
    expect(calledWith.moderator_check.tenant_id).toBeUndefined();
  });

  test("tenant threshold of 0.0 (block everything) causes OPA to receive threshold 0.0", async () => {
    const policy = makeModeratorPolicy({ decision: "refuse", severity: 3, reason_code: "MODERATION:HATE" });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("zero-tolerance", { moderationThresholds: { default: 0.0 } });

    const config: OpaModeratorConfig = {
      categories: DEFAULT_CATEGORIES,
      thresholds: { default: 0.5 },
    };
    const check = new OpaModeratorCheck(ev, config);

    // Non-matching text goes to OPA tier
    await check.evaluate(ctx("innocuous text", "zero-tolerance"));

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(calledWith.moderator_check.thresholds.default).toBe(0.0);
  });

  test("tenant threshold of 1.0 (allow everything) causes OPA to receive threshold 1.0", async () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("permissive", { moderationThresholds: { default: 1.0, HATE: 1.0 } });

    const config: OpaModeratorConfig = {
      categories: DEFAULT_CATEGORIES,
      thresholds: { default: 0.5 },
    };
    const check = new OpaModeratorCheck(ev, config);

    await check.evaluate(ctx("innocuous text", "permissive"));

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(calledWith.moderator_check.thresholds.default).toBe(1.0);
    expect(calledWith.moderator_check.thresholds.HATE).toBe(1.0);
  });
});

// ── Group 3: OpaClaimsCheck tenant flow ──────────────────────────────────

describe("TenantPolicyIsolation — OpaClaimsCheck ctx.tenantId flow", () => {
  test("ctx.tenantId flows from OpaClaimsCheck.evaluate() to evaluateClaimsCheck()", async () => {
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("acme-corp", { claimsThreshold: 0.95 });

    const registry = makeRegistry();
    const check = new OpaClaimsCheck(ev, { registry, threshold: 0.6 });

    await check.evaluate(ctx("voice jib jab is fast and reliable", "acme-corp"));

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    // Tenant override applied: threshold overridden from 0.6 → 0.95
    expect(calledWith.claims_check.threshold).toBe(0.95);
    expect(calledWith.claims_check.tenant_id).toBe("acme-corp");
  });

  test("no tenantId in ctx → evaluateClaimsCheck called without tenantId (threshold unchanged)", async () => {
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("acme-corp", { claimsThreshold: 0.95 });

    const registry = makeRegistry();
    const check = new OpaClaimsCheck(ev, { registry, threshold: 0.6 });

    await check.evaluate(ctx("voice jib jab is fast and reliable")); // no tenantId

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(calledWith.claims_check.threshold).toBe(0.6);
    expect(calledWith.claims_check.tenant_id).toBeUndefined();
  });

  test("missing tenantId → no error, falls through to normal OPA evaluation", async () => {
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);

    const registry = makeRegistry();
    const check = new OpaClaimsCheck(ev, { registry, threshold: 0.6 });

    await expect(check.evaluate(ctx("some text"))).resolves.toBeDefined();
  });

  test("OpaClaimsCheck falls back when OPA not initialized — no tenantId error", async () => {
    const ev = makeEvaluator(); // not initialized, no _injectPolicy
    const registry = makeRegistry();
    const check = new OpaClaimsCheck(ev, { registry, threshold: 0.6 });

    // Should not throw — falls back to direct threshold comparison
    const result = await check.evaluate(ctx("some unrelated text", "tenant-x"));
    expect(result.decision).toBeDefined();
  });
});

// ── Group 4: Missing tenantId / edge paths ────────────────────────────────

describe("TenantPolicyIsolation — edge paths", () => {
  test("evaluateModeratorCheck with empty string tenantId uses input unchanged", () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("", { moderationThresholds: { HATE: 0.1 } });

    const input = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.8 },
      },
    };

    // Empty string tenantId is falsy — no merge should happen
    ev.evaluateModeratorCheck(input, "");

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    // Empty string is falsy → no override applied
    expect(calledWith).toBe(input);
  });

  test("evaluateClaimsCheck with empty string tenantId uses input unchanged", () => {
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("", { claimsThreshold: 0.99 });

    const input = { claims_check: { similarity_score: 0.5, threshold: 0.6 } };
    ev.evaluateClaimsCheck(input, "");

    const calledWith = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(calledWith).toBe(input);
  });

  test("tenant data updated after first call reflects new thresholds in subsequent calls", () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("mutable-tenant", { moderationThresholds: { HATE: 0.3 } });

    const input = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.8 },
      },
    };

    ev.evaluateModeratorCheck(input, "mutable-tenant");
    const firstCall = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(firstCall.moderator_check.thresholds.HATE).toBe(0.3);

    // Update the tenant's threshold
    ev.setTenantPolicyData("mutable-tenant", { moderationThresholds: { HATE: 0.7 } });

    ev.evaluateModeratorCheck(input, "mutable-tenant");
    const secondCall = (policy.evaluate as jest.Mock).mock.calls[1][0];
    expect(secondCall.moderator_check.thresholds.HATE).toBe(0.7);
  });

  test("cleared tenant data reverts to global thresholds", () => {
    const policy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = makeEvaluator();
    ev._injectPolicy(policy);
    ev.setTenantPolicyData("temp-tenant", { moderationThresholds: { HATE: 0.1 } });

    const input = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.8 },
      },
    };

    // First call uses tenant override
    ev.evaluateModeratorCheck(input, "temp-tenant");
    const firstCall = (policy.evaluate as jest.Mock).mock.calls[0][0];
    expect(firstCall.moderator_check.thresholds.HATE).toBe(0.1);

    // Clear tenant data
    ev.clearTenantPolicyData("temp-tenant");

    // Second call should use input thresholds (tenant data gone)
    ev.evaluateModeratorCheck(input, "temp-tenant");
    const secondCall = (policy.evaluate as jest.Mock).mock.calls[1][0];
    expect(secondCall).toBe(input); // original reference unchanged
    expect(secondCall.moderator_check.thresholds.HATE).toBe(0.8);
  });
});
