/**
 * TranscriptStore Unit Tests
 *
 * Tests the TranscriptStore class which manages transcript persistence
 * using prepared SQLite statements. Covers CRUD operations, streaming
 * transcript lifecycle, session-scoped queries, user-scoped queries,
 * context summary generation, and cleanup.
 *
 * Each test gets a fresh in-memory SQLite database via the singleton
 * reset pattern (closeDatabase -> getDatabase with :memory:).
 */

import { getDatabase, closeDatabase } from "../../storage/Database.js";
import {
  TranscriptStore,
  TranscriptEntry,
} from "../../storage/TranscriptStore.js";

// Suppress console.log noise from Database initialization
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("TranscriptStore", () => {
  let store: TranscriptStore;

  beforeEach(() => {
    closeDatabase();
    getDatabase({ path: ":memory:", walMode: false });
    store = new TranscriptStore();

    // Seed parent rows required by foreign key constraints
    const db = getDatabase();
    db.prepare("INSERT INTO users (id, fingerprint) VALUES (?, ?)").run(
      "user-1",
      "fp-1",
    );
    db.prepare("INSERT INTO users (id, fingerprint) VALUES (?, ?)").run(
      "user-2",
      "fp-2",
    );
    db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(
      "session-1",
      "user-1",
    );
    db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(
      "session-2",
      "user-1",
    );
    db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(
      "session-3",
      "user-2",
    );
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("save()", () => {
    it("should insert a transcript entry and return the row id", () => {
      const entry: TranscriptEntry = {
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hello, how are you?",
        confidence: 0.95,
        timestampMs: Date.now(),
        isFinal: true,
      };

      const id = store.save(entry);

      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("should persist the entry to the database", () => {
      const now = Date.now();
      const entry: TranscriptEntry = {
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "I am doing well, thanks!",
        confidence: 1.0,
        timestampMs: now,
        isFinal: true,
      };

      store.save(entry);

      const db = getDatabase();
      const row = db
        .prepare("SELECT * FROM transcripts WHERE session_id = ?")
        .get("session-1") as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.role).toBe("assistant");
      expect(row.content).toBe("I am doing well, thanks!");
      expect(row.confidence).toBe(1.0);
      expect(row.timestamp_ms).toBe(now);
      expect(row.is_final).toBe(1);
    });

    it("should allow null userId", () => {
      const entry: TranscriptEntry = {
        sessionId: "session-1",
        role: "user",
        content: "Anonymous message",
        confidence: 0.8,
        timestampMs: Date.now(),
        isFinal: true,
      };

      const id = store.save(entry);

      expect(id).toBeGreaterThan(0);

      const db = getDatabase();
      const row = db
        .prepare("SELECT user_id FROM transcripts WHERE id = ?")
        .get(id) as { user_id: string | null };

      expect(row.user_id).toBeNull();
    });

    it("should store isFinal=false as integer 0", () => {
      const entry: TranscriptEntry = {
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Partial transcript...",
        confidence: 0.5,
        timestampMs: Date.now(),
        isFinal: false,
      };

      const id = store.save(entry);

      const db = getDatabase();
      const row = db
        .prepare("SELECT is_final FROM transcripts WHERE id = ?")
        .get(id) as { is_final: number };

      expect(row.is_final).toBe(0);
    });
  });

  describe("getBySession()", () => {
    it("should retrieve all entries for a session ordered by timestamp", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "First message",
        confidence: 0.9,
        timestampMs: baseTime,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "First response",
        confidence: 1.0,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Second message",
        confidence: 0.85,
        timestampMs: baseTime + 200,
        isFinal: true,
      });

      const entries = store.getBySession("session-1");

      expect(entries).toHaveLength(3);
      expect(entries[0].content).toBe("First message");
      expect(entries[1].content).toBe("First response");
      expect(entries[2].content).toBe("Second message");
    });

    it("should return empty array for a session with no transcripts", () => {
      const entries = store.getBySession("session-2");

      expect(entries).toEqual([]);
    });

    it("should not return entries from other sessions", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Session 1 message",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      store.save({
        sessionId: "session-2",
        userId: "user-1",
        role: "user",
        content: "Session 2 message",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      const entries = store.getBySession("session-1");

      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("Session 1 message");
    });

    it("should convert isFinal integer to boolean", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Final entry",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Non-final entry",
        confidence: 0.5,
        timestampMs: Date.now() + 1,
        isFinal: false,
      });

      const entries = store.getBySession("session-1");

      expect(entries[0].isFinal).toBe(true);
      expect(entries[1].isFinal).toBe(false);
    });
  });

  describe("saveStreaming()", () => {
    it("should create a new entry for non-final streaming data", () => {
      const id = store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Partial...",
        confidence: 0.3,
        timestampMs: Date.now(),
        isFinal: false,
      });

      expect(id).toBeGreaterThan(0);

      const entries = store.getBySession("session-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].isFinal).toBe(false);
    });

    it("should update existing non-final entry when final arrives", () => {
      const baseTime = Date.now();

      // First: non-final partial
      store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hel...",
        confidence: 0.3,
        timestampMs: baseTime,
        isFinal: false,
      });

      // Then: final version that should update the non-final
      const id = store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hello, world!",
        confidence: 0.95,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      // Return value 0 means it updated an existing row
      expect(id).toBe(0);

      // The non-final entry should have been updated to final
      const entries = store.getBySession("session-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("Hello, world!");
      expect(entries[0].isFinal).toBe(true);
    });

    it("should create new final entry when no non-final exists to update", () => {
      const id = store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Direct final message",
        confidence: 0.95,
        timestampMs: Date.now(),
        isFinal: true,
      });

      // Should create a new entry (id > 0) since there was no non-final to update
      expect(id).toBeGreaterThan(0);

      const entries = store.getBySession("session-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("Direct final message");
      expect(entries[0].isFinal).toBe(true);
    });

    it("should handle multiple non-final updates followed by a final", () => {
      const baseTime = Date.now();

      // Multiple non-final partials (each creates a new row)
      store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "H...",
        confidence: 0.2,
        timestampMs: baseTime,
        isFinal: false,
      });

      store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hel...",
        confidence: 0.4,
        timestampMs: baseTime + 50,
        isFinal: false,
      });

      // Final version: updates the most recent non-final (by timestamp)
      store.saveStreaming({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hello!",
        confidence: 0.95,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      // There should be 2 entries: the first non-final (unchanged) +
      // the second non-final (updated to final "Hello!")
      const entries = store.getBySession("session-1");
      const finalEntries = entries.filter((e) => e.isFinal);
      expect(finalEntries).toHaveLength(1);
      expect(finalEntries[0].content).toBe("Hello!");
    });
  });

  describe("getFinalBySession()", () => {
    it("should return only final entries for a session", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Non-final partial",
        confidence: 0.3,
        timestampMs: baseTime,
        isFinal: false,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Final message",
        confidence: 0.95,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "Final response",
        confidence: 1.0,
        timestampMs: baseTime + 200,
        isFinal: true,
      });

      const finalEntries = store.getFinalBySession("session-1");

      expect(finalEntries).toHaveLength(2);
      expect(finalEntries.every((e) => e.isFinal)).toBe(true);
      expect(finalEntries[0].content).toBe("Final message");
      expect(finalEntries[1].content).toBe("Final response");
    });

    it("should return empty array when session has only non-final entries", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Still streaming...",
        confidence: 0.3,
        timestampMs: Date.now(),
        isFinal: false,
      });

      const finalEntries = store.getFinalBySession("session-1");

      expect(finalEntries).toEqual([]);
    });
  });

  describe("getRecentByUser()", () => {
    it("should return recent final entries for a user across sessions", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Session 1 message",
        confidence: 0.9,
        timestampMs: baseTime,
        isFinal: true,
      });

      store.save({
        sessionId: "session-2",
        userId: "user-1",
        role: "user",
        content: "Session 2 message",
        confidence: 0.9,
        timestampMs: baseTime + 1000,
        isFinal: true,
      });

      const recent = store.getRecentByUser("user-1", 10);

      expect(recent).toHaveLength(2);
      // Ordered DESC by timestamp, so session-2 message comes first
      expect(recent[0].content).toBe("Session 2 message");
      expect(recent[1].content).toBe("Session 1 message");
    });

    it("should exclude non-final entries", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Final message",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Non-final partial",
        confidence: 0.3,
        timestampMs: Date.now() + 1,
        isFinal: false,
      });

      const recent = store.getRecentByUser("user-1", 10);

      expect(recent).toHaveLength(1);
      expect(recent[0].content).toBe("Final message");
    });

    it("should respect the limit parameter", () => {
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        store.save({
          sessionId: "session-1",
          userId: "user-1",
          role: "user",
          content: `Message ${i}`,
          confidence: 0.9,
          timestampMs: baseTime + i * 100,
          isFinal: true,
        });
      }

      const recent = store.getRecentByUser("user-1", 3);

      expect(recent).toHaveLength(3);
    });

    it("should default limit to 50", () => {
      // Just verify it does not throw with the default
      const recent = store.getRecentByUser("user-1");
      expect(Array.isArray(recent)).toBe(true);
    });

    it("should not return entries from other users", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "User 1 message",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      store.save({
        sessionId: "session-3",
        userId: "user-2",
        role: "user",
        content: "User 2 message",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      const recent = store.getRecentByUser("user-1", 10);

      expect(recent).toHaveLength(1);
      expect(recent[0].content).toBe("User 1 message");
    });
  });

  describe("getConversationHistory()", () => {
    it("should return turns in chronological order", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "First",
        confidence: 0.9,
        timestampMs: baseTime,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "Second",
        confidence: 1.0,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Third",
        confidence: 0.9,
        timestampMs: baseTime + 200,
        isFinal: true,
      });

      const history = store.getConversationHistory("user-1", 10);

      // getRecentByUser returns DESC, getConversationHistory reverses to ASC
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe("First");
      expect(history[1].content).toBe("Second");
      expect(history[2].content).toBe("Third");
    });

    it("should return TranscriptTurn objects with role, content, and timestampMs", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hello",
        confidence: 0.9,
        timestampMs: 1000,
        isFinal: true,
      });

      const history = store.getConversationHistory("user-1", 10);

      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        role: "user",
        content: "Hello",
        timestampMs: 1000,
      });
    });

    it("should return empty array when user has no transcripts", () => {
      const history = store.getConversationHistory("user-1", 10);

      expect(history).toEqual([]);
    });

    it("should respect maxTurns parameter (fetching 2x for coverage)", () => {
      const baseTime = Date.now();

      for (let i = 0; i < 10; i++) {
        store.save({
          sessionId: "session-1",
          userId: "user-1",
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Turn ${i}`,
          confidence: 0.9,
          timestampMs: baseTime + i * 100,
          isFinal: true,
        });
      }

      // maxTurns=3 means getRecentByUser is called with limit=6 (3*2)
      const history = store.getConversationHistory("user-1", 3);

      expect(history.length).toBeLessThanOrEqual(6);
    });
  });

  describe("buildContextSummary()", () => {
    it("should return empty string when user has no history", () => {
      const summary = store.buildContextSummary("user-1", 10);

      expect(summary).toBe("");
    });

    it("should build a formatted summary with user and assistant prefixes", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "What is the weather?",
        confidence: 0.9,
        timestampMs: baseTime,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "The weather is sunny today.",
        confidence: 1.0,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      const summary = store.buildContextSummary("user-1", 10);

      expect(summary).toContain("Previous conversation history:");
      expect(summary).toContain("User: What is the weather?");
      expect(summary).toContain("Assistant: The weather is sunny today.");
    });

    it("should truncate messages longer than 200 characters", () => {
      const longMessage = "A".repeat(300);

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: longMessage,
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      const summary = store.buildContextSummary("user-1", 10);

      expect(summary).toContain("...");
      // The truncated content should be 200 chars + "..."
      const userLine = summary
        .split("\n")
        .find((line) => line.startsWith("User:"));
      expect(userLine).toBeDefined();
      // "User: " (6 chars) + 200 chars + "..." (3 chars) = 209 chars
      expect(userLine!.length).toBe(209);
    });

    it("should not truncate messages under 200 characters", () => {
      const shortMessage = "Short message";

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: shortMessage,
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      const summary = store.buildContextSummary("user-1", 10);

      expect(summary).toContain(`User: ${shortMessage}`);
      expect(summary).not.toContain("...");
    });

    it("should trim trailing whitespace from the result", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Hello",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      const summary = store.buildContextSummary("user-1", 10);

      expect(summary).toBe(summary.trim());
    });
  });

  describe("getSessionTurnCount()", () => {
    it("should return the count of final entries for a session", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Message 1",
        confidence: 0.9,
        timestampMs: baseTime,
        isFinal: true,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "assistant",
        content: "Response 1",
        confidence: 1.0,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      // Non-final should not be counted
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Partial...",
        confidence: 0.3,
        timestampMs: baseTime + 200,
        isFinal: false,
      });

      const count = store.getSessionTurnCount("session-1");

      expect(count).toBe(2);
    });

    it("should return 0 for a session with no entries", () => {
      const count = store.getSessionTurnCount("session-2");

      expect(count).toBe(0);
    });

    it("should not count entries from other sessions", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Session 1",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      store.save({
        sessionId: "session-2",
        userId: "user-1",
        role: "user",
        content: "Session 2",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      expect(store.getSessionTurnCount("session-1")).toBe(1);
      expect(store.getSessionTurnCount("session-2")).toBe(1);
    });
  });

  describe("cleanupNonFinal()", () => {
    it("should remove non-final entries for a session", () => {
      const baseTime = Date.now();

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Partial 1",
        confidence: 0.3,
        timestampMs: baseTime,
        isFinal: false,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Partial 2",
        confidence: 0.5,
        timestampMs: baseTime + 50,
        isFinal: false,
      });

      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Final message",
        confidence: 0.95,
        timestampMs: baseTime + 100,
        isFinal: true,
      });

      const deleted = store.cleanupNonFinal("session-1");

      expect(deleted).toBe(2);

      const remaining = store.getBySession("session-1");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].isFinal).toBe(true);
      expect(remaining[0].content).toBe("Final message");
    });

    it("should return 0 when no non-final entries exist", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Final only",
        confidence: 0.9,
        timestampMs: Date.now(),
        isFinal: true,
      });

      const deleted = store.cleanupNonFinal("session-1");

      expect(deleted).toBe(0);
    });

    it("should not affect entries from other sessions", () => {
      store.save({
        sessionId: "session-1",
        userId: "user-1",
        role: "user",
        content: "Session 1 partial",
        confidence: 0.3,
        timestampMs: Date.now(),
        isFinal: false,
      });

      store.save({
        sessionId: "session-2",
        userId: "user-1",
        role: "user",
        content: "Session 2 partial",
        confidence: 0.3,
        timestampMs: Date.now(),
        isFinal: false,
      });

      store.cleanupNonFinal("session-1");

      // Session 2 partial should still exist
      const session2Entries = store.getBySession("session-2");
      expect(session2Entries).toHaveLength(1);
      expect(session2Entries[0].content).toBe("Session 2 partial");
    });

    it("should return 0 for empty session", () => {
      const deleted = store.cleanupNonFinal("session-2");

      expect(deleted).toBe(0);
    });
  });
});
