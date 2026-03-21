/**
 * IntentClassifier — property-based tests (N-48 CRUCIBLE oracle gap)
 *
 * These tests use fast-check to verify mathematical invariants that hold
 * for ALL inputs, not just hand-picked examples. They complement the
 * existing example-based tests in IntentDetection.test.ts.
 *
 * Properties verified:
 *   P1: confidence is always in [0, 1]
 *   P2: fallback iff intent === "general"
 *   P3: fallback is set when confidence < CONFIDENCE_THRESHOLD (0.03)
 *   P4: scores are all non-negative integers
 *   P5: general score is always 0 (not keyword-scored)
 *   P6: classify("") returns general fallback
 *   P7: prepending whitespace does not change intent or confidence
 *   P8: scores[winner] ≥ scores[any other intent] when not fallback
 *   P9: adding a billing keyword to an empty string pushes confidence > 0
 *  P10: classify is deterministic (same input → same output)
 */

import * as fc from "fast-check";
import { IntentClassifier, type CallerIntent } from "../../services/IntentClassifier.js";

const classifier = new IntentClassifier();

const ALL_INTENTS: CallerIntent[] = ["billing", "support", "sales", "complaint", "general"];
const NON_GENERAL_INTENTS: Exclude<CallerIntent, "general">[] = [
  "billing",
  "support",
  "sales",
  "complaint",
];

// ── Helpers ────────────────────────────────────────────────────────────

/** Arbitrary that generates any string (including empty, unicode, newlines). */
const anyString = fc.string({ minLength: 0, maxLength: 500 });

/** Arbitrary that generates non-empty strings with at least one word character. */
const wordyString = fc.string({ minLength: 1, maxLength: 300 }).filter(
  (s) => /\w/.test(s),
);

// ── Property tests ─────────────────────────────────────────────────────

describe("IntentClassifier — property-based tests (fast-check)", () => {
  // P1: confidence ∈ [0, 1] for all inputs
  it("P1: confidence is always in [0, 1]", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const { confidence } = classifier.classify(text);
        return confidence >= 0 && confidence <= 1;
      }),
      { numRuns: 500 },
    );
  });

  // P2: fallback iff intent === "general"
  it("P2: fallback is true iff intent is 'general'", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const { intent, fallback } = classifier.classify(text);
        return fallback === (intent === "general");
      }),
      { numRuns: 500 },
    );
  });

  // P3: low confidence always triggers fallback
  it("P3: when confidence < 0.03, fallback is true", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const { confidence, fallback } = classifier.classify(text);
        if (confidence < 0.03) {
          return fallback === true;
        }
        return true; // property vacuously holds for higher-confidence inputs
      }),
      { numRuns: 500 },
    );
  });

  // P4: all scores are non-negative integers
  it("P4: all intent scores are non-negative integers", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const { scores } = classifier.classify(text);
        return ALL_INTENTS.every(
          (intent) =>
            Number.isInteger(scores[intent]) && scores[intent] >= 0,
        );
      }),
      { numRuns: 500 },
    );
  });

  // P5: the "general" bucket is never keyword-scored (always 0)
  it("P5: scores.general is always 0 (not a keyword-scored intent)", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const { scores } = classifier.classify(text);
        return scores.general === 0;
      }),
      { numRuns: 500 },
    );
  });

  // P6: empty string always falls back to general
  it("P6: empty string always returns general fallback", () => {
    const result = classifier.classify("");
    expect(result.intent).toBe("general");
    expect(result.fallback).toBe(true);
    expect(result.confidence).toBe(0);
  });

  // P7: leading/trailing whitespace does not change intent or confidence
  it("P7: whitespace padding does not change classification outcome", () => {
    fc.assert(
      fc.property(wordyString, (text) => {
        const base = classifier.classify(text);
        const padded = classifier.classify(`   ${text}   `);
        return base.intent === padded.intent && base.confidence === padded.confidence;
      }),
      { numRuns: 200 },
    );
  });

  // P8: when not fallback, winner has the highest score
  it("P8: when not fallback, winning intent has the max score", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const { intent, scores, fallback } = classifier.classify(text);
        if (fallback) return true; // vacuously true for fallback cases
        const winnerScore = scores[intent];
        return NON_GENERAL_INTENTS.every((i) => winnerScore >= scores[i]);
      }),
      { numRuns: 500 },
    );
  });

  // P9: adding a known billing keyword to text raises billing score above 0
  it("P9: injecting a billing keyword raises the billing score above 0", () => {
    fc.assert(
      fc.property(anyString, (prefix) => {
        const text = `${prefix} invoice payment`;
        const { scores } = classifier.classify(text);
        return scores.billing > 0;
      }),
      { numRuns: 200 },
    );
  });

  // P10: classify is deterministic
  it("P10: classify is deterministic — same input always produces same output", () => {
    fc.assert(
      fc.property(anyString, (text) => {
        const a = classifier.classify(text);
        const b = classifier.classify(text);
        return (
          a.intent === b.intent &&
          a.confidence === b.confidence &&
          a.fallback === b.fallback &&
          ALL_INTENTS.every((i) => a.scores[i] === b.scores[i])
        );
      }),
      { numRuns: 300 },
    );
  });

  // P11: score for each non-general intent ≤ keyword count for that intent
  it("P11: intent score never exceeds the keyword count for that intent", () => {
    // billing has 13 keywords, support 13, sales 13, complaint 14
    const MAX_SCORES: Record<Exclude<CallerIntent, "general">, number> = {
      billing: 13,
      support: 13,
      sales: 13,
      complaint: 14,
    };
    fc.assert(
      fc.property(anyString, (text) => {
        const { scores } = classifier.classify(text);
        return NON_GENERAL_INTENTS.every(
          (intent) => scores[intent] <= MAX_SCORES[intent],
        );
      }),
      { numRuns: 500 },
    );
  });

  // P12: confidence = 0 when text has no word characters
  it("P12: text with no word characters yields confidence 0 and general fallback", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(" ", "\t", "\n", "!", "@", "#", "."), {
          minLength: 0,
          maxLength: 50,
        }).map((chars) => chars.join("")),
        (text: string) => {
          const { confidence, fallback } = classifier.classify(text);
          return confidence === 0 && fallback === true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
