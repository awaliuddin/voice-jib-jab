/**
 * DtmfDetector — detects DTMF key presses from voice transcript text.
 *
 * In a WebRTC/voice context without raw telephony, callers may say
 * "press 1", "one", "option two", etc. This detector maps spoken
 * words to DTMF digits.
 */

/** Valid DTMF digits: 0-9, *, #. */
export type DtmfDigit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "*" | "#";

/** Result of DTMF detection: whether a digit was found and at what confidence. */
export interface DtmfDetectionResult {
  detected: boolean;
  digit?: DtmfDigit;
  confidence: number;
}

// ── Word → Digit mapping ───────────────────────────────────────────────

const WORD_MAP: Record<string, DtmfDigit> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  star: "*",
  asterisk: "*",
  hash: "#",
  pound: "#",
};

const DIGIT_SET = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#"]);

/** Phrase prefixes that precede a digit or word-digit. */
const PHRASE_PREFIXES = ["press", "option", "number", "choose", "select"];

// ── DtmfDetector ──────────────────────────────────────────────────────

/** Detects DTMF key presses from spoken voice transcript text (e.g. "press 1", "option three"). */
export class DtmfDetector {
  /**
   * Detect a DTMF digit from a voice transcript string.
   *
   * Detection priority:
   *   1. Exact single digit/symbol → confidence 1.0
   *   2. Exact spoken word (e.g. "one") → confidence 1.0
   *   3. Phrase pattern (e.g. "press 1", "option three") → confidence 1.0
   *   4. First digit found anywhere in text (multiple matches) → confidence 0.7
   *   5. Not detected → confidence 0
   *
   * @param text - The transcript string to analyse
   * @returns DtmfDetectionResult
   */
  detect(text: string): DtmfDetectionResult {
    const normalised = text.toLowerCase().trim();

    if (normalised.length === 0) {
      return { detected: false, confidence: 0 };
    }

    // 1. Exact single digit/symbol
    if (DIGIT_SET.has(normalised)) {
      return { detected: true, digit: normalised as DtmfDigit, confidence: 1.0 };
    }

    // 2. Exact spoken word
    if (WORD_MAP[normalised] !== undefined) {
      return { detected: true, digit: WORD_MAP[normalised], confidence: 1.0 };
    }

    const tokens = normalised.split(/\s+/);

    // 3. Phrase patterns: "press 1", "press one", "option two", etc.
    for (let i = 0; i < tokens.length - 1; i++) {
      if (PHRASE_PREFIXES.includes(tokens[i])) {
        const next = tokens[i + 1];
        if (DIGIT_SET.has(next)) {
          return { detected: true, digit: next as DtmfDigit, confidence: 1.0 };
        }
        if (WORD_MAP[next] !== undefined) {
          return { detected: true, digit: WORD_MAP[next], confidence: 1.0 };
        }
      }
    }

    // 4. Scan all tokens for any digit or word-digit — return first found at lower confidence
    const found: DtmfDigit[] = [];
    for (const token of tokens) {
      if (DIGIT_SET.has(token)) {
        found.push(token as DtmfDigit);
      } else if (WORD_MAP[token] !== undefined) {
        found.push(WORD_MAP[token]);
      }
    }

    if (found.length > 0) {
      return { detected: true, digit: found[0], confidence: found.length > 1 ? 0.7 : 1.0 };
    }

    return { detected: false, confidence: 0 };
  }
}
