/**
 * LiveKbSearchService — real-time knowledge base search for live sessions.
 *
 * When a caller's final transcript arrives, this service scores all KB entries
 * for the tenant using a token-overlap ratio (TF-IDF-like) and surfaces the
 * most relevant articles to the agent.
 *
 * Scoring: (matching query tokens present in title+content) / (total query tokens)
 * Title matches are weighted 2x relative to body-only matches to surface
 * entries whose question directly matches the caller's phrasing.
 */

import type { KnowledgeBaseStore } from "./KnowledgeBaseStore.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface KbSearchResult {
  entryId: string;
  title: string;
  excerpt: string;    // first N chars of content
  score: number;      // 0-1 relevance score
  category?: string;
}

export interface KbSearchResponse {
  query: string;
  tenantId: string;
  results: KbSearchResult[];
  searchedAt: string;
  durationMs: number;
}

// ── Stop words ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "i", "we", "you", "it",
  "to", "of", "in", "on", "at", "for", "with", "my", "your", "our",
  "can", "do", "does", "did", "have", "has", "had", "be", "been",
  "will", "would", "could", "should", "what", "how", "when", "where",
  "why", "who",
]);

// ── LiveKbSearchService ────────────────────────────────────────────────

export class LiveKbSearchService {
  private maxResults: number;
  private minScore: number;
  private excerptLength: number;

  constructor(
    private kbStore: KnowledgeBaseStore,
    opts?: {
      maxResults?: number;
      minScore?: number;
      excerptLength?: number;
    },
  ) {
    this.maxResults = opts?.maxResults ?? 3;
    this.minScore = opts?.minScore ?? 0.1;
    this.excerptLength = opts?.excerptLength ?? 300;
  }

  /**
   * Search the tenant's knowledge base for entries relevant to the query.
   *
   * Scoring algorithm:
   *   - Tokenize query into non-stop-word terms.
   *   - For each KB entry, check which query tokens appear in the title
   *     (question) and body (answer).
   *   - Title matches count double to prefer entries whose question directly
   *     addresses the caller's phrasing over entries that only mention the
   *     terms in the answer text.
   *   - score = weighted_matches / (queryTokens.length * 2), clamped to [0, 1].
   *   - Entries below minScore are excluded.
   *   - Results are sorted by score descending, limited to maxResults.
   */
  async search(query: string, tenantId: string): Promise<KbSearchResponse> {
    const startMs = Date.now();
    const searchedAt = new Date().toISOString();

    const entries = this.kbStore.listEntries(tenantId);
    const queryTokens = this.tokenize(query);

    let results: KbSearchResult[] = [];

    if (queryTokens.length > 0 && entries.length > 0) {
      for (const entry of entries) {
        const titleTokens = this.tokenize(entry.question);
        const bodyTokens = this.tokenize(entry.answer);

        // Count matching query tokens in title (double weight) and body
        let weightedMatches = 0;
        for (const qt of queryTokens) {
          const inTitle = titleTokens.includes(qt);
          const inBody = bodyTokens.includes(qt);
          if (inTitle) {
            // Title match counts as 2 (title + body weight combined)
            weightedMatches += 2;
          } else if (inBody) {
            weightedMatches += 1;
          }
        }

        // Denominator: each query token can contribute up to 2 (title weight)
        const maxPossibleScore = queryTokens.length * 2;
        const score = maxPossibleScore > 0
          ? Math.min(weightedMatches / maxPossibleScore, 1)
          : 0;

        if (score >= this.minScore) {
          results.push({
            entryId: entry.id,
            title: entry.question,
            excerpt: entry.answer.slice(0, this.excerptLength),
            score,
          });
        }
      }

      // Sort descending by score, then stable by entryId for determinism
      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.entryId.localeCompare(b.entryId);
      });

      results = results.slice(0, this.maxResults);
    }

    return {
      query,
      tenantId,
      results,
      searchedAt,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Extract key search terms from a transcript utterance.
   *
   * Lowercases text, strips punctuation, removes stop words, and returns
   * the remaining tokens joined as a query string.
   */
  extractSearchTerms(text: string): string {
    if (!text) return "";

    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

    return tokens.join(" ");
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Tokenize text into lowercase words, excluding stop words.
   * Unlike extractSearchTerms, this does not join — it returns the token array
   * for use in overlap scoring.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  }
}
