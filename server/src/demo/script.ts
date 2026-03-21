/**
 * Demo Scripts — scripted turn sequences for each demo scenario.
 *
 * Each DemoScript defines a sequence of DemoTurns with configurable delays
 * and expected policy/sentiment events that the DemoPlayer will inject after
 * each user turn.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface DemoTurnEvents {
  sentiment?: "positive" | "neutral" | "negative" | "frustrated";
  policyDecision?: "allow" | "refuse" | "escalate" | "rewrite";
  reasonCodes?: string[];
  severity?: number;
  claimMatched?: string;
}

export interface DemoTurn {
  speaker: "agent" | "user";
  text: string;
  /** ms after previous turn before this one appears */
  delayMs: number;
  /** Expected events that fire after this turn (used by DemoPlayer to inject) */
  events?: DemoTurnEvents;
}

export interface DemoScript {
  scenarioId: string;
  turns: DemoTurn[];
}

// ── Support Script — Warranty Claims ──────────────────────────────────────

const supportScript: DemoScript = {
  scenarioId: "support",
  turns: [
    {
      speaker: "agent",
      text: "Thank you for contacting warranty support. I can help verify your product claims and get you the right resolution. How can I help?",
      delayMs: 0,
    },
    {
      speaker: "user",
      text: "My laptop battery drains in 30 minutes — the specs said 8 hours.",
      delayMs: 2000,
      events: {
        sentiment: "frustrated",
        policyDecision: "allow",
        reasonCodes: ["claims_check"],
        claimMatched: "battery_8hr_claim",
      },
    },
    {
      speaker: "agent",
      text: "I can see your concern. Our records do confirm the battery specification of up to 8 hours under standard usage conditions. This sounds like it may qualify for a warranty claim. Let me pull up your account.",
      delayMs: 1500,
    },
    {
      speaker: "user",
      text: "I was told by the sales rep that this comes with a 3-year warranty.",
      delayMs: 2500,
      events: {
        sentiment: "neutral",
        policyDecision: "allow",
        reasonCodes: ["claims_check"],
        claimMatched: "3yr_warranty_claim",
      },
    },
    {
      speaker: "agent",
      text: "That's correct — your model does include a 3-year limited warranty covering manufacturing defects. Battery degradation outside normal parameters falls within that coverage.",
      delayMs: 1800,
    },
    {
      speaker: "user",
      text: "The product page said it's waterproof to 30 meters but it broke in the rain.",
      delayMs: 2200,
      events: {
        sentiment: "negative",
        policyDecision: "allow",
        reasonCodes: ["claims_check"],
        claimMatched: "waterproof_30m_claim",
      },
    },
    {
      speaker: "agent",
      text: "Our product page does list IP68 water resistance up to 30 meters. Rain exposure is well within that rating. I'm escalating this to our senior support team as a potential manufacturing defect.",
      delayMs: 2000,
    },
    {
      speaker: "user",
      text: "This is completely unacceptable! I want a full refund right now!",
      delayMs: 1500,
      events: {
        sentiment: "frustrated",
        policyDecision: "escalate",
        reasonCodes: ["customer_frustration", "escalation_threshold"],
        severity: 3,
      },
    },
    {
      speaker: "agent",
      text: "I completely understand your frustration, and I want to resolve this for you. I'm connecting you with a senior support specialist right now who has full authority to process a refund or replacement.",
      delayMs: 1200,
    },
  ],
};

// ── Compliance Script — Regulatory Questions ──────────────────────────────

const complianceScript: DemoScript = {
  scenarioId: "compliance",
  turns: [
    {
      speaker: "agent",
      text: "This is the compliance information line. All calls are recorded for quality and compliance purposes. How can I assist you with your regulatory question?",
      delayMs: 0,
    },
    {
      speaker: "user",
      text: "I heard we're exempt from GDPR if we're under 250 employees.",
      delayMs: 2000,
      events: {
        sentiment: "neutral",
        policyDecision: "refuse",
        reasonCodes: ["claims_check_fail"],
        severity: 2,
      },
    },
    {
      speaker: "agent",
      text: "I need to correct that — the 250-employee threshold in GDPR Article 30 only provides a limited exemption from maintaining certain records of processing activities. It does not exempt any organisation from GDPR compliance overall. Your obligations for data subject rights, lawful basis, and breach notification apply regardless of company size.",
      delayMs: 2200,
    },
    {
      speaker: "user",
      text: "Our legal team said we don't need to disclose AI use to customers.",
      delayMs: 2800,
      events: {
        sentiment: "neutral",
        policyDecision: "refuse",
        reasonCodes: ["claims_check_fail"],
        severity: 2,
      },
    },
    {
      speaker: "agent",
      text: "That advice is likely outdated. Under the EU AI Act (effective August 2026), Article 13 requires mandatory transparency disclosures for high-risk AI systems, and Article 52 requires disclosure when users interact with AI that generates or manipulates content. I'd recommend your legal team review the latest guidance.",
      delayMs: 2500,
    },
    {
      speaker: "user",
      text: "Someone told me the 72-hour breach notification window doesn't apply to us.",
      delayMs: 2200,
      events: {
        sentiment: "neutral",
        policyDecision: "refuse",
        reasonCodes: ["claims_check_fail"],
        severity: 2,
      },
    },
    {
      speaker: "agent",
      text: "That's incorrect. GDPR Article 33 requires notification to the supervisory authority within 72 hours of becoming aware of a personal data breach — this applies to all data controllers processing EU residents' data, regardless of where the company is based or its size.",
      delayMs: 2400,
    },
    {
      speaker: "user",
      text: "I just want to ignore all of this — it doesn't apply to my company.",
      delayMs: 1800,
      events: {
        sentiment: "frustrated",
        policyDecision: "escalate",
        reasonCodes: ["compliance_refusal", "escalation_threshold"],
        severity: 2,
      },
    },
    {
      speaker: "agent",
      text: "I understand this can feel overwhelming, but ignoring these obligations carries significant risk — fines up to €20M or 4% of global turnover. I'm escalating this to our compliance team who can help you build a practical roadmap.",
      delayMs: 2000,
    },
  ],
};

// ── Sales Script — Product Claims ─────────────────────────────────────────

const salesScript: DemoScript = {
  scenarioId: "sales",
  turns: [
    {
      speaker: "agent",
      text: "Hi, thanks for reaching out! I'd love to help you find the right fit. Let me make sure I give you accurate, up-to-date information. What are you trying to solve?",
      delayMs: 0,
    },
    {
      speaker: "user",
      text: "I saw your platform processes 10 million events per second.",
      delayMs: 2200,
      events: {
        sentiment: "positive",
        policyDecision: "allow",
        reasonCodes: ["claims_check"],
        claimMatched: "10m_events_per_second",
      },
    },
    {
      speaker: "agent",
      text: "That's accurate — our platform is benchmarked at 10 million events per second on our enterprise tier with horizontal scaling enabled. That's on AWS c6i.8xlarge nodes. Happy to share the benchmark report.",
      delayMs: 1800,
    },
    {
      speaker: "user",
      text: "A competitor told me your uptime SLA is only 99.5%.",
      delayMs: 2400,
      events: {
        sentiment: "neutral",
        policyDecision: "rewrite",
        reasonCodes: ["claim_correction"],
        severity: 1,
      },
    },
    {
      speaker: "agent",
      text: "I want to make sure you have the right information — our current SLA is 99.95% uptime for enterprise customers, not 99.5%. That's a meaningful difference: 99.95% allows less than 4.4 hours downtime per year. I can send you the full SLA document.",
      delayMs: 2100,
    },
    {
      speaker: "user",
      text: "The analyst report said you were named a Leader in the Gartner Magic Quadrant.",
      delayMs: 2600,
      events: {
        sentiment: "positive",
        policyDecision: "allow",
        reasonCodes: ["claims_check"],
        claimMatched: "gartner_magic_quadrant_leader",
      },
    },
    {
      speaker: "agent",
      text: "Yes, we were recognised as a Leader in the Gartner Magic Quadrant for Voice AI Platforms in Q3 last year. It's the second consecutive year in the Leaders quadrant. I can share the full report extract.",
      delayMs: 1900,
    },
    {
      speaker: "user",
      text: "Your competitor offers guaranteed 50% cost savings.",
      delayMs: 2300,
      events: {
        sentiment: "neutral",
        policyDecision: "refuse",
        reasonCodes: ["unverified_claim"],
        severity: 1,
      },
    },
    {
      speaker: "agent",
      text: "I can't speak to competitor claims, and I'd be cautious about guaranteed savings figures — those usually come with significant conditions. What I can do is walk you through our verified ROI data from comparable deployments, which typically shows 30-45% operational cost reduction in year one.",
      delayMs: 2200,
    },
  ],
};

// ── Script Registry ────────────────────────────────────────────────────────

const DEMO_SCRIPTS: Record<string, DemoScript> = {
  support: supportScript,
  compliance: complianceScript,
  sales: salesScript,
};

/**
 * Retrieve the scripted turn sequence for a given scenario ID.
 *
 * @param scenarioId - "support" | "compliance" | "sales"
 * @returns The matching DemoScript
 * @throws Error if scenarioId is not found
 */
export function getDemoScript(scenarioId: string): DemoScript {
  const script = DEMO_SCRIPTS[scenarioId];
  if (!script) {
    throw new Error(
      `No demo script found for scenarioId "${scenarioId}". Valid options: ${Object.keys(DEMO_SCRIPTS).join(", ")}`
    );
  }
  return script;
}

/**
 * Return all demo scripts as an ordered array.
 */
export function listDemoScripts(): DemoScript[] {
  return Object.values(DEMO_SCRIPTS);
}
