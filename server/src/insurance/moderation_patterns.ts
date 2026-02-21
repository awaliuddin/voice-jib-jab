/**
 * Content Moderation Patterns — Categorized regex patterns for enterprise voice moderation.
 *
 * These patterns form the fast first-pass moderation layer (Tier 1, sync, zero-latency).
 * They catch clearly harmful content using high-confidence regex patterns. Subtle or
 * context-dependent violations require a semantic layer (e.g., OpenAI Moderation API).
 *
 * Design notes:
 * - Patterns use word boundaries (\b) to minimize false positives
 * - All matching is case-insensitive (patterns use /i flag, text is lowercased)
 * - Tuned for speech-to-text context (words as spoken, minimal punctuation)
 * - Each category can specify its own decision type (refuse vs escalate)
 * - Self-harm triggers "escalate" because the caller needs human support
 */

import type { PolicyDecision } from "../schemas/events.js";

export interface ModerationCategory {
  /** Machine-readable category name (used in reason codes as MODERATION:<NAME>) */
  name: string;
  /** Regex patterns that indicate a violation in this category */
  patterns: RegExp[];
  /** Severity level: 3 = high, 4 = critical */
  severity: number;
  /** Policy decision when this category matches */
  decision: PolicyDecision;
}

// ── Category: Jailbreak / Prompt Injection ──────────────────────────────
// Attempts to override system instructions or manipulate the AI's behavior.
// Critical in enterprise contexts where the agent has access to tools/data.

const JAILBREAK_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+)?(your|previous|prior|above)\s+(instructions|rules|guidelines|constraints|directives)\b/i,
  /\bdisregard\s+(your|all|previous)\s+(training|instructions|rules|guidelines)\b/i,
  /\byou\s+are\s+now\s+(a|an|in)\b/i,
  /\bpretend\s+(you\s+are|to\s+be|you're)\b/i,
  /\bact\s+as\s+if\s+you\s+have\s+no\s+(restrictions|rules|limits|guidelines)\b/i,
  /\b(reveal|show|display|output)\s+(your|the)\s+(system\s+prompt|instructions|rules|guidelines)\b/i,
  /\bbypass\s+(your|the|all)\s+(safety|security|content|moderation)\b/i,
  /\boverride\s+(your|the|all)\s+(guidelines|rules|safety|restrictions)\b/i,
  /\bjailbreak\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\bdan\s+mode\b/i,
  /\bdeveloper\s+mode\s+(enabled|activated|on)\b/i,
];

// ── Category: Violence / Threats ──────────────────────────────────────────
// Explicit threats of physical harm or descriptions of planned violence.

const VIOLENCE_PATTERNS: RegExp[] = [
  /\bi(?:'m| am)\s+going\s+to\s+kill\b/i,
  /\bi\s+(will|wanna|want\s+to)\s+kill\s+(?!myself\b|my\s+life\b)/i,
  /\bi(?:'m| am)\s+going\s+to\s+(hurt|harm|attack|shoot|stab)\s+(you|him|her|them|someone|somebody|everyone|people)\b/i,
  /\bi(?:'m| am)\s+gonna\s+(kill|hurt|harm|attack|shoot|stab)\s+(you|him|her|them|someone|somebody|everyone|people)\b/i,
  /\bi\s+will\s+(hurt|harm|attack|shoot|stab)\s+(you|him|her|them|someone|somebody|everyone|people)\b/i,
  /\b(bomb|shooting|mass\s+casualty)\s+threat\b/i,
  /\bhow\s+to\s+(make|build|construct)\s+(a\s+)?(bomb|explosive|weapon)\b/i,
  /\bi\s+placed\s+a\s+bomb\b/i,
  /\b(going\s+to|gonna|will)\s+(blow\s+up|bomb|detonate|shoot\s+up)\b/i,
  /\bkill\s+(all|every|them|those)\b/i,
];

// ── Category: Self-Harm ──────────────────────────────────────────────────
// Expressions of suicidal ideation or self-harm. Decision is "escalate"
// because the caller needs human support, not a refusal.

const SELF_HARM_PATTERNS: RegExp[] = [
  /\bhow\s+to\s+(kill|end|harm)\s+(myself|my\s+life)\b/i,
  /\bhow\s+to\s+commit\s+suicide\b/i,
  /\bways\s+to\s+(end|take)\s+my\s+(life|own\s+life)\b/i,
  /\bi\s+want\s+to\s+(die|end\s+it|end\s+my\s+life|kill\s+myself)\b/i,
  /\bi\s+(don't|do\s+not)\s+want\s+to\s+(live|be\s+alive|exist)\s+anymore\b/i,
  /\bsuicide\s+(method|plan|instructions|how\s+to)\b/i,
  /\bbest\s+way\s+to\s+(die|end\s+it)\s*$/i,
];

// ── Category: Hate Speech ────────────────────────────────────────────────
// Language targeting protected groups with intent to demean, dehumanize,
// or incite discrimination.

const HATE_SPEECH_PATTERNS: RegExp[] = [
  /\b(all|those|these)\s+\w+\s+(should\s+be\s+killed|deserve\s+to\s+die|are\s+(subhuman|inferior|vermin|animals))\b/i,
  /\b(kill|exterminate|eliminate|eradicate)\s+all\s+\w+\b/i,
  /\b(ethnic|racial)\s+cleansing\b/i,
  /\b(white|black|asian|jewish|muslim|christian|hindu)\s+(supremacy|genocide|extermination)\b/i,
  /\bgenocide\s+(is\s+)?(good|necessary|justified|needed)\b/i,
  /\b(go\s+back|return)\s+to\s+(your|their)\s+(country|homeland)\b/i,
];

// ── Category: Illegal Activity ──────────────────────────────────────────
// Explicit requests for instructions on illegal activities.

const ILLEGAL_ACTIVITY_PATTERNS: RegExp[] = [
  /\bhow\s+to\s+(hack|break)\s+into\b/i,
  /\bhow\s+to\s+(make|cook|manufacture|synthesize)\s+(meth|cocaine|heroin|fentanyl|drugs)\b/i,
  /\bhow\s+to\s+launder\s+money\b/i,
  /\bhow\s+to\s+(forge|counterfeit|fake)\s+(documents|id|passport|money|currency)\b/i,
  /\bhow\s+to\s+(steal|shoplift|rob|burglarize)\b/i,
  /\bhow\s+to\s+hotwire\b/i,
  /\bhow\s+to\s+(poison|drug)\s+(someone|a\s+person)\b/i,
  /\bhow\s+to\s+get\s+away\s+with\s+(murder|crime|theft|fraud)\b/i,
];

// ── Category: Explicit Content ──────────────────────────────────────────
// Sexually explicit requests or content inappropriate for enterprise voice.

const EXPLICIT_CONTENT_PATTERNS: RegExp[] = [
  /\b(write|generate|create|describe)\s+(me\s+)?(an?\s+)?((explicit|erotic|sexual|pornographic)\s+)+(content|story|fiction|scene|material)\b/i,
  /\bhave\s+(sex|intercourse)\s+with\s+me\b/i,
  /\b(sexual|nude|naked)\s+(roleplay|role\s+play)\b/i,
  /\bsexually\s+(explicit|graphic)\s+(conversation|chat|talk)\b/i,
];

// ── Category: Harassment ────────────────────────────────────────────────
// Targeted personal attacks, doxxing threats, or stalking language.

const HARASSMENT_PATTERNS: RegExp[] = [
  /\bi\s+know\s+where\s+you\s+live\b/i,
  /\bi\s+(will|'ll|am\s+going\s+to)\s+(find|track|hunt)\s+(you|them|her|him)\s+(down)?\b/i,
  /\b(post|share|leak|release|publish)\s+(your|their|her|his)\s+(personal\s+)?(address|phone|info|information|photos|pictures)\b/i,
  /\byou\s+(deserve|should)\s+(to\s+)?(die|be\s+killed|be\s+hurt|suffer)\b/i,
  /\b(dox|doxx|swat)\s+(you|them|her|him)\b/i,
];

// ── Default Categories ──────────────────────────────────────────────────

export const DEFAULT_MODERATION_CATEGORIES: ModerationCategory[] = [
  {
    name: "JAILBREAK",
    patterns: JAILBREAK_PATTERNS,
    severity: 4,
    decision: "refuse",
  },
  // SELF_HARM before VIOLENCE: "i want to kill myself" must trigger escalation
  // (human handoff), not a generic violence refusal.
  {
    name: "SELF_HARM",
    patterns: SELF_HARM_PATTERNS,
    severity: 4,
    decision: "escalate",
  },
  {
    name: "VIOLENCE_THREATS",
    patterns: VIOLENCE_PATTERNS,
    severity: 4,
    decision: "refuse",
  },
  {
    name: "HATE_SPEECH",
    patterns: HATE_SPEECH_PATTERNS,
    severity: 4,
    decision: "refuse",
  },
  {
    name: "ILLEGAL_ACTIVITY",
    patterns: ILLEGAL_ACTIVITY_PATTERNS,
    severity: 3,
    decision: "refuse",
  },
  {
    name: "EXPLICIT_CONTENT",
    patterns: EXPLICIT_CONTENT_PATTERNS,
    severity: 3,
    decision: "refuse",
  },
  {
    name: "HARASSMENT",
    patterns: HARASSMENT_PATTERNS,
    severity: 4,
    decision: "refuse",
  },
];

/**
 * Flatten all category patterns into a single RegExp array.
 * Useful for backward-compatible construction.
 */
export function getDefaultDenyPatterns(): RegExp[] {
  return DEFAULT_MODERATION_CATEGORIES.flatMap((c) => c.patterns);
}
