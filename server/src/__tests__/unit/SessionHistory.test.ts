/**
 * SessionHistory Unit Tests
 *
 * Tests the SessionHistory class which manages user identity tracking,
 * session records, cross-session context retrieval, and conversation
 * summaries.
 *
 * The TranscriptStore singleton is mocked to isolate SessionHistory
 * behavior from transcript persistence. Direct database operations
 * use the real in-memory SQLite via the Database singleton.
 */

import { getDatabase, closeDatabase } from "../../storage/Database.js";
import { getTranscriptStore } from "../../storage/TranscriptStore.js";
import { SessionHistory } from "../../storage/SessionHistory.js";

// Mock the TranscriptStore module to isolate SessionHistory tests
jest.mock("../../storage/TranscriptStore.js", () => {
  const actual =
    jest.requireActual<typeof import("../../storage/TranscriptStore.js")>(
      "../../storage/TranscriptStore.js",
    );
  return {
    ...actual,
    getTranscriptStore: jest.fn(() => ({
      getConversationHistory: jest.fn().mockReturnValue([]),
      buildContextSummary: jest.fn().mockReturnValue(""),
      getFinalBySession: jest.fn().mockReturnValue([]),
    })),
  };
});

const mockedGetTranscriptStore = getTranscriptStore as jest.MockedFunction<
  typeof getTranscriptStore
>;

// Suppress console.log noise from Database and SessionHistory
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("SessionHistory", () => {
  let history: SessionHistory;

  beforeEach(() => {
    closeDatabase();
    getDatabase({ path: ":memory:", walMode: false });
    history = new SessionHistory();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("getOrCreateUser()", () => {
    it("should create a new user with the given fingerprint", () => {
      const user = history.getOrCreateUser("fp-abc123");

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.fingerprint).toBe("fp-abc123");
      expect(user.metadata).toEqual({});
    });

    it("should generate a UUID for the new user id", () => {
      const user = history.getOrCreateUser("fp-new");

      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should return the existing user when fingerprint already exists", () => {
      const user1 = history.getOrCreateUser("fp-returning");
      const user2 = history.getOrCreateUser("fp-returning");

      expect(user2.id).toBe(user1.id);
      expect(user2.fingerprint).toBe("fp-returning");
    });

    it("should update last_seen_at when returning user is found", () => {
      const user1 = history.getOrCreateUser("fp-seen");

      // Manually backdate last_seen_at to verify the update
      const db = getDatabase();
      db.prepare("UPDATE users SET last_seen_at = '2020-01-01' WHERE id = ?").run(
        user1.id,
      );

      // Re-fetch: getOrCreateUser should update last_seen_at
      history.getOrCreateUser("fp-seen");

      const row = db
        .prepare("SELECT last_seen_at as lastSeenAt FROM users WHERE id = ?")
        .get(user1.id) as { lastSeenAt: string };

      // Should be more recent than 2020-01-01
      expect(row.lastSeenAt).not.toBe("2020-01-01");
    });

    it("should store metadata as JSON string", () => {
      const metadata = { device: "mobile", os: "iOS" };
      const user = history.getOrCreateUser("fp-meta", metadata);

      expect(user.metadata).toEqual(metadata);

      // Verify raw storage
      const db = getDatabase();
      const row = db
        .prepare("SELECT metadata FROM users WHERE id = ?")
        .get(user.id) as { metadata: string };

      expect(JSON.parse(row.metadata)).toEqual(metadata);
    });

    it("should parse metadata from database for returning users", () => {
      const metadata = { browser: "Chrome", version: 120 };
      history.getOrCreateUser("fp-parse", metadata);

      // Fetch again to exercise the JSON.parse path
      const user = history.getOrCreateUser("fp-parse");

      expect(user.metadata).toEqual(metadata);
    });

    it("should create distinct users for different fingerprints", () => {
      const user1 = history.getOrCreateUser("fp-one");
      const user2 = history.getOrCreateUser("fp-two");

      expect(user1.id).not.toBe(user2.id);
    });
  });

  describe("recordSession()", () => {
    it("should insert a new session record", () => {
      const user = history.getOrCreateUser("fp-session");
      history.recordSession("sess-001", user.id);

      const session = history.getSession("sess-001");

      expect(session).not.toBeNull();
      expect(session!.id).toBe("sess-001");
      expect(session!.userId).toBe(user.id);
    });

    it("should allow null userId for anonymous sessions", () => {
      history.recordSession("sess-anon", null);

      const session = history.getSession("sess-anon");

      expect(session).not.toBeNull();
      expect(session!.userId).toBeNull();
    });

    it("should store metadata as JSON", () => {
      history.recordSession("sess-meta", null, { source: "web" });

      const session = history.getSession("sess-meta");

      expect(session).not.toBeNull();
      expect(session!.metadata).toEqual({ source: "web" });
    });

    it("should use ON CONFLICT to upsert when session id already exists", () => {
      const user = history.getOrCreateUser("fp-upsert");

      history.recordSession("sess-dup", null);
      history.recordSession("sess-dup", user.id, { updated: true });

      const session = history.getSession("sess-dup");

      expect(session).not.toBeNull();
      expect(session!.userId).toBe(user.id);
      expect(session!.metadata).toEqual({ updated: true });
    });
  });

  describe("linkSessionToUser()", () => {
    it("should update the session user_id", () => {
      const user = history.getOrCreateUser("fp-link");

      // Create anonymous session first
      history.recordSession("sess-link", null);

      // Link it to the user
      history.linkSessionToUser("sess-link", user.id);

      const session = history.getSession("sess-link");
      expect(session).not.toBeNull();
      expect(session!.userId).toBe(user.id);
    });

    it("should overwrite a previous user_id link", () => {
      const user1 = history.getOrCreateUser("fp-link1");
      const user2 = history.getOrCreateUser("fp-link2");

      history.recordSession("sess-relink", user1.id);
      history.linkSessionToUser("sess-relink", user2.id);

      const session = history.getSession("sess-relink");
      expect(session!.userId).toBe(user2.id);
    });
  });

  describe("endSession()", () => {
    it("should set ended_at and end_reason on the session", () => {
      history.recordSession("sess-end", null);
      history.endSession("sess-end", "user_disconnect");

      const session = history.getSession("sess-end");

      expect(session).not.toBeNull();
      expect(session!.endedAt).not.toBeNull();
      expect(session!.endReason).toBe("user_disconnect");
    });

    it("should preserve other session fields when ending", () => {
      const user = history.getOrCreateUser("fp-end");
      history.recordSession("sess-end2", user.id, { important: true });

      history.endSession("sess-end2", "timeout");

      const session = history.getSession("sess-end2");
      expect(session!.userId).toBe(user.id);
      expect(session!.metadata).toEqual({ important: true });
    });
  });

  describe("getSession()", () => {
    it("should return the session record by id", () => {
      history.recordSession("sess-get", null);

      const session = history.getSession("sess-get");

      expect(session).not.toBeNull();
      expect(session!.id).toBe("sess-get");
    });

    it("should return null for non-existent session", () => {
      const session = history.getSession("non-existent");

      expect(session).toBeNull();
    });

    it("should parse metadata from JSON", () => {
      history.recordSession("sess-json", null, { key: "value" });

      const session = history.getSession("sess-json");

      expect(session!.metadata).toEqual({ key: "value" });
    });

    it("should handle empty metadata gracefully", () => {
      history.recordSession("sess-empty-meta", null);

      const session = history.getSession("sess-empty-meta");

      expect(session!.metadata).toEqual({});
    });
  });

  describe("getUserSessions()", () => {
    it("should return sessions for a user ordered by started_at DESC", () => {
      const user = history.getOrCreateUser("fp-sessions");

      history.recordSession("sess-a", user.id);
      history.recordSession("sess-b", user.id);
      history.recordSession("sess-c", user.id);

      const sessions = history.getUserSessions(user.id);

      expect(sessions).toHaveLength(3);
      // All sessions belong to this user
      sessions.forEach((s) => {
        expect(s.userId).toBe(user.id);
      });
    });

    it("should respect the limit parameter", () => {
      const user = history.getOrCreateUser("fp-limit");

      for (let i = 0; i < 5; i++) {
        history.recordSession(`sess-lim-${i}`, user.id);
      }

      const sessions = history.getUserSessions(user.id, 2);

      expect(sessions).toHaveLength(2);
    });

    it("should return empty array for user with no sessions", () => {
      const user = history.getOrCreateUser("fp-nosess");

      const sessions = history.getUserSessions(user.id);

      expect(sessions).toEqual([]);
    });

    it("should not return sessions from other users", () => {
      const user1 = history.getOrCreateUser("fp-u1");
      const user2 = history.getOrCreateUser("fp-u2");

      history.recordSession("sess-u1", user1.id);
      history.recordSession("sess-u2", user2.id);

      const sessions = history.getUserSessions(user1.id);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("sess-u1");
    });

    it("should default limit to 10", () => {
      const user = history.getOrCreateUser("fp-default");

      for (let i = 0; i < 15; i++) {
        history.recordSession(`sess-def-${i}`, user.id);
      }

      const sessions = history.getUserSessions(user.id);

      expect(sessions).toHaveLength(10);
    });
  });

  describe("getSessionContext()", () => {
    it("should return context for a first-time user", () => {
      const user = history.getOrCreateUser("fp-first");
      history.recordSession("sess-current", user.id);

      const context = history.getSessionContext(user.id, "sess-current");

      expect(context.userId).toBe(user.id);
      expect(context.isReturningUser).toBe(false);
      expect(context.previousSessionCount).toBe(0);
      expect(context.lastSessionEndedAt).toBeNull();
      expect(context.recentHistory).toEqual([]);
    });

    it("should identify a returning user with previous sessions", () => {
      const user = history.getOrCreateUser("fp-returning-ctx");

      history.recordSession("sess-old", user.id);
      history.endSession("sess-old", "completed");
      history.recordSession("sess-current", user.id);

      const context = history.getSessionContext(user.id, "sess-current");

      expect(context.isReturningUser).toBe(true);
      expect(context.previousSessionCount).toBe(1);
    });

    it("should exclude the current session from previous session count", () => {
      const user = history.getOrCreateUser("fp-exclude");

      history.recordSession("sess-prev1", user.id);
      history.recordSession("sess-prev2", user.id);
      history.recordSession("sess-current", user.id);

      const context = history.getSessionContext(user.id, "sess-current");

      // Should only count sess-prev1 and sess-prev2
      expect(context.previousSessionCount).toBe(2);
    });

    it("should return lastSessionEndedAt from the most recent previous session", () => {
      const user = history.getOrCreateUser("fp-ended");

      history.recordSession("sess-ended", user.id);
      history.endSession("sess-ended", "done");
      history.recordSession("sess-current", user.id);

      const context = history.getSessionContext(user.id, "sess-current");

      expect(context.lastSessionEndedAt).not.toBeNull();
    });

    it("should include last conversation summary when available", () => {
      const user = history.getOrCreateUser("fp-summary");

      history.recordSession("sess-summarized", user.id);
      history.saveConversationSummary(
        user.id,
        "sess-summarized",
        "User asked about weather and pricing.",
        5,
      );

      history.recordSession("sess-current", user.id);

      const context = history.getSessionContext(user.id, "sess-current");

      expect(context.conversationSummary).toContain(
        "User asked about weather and pricing.",
      );
    });

    it("should use mocked transcript store for conversation history", () => {
      const mockHistory = [
        { role: "user" as const, content: "Hello", timestampMs: 1000 },
        {
          role: "assistant" as const,
          content: "Hi there!",
          timestampMs: 1100,
        },
      ];

      const mockStore = {
        getConversationHistory: jest.fn().mockReturnValue(mockHistory),
        buildContextSummary: jest
          .fn()
          .mockReturnValue("User: Hello\nAssistant: Hi there!"),
        getFinalBySession: jest.fn().mockReturnValue([]),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      const user = history.getOrCreateUser("fp-mock");
      history.recordSession("sess-mock", user.id);

      const context = history.getSessionContext(user.id, "sess-mock");

      expect(context.recentHistory).toEqual(mockHistory);
      expect(mockStore.getConversationHistory).toHaveBeenCalledWith(
        user.id,
        10,
      );
    });

    it("should append recent history to existing summary", () => {
      const mockStore = {
        getConversationHistory: jest
          .fn()
          .mockReturnValue([
            { role: "user", content: "New question", timestampMs: 2000 },
          ]),
        buildContextSummary: jest
          .fn()
          .mockReturnValue("User: New question"),
        getFinalBySession: jest.fn().mockReturnValue([]),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      const user = history.getOrCreateUser("fp-append");

      history.recordSession("sess-old", user.id);
      history.saveConversationSummary(
        user.id,
        "sess-old",
        "Previous summary about weather.",
        3,
      );

      history.recordSession("sess-new", user.id);

      const context = history.getSessionContext(user.id, "sess-new");

      expect(context.conversationSummary).toContain(
        "Previous summary about weather.",
      );
      expect(context.conversationSummary).toContain("Most recent exchanges:");
    });
  });

  describe("saveConversationSummary()", () => {
    it("should persist a conversation summary", () => {
      const user = history.getOrCreateUser("fp-save-summary");
      history.recordSession("sess-save", user.id);

      history.saveConversationSummary(
        user.id,
        "sess-save",
        "The user discussed billing issues.",
        8,
      );

      // Verify via direct DB query
      const db = getDatabase();
      const row = db
        .prepare(
          "SELECT * FROM conversation_summaries WHERE user_id = ?",
        )
        .get(user.id) as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.summary).toBe("The user discussed billing issues.");
      expect(row.turn_count).toBe(8);
      expect(row.from_session_id).toBe("sess-save");
      expect(row.to_session_id).toBeNull();
    });

    it("should allow multiple summaries for the same user", () => {
      const user = history.getOrCreateUser("fp-multi-summary");
      history.recordSession("sess-a", user.id);
      history.recordSession("sess-b", user.id);

      history.saveConversationSummary(
        user.id,
        "sess-a",
        "First session summary.",
        3,
      );
      history.saveConversationSummary(
        user.id,
        "sess-b",
        "Second session summary.",
        5,
      );

      const db = getDatabase();
      const rows = db
        .prepare(
          "SELECT * FROM conversation_summaries WHERE user_id = ? ORDER BY id",
        )
        .all(user.id) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[0].summary).toBe("First session summary.");
      expect(rows[1].summary).toBe("Second session summary.");
    });
  });

  describe("generateSessionSummary()", () => {
    it("should return empty string for session with no transcripts", () => {
      // Mock getFinalBySession to return empty
      const mockStore = {
        getConversationHistory: jest.fn().mockReturnValue([]),
        buildContextSummary: jest.fn().mockReturnValue(""),
        getFinalBySession: jest.fn().mockReturnValue([]),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      history.recordSession("sess-empty", null);

      const summary = history.generateSessionSummary("sess-empty");

      expect(summary).toBe("");
    });

    it("should extract user questions and assistant responses", () => {
      const mockTranscripts = [
        {
          sessionId: "sess-gen",
          role: "user",
          content: "What is the weather today?",
          confidence: 0.9,
          timestampMs: 1000,
          isFinal: true,
        },
        {
          sessionId: "sess-gen",
          role: "assistant",
          content: "The weather is sunny with a high of 75F.",
          confidence: 1.0,
          timestampMs: 1100,
          isFinal: true,
        },
        {
          sessionId: "sess-gen",
          role: "user",
          content: "Will it rain tomorrow?",
          confidence: 0.85,
          timestampMs: 1200,
          isFinal: true,
        },
      ];

      const mockStore = {
        getConversationHistory: jest.fn().mockReturnValue([]),
        buildContextSummary: jest.fn().mockReturnValue(""),
        getFinalBySession: jest.fn().mockReturnValue(mockTranscripts),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      history.recordSession("sess-gen", null);

      const summary = history.generateSessionSummary("sess-gen");

      expect(summary).toContain('User asked: "What is the weather today?"');
      expect(summary).toContain('User asked: "Will it rain tomorrow?"');
      expect(summary).toContain(
        'Assistant explained: "The weather is sunny with a high of 75F."',
      );
    });

    it("should truncate long user messages at 100 characters", () => {
      const longUserMessage = "X".repeat(150);

      const mockStore = {
        getConversationHistory: jest.fn().mockReturnValue([]),
        buildContextSummary: jest.fn().mockReturnValue(""),
        getFinalBySession: jest.fn().mockReturnValue([
          {
            sessionId: "sess-trunc",
            role: "user",
            content: longUserMessage,
            confidence: 0.9,
            timestampMs: 1000,
            isFinal: true,
          },
        ]),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      history.recordSession("sess-trunc", null);

      const summary = history.generateSessionSummary("sess-trunc");

      expect(summary).toContain("...");
      // Should contain exactly 100 chars of the message + "..."
      const expectedTruncated = longUserMessage.substring(0, 100) + "...";
      expect(summary).toContain(expectedTruncated);
    });

    it("should truncate long assistant messages at 150 characters", () => {
      const longAssistantMessage = "Y".repeat(200);

      const mockStore = {
        getConversationHistory: jest.fn().mockReturnValue([]),
        buildContextSummary: jest.fn().mockReturnValue(""),
        getFinalBySession: jest.fn().mockReturnValue([
          {
            sessionId: "sess-trunc-a",
            role: "assistant",
            content: longAssistantMessage,
            confidence: 1.0,
            timestampMs: 1000,
            isFinal: true,
          },
        ]),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      history.recordSession("sess-trunc-a", null);

      const summary = history.generateSessionSummary("sess-trunc-a");

      expect(summary).toContain("...");
      const expectedTruncated =
        longAssistantMessage.substring(0, 150) + "...";
      expect(summary).toContain(expectedTruncated);
    });

    it("should limit user messages to first 5 and assistant messages to first 3", () => {
      const userMessages = Array.from({ length: 8 }, (_, i) => ({
        sessionId: "sess-limit",
        role: "user" as const,
        content: `User question ${i}`,
        confidence: 0.9,
        timestampMs: 1000 + i * 200,
        isFinal: true,
      }));

      const assistantMessages = Array.from({ length: 6 }, (_, i) => ({
        sessionId: "sess-limit",
        role: "assistant" as const,
        content: `Assistant response ${i}`,
        confidence: 1.0,
        timestampMs: 1100 + i * 200,
        isFinal: true,
      }));

      // Interleave them
      const allTranscripts = [...userMessages, ...assistantMessages].sort(
        (a, b) => a.timestampMs - b.timestampMs,
      );

      const mockStore = {
        getConversationHistory: jest.fn().mockReturnValue([]),
        buildContextSummary: jest.fn().mockReturnValue(""),
        getFinalBySession: jest.fn().mockReturnValue(allTranscripts),
      };
      mockedGetTranscriptStore.mockReturnValue(mockStore as any);

      history.recordSession("sess-limit", null);

      const summary = history.generateSessionSummary("sess-limit");

      // Count occurrences of "User asked:" and "Assistant explained:"
      const userAskedCount = (summary.match(/User asked:/g) || []).length;
      const assistantExplainedCount = (
        summary.match(/Assistant explained:/g) || []
      ).length;

      expect(userAskedCount).toBeLessThanOrEqual(5);
      expect(assistantExplainedCount).toBeLessThanOrEqual(3);
    });
  });

  describe("getUserTranscriptCount()", () => {
    it("should return 0 for a user with no transcripts", () => {
      const user = history.getOrCreateUser("fp-count-empty");

      const count = history.getUserTranscriptCount(user.id);

      expect(count).toBe(0);
    });

    it("should count only final transcripts for the user", () => {
      const user = history.getOrCreateUser("fp-count");
      history.recordSession("sess-count", user.id);

      const db = getDatabase();

      // Insert final transcripts
      db.prepare(
        "INSERT INTO transcripts (session_id, user_id, role, content, confidence, timestamp_ms, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("sess-count", user.id, "user", "Hello", 0.9, Date.now(), 1);

      db.prepare(
        "INSERT INTO transcripts (session_id, user_id, role, content, confidence, timestamp_ms, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "sess-count",
        user.id,
        "assistant",
        "Hi there!",
        1.0,
        Date.now() + 1,
        1,
      );

      // Insert non-final transcript (should not be counted)
      db.prepare(
        "INSERT INTO transcripts (session_id, user_id, role, content, confidence, timestamp_ms, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "sess-count",
        user.id,
        "user",
        "Partial...",
        0.3,
        Date.now() + 2,
        0,
      );

      const count = history.getUserTranscriptCount(user.id);

      expect(count).toBe(2);
    });

    it("should not count transcripts from other users", () => {
      const user1 = history.getOrCreateUser("fp-count1");
      const user2 = history.getOrCreateUser("fp-count2");
      history.recordSession("sess-c1", user1.id);
      history.recordSession("sess-c2", user2.id);

      const db = getDatabase();

      db.prepare(
        "INSERT INTO transcripts (session_id, user_id, role, content, confidence, timestamp_ms, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("sess-c1", user1.id, "user", "User 1 msg", 0.9, Date.now(), 1);

      db.prepare(
        "INSERT INTO transcripts (session_id, user_id, role, content, confidence, timestamp_ms, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("sess-c2", user2.id, "user", "User 2 msg", 0.9, Date.now(), 1);

      expect(history.getUserTranscriptCount(user1.id)).toBe(1);
      expect(history.getUserTranscriptCount(user2.id)).toBe(1);
    });
  });
});
