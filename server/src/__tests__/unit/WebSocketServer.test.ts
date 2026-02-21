/**
 * VoiceWebSocketServer Unit Tests -- Server, Lane Handlers, Lifecycle
 *
 * Tests the WebSocket server that orchestrates voice sessions: constructor
 * initialization, client connection handling, all lane event handlers
 * (Arbitrator, LaneA, LaneB, FallbackPlanner, Policy/RAG), connection
 * close cleanup, error handling, sendToClient gating, and connection count.
 */

import { EventEmitter } from "events";

// ── Stable mock references (before jest.mock hoisting) ──────────────
const mockWssOn = jest.fn();
const MockWebSocketServer = jest.fn().mockImplementation(() => ({
  on: mockWssOn,
}));

const mockSessionManager = {
  createSession: jest.fn(() => ({ id: "test-session-id" })),
  updateSessionState: jest.fn(),
  touchSession: jest.fn(),
  endSession: jest.fn(),
};

const mockEventBus = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

// EventEmitter-based lane mocks (so .on() handlers can be triggered)
function createMockLaneArbitrator() {
  const arb = new EventEmitter();
  return Object.assign(arb, {
    startSession: jest.fn(),
    endSession: jest.fn(),
    getState: jest.fn(() => "LISTENING"),
    getCurrentOwner: jest.fn(() => "none"),
    onUserSpeechEnded: jest.fn(),
    onLaneBReady: jest.fn(),
    onLaneBDone: jest.fn(),
    onUserBargeIn: jest.fn(),
    onPolicyCancel: jest.fn(),
    onFallbackComplete: jest.fn(),
    resetResponseInProgress: jest.fn(),
  });
}

function createMockLaneA() {
  const lane = new EventEmitter();
  return Object.assign(lane, {
    playReflex: jest.fn(),
    stop: jest.fn(),
    isReady: jest.fn(() => true),
    isEnabled: jest.fn(() => true),
  });
}

function createMockLaneB() {
  const lane = new EventEmitter();
  return Object.assign(lane, {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn(() => false),
    sendAudio: jest.fn().mockResolvedValue(undefined),
    commitAudio: jest.fn().mockResolvedValue(true),
    cancel: jest.fn().mockResolvedValue(undefined),
    clearInputBuffer: jest.fn(),
    getIsResponding: jest.fn(() => false),
    getTTFB: jest.fn(() => null),
    setVoiceMode: jest.fn(),
    getVoiceMode: jest.fn(() => "push-to-talk"),
    setConversationContext: jest.fn(),
    getRequiredDisclaimers: jest.fn(() => []),
    setRequiredDisclaimers: jest.fn(),
  });
}

function createMockControlEngine() {
  return { destroy: jest.fn() };
}

function createMockFallbackPlanner() {
  const fp = new EventEmitter();
  return Object.assign(fp, {
    isEnabled: jest.fn(() => true),
    trigger: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    isActive: jest.fn(() => false),
  });
}

// Per-test mock instances -- reset in beforeEach
let mockArbitrator: ReturnType<typeof createMockLaneArbitrator>;
let mockLaneA: ReturnType<typeof createMockLaneA>;
let mockLaneB: ReturnType<typeof createMockLaneB>;
let mockControlEngine: ReturnType<typeof createMockControlEngine>;
let mockFallbackPlanner: ReturnType<typeof createMockFallbackPlanner>;

// ── jest.mock declarations (hoisted above imports) ──────────────────

jest.mock("ws", () => ({
  WebSocketServer: MockWebSocketServer,
  WebSocket: { OPEN: 1, CLOSING: 2, CLOSED: 3, CONNECTING: 0 },
}));

jest.mock("uuid", () => ({ v4: jest.fn(() => "mock-uuid") }));

jest.mock("../../orchestrator/SessionManager.js", () => ({
  sessionManager: mockSessionManager,
}));

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: mockEventBus,
}));

jest.mock("../../orchestrator/LaneArbitrator.js", () => ({
  LaneArbitrator: jest.fn().mockImplementation(() => mockArbitrator),
}));

jest.mock("../../lanes/LaneA.js", () => ({
  LaneA: jest.fn().mockImplementation(() => mockLaneA),
}));

jest.mock("../../lanes/LaneB.js", () => ({
  LaneB: jest.fn().mockImplementation(() => mockLaneB),
}));

jest.mock("../../lanes/laneC_control.js", () => ({
  ControlEngine: jest.fn().mockImplementation(() => mockControlEngine),
}));

jest.mock("../../insurance/fallback_planner.js", () => ({
  FallbackPlanner: jest.fn().mockImplementation(() => mockFallbackPlanner),
}));

jest.mock("../../config/index.js", () => ({
  config: {
    openai: { apiKey: "test-key", model: "gpt-4o-realtime" },
    features: {
      enableLaneA: true,
      enableRAG: true,
      enablePolicyGate: true,
      enableAuditTrail: false,
      enablePersistentMemory: false,
    },
    latency: {
      ttfbTargetP50: 400,
      ttfbTargetP95: 900,
      bargeInTargetP95: 250,
    },
    safety: {
      enablePIIRedaction: false,
      storeRawAudio: false,
      maxSessionDurationMinutes: 30,
    },
    rag: { topK: 5, maxTokens: 600, maxBytes: 4000 },
    storage: {
      databasePath: "/tmp/test.db",
      enableWalMode: true,
      maxHistoryTurns: 100,
      maxSummaryLength: 500,
    },
    fallback: { mode: "auto" },
  },
}));

jest.mock("../../insurance/audit_trail.js", () => ({
  initializeAuditTrail: jest.fn(),
}));

jest.mock("../../storage/index.js", () => ({
  getDatabase: jest.fn(),
  getTranscriptStore: jest.fn(() => ({
    save: jest.fn(),
    getSessionTurnCount: jest.fn(() => 5),
    cleanupNonFinal: jest.fn(),
  })),
  getSessionHistory: jest.fn(() => ({
    getOrCreateUser: jest.fn(() => ({ id: "user-123" })),
    recordSession: jest.fn(),
    getSessionContext: jest.fn(() => ({
      isReturningUser: false,
      previousSessionCount: 0,
      conversationSummary: null,
    })),
    generateSessionSummary: jest.fn(() => "Test summary"),
    saveConversationSummary: jest.fn(),
    endSession: jest.fn(),
  })),
}));

// ── Imports (after mocks) ───────────────────────────────────────────
import { VoiceWebSocketServer } from "../../api/websocket.js";
import { config } from "../../config/index.js";
import { initializeAuditTrail } from "../../insurance/audit_trail.js";
import {
  getDatabase,
  getSessionHistory,
  getTranscriptStore,
} from "../../storage/index.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockWs() {
  const ws = new EventEmitter();
  (ws as any).readyState = 1; // WebSocket.OPEN
  (ws as any).send = jest.fn();
  (ws as any).close = jest.fn();
  return ws as any;
}

/**
 * Construct a VoiceWebSocketServer and trigger a client connection.
 * Returns the server, the mock ws, and the connection handler.
 */
async function connectClient() {
  const server = new VoiceWebSocketServer({} as any);
  const connectionHandler = mockWssOn.mock.calls.find(
    ([event]: [string]) => event === "connection",
  )?.[1];
  expect(connectionHandler).toBeDefined();

  const mockWs = createMockWs();
  await connectionHandler(mockWs);
  return { server, mockWs, connectionHandler };
}

/** Parse the JSON string passed to ws.send and return the parsed object. */
function parseSent(mockWs: any, callIndex: number): any {
  const raw = mockWs.send.mock.calls[callIndex]?.[0];
  return raw ? JSON.parse(raw) : undefined;
}

/** Find a sent message by type. */
function findSentMessage(mockWs: any, type: string): any {
  for (const [raw] of mockWs.send.mock.calls) {
    const msg = JSON.parse(raw);
    if (msg.type === type) return msg;
  }
  return undefined;
}

// ── Test suite ──────────────────────────────────────────────────────

describe("VoiceWebSocketServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArbitrator = createMockLaneArbitrator();
    mockLaneA = createMockLaneA();
    mockLaneB = createMockLaneB();
    mockControlEngine = createMockControlEngine();
    mockFallbackPlanner = createMockFallbackPlanner();

    // Reset config to defaults (tests may mutate)
    (config as any).features.enablePersistentMemory = false;
    (config as any).features.enableAuditTrail = false;

    // Suppress console noise
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ================================================================
  // 1. Constructor
  // ================================================================
  describe("Constructor", () => {
    it("creates a WebSocketServer and registers the connection handler", () => {
      void new VoiceWebSocketServer({} as any);
      expect(MockWebSocketServer).toHaveBeenCalledWith({ server: {} });
      expect(mockWssOn).toHaveBeenCalledWith(
        "connection",
        expect.any(Function),
      );
    });

    it("initializes storage when enablePersistentMemory is true", () => {
      (config as any).features.enablePersistentMemory = true;
      void new VoiceWebSocketServer({} as any);
      expect(getDatabase).toHaveBeenCalledWith({
        path: "/tmp/test.db",
        walMode: true,
      });
    });

    it("initializes storage when enableAuditTrail is true", () => {
      (config as any).features.enableAuditTrail = true;
      void new VoiceWebSocketServer({} as any);
      expect(getDatabase).toHaveBeenCalledWith({
        path: "/tmp/test.db",
        walMode: true,
      });
    });

    it("handles getDatabase errors gracefully", () => {
      (config as any).features.enablePersistentMemory = true;
      (getDatabase as jest.Mock).mockImplementationOnce(() => {
        throw new Error("DB init failed");
      });
      // Should not throw
      expect(() => new VoiceWebSocketServer({} as any)).not.toThrow();
      expect(console.error).toHaveBeenCalled();
    });

    it("calls initializeAuditTrail with correct config when enableAuditTrail is true", () => {
      (config as any).features.enableAuditTrail = true;
      void new VoiceWebSocketServer({} as any);
      expect(initializeAuditTrail).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          databasePath: "/tmp/test.db",
          walMode: true,
          includeTranscripts: false, // enablePersistentMemory is false
          includeTranscriptDeltas: false,
          includeAudio: false, // storeRawAudio is false
          includeSessionEvents: true,
          includeResponseMetadata: true,
        }),
      );
    });
  });

  // ================================================================
  // 2. handleConnection
  // ================================================================
  describe("handleConnection", () => {
    it("creates a session via SessionManager", async () => {
      await connectClient();
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ connectedAt: expect.any(String) }),
      );
    });

    it("instantiates all lanes and stores connection", async () => {
      const { server } = await connectClient();
      expect(server.getConnectionCount()).toBe(1);
    });

    it("registers ws message, close, and error handlers", async () => {
      const { mockWs } = await connectClient();
      const eventNames = mockWs.eventNames();
      expect(eventNames).toContain("message");
      expect(eventNames).toContain("close");
      expect(eventNames).toContain("error");
    });

    it("sends session.ready with sessionId to client", async () => {
      const { mockWs } = await connectClient();
      const readyMsg = findSentMessage(mockWs, "session.ready");
      expect(readyMsg).toBeDefined();
      expect(readyMsg.sessionId).toBe("test-session-id");
      expect(readyMsg.timestamp).toEqual(expect.any(Number));
    });

    it("initializes connection with default values", async () => {
      const { mockWs } = await connectClient();
      // Verify session.ready was sent (connection was set up with defaults)
      const readyMsg = findSentMessage(mockWs, "session.ready");
      expect(readyMsg).toBeDefined();
      // Connection count confirms the ws was stored in the map
      expect(mockWs.send).toHaveBeenCalled();
    });
  });

  // ================================================================
  // 3. setupLaneHandlers -- Arbitrator
  // ================================================================
  describe("setupLaneHandlers -- Arbitrator", () => {
    it("forwards state_change to client as lane.state_changed", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.emit("state_change", {
        from: "LISTENING",
        to: "B_RESPONDING",
        cause: "speech_ended",
      });
      const msg = findSentMessage(mockWs, "lane.state_changed");
      expect(msg).toBeDefined();
      expect(msg.from).toBe("LISTENING");
      expect(msg.to).toBe("B_RESPONDING");
      expect(msg.cause).toBe("speech_ended");
    });

    it("forwards owner_change to client as lane.owner_changed", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.emit("owner_change", {
        from: "none",
        to: "B",
        cause: "b_first_audio_ready",
      });
      const msg = findSentMessage(mockWs, "lane.owner_changed");
      expect(msg).toBeDefined();
      expect(msg.from).toBe("none");
      expect(msg.to).toBe("B");
    });

    it("calls laneA.playReflex on play_reflex event", async () => {
      await connectClient();
      mockArbitrator.emit("play_reflex");
      expect(mockLaneA.playReflex).toHaveBeenCalled();
    });

    it("calls laneA.stop on stop_reflex event", async () => {
      await connectClient();
      mockArbitrator.emit("stop_reflex");
      expect(mockLaneA.stop).toHaveBeenCalled();
    });

    it("logs on play_lane_b event", async () => {
      await connectClient();
      mockArbitrator.emit("play_lane_b");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Lane B audio playback started"),
      );
    });

    it("cancels laneB on stop_lane_b event", async () => {
      await connectClient();
      mockArbitrator.emit("stop_lane_b");
      expect(mockLaneB.cancel).toHaveBeenCalled();
    });

    it("triggers fallback planner on play_fallback when enabled", async () => {
      await connectClient();
      mockArbitrator.emit("play_fallback");
      expect(mockSessionManager.updateSessionState).toHaveBeenCalledWith(
        "test-session-id",
        "responding",
      );
      expect(mockFallbackPlanner.trigger).toHaveBeenCalled();
    });

    it("calls onFallbackComplete immediately when fallback is disabled", async () => {
      mockFallbackPlanner.isEnabled.mockReturnValue(false);
      await connectClient();
      mockArbitrator.emit("play_fallback");
      expect(mockArbitrator.onFallbackComplete).toHaveBeenCalled();
      expect(mockFallbackPlanner.trigger).not.toHaveBeenCalled();
    });

    it("stops fallback on stop_fallback event", async () => {
      await connectClient();
      mockArbitrator.emit("stop_fallback");
      expect(mockFallbackPlanner.stop).toHaveBeenCalled();
    });

    it("handles response_complete by updating state and sending response.end", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.emit("response_complete");
      expect(mockSessionManager.updateSessionState).toHaveBeenCalledWith(
        "test-session-id",
        "listening",
      );
      const msg = findSentMessage(mockWs, "response.end");
      expect(msg).toBeDefined();
    });
  });

  // ================================================================
  // 4. setupLaneHandlers -- LaneA
  // ================================================================
  describe("setupLaneHandlers -- LaneA", () => {
    it("forwards Lane A audio to client and emits event bus event", async () => {
      const { mockWs } = await connectClient();
      const audioData = Buffer.alloc(100);
      mockLaneA.emit("audio", {
        data: audioData,
        format: "pcm",
        sampleRate: 24000,
      });
      const msg = findSentMessage(mockWs, "audio.chunk");
      expect(msg).toBeDefined();
      expect(msg.lane).toBe("A");
      expect(msg.format).toBe("pcm");
      expect(msg.sampleRate).toBe(24000);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "audio.chunk",
          source: "laneA",
        }),
      );
    });

    it("logs on stopped event", async () => {
      await connectClient();
      mockLaneA.emit("stopped");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Lane A stopped"),
      );
    });
  });

  // ================================================================
  // 5. setupLaneHandlers -- LaneB
  // ================================================================
  describe("setupLaneHandlers -- LaneB", () => {
    it("calls onLaneBReady on first_audio_ready", async () => {
      await connectClient();
      mockLaneB.emit("first_audio_ready", { latencyMs: 250 });
      expect(mockArbitrator.onLaneBReady).toHaveBeenCalled();
    });

    it("forwards Lane B audio when owner is B and audioStopped is false", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.getCurrentOwner.mockReturnValue("B");
      const audioData = Buffer.alloc(100);
      mockLaneB.emit("audio", {
        data: audioData,
        format: "pcm",
        sampleRate: 24000,
      });
      const msg = findSentMessage(mockWs, "audio.chunk");
      expect(msg).toBeDefined();
      expect(msg.lane).toBe("B");
    });

    it("drops Lane B audio when audioStopped is true", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.getCurrentOwner.mockReturnValue("B");

      // Trigger audioStopped by emitting close then reconnecting -- instead
      // simulate by sending an audio.stop message through the ws handler.
      // Since audioStopped is on the connection object, we trigger it indirectly
      // by emitting an audio.stop message.
      mockWs.emit(
        "message",
        Buffer.from(JSON.stringify({ type: "audio.stop" })),
      );

      // Allow async to resolve
      await new Promise((r) => setTimeout(r, 10));

      // Clear previous sends to isolate this test
      mockWs.send.mockClear();

      mockLaneB.emit("audio", {
        data: Buffer.alloc(100),
        format: "pcm",
        sampleRate: 24000,
      });
      // Should not have sent any audio.chunk
      const msg = findSentMessage(mockWs, "audio.chunk");
      expect(msg).toBeUndefined();
    });

    it("drops Lane B audio when owner is not B", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.getCurrentOwner.mockReturnValue("A");
      mockWs.send.mockClear();
      mockLaneB.emit("audio", {
        data: Buffer.alloc(100),
        format: "pcm",
        sampleRate: 24000,
      });
      const msg = findSentMessage(mockWs, "audio.chunk");
      expect(msg).toBeUndefined();
    });

    it("forwards assistant transcript to client and emits event", async () => {
      const { mockWs } = await connectClient();
      const segment = {
        text: "Hello there",
        confidence: 0.99,
        isFinal: true,
        timestamp: Date.now(),
      };
      mockLaneB.emit("transcript", segment);
      const msg = findSentMessage(mockWs, "transcript");
      expect(msg).toBeDefined();
      expect(msg.text).toBe("Hello there");
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "transcript",
          source: "laneB",
        }),
      );
    });

    it("persists assistant transcript when persistentMemory is enabled and isFinal", async () => {
      (config as any).features.enablePersistentMemory = true;
      await connectClient();
      const segment = {
        text: "Persisted response",
        confidence: 0.95,
        isFinal: true,
        timestamp: Date.now(),
      };
      mockLaneB.emit("transcript", segment);
      expect(getTranscriptStore).toHaveBeenCalled();
    });

    it("does NOT persist assistant transcript when isFinal is false", async () => {
      (config as any).features.enablePersistentMemory = true;
      await connectClient();
      // Clear any calls from connectClient
      (getTranscriptStore as jest.Mock).mockClear();
      const segment = {
        text: "Partial response",
        confidence: 0.8,
        isFinal: false,
        timestamp: Date.now(),
      };
      mockLaneB.emit("transcript", segment);
      expect(getTranscriptStore).not.toHaveBeenCalled();
    });

    it("forwards user_transcript to client and emits event", async () => {
      const { mockWs } = await connectClient();
      const segment = {
        text: "User said this",
        confidence: 0.9,
        isFinal: true,
        timestamp: Date.now(),
      };
      mockLaneB.emit("user_transcript", segment);
      const msg = findSentMessage(mockWs, "user_transcript");
      expect(msg).toBeDefined();
      expect(msg.text).toBe("User said this");
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "user_transcript",
          source: "client",
        }),
      );
    });

    it("sends speech.started to client", async () => {
      const { mockWs } = await connectClient();
      mockLaneB.emit("speech_started");
      const msg = findSentMessage(mockWs, "speech.started");
      expect(msg).toBeDefined();
    });

    it("sends speech.stopped and calls onUserSpeechEnded", async () => {
      const { mockWs } = await connectClient();
      mockLaneB.emit("speech_stopped");
      const msg = findSentMessage(mockWs, "speech.stopped");
      expect(msg).toBeDefined();
      expect(mockArbitrator.onUserSpeechEnded).toHaveBeenCalled();
    });

    it("handles response_start by updating state and emitting metadata", async () => {
      const { mockWs } = await connectClient();
      mockLaneB.emit("response_start");
      expect(mockSessionManager.updateSessionState).toHaveBeenCalledWith(
        "test-session-id",
        "responding",
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "response.metadata",
          payload: expect.objectContaining({ phase: "start" }),
        }),
      );
      const msg = findSentMessage(mockWs, "response.start");
      expect(msg).toBeDefined();
    });

    it("handles response_end with totalMs when responseStartTime is set", async () => {
      await connectClient();
      // Trigger response_start first to set responseStartTime
      mockLaneB.emit("response_start");
      mockEventBus.emit.mockClear();

      mockLaneB.getTTFB.mockReturnValue(200 as any);
      mockLaneB.emit("response_end");

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "response.metadata",
          payload: expect.objectContaining({
            phase: "end",
            total_ms: expect.any(Number),
            ttfb_ms: 200,
          }),
        }),
      );
      expect(mockArbitrator.onLaneBDone).toHaveBeenCalled();
    });

    it("handles response_end without totalMs when responseStartTime is null", async () => {
      await connectClient();
      // Do NOT trigger response_start, so responseStartTime remains null
      mockLaneB.emit("response_end");

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "response.metadata",
          payload: expect.objectContaining({
            phase: "end",
            total_ms: undefined,
          }),
        }),
      );
      expect(mockArbitrator.onLaneBDone).toHaveBeenCalled();
    });

    it("forwards Lane B errors to client", async () => {
      const { mockWs } = await connectClient();
      const error = new Error("Lane B failure");
      mockLaneB.emit("error", error);
      const msg = findSentMessage(mockWs, "error");
      expect(msg).toBeDefined();
      expect(msg.error).toBe("Lane B failure");
    });
  });

  // ================================================================
  // 6. setupLaneHandlers -- FallbackPlanner
  // ================================================================
  describe("setupLaneHandlers -- FallbackPlanner", () => {
    it("forwards fallback audio when owner is fallback and audioStopped is false", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.getCurrentOwner.mockReturnValue("fallback");
      const audioData = Buffer.alloc(50);
      mockFallbackPlanner.emit("audio", {
        data: audioData,
        format: "pcm",
        sampleRate: 24000,
      });
      // Find audio.chunk with lane=fallback
      let found = false;
      for (const [raw] of mockWs.send.mock.calls) {
        const msg = JSON.parse(raw);
        if (msg.type === "audio.chunk" && msg.lane === "fallback") {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("drops fallback audio when audioStopped is true", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.getCurrentOwner.mockReturnValue("fallback");

      // Set audioStopped via audio.stop message
      mockWs.emit(
        "message",
        Buffer.from(JSON.stringify({ type: "audio.stop" })),
      );
      await new Promise((r) => setTimeout(r, 10));
      mockWs.send.mockClear();

      mockFallbackPlanner.emit("audio", {
        data: Buffer.alloc(50),
        format: "pcm",
        sampleRate: 24000,
      });
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it("drops fallback audio when owner is not fallback", async () => {
      const { mockWs } = await connectClient();
      mockArbitrator.getCurrentOwner.mockReturnValue("B");
      mockWs.send.mockClear();

      mockFallbackPlanner.emit("audio", {
        data: Buffer.alloc(50),
        format: "pcm",
        sampleRate: 24000,
      });
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it("calls onFallbackComplete only when done reason is 'done', not 'stopped'", async () => {
      await connectClient();

      mockFallbackPlanner.emit("done", { reason: "done" });
      expect(mockArbitrator.onFallbackComplete).toHaveBeenCalledTimes(1);

      mockArbitrator.onFallbackComplete.mockClear();
      mockFallbackPlanner.emit("done", { reason: "stopped" });
      expect(mockArbitrator.onFallbackComplete).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  // 7. setupLaneHandlers -- Policy/RAG
  // ================================================================
  describe("setupLaneHandlers -- Policy/RAG", () => {
    it("registers policyDecisionHandler and ragResultHandler on eventBus", async () => {
      await connectClient();
      expect(mockEventBus.on).toHaveBeenCalledWith(
        "policy.decision",
        expect.any(Function),
      );
      expect(mockEventBus.on).toHaveBeenCalledWith(
        "rag.result",
        expect.any(Function),
      );
    });

    it("stores lastPolicyDecision when policy.decision event matches session", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "policy.decision",
      )?.[1];
      expect(handler).toBeDefined();

      handler({
        type: "policy.decision",
        session_id: "test-session-id",
        payload: {
          decision: "allow",
          reason_codes: [],
          severity: 0,
        },
      });
      // Handler should have been called without error (stored lastPolicyDecision)
      expect(mockArbitrator.onPolicyCancel).not.toHaveBeenCalled();
    });

    it("ignores policy.decision events for different sessions", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "policy.decision",
      )?.[1];

      handler({
        type: "policy.decision",
        session_id: "other-session",
        payload: {
          decision: "cancel_output",
          reason_codes: ["test"],
          severity: 5,
        },
      });
      expect(mockArbitrator.onPolicyCancel).not.toHaveBeenCalled();
    });

    it("calls onPolicyCancel for cancel_output/refuse/escalate decisions", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "policy.decision",
      )?.[1];

      for (const decision of ["cancel_output", "refuse", "escalate"]) {
        mockArbitrator.onPolicyCancel.mockClear();
        handler({
          type: "policy.decision",
          session_id: "test-session-id",
          payload: {
            decision,
            reason_codes: ["test"],
            severity: 5,
          },
        });
        expect(mockArbitrator.onPolicyCancel).toHaveBeenCalledTimes(1);
      }
    });

    it("appends required_disclaimer_id to Lane B disclaimers", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "policy.decision",
      )?.[1];

      mockLaneB.getRequiredDisclaimers.mockReturnValue(["existing"] as any);
      handler({
        type: "policy.decision",
        session_id: "test-session-id",
        payload: {
          decision: "allow",
          reason_codes: [],
          severity: 0,
          required_disclaimer_id: "disc-1",
        },
      });
      expect(mockLaneB.setRequiredDisclaimers).toHaveBeenCalledWith([
        "existing",
        "disc-1",
      ]);
    });

    it("does not set disclaimers when required_disclaimer_id is empty", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "policy.decision",
      )?.[1];

      handler({
        type: "policy.decision",
        session_id: "test-session-id",
        payload: {
          decision: "allow",
          reason_codes: [],
          severity: 0,
          required_disclaimer_id: "",
        },
      });
      expect(mockLaneB.setRequiredDisclaimers).not.toHaveBeenCalled();
    });

    it("appends RAG disclaimers to Lane B when present", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "rag.result",
      )?.[1];
      expect(handler).toBeDefined();

      mockLaneB.getRequiredDisclaimers.mockReturnValue([]);
      handler({
        type: "rag.result",
        session_id: "test-session-id",
        payload: {
          disclaimers: ["rag-disc-1", "rag-disc-2"],
        },
      });
      expect(mockLaneB.setRequiredDisclaimers).toHaveBeenCalledWith([
        "rag-disc-1",
        "rag-disc-2",
      ]);
    });

    it("does not set disclaimers when RAG disclaimers array is empty", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "rag.result",
      )?.[1];

      handler({
        type: "rag.result",
        session_id: "test-session-id",
        payload: { disclaimers: [] },
      });
      expect(mockLaneB.setRequiredDisclaimers).not.toHaveBeenCalled();
    });

    it("treats non-array disclaimers as empty array", async () => {
      await connectClient();
      const handler = mockEventBus.on.mock.calls.find(
        ([event]: [string]) => event === "rag.result",
      )?.[1];

      handler({
        type: "rag.result",
        session_id: "test-session-id",
        payload: { disclaimers: null },
      });
      expect(mockLaneB.setRequiredDisclaimers).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  // 8. handleClose
  // ================================================================
  describe("handleClose", () => {
    it("removes policyDecisionHandler from eventBus", async () => {
      const { mockWs } = await connectClient();
      mockWs.emit("close");
      expect(mockEventBus.off).toHaveBeenCalledWith(
        "policy.decision",
        expect.any(Function),
      );
    });

    it("removes ragResultHandler from eventBus", async () => {
      const { mockWs } = await connectClient();
      mockWs.emit("close");
      expect(mockEventBus.off).toHaveBeenCalledWith(
        "rag.result",
        expect.any(Function),
      );
    });

    it("ends the arbitrator session", async () => {
      const { mockWs } = await connectClient();
      mockWs.emit("close");
      expect(mockArbitrator.endSession).toHaveBeenCalled();
    });

    it("stops fallback planner", async () => {
      const { mockWs } = await connectClient();
      mockWs.emit("close");
      expect(mockFallbackPlanner.stop).toHaveBeenCalled();
    });

    it("destroys control engine", async () => {
      const { mockWs } = await connectClient();
      mockWs.emit("close");
      expect(mockControlEngine.destroy).toHaveBeenCalled();
    });

    it("disconnects Lane B", async () => {
      const { mockWs } = await connectClient();
      mockWs.emit("close");
      expect(mockLaneB.disconnect).toHaveBeenCalled();
    });

    it("ends session in SessionManager and removes connection from map", async () => {
      const { server, mockWs } = await connectClient();
      expect(server.getConnectionCount()).toBe(1);
      mockWs.emit("close");
      expect(mockSessionManager.endSession).toHaveBeenCalledWith(
        "test-session-id",
        "connection_closed",
      );
      expect(server.getConnectionCount()).toBe(0);
    });

    it("saves conversation summary when persistentMemory is enabled and userId is set", async () => {
      (config as any).features.enablePersistentMemory = true;
      const { mockWs } = await connectClient();

      // We need to set userId on the connection. Trigger session.start with fingerprint.
      mockLaneB.isConnected.mockReturnValue(false);
      mockWs.emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "session.start",
            fingerprint: "test-fp",
          }),
        ),
      );
      await new Promise((r) => setTimeout(r, 20));

      // Clear mocks before close to isolate
      (getSessionHistory as jest.Mock).mockClear();
      (getTranscriptStore as jest.Mock).mockClear();

      mockWs.emit("close");

      expect(getSessionHistory).toHaveBeenCalled();
      expect(getTranscriptStore).toHaveBeenCalled();
    });
  });

  // ================================================================
  // 9. handleError
  // ================================================================
  describe("handleError", () => {
    it("emits session.error event to eventBus", async () => {
      const { mockWs } = await connectClient();
      const error = new Error("Connection lost");
      mockWs.emit("error", error);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.error",
          source: "orchestrator",
          session_id: "test-session-id",
          payload: { error: "Connection lost" },
        }),
      );
    });

    it("logs the error to console", async () => {
      const { mockWs } = await connectClient();
      const error = new Error("Test error");
      mockWs.emit("error", error);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in session"),
        error,
      );
    });
  });

  // ================================================================
  // 10. sendToClient
  // ================================================================
  describe("sendToClient", () => {
    it("sends JSON when ws.readyState is OPEN (1)", async () => {
      const { mockWs } = await connectClient();
      // session.ready was already sent during connection
      expect(mockWs.send).toHaveBeenCalled();
      const firstMsg = parseSent(mockWs, 0);
      expect(firstMsg.type).toBe("session.ready");
    });

    it("does NOT send when ws.readyState is not OPEN", async () => {
      const { mockWs } = await connectClient();
      mockWs.send.mockClear();

      // Change readyState to CLOSED
      mockWs.readyState = 3;

      // Trigger an event that would send to client
      mockArbitrator.emit("state_change", {
        from: "LISTENING",
        to: "B_RESPONDING",
        cause: "speech_ended",
      });
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  // 11. getConnectionCount
  // ================================================================
  describe("getConnectionCount", () => {
    it("returns the number of active connections", async () => {
      const server = new VoiceWebSocketServer({} as any);
      expect(server.getConnectionCount()).toBe(0);

      const connectionHandler = mockWssOn.mock.calls.find(
        ([event]: [string]) => event === "connection",
      )?.[1];

      const ws1 = createMockWs();
      await connectionHandler(ws1);
      expect(server.getConnectionCount()).toBe(1);

      const ws2 = createMockWs();
      await connectionHandler(ws2);
      expect(server.getConnectionCount()).toBe(2);

      // Close one
      ws1.emit("close");
      expect(server.getConnectionCount()).toBe(1);
    });
  });
});
