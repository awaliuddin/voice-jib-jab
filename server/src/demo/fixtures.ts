/**
 * Demo Fixtures — pre-configured enterprise demo scenarios.
 *
 * Each DemoScenario maps to a built-in agent template and provides
 * supplemental context for a self-contained 5-minute enterprise demo.
 *
 * Usage:
 *   import { DEMO_SCENARIOS, getDemoScenario } from "./fixtures.js";
 *   const s = getDemoScenario("support");
 */

/** Identifier for a built-in demo scenario. */
export type DemoScenarioId = "support" | "compliance" | "sales";

/** A self-contained enterprise demo scenario with greeting, utterances, and pitch points. */
export interface DemoScenario {
  id: DemoScenarioId;
  name: string;
  description: string;
  templateId: string;
  greeting: string;
  sampleUtterances: string[];
  sampleClaims: string[];
  expectedPolicyTriggers: string[];
  pitchPoints: string[];
}

/** Registry of all built-in demo scenarios keyed by ID. */
export const DEMO_SCENARIOS: Record<DemoScenarioId, DemoScenario> = {
  support: {
    id: "support",
    name: "Customer Support — Warranty Claims",
    description: "Real-time warranty claim verification with automatic escalation.",
    templateId: "builtin-customer-support",
    greeting:
      "Thank you for contacting warranty support. I can help verify your product claims and get you the right resolution. How can I help?",
    sampleUtterances: [
      "My laptop battery drains in 30 minutes — the specs said 8 hours.",
      "I was told by the sales rep that this comes with a 3-year warranty.",
      "The product page said it's waterproof to 30 meters.",
    ],
    sampleClaims: [
      "The battery lasts 8 hours",
      "The product has a 3-year warranty",
      "The device is waterproof to 30 meters",
    ],
    expectedPolicyTriggers: ["claims_check", "escalation"],
    pitchPoints: [
      "Real-time claim verification prevents agents from confirming false product specs",
      "Automatic escalation when customer frustration detected",
      "Full compliance export for every interaction (EU AI Act Article 13)",
    ],
  },
  compliance: {
    id: "compliance",
    name: "Compliance Hotline — Regulatory Questions",
    description: "Flags legally incorrect regulatory claims before they propagate.",
    templateId: "builtin-tech-support",
    greeting:
      "This is the compliance information line. All calls are recorded. How can I assist you with your regulatory question?",
    sampleUtterances: [
      "I heard we're exempt from GDPR reporting requirements if we're under 250 employees.",
      "Our legal team said we don't need to disclose AI use to customers.",
      "Someone told me the 72-hour breach notification window doesn't apply to us.",
    ],
    sampleClaims: [
      "Companies under 250 employees are exempt from GDPR reporting",
      "AI use disclosure is not required",
      "72-hour breach notification does not apply",
    ],
    expectedPolicyTriggers: ["claims_check", "moderation"],
    pitchPoints: [
      "Flags legally incorrect claims before they propagate through the organization",
      "High moderation sensitivity catches regulatory misstatements",
      "Immutable audit trail for every compliance call",
    ],
  },
  sales: {
    id: "sales",
    name: "Sales Qualification — Product Claims",
    description: "Keeps sales conversations accurate without breaking flow.",
    templateId: "builtin-sales",
    greeting:
      "Hi, thanks for reaching out! I'd love to help you find the right fit. Let me ask you a few questions to make sure I give you accurate information.",
    sampleUtterances: [
      "I saw your platform processes 10 million events per second.",
      "A competitor told me your uptime SLA is only 99.5%.",
      "The analyst report said you were named a Leader in the Gartner Magic Quadrant.",
    ],
    sampleClaims: [
      "Platform processes 10 million events per second",
      "Uptime SLA is 99.5%",
      "Named Leader in Gartner Magic Quadrant",
    ],
    expectedPolicyTriggers: ["claims_check"],
    pitchPoints: [
      "Prevents sales agents from accidentally confirming competitive misinformation",
      "Real-time fact-checking keeps deals on track with accurate positioning",
      "Low moderation sensitivity — lets sales conversations flow naturally",
    ],
  },
};

/**
 * Retrieve a demo scenario by ID.
 *
 * @param id - The scenario identifier ("support" | "compliance" | "sales")
 * @returns The matching DemoScenario
 */
export function getDemoScenario(id: DemoScenarioId): DemoScenario {
  return DEMO_SCENARIOS[id];
}

/**
 * Return all demo scenarios as an ordered array.
 *
 * @returns Array of all DemoScenario entries
 */
export function listDemoScenarios(): DemoScenario[] {
  return Object.values(DEMO_SCENARIOS);
}
