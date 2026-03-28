/**
 * ConversationSummarizer — Generates structured summaries from conversation
 * transcripts including topic extraction, decision/action-item detection,
 * sentiment arc analysis, escalation flags, and notable quotes.
 *
 * Pure computation with no external dependencies or side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────

/** A single conversation turn with role, text, and optional timestamp. */
export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  timestampMs?: number;
}

/** Structured summary: topics, decisions, action items, sentiment arc, escalation, and key quotes. */
export interface ConversationSummary {
  sessionId: string;
  generatedAt: string;
  durationMs: number | null;
  turnCount: number;
  topics: string[];
  decisions: string[];
  actionItems: string[];
  sentimentArc: {
    opening: string;
    middle: string;
    closing: string;
  };
  escalated: boolean;
  keyQuotes: string[];
}

/** Optional inputs for summarization: session duration and pre-computed sentiment readings. */
export interface SummarizeOptions {
  durationMs?: number;
  sentimentReadings?: Array<{ sentiment: string; score: number }>;
}

// ── Constants ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "i", "you", "we",
  "they", "he", "she", "it", "this", "that", "these", "those", "what",
  "which", "who", "when", "where", "how", "why", "and", "or", "but",
  "if", "then", "so", "as", "at", "by", "for", "in", "of", "on", "to",
  "up", "with", "not", "no", "yes", "okay", "just", "like", "get",
  "got", "going", "really", "very", "my", "your", "our",
]);

const DECISION_PATTERNS = [
  "will ", "going to", "decided", "agreed", "confirmed",
  "resolve", "solution", "fixed", "sorted",
];

const ACTION_PATTERNS = [
  "will contact", "will send", "will call", "will email", "will follow",
  "need to", "action item", "follow up", "call back", "send you",
  "reach out", "schedule", "arrange", "book",
];

const POSITIVE_WORDS = ["thank", "great", "good", "excellent", "helpful", "appreciate"];
const NEGATIVE_WORDS = ["frustrated", "bad", "terrible", "wrong", "problem", "issue"];

const ESCALATION_KEYWORDS = ["frustrated", "unacceptable"];

const MAX_TOPICS = 5;
const MAX_DECISIONS = 5;
const MAX_ACTION_ITEMS = 5;
const MAX_KEY_QUOTES = 3;
const MIN_SENTENCE_LENGTH = 10;
const MIN_QUOTE_LENGTH = 20;
const MIN_WORD_LENGTH = 3;

// ── Helpers ───────────────────────────────────────────────────────────

/** Split text into sentences on `. `, `? `, or `! ` boundaries. */
function splitSentences(text: string): string[] {
  return text
    .split(/[.?!]\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Tokenize text into lowercase words, filtering stopwords and short tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w));
}

/** Count word frequencies and return top N. */
function topWords(words: string[], limit: number): string[] {
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

/** Check if a sentence contains any of the given patterns (case-insensitive). */
function matchesAny(sentence: string, patterns: string[]): boolean {
  const lower = sentence.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/** Split an array into three roughly equal slices. */
function splitThirds<T>(items: T[]): [T[], T[], T[]] {
  const len = items.length;
  const oneThird = Math.ceil(len / 3);
  const twoThirds = Math.ceil((len * 2) / 3);
  return [
    items.slice(0, oneThird),
    items.slice(oneThird, twoThirds),
    items.slice(twoThirds),
  ];
}

/** Find the most common string in an array, defaulting to "neutral". */
function mostCommon(values: string[]): string {
  if (values.length === 0) return "neutral";

  const freq = new Map<string, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }

  let best = "neutral";
  let bestCount = 0;
  for (const [val, count] of freq) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

/** Classify text sentiment by counting positive vs negative word hits. */
function classifyText(text: string): string {
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;

  for (const w of POSITIVE_WORDS) {
    if (lower.includes(w)) pos++;
  }
  for (const w of NEGATIVE_WORDS) {
    if (lower.includes(w)) neg++;
  }

  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

// ── ConversationSummarizer ────────────────────────────────────────────

/** Generates structured conversation summaries with topic extraction and sentiment analysis. */
export class ConversationSummarizer {
  /**
   * Generate a structured summary from a conversation transcript.
   *
   * Args:
   *   sessionId: Unique session identifier.
   *   turns: Ordered list of transcript turns.
   *   opts: Optional duration and sentiment readings.
   *
   * Returns:
   *   A ConversationSummary with topics, decisions, action items,
   *   sentiment arc, escalation flag, and key quotes.
   */
  summarize(
    sessionId: string,
    turns: TranscriptTurn[],
    opts?: SummarizeOptions,
  ): ConversationSummary {
    return {
      sessionId,
      generatedAt: new Date().toISOString(),
      durationMs: opts?.durationMs ?? null,
      turnCount: turns.length,
      topics: this.extractTopics(turns),
      decisions: this.extractDecisions(turns),
      actionItems: this.extractActionItems(turns),
      sentimentArc: this.computeSentimentArc(turns, opts?.sentimentReadings),
      escalated: this.detectEscalation(turns, opts?.sentimentReadings),
      keyQuotes: this.extractKeyQuotes(turns),
    };
  }

  // ── Private extraction methods ────────────────────────────────────

  private extractTopics(turns: TranscriptTurn[]): string[] {
    const allText = turns.map((t) => t.text).join(" ");
    const words = tokenize(allText);
    return topWords(words, MAX_TOPICS);
  }

  private extractDecisions(turns: TranscriptTurn[]): string[] {
    const results: string[] = [];

    for (const turn of turns) {
      const sentences = splitSentences(turn.text);
      for (const sentence of sentences) {
        if (
          sentence.length >= MIN_SENTENCE_LENGTH &&
          matchesAny(sentence, DECISION_PATTERNS) &&
          !results.includes(sentence)
        ) {
          results.push(sentence);
          if (results.length >= MAX_DECISIONS) return results;
        }
      }
    }

    return results;
  }

  private extractActionItems(turns: TranscriptTurn[]): string[] {
    const results: string[] = [];

    for (const turn of turns) {
      const sentences = splitSentences(turn.text);
      for (const sentence of sentences) {
        if (
          sentence.length >= MIN_SENTENCE_LENGTH &&
          matchesAny(sentence, ACTION_PATTERNS) &&
          !results.includes(sentence)
        ) {
          results.push(sentence);
          if (results.length >= MAX_ACTION_ITEMS) return results;
        }
      }
    }

    return results;
  }

  private computeSentimentArc(
    turns: TranscriptTurn[],
    readings?: Array<{ sentiment: string; score: number }>,
  ): ConversationSummary["sentimentArc"] {
    if (readings && readings.length > 0) {
      return this.arcFromReadings(readings);
    }
    return this.arcFromText(turns);
  }

  private arcFromReadings(
    readings: Array<{ sentiment: string; score: number }>,
  ): ConversationSummary["sentimentArc"] {
    const [opening, middle, closing] = splitThirds(readings);
    return {
      opening: mostCommon(opening.map((r) => r.sentiment)),
      middle: mostCommon(middle.map((r) => r.sentiment)),
      closing: mostCommon(closing.map((r) => r.sentiment)),
    };
  }

  private arcFromText(
    turns: TranscriptTurn[],
  ): ConversationSummary["sentimentArc"] {
    const userTurns = turns.filter((t) => t.role === "user");
    if (userTurns.length === 0) {
      return { opening: "neutral", middle: "neutral", closing: "neutral" };
    }

    const [opening, middle, closing] = splitThirds(userTurns);
    return {
      opening: classifyText(opening.map((t) => t.text).join(" ")),
      middle: classifyText(middle.map((t) => t.text).join(" ")),
      closing: classifyText(closing.map((t) => t.text).join(" ")),
    };
  }

  private detectEscalation(
    turns: TranscriptTurn[],
    readings?: Array<{ sentiment: string; score: number }>,
  ): boolean {
    if (readings?.some((r) => r.sentiment === "frustrated")) {
      return true;
    }

    return turns
      .filter((t) => t.role === "user")
      .some((t) => {
        const lower = t.text.toLowerCase();
        return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
      });
  }

  private extractKeyQuotes(turns: TranscriptTurn[]): string[] {
    const userSentences: string[] = [];

    for (const turn of turns) {
      if (turn.role !== "user") continue;
      const sentences = splitSentences(turn.text);
      for (const s of sentences) {
        if (s.length > MIN_QUOTE_LENGTH && !userSentences.includes(s)) {
          userSentences.push(s);
        }
      }
    }

    return userSentences
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_KEY_QUOTES);
  }
}
