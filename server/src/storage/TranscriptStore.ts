/**
 * TranscriptStore.ts - Persist conversation transcripts
 *
 * Stores user and assistant turns with full metadata.
 * Supports efficient querying for context retrieval.
 */

import { getDatabase } from "./Database.js";

export interface TranscriptEntry {
  id?: number;
  sessionId: string;
  userId?: string;
  role: "user" | "assistant";
  content: string;
  confidence: number;
  timestampMs: number;
  isFinal: boolean;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
  timestampMs: number;
}

/**
 * TranscriptStore - Manages transcript persistence
 */
export class TranscriptStore {
  private insertStmt: ReturnType<typeof getDatabase>["prepare"] extends (
    sql: string,
  ) => infer R
    ? R
    : never;
  private getBySessionStmt: any;
  private getRecentByUserStmt: any;
  private updateFinalStmt: any;

  constructor() {
    const db = getDatabase();

    // Prepare statements for performance
    this.insertStmt = db.prepare(`
      INSERT INTO transcripts (session_id, user_id, role, content, confidence, timestamp_ms, is_final)
      VALUES (@sessionId, @userId, @role, @content, @confidence, @timestampMs, @isFinal)
    `);

    this.getBySessionStmt = db.prepare(`
      SELECT id, session_id as sessionId, user_id as userId, role, content, confidence,
             timestamp_ms as timestampMs, is_final as isFinal
      FROM transcripts
      WHERE session_id = ?
      ORDER BY timestamp_ms ASC
    `);

    this.getRecentByUserStmt = db.prepare(`
      SELECT t.id, t.session_id as sessionId, t.user_id as userId, t.role, t.content,
             t.confidence, t.timestamp_ms as timestampMs, t.is_final as isFinal
      FROM transcripts t
      INNER JOIN sessions s ON t.session_id = s.id
      WHERE t.user_id = ?
        AND t.is_final = 1
        AND s.started_at > datetime('now', '-7 days')
      ORDER BY t.timestamp_ms DESC
      LIMIT ?
    `);

    this.updateFinalStmt = db.prepare(`
      UPDATE transcripts
      SET content = @content, is_final = 1, confidence = @confidence
      WHERE session_id = @sessionId
        AND role = @role
        AND is_final = 0
        AND id = (
          SELECT id FROM transcripts
          WHERE session_id = @sessionId AND role = @role AND is_final = 0
          ORDER BY timestamp_ms DESC LIMIT 1
        )
    `);
  }

  /**
   * Save a transcript entry
   * For streaming transcripts, only save final entries
   */
  save(entry: TranscriptEntry): number {
    const result = this.insertStmt.run({
      sessionId: entry.sessionId,
      userId: entry.userId || null,
      role: entry.role,
      content: entry.content,
      confidence: entry.confidence,
      timestampMs: entry.timestampMs,
      isFinal: entry.isFinal ? 1 : 0,
    });
    return result.lastInsertRowid as number;
  }

  /**
   * Save or update a streaming transcript
   * Updates the most recent non-final entry for this role,
   * or creates a new entry if none exists
   */
  saveStreaming(entry: TranscriptEntry): number {
    if (entry.isFinal) {
      // For final entries, first try to update existing non-final
      const updated = this.updateFinalStmt.run({
        sessionId: entry.sessionId,
        role: entry.role,
        content: entry.content,
        confidence: entry.confidence,
      });

      if (updated.changes > 0) {
        return 0; // Updated existing
      }
      // No existing non-final entry, create new
      return this.save(entry);
    } else {
      // For non-final entries, always create new
      // Old non-final entries will be cleaned up by updateFinalStmt
      return this.save(entry);
    }
  }

  /**
   * Get all transcripts for a session
   */
  getBySession(sessionId: string): TranscriptEntry[] {
    const rows = this.getBySessionStmt.all(sessionId) as any[];
    return rows.map((row) => ({
      ...row,
      isFinal: row.isFinal === 1,
    }));
  }

  /**
   * Get final transcripts for a session (excludes streaming deltas)
   */
  getFinalBySession(sessionId: string): TranscriptEntry[] {
    return this.getBySession(sessionId).filter((t) => t.isFinal);
  }

  /**
   * Get recent transcripts for a user across all sessions
   * @param userId User ID
   * @param limit Maximum number of entries to return
   */
  getRecentByUser(userId: string, limit: number = 50): TranscriptEntry[] {
    const rows = this.getRecentByUserStmt.all(userId, limit) as any[];
    return rows.map((row) => ({
      ...row,
      isFinal: row.isFinal === 1,
    }));
  }

  /**
   * Get conversation turns for a user (grouped exchanges)
   * Returns turns in chronological order
   */
  getConversationHistory(
    userId: string,
    maxTurns: number = 20,
  ): TranscriptTurn[] {
    // Get recent transcripts and reverse to get chronological order
    const transcripts = this.getRecentByUser(userId, maxTurns * 2).reverse();

    // Convert to turns
    return transcripts.map((t) => ({
      role: t.role,
      content: t.content,
      timestampMs: t.timestampMs,
    }));
  }

  /**
   * Build a conversation summary for context injection
   * Returns a string suitable for system prompts
   */
  buildContextSummary(userId: string, maxTurns: number = 10): string {
    const history = this.getConversationHistory(userId, maxTurns);

    if (history.length === 0) {
      return "";
    }

    // Group by session if possible
    let summary = "Previous conversation history:\n";

    for (const turn of history) {
      const prefix = turn.role === "user" ? "User" : "Assistant";
      // Truncate long messages
      const content =
        turn.content.length > 200
          ? turn.content.substring(0, 200) + "..."
          : turn.content;
      summary += `${prefix}: ${content}\n`;
    }

    return summary.trim();
  }

  /**
   * Get transcript count for a session
   */
  getSessionTurnCount(sessionId: string): number {
    const db = getDatabase();
    const result = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM transcripts
      WHERE session_id = ? AND is_final = 1
    `,
      )
      .get(sessionId) as { count: number };
    return result.count;
  }

  /**
   * Delete non-final transcripts for a session (cleanup)
   */
  cleanupNonFinal(sessionId: string): number {
    const db = getDatabase();
    const result = db
      .prepare(
        `
      DELETE FROM transcripts
      WHERE session_id = ? AND is_final = 0
    `,
      )
      .run(sessionId);
    return result.changes;
  }
}

// Singleton instance
let instance: TranscriptStore | null = null;

export function getTranscriptStore(): TranscriptStore {
  if (!instance) {
    instance = new TranscriptStore();
  }
  return instance;
}
