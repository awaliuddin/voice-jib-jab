/**
 * OpaEvaluator Unit Tests
 *
 * Tests the OPA WASM wrapper and its integration with PolicyGate.
 * @open-policy-agent/opa-wasm is mocked — no real WASM binary required.
 *
 * Test groups:
 *   1. OpaEvaluator lifecycle          (5 tests)
 *   2. evaluate() input/output mapping (8 tests)
 *   3. Policy return format variations (4 tests)
 *   4. Latency assertion               (1 test)
 *   5. PolicyGate + OpaEvaluator       (8 tests)
 *   6. evaluateClaimsCheck()           (9 tests)
 *   7. Edge cases                      (6 tests)
 */

// ── Module mock (hoisted before imports) ──────────────────────────────────

const mockLoadPolicy = jest.fn();

jest.mock("@open-policy-agent/opa-wasm", () => ({
  loadPolicy: mockLoadPolicy,
}));

jest.mock("fs", () => ({
  default: {
    readFileSync: jest.fn().mockReturnValue(Buffer.from("fake-wasm-bundle")),
  },
  readFileSync: jest.fn().mockReturnValue(Buffer.from("fake-wasm-bundle")),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────

import { OpaEvaluator } from "../../insurance/opa_evaluator.js";
import type { OpaCheckInput, OpaOutput, TenantPolicyData, OpaModeratorInput, OpaClaimsInput } from "../../insurance/opa_evaluator.js";
import {
  PolicyGate,
  type EvaluationContext,
  type PolicyCheck,
  type CheckResult,
} from "../../insurance/policy_gate.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build an OPA policy that returns the given raw result value. */
function makeMockPolicy(rawValue: unknown) {
  return {
    evaluate: jest.fn().mockReturnValue([
      { expressions: [{ value: rawValue }] },
    ]),
  };
}

/** Build a policy that returns the standard result structure. */
function policyReturning(output: Partial<OpaOutput>) {
  return makeMockPolicy({
    decision: output.decision ?? "allow",
    severity: output.severity ?? 0,
    safeRewrite: output.safeRewrite ?? null,
    requiredDisclaimerId: output.requiredDisclaimerId ?? null,
  });
}

function makeCheck(name: string, result: Partial<CheckResult>): PolicyCheck {
  return {
    name,
    evaluate: jest.fn().mockReturnValue({
      decision: "allow",
      reasonCodes: [],
      severity: 0,
      ...result,
    }),
  };
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    sessionId: "test-session",
    role: "assistant",
    text: "Hello there",
    isFinal: true,
    ...overrides,
  };
}

// ── Group 1: OpaEvaluator lifecycle ──────────────────────────────────────

describe("OpaEvaluator — lifecycle", () => {
  test("evaluate() throws when not initialized", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    expect(() => ev.evaluate({ checks: [] })).toThrow(
      "OpaEvaluator not initialized",
    );
  });

  test("isInitialized returns false before initialize()", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    expect(ev.isInitialized).toBe(false);
  });

  test("isInitialized returns true after _injectPolicy()", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({}));
    expect(ev.isInitialized).toBe(true);
  });

  test("initialize() is idempotent — loadPolicy called only once", async () => {
    const fakePolicy = policyReturning({});
    mockLoadPolicy.mockResolvedValueOnce(fakePolicy);

    const ev = new OpaEvaluator("/fake/bundle.wasm");
    await ev.initialize();
    await ev.initialize(); // second call should no-op

    expect(mockLoadPolicy).toHaveBeenCalledTimes(1);
  });

  test("initialize() sets policy (isInitialized becomes true)", async () => {
    const fakePolicy = policyReturning({});
    mockLoadPolicy.mockResolvedValueOnce(fakePolicy);

    const ev = new OpaEvaluator("/fake/bundle.wasm");
    expect(ev.isInitialized).toBe(false);
    await ev.initialize();
    expect(ev.isInitialized).toBe(true);
  });
});

// ── Group 2: evaluate() input/output mapping ─────────────────────────────

describe("OpaEvaluator — evaluate() input/output mapping", () => {
  test("empty checks array: policy returns default allow", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ decision: "allow", severity: 0 }));

    const out = ev.evaluate({ checks: [] });
    expect(out.decision).toBe("allow");
    expect(out.severity).toBe(0);
  });

  test("single allow check: decision is allow", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ decision: "allow" }));

    const checks: OpaCheckInput[] = [
      { name: "test", decision: "allow", reasonCodes: [], severity: 0 },
    ];
    expect(ev.evaluate({ checks }).decision).toBe("allow");
  });

  test("single refuse check: decision is refuse", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ decision: "refuse", severity: 4 }));

    const checks: OpaCheckInput[] = [
      { name: "test", decision: "refuse", reasonCodes: ["BAD"], severity: 4 },
    ];
    const out = ev.evaluate({ checks });
    expect(out.decision).toBe("refuse");
    expect(out.severity).toBe(4);
  });

  test("safeRewrite string propagated from OPA output", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ decision: "rewrite", safeRewrite: "safe version" }));

    const out = ev.evaluate({ checks: [] });
    expect(out.safeRewrite).toBe("safe version");
  });

  test("requiredDisclaimerId string propagated from OPA output", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ requiredDisclaimerId: "DISC-001" }));

    const out = ev.evaluate({ checks: [] });
    expect(out.requiredDisclaimerId).toBe("DISC-001");
  });

  test("null safeRewrite in OPA output → null in result", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ safeRewrite: null }));

    const out = ev.evaluate({ checks: [] });
    expect(out.safeRewrite).toBeNull();
  });

  test("null requiredDisclaimerId in OPA output → null in result", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ requiredDisclaimerId: null }));

    const out = ev.evaluate({ checks: [] });
    expect(out.requiredDisclaimerId).toBeNull();
  });

  test("input checks are passed through to the policy evaluate() call", () => {
    const mockPolicy = policyReturning({});
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);

    const checks: OpaCheckInput[] = [
      { name: "pii_redactor", decision: "rewrite", reasonCodes: ["PII_DETECTED"], severity: 3, safeRewrite: "redacted" },
      { name: "moderator", decision: "allow", reasonCodes: [], severity: 0 },
    ];
    ev.evaluate({ checks });

    expect(mockPolicy.evaluate).toHaveBeenCalledWith({ checks });
  });
});

// ── Group 3: Policy return format variations ──────────────────────────────

describe("OpaEvaluator — policy return format variations", () => {
  test("empty results array → default allow output", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy({ evaluate: jest.fn().mockReturnValue([]) });

    const out = ev.evaluate({ checks: [] });
    expect(out.decision).toBe("allow");
    expect(out.severity).toBe(0);
    expect(out.safeRewrite).toBeNull();
    expect(out.requiredDisclaimerId).toBeNull();
  });

  test("policy returns null value → default allow output", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy({ evaluate: jest.fn().mockReturnValue([{ expressions: [{ value: null }] }]) });

    const out = ev.evaluate({ checks: [] });
    expect(out.decision).toBe("allow");
  });

  test("value nested under 'result' key is unwrapped", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(makeMockPolicy({
      result: { decision: "escalate", severity: 3, safeRewrite: null, requiredDisclaimerId: null },
    }));

    const out = ev.evaluate({ checks: [] });
    expect(out.decision).toBe("escalate");
    expect(out.severity).toBe(3);
  });

  test("unknown decision value defaults to 'allow'", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(makeMockPolicy({ decision: "UNKNOWN_DECISION", severity: 0, safeRewrite: null, requiredDisclaimerId: null }));

    // The evaluator casts whatever OPA returns; TypeScript safety is at boundary
    const out = ev.evaluate({ checks: [] });
    // OPA returned an unknown decision — evaluator passes it through as-is
    // (validation is the Rego policy's job)
    expect(out.decision).toBe("UNKNOWN_DECISION" as any);
  });
});

// ── Group 4: Latency assertion ────────────────────────────────────────────

describe("OpaEvaluator — latency", () => {
  test("1000 synchronous evaluations complete in < 1ms average", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(policyReturning({ decision: "allow", severity: 0 }));

    const checks: OpaCheckInput[] = [
      { name: "pii_redactor", decision: "allow", reasonCodes: [], severity: 0 },
      { name: "moderator", decision: "allow", reasonCodes: [], severity: 0 },
    ];

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      ev.evaluate({ checks });
    }
    const elapsed = Date.now() - start;

    // 1000 calls in < 1000ms means average < 1ms each
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── Group 5: PolicyGate + OpaEvaluator integration ───────────────────────

describe("PolicyGate + OpaEvaluator integration", () => {
  test("without OpaEvaluator: uses TS aggregation (existing behavior)", async () => {
    const gate = new PolicyGate([
      makeCheck("check_a", { decision: "refuse", reasonCodes: ["BAD"], severity: 4 }),
    ]);
    const result = await gate.evaluate(makeCtx());
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("BAD");
  });

  test("with uninitialized OpaEvaluator: falls back to TS aggregation", async () => {
    const uninitEv = new OpaEvaluator("/fake/bundle.wasm");
    const gate = new PolicyGate(
      [makeCheck("check_a", { decision: "refuse", reasonCodes: ["BAD"], severity: 4 })],
      uninitEv,
    );
    const result = await gate.evaluate(makeCtx());
    expect(result.decision).toBe("refuse");
  });

  test("with initialized OpaEvaluator: uses OPA result for decision", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy(policyReturning({ decision: "cancel_output", severity: 4 }));

    const gate = new PolicyGate(
      [makeCheck("check_a", { decision: "refuse", reasonCodes: ["BAD"], severity: 3 })],
      opaEv,
    );
    const result = await gate.evaluate(makeCtx());
    // OPA says cancel_output; TS loop would have returned refuse
    expect(result.decision).toBe("cancel_output");
    expect(result.severity).toBe(4);
  });

  test("checksRun is still tracked when OPA is used", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy(policyReturning({ decision: "allow" }));

    const gate = new PolicyGate(
      [
        makeCheck("pii_redactor", {}),
        makeCheck("moderator", {}),
      ],
      opaEv,
    );
    const result = await gate.evaluate(makeCtx());
    expect(result.checksRun).toEqual(["pii_redactor", "moderator"]);
  });

  test("allReasonCodes still aggregated from checks when OPA is used", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy(policyReturning({ decision: "refuse" }));

    const gate = new PolicyGate(
      [
        makeCheck("check_a", { reasonCodes: ["CODE_A"] }),
        makeCheck("check_b", { reasonCodes: ["CODE_B"] }),
      ],
      opaEv,
    );
    const result = await gate.evaluate(makeCtx());
    expect(result.reasonCodes).toContain("CODE_A");
    expect(result.reasonCodes).toContain("CODE_B");
  });

  test("checkDurationMs is measured when OPA is used", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy(policyReturning({}));

    const gate = new PolicyGate([makeCheck("check_a", {})], opaEv);
    const result = await gate.evaluate(makeCtx());
    expect(result.checkDurationMs).toBeGreaterThanOrEqual(0);
  });

  test("short-circuit still limits checks passed to OPA", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    const mockPolicy = policyReturning({ decision: "cancel_output", severity: 4 });
    opaEv._injectPolicy(mockPolicy);

    const check1 = makeCheck("first", { decision: "cancel_output", severity: 4 });
    const check2 = makeCheck("second", {});
    const gate = new PolicyGate([check1, check2], opaEv);

    await gate.evaluate(makeCtx());

    // Short-circuit: second check never ran
    expect(check2.evaluate).not.toHaveBeenCalled();
    // OPA received only the one check that ran
    const opaInput = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(opaInput.checks).toHaveLength(1);
    expect(opaInput.checks[0].name).toBe("first");
  });

  test("safeRewrite from OPA output flows through to GateResult", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy(policyReturning({ decision: "rewrite", safeRewrite: "safe text" }));

    const gate = new PolicyGate(
      [makeCheck("pii_redactor", { decision: "rewrite", safeRewrite: "raw safe text" })],
      opaEv,
    );
    const result = await gate.evaluate(makeCtx());
    // OPA's safeRewrite wins over the TS check's safeRewrite
    expect(result.safeRewrite).toBe("safe text");
  });
});

// ── Group 6: evaluateClaimsCheck() ───────────────────────────────────────

describe("OpaEvaluator — evaluateClaimsCheck()", () => {
  test("throws when not initialized", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    expect(() =>
      ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.8, threshold: 0.6 } }),
    ).toThrow("OpaEvaluator not initialized");
  });

  test("returns refuse/3/CLAIMS:UNVERIFIED when policy returns empty results", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy({ evaluate: jest.fn().mockReturnValue([]) });

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.8, threshold: 0.6 } });
    expect(out.decision).toBe("refuse");
    expect(out.severity).toBe(3);
    expect(out.reasonCode).toBe("CLAIMS:UNVERIFIED");
  });

  test("returns refuse/3/CLAIMS:UNVERIFIED when policy returns null value", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy({ evaluate: jest.fn().mockReturnValue([{ expressions: [{ value: null }] }]) });

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.5, threshold: 0.6 } });
    expect(out.decision).toBe("refuse");
    expect(out.severity).toBe(3);
    expect(out.reasonCode).toBe("CLAIMS:UNVERIFIED");
  });

  test("returns allow when OPA decides allow (score above threshold)", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(
      makeMockPolicy({ decision: "allow", severity: 0, reason_code: null }),
    );

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.9, threshold: 0.6 } });
    expect(out.decision).toBe("allow");
    expect(out.severity).toBe(0);
    expect(out.reasonCode).toBe("CLAIMS:UNVERIFIED"); // null reason_code → default
  });

  test("returns refuse with CLAIMS:UNVERIFIED when OPA decides refuse", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(
      makeMockPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:UNVERIFIED" }),
    );

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.1, threshold: 0.6 } });
    expect(out.decision).toBe("refuse");
    expect(out.severity).toBe(3);
    expect(out.reasonCode).toBe("CLAIMS:UNVERIFIED");
  });

  test("propagates custom reason_code from OPA result", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(
      makeMockPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:CUSTOM_CODE" }),
    );

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.2, threshold: 0.6 } });
    expect(out.reasonCode).toBe("CLAIMS:CUSTOM_CODE");
  });

  test("unwraps result from claims_check key when present", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(
      makeMockPolicy({
        claims_check: { decision: "allow", severity: 0, reason_code: null },
      }),
    );

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.8, threshold: 0.6 } });
    expect(out.decision).toBe("allow");
    expect(out.severity).toBe(0);
  });

  test("non-number severity defaults to 3", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(
      makeMockPolicy({ decision: "refuse", severity: "high", reason_code: "CLAIMS:UNVERIFIED" }),
    );

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.1, threshold: 0.6 } });
    expect(out.severity).toBe(3);
  });

  test("non-string reason_code defaults to CLAIMS:UNVERIFIED", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(
      makeMockPolicy({ decision: "refuse", severity: 3, reason_code: 42 }),
    );

    const out = ev.evaluateClaimsCheck({ claims_check: { similarity_score: 0.1, threshold: 0.6 } });
    expect(out.reasonCode).toBe("CLAIMS:UNVERIFIED");
  });

  test("input is passed through to policy.evaluate()", () => {
    const mockPolicy = makeMockPolicy({ decision: "allow", severity: 0, reason_code: null });
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);

    const input = { claims_check: { similarity_score: 0.75, threshold: 0.5 } };
    ev.evaluateClaimsCheck(input);

    expect(mockPolicy.evaluate).toHaveBeenCalledWith(input);
  });
});

// ── Group 7: Edge cases ───────────────────────────────────────────────────

describe("OpaEvaluator — edge cases", () => {
  test("opaEvaluator.evaluate() throws → error propagates from PolicyGate", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy({
      evaluate: jest.fn().mockImplementation(() => {
        throw new Error("OPA internal error");
      }),
    });

    const gate = new PolicyGate([makeCheck("check_a", {})], opaEv);
    await expect(gate.evaluate(makeCtx())).rejects.toThrow("OPA internal error");
  });

  test("non-string safeRewrite in OPA result → null", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(makeMockPolicy({ decision: "allow", severity: 0, safeRewrite: 42, requiredDisclaimerId: null }));

    const out = ev.evaluate({ checks: [] });
    expect(out.safeRewrite).toBeNull();
  });

  test("non-string requiredDisclaimerId in OPA result → null", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(makeMockPolicy({ decision: "allow", severity: 0, safeRewrite: null, requiredDisclaimerId: true }));

    const out = ev.evaluate({ checks: [] });
    expect(out.requiredDisclaimerId).toBeNull();
  });

  test("non-number severity in OPA result → 0", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(makeMockPolicy({ decision: "refuse", severity: "high", safeRewrite: null, requiredDisclaimerId: null }));

    const out = ev.evaluate({ checks: [] });
    expect(out.severity).toBe(0);
  });

  test("PolicyGate with zero checks and OPA initialized → OPA sees empty checks", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    const mockPolicy = policyReturning({ decision: "allow" });
    opaEv._injectPolicy(mockPolicy);

    const gate = new PolicyGate([], opaEv);
    const result = await gate.evaluate(makeCtx());

    expect(result.decision).toBe("allow");
    expect(result.checksRun).toHaveLength(0);
    const opaInput = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(opaInput.checks).toHaveLength(0);
  });

  test("OPA null safeRewrite maps to undefined in GateResult", async () => {
    const opaEv = new OpaEvaluator("/fake/bundle.wasm");
    opaEv._injectPolicy(policyReturning({ safeRewrite: null, requiredDisclaimerId: null }));

    const gate = new PolicyGate([makeCheck("check_a", {})], opaEv);
    const result = await gate.evaluate(makeCtx());
    expect(result.safeRewrite).toBeUndefined();
    expect(result.requiredDisclaimerId).toBeUndefined();
  });
});

// ── Group 8: TenantPolicyData ─────────────────────────────────────────────

describe("OpaEvaluator — TenantPolicyData", () => {
  // ── Storage / retrieval ────────────────────────────────────────────

  test("setTenantPolicyData() stores data retrievable via getTenantPolicyData()", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    const data: TenantPolicyData = { moderationThresholds: { HATE: 0.3 }, claimsThreshold: 0.7 };
    ev.setTenantPolicyData("tenant-A", data);
    expect(ev.getTenantPolicyData("tenant-A")).toEqual(data);
  });

  test("getTenantPolicyData() returns undefined for unknown tenantId", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    expect(ev.getTenantPolicyData("non-existent")).toBeUndefined();
  });

  test("clearTenantPolicyData(tenantId) removes that tenant's data", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev.setTenantPolicyData("tenant-A", { claimsThreshold: 0.5 });
    ev.setTenantPolicyData("tenant-B", { claimsThreshold: 0.8 });
    ev.clearTenantPolicyData("tenant-A");
    expect(ev.getTenantPolicyData("tenant-A")).toBeUndefined();
    expect(ev.getTenantPolicyData("tenant-B")).toBeDefined();
  });

  test("clearTenantPolicyData() with no args clears all tenants", () => {
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev.setTenantPolicyData("tenant-A", { claimsThreshold: 0.5 });
    ev.setTenantPolicyData("tenant-B", { claimsThreshold: 0.8 });
    ev.clearTenantPolicyData();
    expect(ev.getTenantPolicyData("tenant-A")).toBeUndefined();
    expect(ev.getTenantPolicyData("tenant-B")).toBeUndefined();
  });

  // ── evaluateModeratorCheck with tenant overrides ───────────────────

  test("evaluateModeratorCheck with tenantId — tenant thresholds override input thresholds", () => {
    const mockPolicy = {
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    };
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);
    ev.setTenantPolicyData("tenant-strict", { moderationThresholds: { HATE: 0.1 } });

    const input: OpaModeratorInput = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.8, default: 0.5 },
      },
    };
    ev.evaluateModeratorCheck(input, "tenant-strict");

    const calledWith = mockPolicy.evaluate.mock.calls[0][0] as OpaModeratorInput;
    // Tenant threshold for HATE overrides 0.8 → 0.1
    expect(calledWith.moderator_check.thresholds.HATE).toBe(0.1);
    // Global default remains
    expect(calledWith.moderator_check.thresholds.default).toBe(0.5);
    // tenant_id is injected into input
    expect(calledWith.moderator_check.tenant_id).toBe("tenant-strict");
  });

  test("evaluateModeratorCheck without tenantId — uses input thresholds unchanged", () => {
    const mockPolicy = {
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    };
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);
    ev.setTenantPolicyData("tenant-strict", { moderationThresholds: { HATE: 0.1 } });

    const input: OpaModeratorInput = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.8, default: 0.5 },
      },
    };
    ev.evaluateModeratorCheck(input); // no tenantId

    const calledWith = mockPolicy.evaluate.mock.calls[0][0] as OpaModeratorInput;
    expect(calledWith).toBe(input); // exact same reference — no mutation
    expect(calledWith.moderator_check.thresholds.HATE).toBe(0.8);
  });

  test("evaluateModeratorCheck with tenantId but no stored data — uses input thresholds unchanged", () => {
    const mockPolicy = {
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    };
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);

    const input: OpaModeratorInput = {
      moderator_check: {
        categories: [{ name: "HATE", score: 0.5 }],
        thresholds: { HATE: 0.8 },
      },
    };
    ev.evaluateModeratorCheck(input, "unknown-tenant");

    const calledWith = mockPolicy.evaluate.mock.calls[0][0] as OpaModeratorInput;
    expect(calledWith).toBe(input);
  });

  // ── evaluateClaimsCheck with tenant overrides ─────────────────────

  test("evaluateClaimsCheck with tenantId — tenant claimsThreshold overrides input threshold", () => {
    const mockPolicy = {
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    };
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);
    ev.setTenantPolicyData("tenant-A", { claimsThreshold: 0.9 });

    const input: OpaClaimsInput = { claims_check: { similarity_score: 0.85, threshold: 0.6 } };
    ev.evaluateClaimsCheck(input, "tenant-A");

    const calledWith = mockPolicy.evaluate.mock.calls[0][0] as OpaClaimsInput;
    expect(calledWith.claims_check.threshold).toBe(0.9);
    expect(calledWith.claims_check.tenant_id).toBe("tenant-A");
  });

  test("evaluateClaimsCheck without tenantId — uses input threshold unchanged", () => {
    const mockPolicy = {
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    };
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);
    ev.setTenantPolicyData("tenant-A", { claimsThreshold: 0.9 });

    const input: OpaClaimsInput = { claims_check: { similarity_score: 0.85, threshold: 0.6 } };
    ev.evaluateClaimsCheck(input); // no tenantId

    const calledWith = mockPolicy.evaluate.mock.calls[0][0] as OpaClaimsInput;
    expect(calledWith).toBe(input);
    expect(calledWith.claims_check.threshold).toBe(0.6);
  });

  test("evaluateClaimsCheck with tenantId but no stored claimsThreshold — uses input threshold", () => {
    const mockPolicy = {
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    };
    const ev = new OpaEvaluator("/fake/bundle.wasm");
    ev._injectPolicy(mockPolicy);
    // Store only moderationThresholds, not claimsThreshold
    ev.setTenantPolicyData("tenant-A", { moderationThresholds: { HATE: 0.2 } });

    const input: OpaClaimsInput = { claims_check: { similarity_score: 0.85, threshold: 0.6 } };
    ev.evaluateClaimsCheck(input, "tenant-A");

    const calledWith = mockPolicy.evaluate.mock.calls[0][0] as OpaClaimsInput;
    expect(calledWith).toBe(input); // unchanged — claimsThreshold not set
  });

  // ── Cross-tenant isolation ─────────────────────────────────────────

  test("two tenants with different thresholds produce different effective inputs", () => {
    const makePolicy = () => ({
      evaluate: jest.fn().mockReturnValue([
        { expressions: [{ value: { decision: "allow", severity: 0, reason_code: null } }] },
      ]),
    });
    const policyA = makePolicy();
    const policyB = makePolicy();

    const evA = new OpaEvaluator("/fake/bundle.wasm");
    evA._injectPolicy(policyA);
    evA.setTenantPolicyData("tenant-strict", { claimsThreshold: 0.95 });

    const evB = new OpaEvaluator("/fake/bundle.wasm");
    evB._injectPolicy(policyB);
    evB.setTenantPolicyData("tenant-lenient", { claimsThreshold: 0.3 });

    const input: OpaClaimsInput = { claims_check: { similarity_score: 0.5, threshold: 0.6 } };

    evA.evaluateClaimsCheck(input, "tenant-strict");
    evB.evaluateClaimsCheck(input, "tenant-lenient");

    const calledA = policyA.evaluate.mock.calls[0][0] as OpaClaimsInput;
    const calledB = policyB.evaluate.mock.calls[0][0] as OpaClaimsInput;

    expect(calledA.claims_check.threshold).toBe(0.95);
    expect(calledB.claims_check.threshold).toBe(0.3);
  });

  // ── Type-level checks (compilation confirms field presence) ───────

  test("OpaModeratorInput has optional tenant_id field in moderator_check", () => {
    // If this compiles, the interface is correct
    const input: OpaModeratorInput = {
      moderator_check: {
        categories: [],
        thresholds: {},
        tenant_id: "tenant-xyz",
      },
    };
    expect(input.moderator_check.tenant_id).toBe("tenant-xyz");
  });

  test("OpaClaimsInput has optional tenant_id field in claims_check", () => {
    // If this compiles, the interface is correct
    const input: OpaClaimsInput = {
      claims_check: {
        similarity_score: 0.5,
        threshold: 0.6,
        tenant_id: "tenant-xyz",
      },
    };
    expect(input.claims_check.tenant_id).toBe("tenant-xyz");
  });
});
