/**
 * SentimentTracker — Tracks per-session sentiment trajectory over time.
 *
 * Maintains an in-memory timeline of sentiment readings per session,
 * supports escalation detection (consecutive frustrated readings),
 * and provides session summaries.
 */

import type { SentimentLabel, SentimentResult } from "./SentimentAnalyzer.js";

// ── Types ─────────────────────────────────────────────────────────────

/** A single timestamped sentiment measurement within a session. */
export interface SentimentReading {
  timestamp: string;
  sentiment: SentimentLabel;
  score: number;
  turnIndex: number;
}

/** Aggregated sentiment summary for an entire session. */
export interface SessionSentimentSummary {
  sessionId: string;
  readingCount: number;
  dominantSentiment: SentimentLabel;
  averageScore: number;
  escalationTriggered: boolean;
  trajectory: SentimentReading[];
}

// ── Tie-break priority (higher index = higher priority) ───────────────

const TIE_BREAK_PRIORITY: Record<SentimentLabel, number> = {
  neutral: 0,
  positive: 1,
  negative: 2,
  frustrated: 3,
};

// ── SentimentTracker ──────────────────────────────────────────────────

/** Per-session sentiment trajectory tracker with escalation detection. */
export class SentimentTracker {
  private sessions = new Map<string, SentimentReading[]>();

  /** Append a new reading for a session. turnIndex auto-increments. */
  addReading(sessionId: string, result: SentimentResult): void {
    const readings = this.getOrCreateSession(sessionId);
    readings.push({
      timestamp: new Date().toISOString(),
      sentiment: result.sentiment,
      score: result.score,
      turnIndex: readings.length,
    });
  }

  /** Return a copy of readings for a session, or [] if unknown. */
  getReadings(sessionId: string): SentimentReading[] {
    const readings = this.sessions.get(sessionId);
    if (!readings) return [];
    return [...readings];
  }

  /**
   * Returns true if the last 2+ consecutive readings are "frustrated".
   * Returns false for fewer than 2 readings or if the tail is not frustrated.
   */
  shouldEscalate(sessionId: string): boolean {
    const readings = this.sessions.get(sessionId);
    if (!readings || readings.length < 2) return false;

    const last = readings[readings.length - 1];
    const secondLast = readings[readings.length - 2];
    return last.sentiment === "frustrated" && secondLast.sentiment === "frustrated";
  }

  /** Most frequently occurring label. Ties broken: frustrated > negative > positive > neutral. */
  getDominantSentiment(sessionId: string): SentimentLabel {
    const readings = this.sessions.get(sessionId);
    if (!readings || readings.length === 0) return "neutral";

    const counts = new Map<SentimentLabel, number>();
    for (const r of readings) {
      counts.set(r.sentiment, (counts.get(r.sentiment) ?? 0) + 1);
    }

    let dominant: SentimentLabel = "neutral";
    let maxCount = 0;
    for (const [label, count] of counts) {
      if (
        count > maxCount ||
        (count === maxCount && TIE_BREAK_PRIORITY[label] > TIE_BREAK_PRIORITY[dominant])
      ) {
        dominant = label;
        maxCount = count;
      }
    }
    return dominant;
  }

  /** Average score across all readings, or 0 if none. */
  getAverageScore(sessionId: string): number {
    const readings = this.sessions.get(sessionId);
    if (!readings || readings.length === 0) return 0;

    const sum = readings.reduce((acc, r) => acc + r.score, 0);
    return sum / readings.length;
  }

  /** Full session summary with trajectory, dominant sentiment, and escalation flag. */
  getSummary(sessionId: string): SessionSentimentSummary {
    return {
      sessionId,
      readingCount: this.getReadings(sessionId).length,
      dominantSentiment: this.getDominantSentiment(sessionId),
      averageScore: this.getAverageScore(sessionId),
      escalationTriggered: this.shouldEscalate(sessionId),
      trajectory: this.getReadings(sessionId),
    };
  }

  /** Remove all readings for a session. */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Get or initialize the readings array for a session. */
  private getOrCreateSession(sessionId: string): SentimentReading[] {
    let readings = this.sessions.get(sessionId);
    if (!readings) {
      readings = [];
      this.sessions.set(sessionId, readings);
    }
    return readings;
  }
}
