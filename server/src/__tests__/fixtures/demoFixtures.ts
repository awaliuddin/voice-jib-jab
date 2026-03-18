/**
 * Demo Fixtures — voice-jib-jab Portfolio Showcase
 *
 * Pre-configured tenants, claims, and policies for reproducible demos.
 * Matches the scenarios in docs/demo-script.md.
 *
 * Usage (in tests or demo scripts):
 *   import { TENANT_DEMO_ALPHA, TENANT_DEMO_BETA, buildAlphaEngine, buildBetaEngine } from "./demoFixtures.js";
 */

import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";

// ── Tenant IDs ────────────────────────────────────────────────────────────

export const TENANT_DEMO_ALPHA = "org_demo_alpha";
export const TENANT_DEMO_BETA = "org_demo_beta";

// ── Alpha: Medical Device Company ─────────────────────────────────────────
// Strict policy: only FDA-approved claims allowed; low moderation threshold.

export const ALPHA_CLAIMS = [
  {
    id: "DEMO-A-001",
    text: "This product is FDA certified and cleared for clinical use",
  },
  {
    id: "DEMO-A-002",
    text: "Clinically validated in peer-reviewed studies for diagnostic accuracy",
  },
  {
    id: "DEMO-A-003",
    text: "CE marked for use in European healthcare settings",
  },
];

export const ALPHA_DISALLOWED_PATTERNS = [
  /guarantees? a cure/i,
  /cures? all/i,
  /100% effective/i,
  /no side effects/i,
];

/** Pre-built claims registry for TENANT_DEMO_ALPHA */
export function buildAlphaClaimsRegistry(): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims: ALPHA_CLAIMS,
    disallowedPatterns: ALPHA_DISALLOWED_PATTERNS,
    enableFileLoad: false,
  });
}

/**
 * OPA policy data for TENANT_DEMO_ALPHA.
 * Strict: low claims threshold (0.2) so marginal matches are refused.
 */
export const ALPHA_OPA_POLICY_DATA = {
  claimsThreshold: 0.2,
  moderationThresholds: {
    JAILBREAK: 0.3,
    HATE_SPEECH: 0.2,
    VIOLENCE_THREATS: 0.25,
  },
};

// ── Beta: Fintech Company ─────────────────────────────────────────────────
// Permissive moderation; financial claims registry; no medical claims.

export const BETA_CLAIMS = [
  {
    id: "DEMO-B-001",
    text: "Historical returns of approximately 8-12% per year based on index performance",
  },
  {
    id: "DEMO-B-002",
    text: "FDIC insured deposits up to $250,000 per depositor",
  },
  {
    id: "DEMO-B-003",
    text: "Regulated by the SEC and registered as an investment advisor",
  },
];

export const BETA_DISALLOWED_PATTERNS = [
  /guaranteed \d+%/i,
  /guaranteed.*returns?/i,
  /risk.?free investment/i,
  /cannot lose/i,
];

/** Pre-built claims registry for TENANT_DEMO_BETA */
export function buildBetaClaimsRegistry(): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims: BETA_CLAIMS,
    disallowedPatterns: BETA_DISALLOWED_PATTERNS,
    enableFileLoad: false,
  });
}

/**
 * OPA policy data for TENANT_DEMO_BETA.
 * Permissive: high claims threshold (0.85) allows broader claims.
 */
export const BETA_OPA_POLICY_DATA = {
  claimsThreshold: 0.85,
  moderationThresholds: {
    JAILBREAK: 0.5,
    HATE_SPEECH: 0.4,
    VIOLENCE_THREATS: 0.5,
  },
};

// ── Demo Evaluation Contexts ─────────────────────────────────────────────

/** Texts that should ALLOW on Alpha, REFUSE on Beta (medical domain) */
export const ALPHA_ALLOW_TEXTS = [
  "Is this product FDA certified?",
  "Is this CE marked for European healthcare?",
];

export const ALPHA_REFUSE_TEXTS = [
  "This device guarantees a cure for all conditions.",
  "This product has 100% effective results with no side effects.",
];

/** Texts that should ALLOW on Beta, REFUSE on Alpha (financial domain) */
export const BETA_ALLOW_TEXTS = [
  "What are the historical returns based on index performance?",
  "Are deposits FDIC insured?",
];

export const BETA_REFUSE_TEXTS = [
  "Guaranteed 40% annual returns on your investment.",
  "This is a risk-free investment — you cannot lose.",
];

/** Text that escalates on both tenants (moderation category: SELF_HARM) */
export const ESCALATION_TEXT = "I want to hurt myself.";

// ── Snapshot Summaries ────────────────────────────────────────────────────

/**
 * Expected demo outcomes for documentation / assertion reference.
 * Used in demo script (docs/demo-script.md) to describe expected decisions.
 */
export const DEMO_SCENARIOS = [
  {
    tenant: TENANT_DEMO_ALPHA,
    input: "Is this product FDA certified?",
    expectedDecision: "allow",
    claimMatched: "DEMO-A-001",
    description: "Alpha: allowed claim (Act 2a)",
  },
  {
    tenant: TENANT_DEMO_ALPHA,
    input: "This device guarantees a cure for all conditions.",
    expectedDecision: "refuse",
    description: "Alpha: disallowed claim (Act 2b)",
  },
  {
    tenant: TENANT_DEMO_ALPHA,
    input: ESCALATION_TEXT,
    expectedDecision: "escalate",
    description: "Alpha: SELF_HARM escalation → MCP ticket (Act 2c)",
  },
  {
    tenant: TENANT_DEMO_BETA,
    input: "This device guarantees a cure for all conditions.",
    expectedDecision: "allow",
    description: "Beta: same text as Alpha Act 2b — allowed (Act 3a)",
  },
  {
    tenant: TENANT_DEMO_BETA,
    input: "Guaranteed 40% annual returns on your investment.",
    expectedDecision: "refuse",
    description: "Beta: disallowed financial claim (Act 3b)",
  },
] as const;
