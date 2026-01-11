/**
 * Storage module exports
 *
 * Provides persistent storage for:
 * - Conversation transcripts
 * - User sessions
 * - Audit events
 */

export { DatabaseAdapter, getDatabase, closeDatabase } from "./Database.js";
export type { DatabaseConfig } from "./Database.js";

export { TranscriptStore, getTranscriptStore } from "./TranscriptStore.js";
export type { TranscriptEntry, TranscriptTurn } from "./TranscriptStore.js";

export { SessionHistory, getSessionHistory } from "./SessionHistory.js";
export type {
  User,
  SessionRecord,
  ConversationSummary,
  SessionContext,
} from "./SessionHistory.js";
