/**
 * Full Pipeline E2E Smoke Test — DIRECTIVE-NXTG-20260318-56
 *
 * Verifies the complete end-to-end flow across all shipped features:
 *   N-12 Ticketing MCP  — fire-and-forget escalation ticket on Lane C escalate
 *   N-13 Multi-Tenant   — per-tenant claims + OPA threshold isolation
 *   N-14 Governance     — OpaModeratorCheck + OpaClaimsCheck (deny-unless-approved)
 *
 * Design notes:
 *   - OpaClaimsCheck (used when opaEvaluator is provided) follows a
 *     "deny-unless-approved" model: text with TF-IDF similarity below the
 *     tenant threshold is refused as an unverified claim. This is correct and
 *     expected production behaviour; tests are designed around it.
 *   - Tests involving neutral text (no product claims) use role: "user" or
 *     engines without opaEvaluator so the legacy ClaimsChecker (role-guarded)
 *     runs instead of OpaClaimsCheck.
 *
 * Oracle types: behavioural (decision/event assertions) + state (payload fields).
 */

// ── Mocks (before imports — jest hoisting requirement) ───────────────────

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
import { OpaEvaluator } from "../../insurance/opa_evaluator.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";
import type {
  TicketingClient,
  TicketPayload,
  TicketResult,
} from "../../services/TicketingMcpClient.js";

// ── Tenant IDs ────────────────────────────────────────────────────────────

const ALPHA = "org_smoke_alpha"; // medical device — strict OPA threshold
const BETA = "org_smoke_beta";   // fintech — permissive OPA threshold

// ── Claim fixtures ────────────────────────────────────────────────────────
// Exact claim texts are used in "allow" scenario tests to ensure TF-IDF
// similarity exceeds the tenant threshold.

const ALPHA_CLAIM_A = "FDA cleared class II medical device approved for clinical use";
const ALPHA_CLAIM_B = "Clinically validated in randomized controlled trial";

const BETA_CLAIM_A = "FDIC insured deposits up to 250000 dollars per depositor";
const BETA_CLAIM_B = "SEC registered investment advisor with fiduciary duty";

function buildAlphaRegistry(): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims: [
      { id: "SA-001", text: ALPHA_CLAIM_A },
      { id: "SA-002", text: ALPHA_CLAIM_B },
    ],
    disallowedPatterns: ["guaranteed cure", "100% effective", "miracle treatment"],
    enableFileLoad: false,
  });
}

function buildBetaRegistry(): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims: [
      { id: "SB-001", text: BETA_CLAIM_A },
      { id: "SB-002", text: BETA_CLAIM_B },
    ],
    disallowedPatterns: ["guaranteed returns", "risk-free investment", "cannot lose"],
    enableFileLoad: false,
  });
}

// ── Ticketing mock factory ────────────────────────────────────────────────

function makeTicketingClient(
  overrides: Partial<TicketingClient> = {},
): jest.Mocked<TicketingClient> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    createTicket: jest.fn().mockResolvedValue({
      ticketId: "99",
      url: "https://github.com/org/repo/issues/99",
      provider: "github",
    } as TicketResult),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<TicketingClient>;
}

// ── Engine factories ──────────────────────────────────────────────────────

/** Full OPA pipeline: OpaModeratorCheck + OpaClaimsCheck. Claims are strict. */
function makeOpaEngine(
  tenantId: string,
  registry: AllowedClaimsRegistry,
  ticketingClient?: TicketingClient,
  opaEvaluator?: OpaEvaluator,
): ControlEngine {
  return new ControlEngine(`session_${tenantId}`, {
    tenantId,
    claimsRegistry: registry,
    ticketingClient,
    opaEvaluator,
    opaClaimsThreshold: tenantId === ALPHA ? 0.1 : 0.9,
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

/**
 * Simple pipeline: standard Moderator + ClaimsChecker (role-guarded).
 * Used for tests that need neutral text to pass without claims matching.
 */
function makeSimpleEngine(
  tenantId: string,
  registry: AllowedClaimsRegistry,
  ticketingClient?: TicketingClient,
): ControlEngine {
  return new ControlEngine(`session_${tenantId}`, {
    tenantId,
    claimsRegistry: registry,
    ticketingClient,
    // no opaEvaluator → uses ClaimsChecker (role-guarded) + Moderator
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

function ctx(
  text: string,
  tenantId: string,
  role: "user" | "assistant" = "assistant",
): EvaluationContext {
  return {
    sessionId: `session_${tenantId}`,
    role,
    text,
    isFinal: true,
    tenantId,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Full Pipeline E2E Smoke Test (N-12 + N-13 + N-14)", () => {
  let alphaRegistry: AllowedClaimsRegistry;
  let betaRegistry: AllowedClaimsRegistry;
  let alphaTicketing: jest.Mocked<TicketingClient>;
  let betaTicketing: jest.Mocked<TicketingClient>;
  let opaEvaluator: OpaEvaluator;
  let alphaOpaEngine: ControlEngine;
  let betaOpaEngine: ControlEngine;
  let alphaSimpleEngine: ControlEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    alphaRegistry = buildAlphaRegistry();
    betaRegistry = buildBetaRegistry();
    alphaTicketing = makeTicketingClient();
    betaTicketing = makeTicketingClient();
    opaEvaluator = new OpaEvaluator("stub.wasm"); // WASM mocked above
    opaEvaluator.setTenantPolicyData(ALPHA, { claimsThreshold: 0.1 }); // strict
    opaEvaluator.setTenantPolicyData(BETA, { claimsThreshold: 0.9 });  // permissive
    alphaOpaEngine = makeOpaEngine(ALPHA, alphaRegistry, alphaTicketing, opaEvaluator);
    betaOpaEngine = makeOpaEngine(BETA, betaRegistry, betaTicketing, opaEvaluator);
    alphaSimpleEngine = makeSimpleEngine(ALPHA, alphaRegistry, alphaTicketing);
  });

  afterEach(() => {
    opaEvaluator.clearTenantPolicyData();
  });

  // ── 1. initialize() wiring ──────────────────────────────────────────────

  describe("Pipeline initialization (N-12 ticketing wiring)", () => {
    it("initialize() connects ticketing client for both tenants", async () => {
      await alphaOpaEngine.initialize();
      await betaOpaEngine.initialize();
      expect(alphaTicketing.connect).toHaveBeenCalledTimes(1);
      expect(betaTicketing.connect).toHaveBeenCalledTimes(1);
    });

    it("initialize() is idempotent — second call does not reconnect", async () => {
      await alphaOpaEngine.initialize();
      await alphaOpaEngine.initialize();
      expect(alphaTicketing.connect).toHaveBeenCalledTimes(1);
    });
  });

  // ── 2. Alpha tenant — allow (OpaClaimsCheck: deny-unless-approved) ─────

  describe("Alpha tenant — OPA claims allow path (medical)", () => {
    it("exact registered claim → allow decision", async () => {
      const result = await alphaOpaEngine.evaluate(
        ctx(ALPHA_CLAIM_A, ALPHA),
      );
      expect(result.decision).toBe("allow");
    });

    it("second registered claim → allow decision", async () => {
      const result = await alphaOpaEngine.evaluate(
        ctx(ALPHA_CLAIM_B, ALPHA),
      );
      expect(result.decision).toBe("allow");
    });

    it("neutral user message (no product claim) → allow via user-role bypass", async () => {
      // role: "user" → ClaimsChecker role-guard returns allow; Moderator has no match
      const result = await alphaSimpleEngine.evaluate(
        ctx("Thank you for contacting our support team today.", ALPHA, "user"),
      );
      expect(result.decision).toBe("allow");
    });
  });

  // ── 3. Alpha tenant — refuse (disallowed patterns) ──────────────────────

  describe("Alpha tenant — OPA claims refuse path (medical)", () => {
    it("'guaranteed cure' disallowed pattern → refuse", async () => {
      const result = await alphaOpaEngine.evaluate(
        ctx("This treatment is a guaranteed cure for all conditions.", ALPHA),
      );
      expect(result.decision).toBe("refuse");
    });

    it("'100% effective' disallowed pattern → refuse", async () => {
      const result = await alphaOpaEngine.evaluate(
        ctx("Our device is 100% effective.", ALPHA),
      );
      expect(result.decision).toBe("refuse");
    });

    it("refused evaluation does not trigger ticket creation", async () => {
      await alphaOpaEngine.evaluate(
        ctx("This is a guaranteed cure for everything.", ALPHA),
      );
      await Promise.resolve();
      expect(alphaTicketing.createTicket).not.toHaveBeenCalled();
    });
  });

  // ── 4. Alpha tenant — escalation + MCP ticketing (N-12) ───────────────

  describe("Alpha tenant — escalation + MCP ticketing (N-12)", () => {
    it("SELF_HARM user input → escalate decision", async () => {
      const result = await alphaSimpleEngine.evaluate(
        ctx("I want to hurt myself right now", ALPHA, "user"),
      );
      expect(result.decision).toBe("escalate");
    });

    it("escalate decision → ticket_created event fires", async () => {
      const ticketEvents: unknown[] = [];
      alphaSimpleEngine.on("ticket_created", (p) => ticketEvents.push(p));

      await alphaSimpleEngine.evaluate(
        ctx("I want to hurt myself right now", ALPHA, "user"),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(alphaTicketing.createTicket).toHaveBeenCalledTimes(1);
      expect(ticketEvents).toHaveLength(1);
      const payload = ticketEvents[0] as { ticket: TicketResult };
      expect(payload.ticket.ticketId).toBe("99");
      expect(payload.ticket.provider).toBe("github");
    });

    it("ticket payload contains sessionId, severity ≥ 4, and SELF_HARM reason code", async () => {
      await alphaSimpleEngine.evaluate(
        ctx("I want to hurt myself right now", ALPHA, "user"),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      const call = alphaTicketing.createTicket.mock.calls[0][0] as TicketPayload;
      expect(call.sessionId).toBe(`session_${ALPHA}`);
      expect(call.severity).toBeGreaterThanOrEqual(4);
      // ModerationCategory produces "MODERATION:<name>" reason codes
      expect(call.reasonCodes.some((r) => r.includes("SELF_HARM"))).toBe(true);
    });

    it("transcript excerpt capped at 200 chars", async () => {
      const longText = "I want to hurt myself. ".repeat(20);
      await alphaSimpleEngine.evaluate(ctx(longText, ALPHA, "user"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const call = alphaTicketing.createTicket.mock.calls[0][0] as TicketPayload;
      expect(call.transcriptExcerpt.length).toBeLessThanOrEqual(200);
      expect(call.transcriptExcerpt).toBe(longText.slice(0, 200));
    });

    it("fire-and-forget: evaluate() returns before createTicket resolves", async () => {
      const neverResolving = makeTicketingClient({
        createTicket: jest.fn().mockReturnValue(new Promise<TicketResult>(() => {})),
      });
      const blockedEngine = makeSimpleEngine(ALPHA, alphaRegistry, neverResolving);
      await blockedEngine.initialize();

      const start = performance.now();
      await blockedEngine.evaluate(ctx("I want to hurt myself", ALPHA, "user"));
      expect(performance.now() - start).toBeLessThan(500);
    });

    it("createTicket error → ticket_error event, evaluate() still resolves", async () => {
      const failTicketing = makeTicketingClient({
        createTicket: jest.fn().mockRejectedValue(new Error("GitHub API down")),
      });
      const failEngine = makeSimpleEngine(ALPHA, alphaRegistry, failTicketing);

      const errorEvents: unknown[] = [];
      failEngine.on("ticket_error", (e) => errorEvents.push(e));

      await expect(
        failEngine.evaluate(ctx("I want to hurt myself", ALPHA, "user")),
      ).resolves.toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(errorEvents).toHaveLength(1);
    });
  });

  // ── 5. Beta tenant — allow + refuse ─────────────────────────────────────

  describe("Beta tenant — OPA claims (fintech)", () => {
    it("exact FDIC claim → allow decision", async () => {
      const result = await betaOpaEngine.evaluate(ctx(BETA_CLAIM_A, BETA));
      expect(result.decision).toBe("allow");
    });

    it("'guaranteed returns' disallowed pattern → refuse", async () => {
      const result = await betaOpaEngine.evaluate(
        ctx("We guarantee 40% annual guaranteed returns.", BETA),
      );
      expect(result.decision).toBe("refuse");
    });

    it("'risk-free investment' pattern → refuse", async () => {
      const result = await betaOpaEngine.evaluate(
        ctx("This is a risk-free investment opportunity.", BETA),
      );
      expect(result.decision).toBe("refuse");
    });
  });

  // ── 6. Cross-tenant domain isolation (N-13) ───────────────────────────

  describe("Cross-tenant domain isolation (N-13)", () => {
    // OpaClaimsCheck: deny-unless-approved. Medical text has high TF-IDF
    // similarity to Alpha's FDA claims but near-zero similarity to Beta's
    // FDIC/SEC claims → Beta refuses medical text as unverified claim.
    it("Alpha allows its own medical claim; Beta refuses the same text (domain isolation)", async () => {
      const alphaResult = await alphaOpaEngine.evaluate(ctx(ALPHA_CLAIM_A, ALPHA));
      const betaResult = await betaOpaEngine.evaluate(ctx(ALPHA_CLAIM_A, BETA));
      expect(alphaResult.decision).toBe("allow");
      expect(betaResult.decision).toBe("refuse");
    });

    it("Beta allows its own financial claim; Alpha refuses the same text (domain isolation)", async () => {
      const betaResult = await betaOpaEngine.evaluate(ctx(BETA_CLAIM_A, BETA));
      const alphaResult = await alphaOpaEngine.evaluate(ctx(BETA_CLAIM_A, ALPHA));
      expect(betaResult.decision).toBe("allow");
      expect(alphaResult.decision).toBe("refuse");
    });

    it("SELF_HARM escalates on both tenants (shared moderation category)", async () => {
      const alphaResult = await alphaSimpleEngine.evaluate(
        ctx("I want to hurt myself", ALPHA, "user"),
      );
      const betaSimpleEngine = makeSimpleEngine(BETA, betaRegistry, betaTicketing);
      const betaResult = await betaSimpleEngine.evaluate(
        ctx("I want to hurt myself", BETA, "user"),
      );
      expect(alphaResult.decision).toBe("escalate");
      expect(betaResult.decision).toBe("escalate");
    });

    it("Alpha escalation ticket does not reach Beta ticketing client", async () => {
      await alphaSimpleEngine.evaluate(ctx("I want to hurt myself", ALPHA, "user"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(alphaTicketing.createTicket).toHaveBeenCalledTimes(1);
      expect(betaTicketing.createTicket).not.toHaveBeenCalled();
    });

    it("OPA tenant policy data is isolated (different thresholds per tenant)", () => {
      expect(opaEvaluator.getTenantPolicyData(ALPHA)?.claimsThreshold).toBe(0.1);
      expect(opaEvaluator.getTenantPolicyData(BETA)?.claimsThreshold).toBe(0.9);
    });
  });

  // ── 7. Multiple evaluations in sequence ─────────────────────────────────

  describe("Multiple evaluations in sequence", () => {
    it("three SELF_HARM inputs → three separate ticket calls", async () => {
      for (let i = 0; i < 3; i++) {
        await alphaSimpleEngine.evaluate(ctx("I want to hurt myself", ALPHA, "user"));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(alphaTicketing.createTicket).toHaveBeenCalledTimes(3);
    });

    it("allow → refuse → escalate sequence (OPA path)", async () => {
      const r1 = await alphaOpaEngine.evaluate(ctx(ALPHA_CLAIM_A, ALPHA));
      const r2 = await alphaOpaEngine.evaluate(
        ctx("This is a guaranteed cure.", ALPHA),
      );
      const r3 = await alphaSimpleEngine.evaluate(
        ctx("I want to hurt myself", ALPHA, "user"),
      );
      expect(r1.decision).toBe("allow");
      expect(r2.decision).toBe("refuse");
      expect(r3.decision).toBe("escalate");
    });

    it("evaluationId is unique per escalation event", async () => {
      const ids = new Set<string>();
      alphaSimpleEngine.on("ticket_created", (p: { evaluationId: string }) =>
        ids.add(p.evaluationId),
      );

      for (let i = 0; i < 3; i++) {
        await alphaSimpleEngine.evaluate(ctx("I want to hurt myself", ALPHA, "user"));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(ids.size).toBe(3);
    });
  });
});
