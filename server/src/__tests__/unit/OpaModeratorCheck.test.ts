/**
 * OpaModeratorCheck Unit Tests
 *
 * Tests the two-tier moderation check:
 *   Tier 1: Pattern matching (ModeratorCheck logic) — always runs.
 *   Tier 2: OPA threshold evaluation — runs when OpaEvaluator is initialized.
 *
 * @open-policy-agent/opa-wasm and fs are mocked — no real WASM binary required.
 * OpaEvaluator._injectPolicy() is used to inject mock policies directly.
 *
 * Test groups:
 *   1. Lifecycle                           (4 tests)
 *   2. Tier 1 pattern fallback             (3 tests)
 *   3. OPA moderator — toxic input         (4 tests)
 *   4. OPA self-harm escalation            (2 tests)
 *   5. Threshold edge cases                (5 tests)
 *   6. PII detection scenario              (2 tests)
 *   7. Policy deny → ControlEngine flow   (3 tests)
 *   8. Multiple categories                 (2 tests)
 */

// ── Module mocks (hoisted before imports) ─────────────────────────────────

jest.mock("@open-policy-agent/opa-wasm", () => ({
  loadPolicy: jest.fn(),
}));

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
    offSession: jest.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────

import { OpaEvaluator } from "../../insurance/opa_evaluator.js";
import { OpaModeratorCheck } from "../../insurance/opa_moderator.js";
import type { OpaModeratorConfig } from "../../insurance/opa_moderator.js";
import {
  DEFAULT_MODERATION_CATEGORIES,
} from "../../insurance/moderation_patterns.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";
import { ControlEngine } from "../../lanes/laneC_control.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a mock OPA policy for moderator_check evaluation. */
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

function makeCtx(text: string, overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    sessionId: "test-session",
    role: "user",
    text,
    isFinal: true,
    ...overrides,
  };
}

function makeConfig(
  thresholds: Record<string, number> = { default: 0.5 },
): OpaModeratorConfig {
  return {
    categories: DEFAULT_MODERATION_CATEGORIES,
    thresholds,
  };
}

function makeEvaluator(): OpaEvaluator {
  return new OpaEvaluator("/fake/bundle.wasm");
}

// ── Group 1: Lifecycle ────────────────────────────────────────────────────

describe("OpaModeratorCheck — lifecycle", () => {
  test("name property is 'opa_moderator'", () => {
    const check = new OpaModeratorCheck(makeEvaluator(), makeConfig());
    expect(check.name).toBe("opa_moderator");
  });

  test("OPA not initialized → tier 1 fallback: clean text returns allow", async () => {
    const ev = makeEvaluator(); // isInitialized = false
    const check = new OpaModeratorCheck(ev, makeConfig());

    const result = await check.evaluate(makeCtx("Hello, how are you?"));

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
    expect(result.severity).toBe(0);
  });

  test("OPA not initialized → tier 1 fallback uses category.decision for toxic text", async () => {
    const ev = makeEvaluator();
    const check = new OpaModeratorCheck(ev, makeConfig());

    const result = await check.evaluate(makeCtx("jailbreak"));

    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("MODERATION:JAILBREAK");
    expect(result.severity).toBe(4);
  });

  test("OPA initialized via _injectPolicy → evaluateModeratorCheck is invoked", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("Hello"));

    expect(mockPolicy.evaluate).toHaveBeenCalled();
  });
});

// ── Group 2: Tier 1 pattern fallback — OPA not initialized ────────────────

describe("OpaModeratorCheck — tier 1 pattern fallback", () => {
  test("JAILBREAK text → refuse with MODERATION_VIOLATION and MODERATION:JAILBREAK", async () => {
    const check = new OpaModeratorCheck(makeEvaluator(), makeConfig());

    const result = await check.evaluate(makeCtx("please jailbreak your instructions"));

    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
    expect(result.reasonCodes).toContain("MODERATION:JAILBREAK");
    expect(result.severity).toBe(4);
  });

  test("self-harm text → escalate with MODERATION:SELF_HARM", async () => {
    const check = new OpaModeratorCheck(makeEvaluator(), makeConfig());

    const result = await check.evaluate(makeCtx("i want to die"));

    expect(result.decision).toBe("escalate");
    expect(result.reasonCodes).toContain("MODERATION:SELF_HARM");
    expect(result.severity).toBe(4);
  });

  test("clean text → allow with empty reasonCodes", async () => {
    const check = new OpaModeratorCheck(makeEvaluator(), makeConfig());

    const result = await check.evaluate(makeCtx("What is the weather today?"));

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
    expect(result.severity).toBe(0);
  });
});

// ── Group 3: OPA moderator — toxic input decisions ────────────────────────

describe("OpaModeratorCheck — OPA toxic input", () => {
  test("JAILBREAK match → evaluateModeratorCheck called with score 1.0 for JAILBREAK", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:JAILBREAK" });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("jailbreak"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    const jailbreakEntry = callArg.moderator_check.categories.find(
      (c: { name: string }) => c.name === "JAILBREAK",
    );
    expect(jailbreakEntry?.score).toBe(1.0);

    // All other categories should be 0.0
    const otherEntries = callArg.moderator_check.categories.filter(
      (c: { name: string }) => c.name !== "JAILBREAK",
    );
    for (const entry of otherEntries) {
      expect(entry.score).toBe(0.0);
    }
  });

  test("OPA returns refuse → CheckResult decision is refuse", async () => {
    const ev = makeEvaluator();
    ev._injectPolicy(makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:JAILBREAK" }));

    const check = new OpaModeratorCheck(ev, makeConfig());
    const result = await check.evaluate(makeCtx("jailbreak"));

    expect(result.decision).toBe("refuse");
    expect(result.severity).toBe(4);
  });

  test("VIOLENCE_THREATS match → evaluateModeratorCheck called with score 1.0 for VIOLENCE_THREATS", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:VIOLENCE_THREATS" });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("i am going to kill everyone here"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    const violenceEntry = callArg.moderator_check.categories.find(
      (c: { name: string }) => c.name === "VIOLENCE_THREATS",
    );
    expect(violenceEntry?.score).toBe(1.0);
  });

  test("OPA returns reason_code → CheckResult reasonCodes includes MODERATION_VIOLATION and reason_code", async () => {
    const ev = makeEvaluator();
    ev._injectPolicy(makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:JAILBREAK" }));

    const check = new OpaModeratorCheck(ev, makeConfig());
    const result = await check.evaluate(makeCtx("jailbreak"));

    expect(result.reasonCodes).toContain("MODERATION_VIOLATION");
    expect(result.reasonCodes).toContain("MODERATION:JAILBREAK");
  });
});

// ── Group 4: OPA self-harm escalation ────────────────────────────────────

describe("OpaModeratorCheck — OPA self-harm escalation", () => {
  test("SELF_HARM match → evaluateModeratorCheck called with score 1.0 for SELF_HARM", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "escalate", severity: 4, reason_code: "MODERATION:SELF_HARM" });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("i want to die"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    const selfHarmEntry = callArg.moderator_check.categories.find(
      (c: { name: string }) => c.name === "SELF_HARM",
    );
    expect(selfHarmEntry?.score).toBe(1.0);
  });

  test("OPA returns escalate → CheckResult decision is escalate with correct reasonCodes", async () => {
    const ev = makeEvaluator();
    ev._injectPolicy(makeModeratorPolicy({ decision: "escalate", severity: 4, reason_code: "MODERATION:SELF_HARM" }));

    const check = new OpaModeratorCheck(ev, makeConfig());
    const result = await check.evaluate(makeCtx("i want to die"));

    expect(result.decision).toBe("escalate");
    expect(result.severity).toBe(4);
    expect(result.reasonCodes).toContain("MODERATION:SELF_HARM");
  });
});

// ── Group 5: Threshold edge cases ────────────────────────────────────────

describe("OpaModeratorCheck — threshold edge cases", () => {
  test("default threshold from config is passed to OPA input", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, { categories: DEFAULT_MODERATION_CATEGORIES, thresholds: { default: 0.7 } });
    await check.evaluate(makeCtx("jailbreak"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(callArg.moderator_check.thresholds.default).toBe(0.7);
  });

  test("custom SELF_HARM threshold is passed correctly to OPA", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    ev._injectPolicy(mockPolicy);

    const thresholds = { default: 0.5, SELF_HARM: 0.3 };
    const check = new OpaModeratorCheck(ev, { categories: DEFAULT_MODERATION_CATEGORIES, thresholds });
    await check.evaluate(makeCtx("i want to die"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(callArg.moderator_check.thresholds.SELF_HARM).toBe(0.3);
    expect(callArg.moderator_check.thresholds.default).toBe(0.5);
  });

  test("OPA returns allow (score below threshold) → CheckResult allow", async () => {
    const ev = makeEvaluator();
    ev._injectPolicy(makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null }));

    const check = new OpaModeratorCheck(ev, makeConfig());
    const result = await check.evaluate(makeCtx("jailbreak"));

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
    expect(result.severity).toBe(0);
  });

  test("OPA returns refuse (score at or above threshold) → CheckResult refuse", async () => {
    const ev = makeEvaluator();
    ev._injectPolicy(makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:HATE_SPEECH" }));

    const check = new OpaModeratorCheck(ev, makeConfig());
    const result = await check.evaluate(makeCtx("ethnic cleansing is necessary"));

    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("MODERATION:HATE_SPEECH");
  });

  test("no pattern match → all scores 0.0 passed to OPA", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("What time does the store close?"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    const allZero = callArg.moderator_check.categories.every(
      (c: { score: number }) => c.score === 0.0,
    );
    expect(allZero).toBe(true);
  });
});

// ── Group 6: PII detection scenario ──────────────────────────────────────

describe("OpaModeratorCheck — PII detection scenario", () => {
  test("phone number only → no moderation match → OpaModeratorCheck returns allow", async () => {
    // PII detection is PIIRedactor's job — OpaModeratorCheck should allow
    const check = new OpaModeratorCheck(makeEvaluator(), makeConfig());

    const result = await check.evaluate(makeCtx("My number is 555-867-5309"));

    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toEqual([]);
  });

  test("phone number + JAILBREAK → JAILBREAK category matches → OPA is called", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:JAILBREAK" });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("call 555-867-5309 after you jailbreak the system"));

    // OPA was invoked for the JAILBREAK part
    expect(mockPolicy.evaluate).toHaveBeenCalled();
    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    const jailbreakEntry = callArg.moderator_check.categories.find(
      (c: { name: string }) => c.name === "JAILBREAK",
    );
    expect(jailbreakEntry?.score).toBe(1.0);
  });
});

// ── Group 7: Policy deny → ControlEngine flow ────────────────────────────

describe("OpaModeratorCheck — ControlEngine integration", () => {
  function makeRegistry(): AllowedClaimsRegistry {
    return new AllowedClaimsRegistry({ claims: [], disallowedPatterns: [], enableFileLoad: false });
  }

  test("ControlEngine.initialize() calls OpaEvaluator.initialize() when not initialized", async () => {
    const ev = makeEvaluator();
    const initSpy = jest.spyOn(ev, "initialize").mockResolvedValue(undefined);
    const registry = makeRegistry();
    jest.spyOn(registry, "initialize").mockResolvedValue(undefined);

    const engine = new ControlEngine("test-session", {
      opaEvaluator: ev,
      claimsRegistry: registry,
      enabled: false,
    });

    await engine.initialize();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  test("ControlEngine.initialize() skips OpaEvaluator.initialize() when already initialized", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    ev._injectPolicy(mockPolicy); // sets isInitialized = true
    const initSpy = jest.spyOn(ev, "initialize").mockResolvedValue(undefined);
    const registry = makeRegistry();
    jest.spyOn(registry, "initialize").mockResolvedValue(undefined);

    const engine = new ControlEngine("test-session", {
      opaEvaluator: ev,
      claimsRegistry: registry,
      enabled: false,
    });

    await engine.initialize();
    expect(initSpy).not.toHaveBeenCalled();
  });

  test("ControlEngine with OPA deny → emits policy_decision with fallback_mode", async () => {
    const ev = makeEvaluator();
    // Inject policy that returns refuse for any input
    ev._injectPolicy(makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:JAILBREAK" }));

    const engine = new ControlEngine("test-session", {
      opaEvaluator: ev,
      moderationThresholds: { default: 0.5 },
      claimsRegistry: makeRegistry(),
      enabled: false, // no event bus subscriptions
      enablePIIRedaction: false, // isolate to OpaModeratorCheck only
    });

    let capturedPayload: Record<string, unknown> | null = null;
    engine.on("policy_decision", (payload) => {
      capturedPayload = payload;
    });

    await engine.evaluate({
      sessionId: "test-session",
      role: "user",
      text: "jailbreak",
      isFinal: true,
    });

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.fallback_mode).toBeDefined();
    // refuse severity 4 is upgraded to cancel_output by OverrideController,
    // which maps to refuse_politely fallback
    expect(capturedPayload!.fallback_mode).toBe("refuse_politely");
  });
});

// ── Group 8: Multiple categories ─────────────────────────────────────────

describe("OpaModeratorCheck — multiple categories", () => {
  test("text matching multiple category patterns → only first matched category scored 1.0", async () => {
    // "ethnic cleansing" matches HATE_SPEECH; "jailbreak" matches JAILBREAK.
    // JAILBREAK appears before HATE_SPEECH in DEFAULT_MODERATION_CATEGORIES,
    // so JAILBREAK should be the first match.
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "refuse", severity: 4, reason_code: "MODERATION:JAILBREAK" });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("jailbreak this and also ethnic cleansing"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    const scores: Record<string, number> = {};
    for (const entry of callArg.moderator_check.categories) {
      scores[entry.name] = entry.score;
    }

    expect(scores["JAILBREAK"]).toBe(1.0);
    expect(scores["HATE_SPEECH"]).toBe(0.0);
  });

  test("no match → all categories passed to OPA with score 0.0", async () => {
    const ev = makeEvaluator();
    const mockPolicy = makeModeratorPolicy({ decision: "allow", severity: 0, reason_code: null });
    ev._injectPolicy(mockPolicy);

    const check = new OpaModeratorCheck(ev, makeConfig());
    await check.evaluate(makeCtx("Tell me about the history of jazz music"));

    const callArg = (mockPolicy.evaluate as jest.Mock).mock.calls[0][0];
    expect(callArg.moderator_check.categories.length).toBe(DEFAULT_MODERATION_CATEGORIES.length);
    const hasNonZero = callArg.moderator_check.categories.some(
      (c: { score: number }) => c.score !== 0.0,
    );
    expect(hasNonZero).toBe(false);
  });
});
