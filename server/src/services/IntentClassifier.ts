/**
 * IntentClassifier — stateless intent classification from transcript text.
 *
 * Classifies caller intent using keyword scoring. Each keyword scores 1 point
 * (distinct match — counted once per keyword even if it appears multiple times).
 * Confidence is computed as highScore / totalWords, clamped to [0, 1].
 * Falls back to "general" when no keywords match or confidence < 0.03.
 *
 * Supported intents: "support" | "billing" | "sales" | "complaint" | "general"
 */

/** Recognized caller intent categories. */
export type CallerIntent = "support" | "billing" | "sales" | "complaint" | "general";

/** Classification result with winning intent, confidence, and per-intent scores. */
export interface IntentResult {
  intent: CallerIntent;
  confidence: number;   // 0.0–1.0, score of winning intent
  scores: Record<CallerIntent, number>; // raw scores for all intents
  fallback: boolean;    // true if returned "general" due to low confidence
}

// ── Keyword lists ──────────────────────────────────────────────────────

const KEYWORDS: Record<Exclude<CallerIntent, "general">, ReadonlyArray<string>> = {
  billing: [
    "bill", "invoice", "payment", "charge", "refund", "subscription",
    "credit card", "pay", "pricing", "cost", "fee", "overcharge", "receipt",
  ],
  support: [
    "help", "issue", "problem", "error", "broken", "not working", "fix",
    "stuck", "technical", "support", "crash", "bug", "fail",
  ],
  sales: [
    "buy", "purchase", "demo", "trial", "upgrade", "plan", "quote",
    "pricing", "interested", "product", "feature", "enterprise", "license",
  ],
  complaint: [
    "complaint", "unhappy", "angry", "frustrated", "disappointed", "terrible",
    "awful", "unacceptable", "worst", "hate", "disgusted", "escalate",
    "manager", "sue",
  ],
};

const SCORED_INTENTS = Object.keys(KEYWORDS) as Exclude<CallerIntent, "general">[];
const CONFIDENCE_THRESHOLD = 0.03;

/** Escape regex metacharacters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pre-compiled word-boundary patterns for each keyword.
 * Using \b anchors prevents short keywords (e.g. "pay") from matching
 * inside longer words (e.g. "payment"). Multi-word phrases like "credit card"
 * get \b at both phrase edges.
 */
const KEYWORD_PATTERNS: Record<Exclude<CallerIntent, "general">, ReadonlyArray<RegExp>> =
  Object.fromEntries(
    SCORED_INTENTS.map((intent) => [
      intent,
      KEYWORDS[intent].map((k) => new RegExp(`\\b${escapeRegex(k)}\\b`)),
    ]),
  ) as unknown as Record<Exclude<CallerIntent, "general">, ReadonlyArray<RegExp>>;

// ── IntentClassifier ───────────────────────────────────────────────────

export class IntentClassifier {
  /**
   * Classify the intent of the provided text.
   *
   * @param text - Caller utterance or transcript snippet.
   * @returns IntentResult with intent, confidence, per-intent scores, and fallback flag.
   */
  classify(text: string): IntentResult {
    const lower = text.toLowerCase();

    // Count words for confidence calculation
    const words = lower.split(/\s+/).filter((w) => w.length > 0);
    const totalWords = words.length;

    const scores: Record<CallerIntent, number> = {
      billing: 0,
      support: 0,
      sales: 0,
      complaint: 0,
      general: 0,
    };

    // Score each non-general intent: 1 point per distinct keyword match.
    // Word-boundary patterns prevent short keywords (e.g. "pay") from
    // falsely matching inside longer words (e.g. "payment").
    for (const intent of SCORED_INTENTS) {
      let intentScore = 0;
      for (const pattern of KEYWORD_PATTERNS[intent]) {
        if (pattern.test(lower)) {
          intentScore += 1;
        }
      }
      scores[intent] = intentScore;
    }

    // Find the winning intent
    let winner: Exclude<CallerIntent, "general"> | null = null;
    let highScore = 0;
    for (const intent of SCORED_INTENTS) {
      if (scores[intent] > highScore) {
        highScore = scores[intent];
        winner = intent;
      }
    }

    // Compute confidence: highScore / totalWords, clamped to [0, 1]
    const confidence = totalWords > 0
      ? Math.min(highScore / totalWords, 1.0)
      : 0;

    // Fallback to general if no match or confidence too low
    if (highScore === 0 || confidence < CONFIDENCE_THRESHOLD) {
      return { intent: "general", confidence, scores, fallback: true };
    }

    return { intent: winner!, confidence, scores, fallback: false };
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

/** Pre-instantiated singleton for stateless intent classification. */
export const intentClassifier = new IntentClassifier();
