/**
 * SessionHistory.ts - User identity tracking and session history
 *
 * Manages:
 * - User identification via fingerprint
 * - Session records linked to users
 * - Cross-session context retrieval
 * - Conversation summaries for new sessions
 */

import { v4 as uuidv4 } from "uuid";
import { getDatabase } from "./Database.js";
import { getTranscriptStore } from "./TranscriptStore.js";

export interface User {
  id: string;
  fingerprint: string;
  createdAt: string;
  lastSeenAt: string;
  metadata: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  metadata: Record<string, unknown>;
}

export interface ConversationSummary {
  id: number;
  userId: string;
  summary: string;
  turnCount: number;
  fromSessionId: string;
  toSessionId: string | null;
  createdAt: string;
}

export interface SessionContext {
  userId: string;
  isReturningUser: boolean;
  previousSessionCount: number;
  lastSessionEndedAt: string | null;
  conversationSummary: string;
  recentHistory: Array<{
    role: "user" | "assistant";
    content: string;
    timestampMs: number;
  }>;
}

/**
 * SessionHistory - Manages user sessions and conversation history
 */
export class SessionHistory {
  // Prepared statements
  private findUserByFingerprintStmt: any;
  private createUserStmt: any;
  private updateUserLastSeenStmt: any;
  private createSessionStmt: any;
  private endSessionStmt: any;
  private linkSessionToUserStmt: any;
  private getUserSessionsStmt: any;
  private getLastSummaryStmt: any;
  private saveSummaryStmt: any;
  private getSessionStmt: any;

  constructor() {
    const db = getDatabase();

    // User queries
    this.findUserByFingerprintStmt = db.prepare(`
      SELECT id, fingerprint, created_at as createdAt, last_seen_at as lastSeenAt, metadata
      FROM users WHERE fingerprint = ?
    `);

    this.createUserStmt = db.prepare(`
      INSERT INTO users (id, fingerprint, metadata)
      VALUES (@id, @fingerprint, @metadata)
    `);

    this.updateUserLastSeenStmt = db.prepare(`
      UPDATE users SET last_seen_at = datetime('now') WHERE id = ?
    `);

    // Session queries
    this.createSessionStmt = db.prepare(`
      INSERT INTO sessions (id, user_id, metadata)
      VALUES (@id, @userId, @metadata)
      ON CONFLICT(id) DO UPDATE SET
        user_id = COALESCE(excluded.user_id, sessions.user_id),
        metadata = excluded.metadata
    `);

    this.endSessionStmt = db.prepare(`
      UPDATE sessions
      SET ended_at = datetime('now'), end_reason = @endReason
      WHERE id = @id
    `);

    this.linkSessionToUserStmt = db.prepare(`
      UPDATE sessions SET user_id = ? WHERE id = ?
    `);

    this.getUserSessionsStmt = db.prepare(`
      SELECT id, user_id as userId, started_at as startedAt,
             ended_at as endedAt, end_reason as endReason, metadata
      FROM sessions
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    this.getSessionStmt = db.prepare(`
      SELECT id, user_id as userId, started_at as startedAt,
             ended_at as endedAt, end_reason as endReason, metadata
      FROM sessions WHERE id = ?
    `);

    // Summary queries
    this.getLastSummaryStmt = db.prepare(`
      SELECT id, user_id as userId, summary, turn_count as turnCount,
             from_session_id as fromSessionId, to_session_id as toSessionId,
             created_at as createdAt
      FROM conversation_summaries
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    this.saveSummaryStmt = db.prepare(`
      INSERT INTO conversation_summaries (user_id, summary, turn_count, from_session_id, to_session_id)
      VALUES (@userId, @summary, @turnCount, @fromSessionId, @toSessionId)
    `);
  }

  /**
   * Get or create a user by fingerprint
   * @param fingerprint Unique client identifier (browser fingerprint, device ID, etc.)
   * @param metadata Optional metadata to store with user
   */
  getOrCreateUser(
    fingerprint: string,
    metadata: Record<string, unknown> = {},
  ): User {
    // Try to find existing user
    const existing = this.findUserByFingerprintStmt.get(fingerprint) as
      | any
      | undefined;

    if (existing) {
      // Update last seen
      this.updateUserLastSeenStmt.run(existing.id);
      return {
        ...existing,
        metadata: JSON.parse(existing.metadata || "{}"),
      };
    }

    // Create new user
    const userId = uuidv4();
    this.createUserStmt.run({
      id: userId,
      fingerprint,
      metadata: JSON.stringify(metadata),
    });

    console.log(`[SessionHistory] Created new user: ${userId}`);

    return {
      id: userId,
      fingerprint,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      metadata,
    };
  }

  /**
   * Record a new session
   */
  recordSession(
    sessionId: string,
    userId: string | null = null,
    metadata: Record<string, unknown> = {},
  ): void {
    this.createSessionStmt.run({
      id: sessionId,
      userId,
      metadata: JSON.stringify(metadata),
    });
    console.log(
      `[SessionHistory] Recorded session: ${sessionId} (user: ${userId || "anonymous"})`,
    );
  }

  /**
   * Link a session to a user (after identification)
   */
  linkSessionToUser(sessionId: string, userId: string): void {
    this.linkSessionToUserStmt.run(userId, sessionId);
    console.log(
      `[SessionHistory] Linked session ${sessionId} to user ${userId}`,
    );
  }

  /**
   * Mark a session as ended
   */
  endSession(sessionId: string, reason: string): void {
    this.endSessionStmt.run({
      id: sessionId,
      endReason: reason,
    });
    console.log(`[SessionHistory] Ended session: ${sessionId} (${reason})`);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionRecord | null {
    const row = this.getSessionStmt.get(sessionId) as any | undefined;
    if (!row) return null;

    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  /**
   * Get a user's recent sessions
   */
  getUserSessions(userId: string, limit: number = 10): SessionRecord[] {
    const rows = this.getUserSessionsStmt.all(userId, limit) as any[];
    return rows.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
    }));
  }

  /**
   * Get session context for a user starting a new session
   * This is the key method for cross-session memory
   */
  getSessionContext(userId: string, currentSessionId: string): SessionContext {
    const transcriptStore = getTranscriptStore();

    // Get user's previous sessions
    const sessions = this.getUserSessions(userId, 10);
    const previousSessions = sessions.filter((s) => s.id !== currentSessionId);

    // Get last conversation summary
    const lastSummary = this.getLastSummaryStmt.get(userId) as any | undefined;

    // Get recent conversation history
    const recentHistory = transcriptStore.getConversationHistory(userId, 10);

    // Build context summary
    let conversationSummary = "";

    if (lastSummary?.summary) {
      conversationSummary = lastSummary.summary;
    }

    // Append very recent history that might not be in summary
    if (recentHistory.length > 0) {
      const historyText = transcriptStore.buildContextSummary(userId, 5);
      if (historyText && !conversationSummary.includes(historyText)) {
        conversationSummary = conversationSummary
          ? `${conversationSummary}\n\nMost recent exchanges:\n${historyText}`
          : historyText;
      }
    }

    const lastSession = previousSessions[0];

    return {
      userId,
      isReturningUser: previousSessions.length > 0,
      previousSessionCount: previousSessions.length,
      lastSessionEndedAt: lastSession?.endedAt || null,
      conversationSummary,
      recentHistory,
    };
  }

  /**
   * Save a conversation summary for a session
   * Called when session ends to preserve context for future sessions
   */
  saveConversationSummary(
    userId: string,
    sessionId: string,
    summary: string,
    turnCount: number,
  ): void {
    this.saveSummaryStmt.run({
      userId,
      summary,
      turnCount,
      fromSessionId: sessionId,
      toSessionId: null,
    });
    console.log(
      `[SessionHistory] Saved conversation summary for user ${userId} (${turnCount} turns)`,
    );
  }

  /**
   * Generate a conversation summary from session transcripts
   * This is a simple heuristic-based summary - could be enhanced with LLM
   */
  generateSessionSummary(sessionId: string): string {
    const transcriptStore = getTranscriptStore();
    const transcripts = transcriptStore.getFinalBySession(sessionId);

    if (transcripts.length === 0) {
      return "";
    }

    // Extract key topics and responses
    const userMessages = transcripts
      .filter((t) => t.role === "user")
      .map((t) => t.content);

    const assistantMessages = transcripts
      .filter((t) => t.role === "assistant")
      .map((t) => t.content);

    // Build a simple summary
    const topics: string[] = [];

    // Extract first few user intents
    for (const msg of userMessages.slice(0, 5)) {
      // Truncate long messages
      const truncated = msg.length > 100 ? msg.substring(0, 100) + "..." : msg;
      topics.push(`User asked: "${truncated}"`);
    }

    // Add key assistant responses
    for (const msg of assistantMessages.slice(0, 3)) {
      const truncated = msg.length > 150 ? msg.substring(0, 150) + "..." : msg;
      topics.push(`Assistant explained: "${truncated}"`);
    }

    return topics.join("\n");
  }

  /**
   * Get count of total transcripts for a user
   */
  getUserTranscriptCount(userId: string): number {
    const db = getDatabase();
    const result = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM transcripts
      WHERE user_id = ? AND is_final = 1
    `,
      )
      .get(userId) as { count: number };
    return result.count;
  }
}

// Singleton instance
let instance: SessionHistory | null = null;

export function getSessionHistory(): SessionHistory {
  if (!instance) {
    instance = new SessionHistory();
  }
  return instance;
}
