/**
 * Storage module exports
 *
 * Provides persistent storage for:
 * - Conversation transcripts
 * - User sessions
 * - Audit events
 */

/** SQLite database adapter and singleton helpers. */
export { DatabaseAdapter, getDatabase, closeDatabase } from "./Database.js";
export type { DatabaseConfig } from "./Database.js";

/** Persistent transcript storage for conversation turns. */
export { TranscriptStore, getTranscriptStore } from "./TranscriptStore.js";
export type { TranscriptEntry, TranscriptTurn } from "./TranscriptStore.js";

/** Cross-session user history and conversation summaries. */
export { SessionHistory, getSessionHistory } from "./SessionHistory.js";
export type {
  User,
  SessionRecord,
  ConversationSummary,
  SessionContext,
} from "./SessionHistory.js";
