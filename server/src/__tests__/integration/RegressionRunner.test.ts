/**
 * Regression Runner — Automated policy decision consistency tests.
 *
 * Runs all regression fixtures through the ControlEngine (SimpleEngine pipeline)
 * and asserts that each fixture produces its documented expected decision.
 * Any change to moderation patterns, claims registries, or pipeline ordering
 * that alters a decision will surface as a regression failure here.
 *
 * Engine pipeline (makeSimpleEngine — no OPA):
 *   PIIRedactor -> Moderator (SELF_HARM category) -> ClaimsChecker (role-guarded)
 *
 * Oracle types: behavioural (decision assertions) + structural (fixture metadata).
 */

// ── Mocks (before imports — jest hoisting requirement) ───────────────────
// MOCK JUSTIFIED: EventBus, AllowedClaimsRegistry (HuggingFace download), OpaEvaluator (WASM
// file) are CI-unavailable infrastructure. Regression suite tests Lane C policy decisions
// (moderation, OPA claims, severity routing) — not infra initialization.

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
    offSession: jest.fn(),
  },
}));

// Prevent AllowedClaimsRegistry.initialize() from loading HuggingFace transformers.
jest.mock("../../insurance/allowed_claims_registry.js", () => {
  const actual = jest.requireActual("../../insurance/allowed_claims_registry.js");
  class PatchedRegistry extends actual.AllowedClaimsRegistry {
    async initialize(): Promise<void> {
      // no-op in tests — skip transformer model download
    }
  }
  return { ...actual, AllowedClaimsRegistry: PatchedRegistry };
});

// Prevent OpaEvaluator.initialize() from trying to load a .wasm file.
jest.mock("../../insurance/opa_evaluator.js", () => {
  const actual = jest.requireActual("../../insurance/opa_evaluator.js");
  class PatchedOpaEvaluator extends actual.OpaEvaluator {
    async initialize(): Promise<void> {
      // no-op in tests — skip WASM file loading
    }
  }
  return { ...actual, OpaEvaluator: PatchedOpaEvaluator };
});

// ── Imports ──────────────────────────────────────────────────────────────

import { ControlEngine } from "../../lanes/laneC_control.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";
import type { PolicyDecision } from "../../schemas/events.js";
import {
  TENANT_DEMO_ALPHA,
  TENANT_DEMO_BETA,
  buildAlphaClaimsRegistry,
  buildBetaClaimsRegistry,
} from "../fixtures/demoFixtures.js";
import {
  REGRESSION_FIXTURES,
  type RegressionFixture,
} from "../fixtures/regressionFixtures.js";

// ── Engine factory ───────────────────────────────────────────────────────

/**
 * Simple pipeline: standard Moderator + ClaimsChecker (role-guarded).
 * Mirrors makeSimpleEngine from FullPipelineE2E.test.ts.
 */
function makeSimpleEngine(
  tenantId: string,
  registry: AllowedClaimsRegistry,
): ControlEngine {
  return new ControlEngine(`session_regression_${tenantId}`, {
    tenantId,
    claimsRegistry: registry,
    // no opaEvaluator -> uses ClaimsChecker (role-guarded) + Moderator
    moderationCategories: [
      {
        name: "SELF_HARM",
        patterns: [/i want to (hurt|harm|kill) myself/i, /suicide/i],
        decision: "escalate" as const,
        severity: 5,
      },
    ],
    moderationDenyPatterns: [],
    cancelOutputThreshold: 10,
    enabled: false,
  });
}

// ── Engine resolution by tenant ──────────────────────────────────────────

const VALID_DECISIONS: PolicyDecision[] = [
  "allow",
  "rewrite",
  "refuse",
  "escalate",
  "cancel_output",
];

let alphaEngine: ControlEngine;
let betaEngine: ControlEngine;

function getEngineForTenant(tenantId: string): ControlEngine {
  if (tenantId === TENANT_DEMO_ALPHA) return alphaEngine;
  if (tenantId === TENANT_DEMO_BETA) return betaEngine;
  throw new Error(`Unknown tenant in regression fixture: ${tenantId}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Regression Suite — Policy Decision Consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const alphaRegistry = buildAlphaClaimsRegistry();
    const betaRegistry = buildBetaClaimsRegistry();
    alphaEngine = makeSimpleEngine(TENANT_DEMO_ALPHA, alphaRegistry);
    betaEngine = makeSimpleEngine(TENANT_DEMO_BETA, betaRegistry);
  });

  // ── Core regression: one test per fixture ────────────────────────────

  describe("REG-001 through REG-010", () => {
    it.each(REGRESSION_FIXTURES)(
      "[$id] $description",
      async (fixture: RegressionFixture) => {
        const engine = getEngineForTenant(fixture.tenantId);
        const ctx: EvaluationContext = {
          role: fixture.role,
          text: fixture.inputText,
          sessionId: `regression-${fixture.id}`,
          tenantId: fixture.tenantId,
          isFinal: true,
        };

        const result = await engine.evaluate(ctx);

        expect(result.decision).toBe(fixture.expectedDecision);

        if (fixture.expectedReasonCodeContains) {
          const hasExpectedCode = result.reasonCodes.some((code) =>
            code.includes(fixture.expectedReasonCodeContains!),
          );
          expect(hasExpectedCode).toBe(true);
        }
      },
    );
  });

  // ── Fixture metadata validation ──────────────────────────────────────

  describe("Regression metadata", () => {
    it("all fixtures have unique IDs", () => {
      const ids = REGRESSION_FIXTURES.map((f) => f.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("all expected decisions are valid PolicyDecision values", () => {
      for (const fixture of REGRESSION_FIXTURES) {
        expect(VALID_DECISIONS).toContain(fixture.expectedDecision);
      }
    });

    it("fixture count is 10", () => {
      expect(REGRESSION_FIXTURES).toHaveLength(10);
    });

    it("all fixtures have non-empty tags", () => {
      for (const fixture of REGRESSION_FIXTURES) {
        expect(fixture.tags.length).toBeGreaterThan(0);
      }
    });

    it("all fixtures have non-empty description and inputText", () => {
      for (const fixture of REGRESSION_FIXTURES) {
        expect(fixture.description.length).toBeGreaterThan(0);
        expect(fixture.inputText.length).toBeGreaterThan(0);
      }
    });

    it("fixture IDs follow REG-NNN format", () => {
      for (const fixture of REGRESSION_FIXTURES) {
        expect(fixture.id).toMatch(/^REG-\d{3}$/);
      }
    });
  });
});
