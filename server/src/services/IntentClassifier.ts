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

export type CallerIntent = "support" | "billing" | "sales" | "complaint" | "general";

export interface IntentResult {
  intent: CallerIntent;
  confidence: number;   // 0.0–1.0, score of winning intent
  scores: Record<CallerIntent, number>; // raw scores for all intents
  fallback: boolean;    // true if returned "general" due to low confidence
}

// ── Keyword lists ──────────────────────────────────────────────────────

const KEYWORDS: Record<Exclude<CallerIntent, "general">, ReadonlySet<string>> = {
  billing: new Set([
    "bill", "invoice", "payment", "charge", "refund", "subscription",
    "credit card", "pay", "pricing", "cost", "fee", "overcharge", "receipt",
  ]),
  support: new Set([
    "help", "issue", "problem", "error", "broken", "not working", "fix",
    "stuck", "technical", "support", "crash", "bug", "fail",
  ]),
  sales: new Set([
    "buy", "purchase", "demo", "trial", "upgrade", "plan", "quote",
    "pricing", "interested", "product", "feature", "enterprise", "license",
  ]),
  complaint: new Set([
    "complaint", "unhappy", "angry", "frustrated", "disappointed", "terrible",
    "awful", "unacceptable", "worst", "hate", "disgusted", "escalate",
    "manager", "sue",
  ]),
};

const SCORED_INTENTS = Object.keys(KEYWORDS) as Exclude<CallerIntent, "general">[];
const CONFIDENCE_THRESHOLD = 0.03;

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

    // Score each non-general intent: 1 point per distinct keyword match
    for (const intent of SCORED_INTENTS) {
      let intentScore = 0;
      for (const keyword of KEYWORDS[intent]) {
        if (lower.includes(keyword)) {
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

export const intentClassifier = new IntentClassifier();
