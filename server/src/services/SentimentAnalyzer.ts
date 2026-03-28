/**
 * SentimentAnalyzer — Keyword-based sentiment classification for voice turns.
 *
 * Scores text against four keyword lists (frustrated, negative, positive, intensifiers)
 * and classifies into one of four labels with a confidence score.
 *
 * Pure function, no external dependencies.
 */

// ── Types ─────────────────────────────────────────────────────────────

/** Discrete sentiment classification labels. */
export type SentimentLabel = "positive" | "neutral" | "negative" | "frustrated";

/** Sentiment analysis output with label, score, confidence, and matched keywords. */
export interface SentimentResult {
  sentiment: SentimentLabel;
  score: number;
  confidence: number;
  keywords: string[];
}

// ── Keyword Lists ─────────────────────────────────────────────────────

const FRUSTRATED_KEYWORDS: readonly string[] = [
  "frustrat", "ridiculous", "unacceptable", "terrible", "awful",
  "horrible", "worst", "useless", "pathetic", "outrageous",
];

const NEGATIVE_KEYWORDS: readonly string[] = [
  "bad", "wrong", "broken", "problem", "issue", "error", "fail",
  "can't", "cannot", "won't", "doesn't work", "not working",
  "unhappy", "disappointed",
];

const POSITIVE_KEYWORDS: readonly string[] = [
  "thank", "great", "excellent", "perfect", "amazing", "wonderful",
  "love", "good", "nice", "appreciate", "helpful", "fantastic",
  "brilliant", "pleased",
];

const INTENSIFIERS: readonly string[] = [
  "very", "really", "extremely", "so", "absolutely",
];

// ── SentimentAnalyzer ─────────────────────────────────────────────────

export class SentimentAnalyzer {
  /** Analyze text and return a sentiment classification with score and confidence. */
  analyze(text: string): SentimentResult {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/);
    const keywords: string[] = [];
    let score = 0;

    const intensifierPositions = this.findIntensifierPositions(words);
    score += this.scoreKeywordList(lower, FRUSTRATED_KEYWORDS, -3, keywords, words, intensifierPositions);
    score += this.scoreKeywordList(lower, NEGATIVE_KEYWORDS, -1, keywords, words, intensifierPositions);
    score += this.scoreKeywordList(lower, POSITIVE_KEYWORDS, 2, keywords, words, intensifierPositions);

    const { sentiment, confidence } = this.classify(score);
    return { sentiment, score, confidence, keywords };
  }

  /** Find word indices that are intensifiers. */
  private findIntensifierPositions(words: string[]): Set<number> {
    const positions = new Set<number>();
    for (let i = 0; i < words.length; i++) {
      if (INTENSIFIERS.some((int) => words[i] === int)) {
        positions.add(i);
      }
    }
    return positions;
  }

  /**
   * Score matches from a keyword list against the lowercased text.
   * Intensifiers before a matched keyword multiply its points by 1.5.
   */
  private scoreKeywordList(
    lower: string,
    keywords: readonly string[],
    basePoints: number,
    matchedKeywords: string[],
    words: string[],
    intensifierPositions: Set<number>,
  ): number {
    let total = 0;

    for (const keyword of keywords) {
      if (!lower.includes(keyword)) continue;

      matchedKeywords.push(keyword);
      let multiplier = 1;

      const kwIndex = this.findKeywordWordIndex(words, keyword);
      if (kwIndex > 0 && intensifierPositions.has(kwIndex - 1)) {
        multiplier = 1.5;
      }

      total += basePoints * multiplier;
    }

    return total;
  }

  /** Find the word index where a keyword starts in the words array. */
  private findKeywordWordIndex(words: string[], keyword: string): number {
    // Multi-word keywords: check joined consecutive words
    const kwWords = keyword.split(/\s+/);
    if (kwWords.length > 1) {
      for (let i = 0; i <= words.length - kwWords.length; i++) {
        const slice = words.slice(i, i + kwWords.length).join(" ");
        if (slice.includes(keyword)) return i;
      }
      return -1;
    }

    // Single-word: find first word that contains the keyword substring
    for (let i = 0; i < words.length; i++) {
      if (words[i].includes(keyword)) return i;
    }
    return -1;
  }

  /** Map a raw score to a sentiment label and confidence. */
  private classify(score: number): { sentiment: SentimentLabel; confidence: number } {
    if (score >= 3) {
      return { sentiment: "positive", confidence: Math.min(score / 6, 1.0) };
    }
    if (score <= -5) {
      return { sentiment: "frustrated", confidence: Math.min(Math.abs(score) / 8, 1.0) };
    }
    if (score <= -2) {
      return { sentiment: "negative", confidence: Math.min(Math.abs(score) / 5, 1.0) };
    }
    return { sentiment: "neutral", confidence: 0.5 };
  }
}
