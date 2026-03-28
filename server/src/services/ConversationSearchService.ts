/**
 * ConversationSearchService — in-memory full-text search over session transcripts.
 *
 * Works on top of SessionRecorder's disk-persisted recordings. No separate
 * index is maintained; all filtering is performed at query time over the
 * data that SessionRecorder already stores.
 */

import type { SessionRecorder } from "./SessionRecorder.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Query filters for searching session transcripts (keyword, speaker, date range, sentiment). */
export interface SearchFilters {
  /** Substring match on transcript text (case-insensitive). */
  keyword?: string;
  /** Filter by which speaker produced the turn. */
  speaker?: "user" | "assistant" | "both";
  /** Filter by tenant. */
  tenantId?: string;
  /** ISO date — include sessions whose startedAt >= from. */
  from?: string;
  /** ISO date — include sessions whose startedAt <= to. */
  to?: string;
  /** Dominant sentiment of the session (from summary). */
  sentiment?: string;
  /** Policy decision that appears in the session. */
  policyDecision?: string;
  /** Maximum hits to return (default 20, max 100). */
  limit?: number;
  /** Number of hits to skip (default 0). */
  offset?: number;
}

/** A single transcript match with session context and optional keyword highlight. */
export interface TranscriptHit {
  sessionId: string;
  tenantId?: string;
  startedAt: string;
  endedAt?: string;
  speaker: "user" | "assistant";
  /** The matching transcript segment text. */
  text: string;
  /** Millisecond offset from the start of the session. */
  timestamp: number;
  sentiment?: string;
  /** The keyword that produced this match (if a keyword filter was applied). */
  matchedKeyword?: string;
}

/** Paginated search result containing total count and matching transcript hits. */
export interface ConversationSearchResult {
  total: number;
  limit: number;
  offset: number;
  hits: TranscriptHit[];
}

/** High-level summary of a session: turn count, sentiment, policy decisions, and preview. */
export interface SessionSummary {
  sessionId: string;
  tenantId?: string;
  startedAt: string;
  endedAt?: string;
  turnCount: number;
  topSentiment?: string;
  /** Unique policy decision values that appeared in the session. */
  policyDecisions: string[];
  /** First 200 characters of the first user utterance. */
  transcriptPreview: string;
}

// ---------------------------------------------------------------------------
// ConversationSearchService
// ---------------------------------------------------------------------------

/** In-memory full-text search over SessionRecorder transcripts with filtering and pagination. */
export class ConversationSearchService {
  constructor(private readonly recorder: SessionRecorder) {}

  /**
   * Search session transcripts using the provided filters.
   *
   * The search:
   *   1. Lists all session metadata from SessionRecorder.
   *   2. Filters sessions by tenantId, date range, sentiment, and policyDecision
   *      at the session level (avoids loading the full timeline unnecessarily).
   *   3. For sessions that survive session-level filters, loads the full
   *      recording and extracts transcript events.
   *   4. Filters transcript events by speaker type and keyword.
   *   5. Applies limit/offset to the collected hits.
   */
  async search(filters: SearchFilters): Promise<ConversationSearchResult> {
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;

    const fromMs = filters.from ? new Date(filters.from).getTime() : undefined;
    const toMs = filters.to ? new Date(filters.to).getTime() : undefined;
    const keywordLower = filters.keyword ? filters.keyword.toLowerCase() : undefined;

    // Determine which speaker types we include
    const includeSpeaker = this.resolveSpeakerFilter(filters.speaker ?? "both");

    const sessionMetas = this.recorder.listRecordings();

    const allHits: TranscriptHit[] = [];

    for (const meta of sessionMetas) {
      // --- Session-level filters (no timeline needed) ---

      if (filters.tenantId !== undefined && meta.tenantId !== filters.tenantId) {
        continue;
      }

      const sessionStartMs = new Date(meta.startedAt).getTime();

      if (fromMs !== undefined && sessionStartMs < fromMs) {
        continue;
      }

      if (toMs !== undefined && sessionStartMs > toMs) {
        continue;
      }

      // Sentiment filter: check session-level dominant sentiment summary
      if (filters.sentiment !== undefined) {
        const dominantSentiment = meta.summary.sentiment?.dominantSentiment;
        if (dominantSentiment !== filters.sentiment) {
          continue;
        }
      }

      // Policy decision filter: check if the decision appears in the session summary
      if (filters.policyDecision !== undefined) {
        const decisionsMap = meta.summary.policyDecisions as Record<string, number>;
        const count = decisionsMap[filters.policyDecision] ?? 0;
        if (count === 0) {
          continue;
        }
      }

      // --- Load full timeline for transcript extraction ---
      const recording = this.recorder.loadRecording(meta.sessionId);
      if (!recording) {
        continue;
      }

      const sessionSentiment = recording.summary.sentiment?.dominantSentiment;

      for (const entry of recording.timeline) {
        const speaker = this.entryToSpeaker(entry.type);
        if (!speaker) {
          continue;
        }

        // Speaker filter
        if (!includeSpeaker.includes(speaker)) {
          continue;
        }

        const payload = entry.payload as Record<string, unknown> | undefined;
        const text = typeof payload?.text === "string" ? payload.text : undefined;
        if (!text) {
          continue;
        }

        // Keyword filter
        if (keywordLower !== undefined && !text.toLowerCase().includes(keywordLower)) {
          continue;
        }

        const hit: TranscriptHit = {
          sessionId: recording.sessionId,
          tenantId: recording.tenantId ?? undefined,
          startedAt: recording.startedAt,
          endedAt: recording.endedAt ?? undefined,
          speaker,
          text,
          timestamp: entry.t_ms,
          sentiment: sessionSentiment,
        };

        if (keywordLower !== undefined) {
          hit.matchedKeyword = filters.keyword;
        }

        allHits.push(hit);
      }
    }

    const total = allHits.length;
    const hits = allHits.slice(offset, offset + limit);

    return { total, limit, offset, hits };
  }

  /**
   * Build a structured summary of a single session.
   *
   * Returns null when the session recording does not exist on disk.
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    const recording = this.recorder.loadRecording(sessionId);
    if (!recording) {
      return null;
    }

    // Collect unique policy decisions that were actually used
    const policyDecisionsMap = recording.summary.policyDecisions as Record<string, number>;
    const policyDecisions = Object.entries(policyDecisionsMap)
      .filter(([, count]) => count > 0)
      .map(([decision]) => decision);

    // Find the first user utterance for the transcript preview
    let transcriptPreview = "";
    for (const entry of recording.timeline) {
      if (entry.type !== "user_transcript") {
        continue;
      }
      const payload = entry.payload as Record<string, unknown> | undefined;
      const text = typeof payload?.text === "string" ? payload.text : undefined;
      if (text) {
        transcriptPreview = text.slice(0, 200);
        break;
      }
    }

    // Derive topSentiment from the dominant sentiment in the summary
    const topSentiment = recording.summary.sentiment?.dominantSentiment;

    return {
      sessionId: recording.sessionId,
      tenantId: recording.tenantId ?? undefined,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt ?? undefined,
      turnCount: recording.summary.turnCount,
      topSentiment,
      policyDecisions,
      transcriptPreview,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Map a timeline entry type to a speaker, or return null if not a transcript.
   *
   * - "user_transcript" → user
   * - "transcript" or "transcript.final" → assistant
   */
  private entryToSpeaker(type: string): "user" | "assistant" | null {
    if (type === "user_transcript") {
      return "user";
    }
    if (type === "transcript" || type === "transcript.final") {
      return "assistant";
    }
    return null;
  }

  /**
   * Return the set of speaker values to include for a given speaker filter.
   */
  private resolveSpeakerFilter(speaker: "user" | "assistant" | "both"): Array<"user" | "assistant"> {
    if (speaker === "user") return ["user"];
    if (speaker === "assistant") return ["assistant"];
    return ["user", "assistant"];
  }
}
