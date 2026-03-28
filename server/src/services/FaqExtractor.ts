/**
 * FaqExtractor — Extracts question/answer pairs from conversation transcripts.
 *
 * Identifies user turns that contain questions (by trailing "?" or question
 * words) and pairs them with the next assistant turn as the answer context.
 *
 * Usage:
 *   const extractor = new FaqExtractor();
 *   const faqs = extractor.extract(turns);
 */

// ── Types ─────────────────────────────────────────────────────────────

/** A question/answer pair extracted from a conversation transcript. */
export interface ExtractedFaq {
  question: string;
  context: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const QUESTION_WORDS: string[] = [
  "what", "how", "when", "where", "why", "who",
  "can you", "could you", "would you",
  "is there", "do you", "does it", "will it",
];

const MIN_QUESTION_LENGTH = 10;
const MAX_RESULTS = 10;

// ── FaqExtractor ──────────────────────────────────────────────────────

/** Extracts FAQ-style question/answer pairs from user-assistant conversation turns. */
export class FaqExtractor {
  /**
   * Extract question/answer pairs from a conversation transcript.
   *
   * Algorithm:
   * 1. Find user turns ending with "?" or containing question words
   * 2. Pair each with the next assistant turn (if any) as the answer context
   * 3. Filter out questions shorter than 10 chars
   * 4. Deduplicate by case-insensitive first 30 chars of question
   * 5. Return at most 10 results
   */
  extract(
    turns: Array<{ role: "user" | "assistant"; text: string }>,
  ): ExtractedFaq[] {
    const results: ExtractedFaq[] = [];
    const seenPrefixes = new Set<string>();

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.role !== "user") {
        continue;
      }

      if (!this.isQuestion(turn.text)) {
        continue;
      }

      if (turn.text.trim().length < MIN_QUESTION_LENGTH) {
        continue;
      }

      const prefix = turn.text.trim().toLowerCase().slice(0, 30);
      if (seenPrefixes.has(prefix)) {
        continue;
      }
      seenPrefixes.add(prefix);

      const context = this.findNextAssistantTurn(turns, i);
      results.push({
        question: turn.text.trim(),
        context,
      });

      if (results.length >= MAX_RESULTS) {
        break;
      }
    }

    return results;
  }

  /** Check whether a user turn text qualifies as a question. */
  private isQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.endsWith("?")) {
      return true;
    }

    const lower = trimmed.toLowerCase();
    return QUESTION_WORDS.some((qw) => lower.includes(qw));
  }

  /** Find the next assistant turn after the given index. */
  private findNextAssistantTurn(
    turns: Array<{ role: "user" | "assistant"; text: string }>,
    afterIndex: number,
  ): string {
    for (let j = afterIndex + 1; j < turns.length; j++) {
      if (turns[j].role === "assistant") {
        return turns[j].text;
      }
    }
    return "";
  }
}
