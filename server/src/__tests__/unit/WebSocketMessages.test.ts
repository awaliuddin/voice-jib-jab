/**
 * VoiceWebSocketServer Unit Tests — Message Handler (handleMessage)
 *
 * Tests every switch case inside handleMessage (lines 641-1012):
 *   session.start, audio.chunk, audio.stop, audio.cancel, playback.ended,
 *   audio.commit, user.barge_in, session.end, session.set_mode,
 *   default (unknown type), and JSON parse errors.
 */

import { EventEmitter } from "events";

// ── Stable mock references ──────────────────────────────────────────
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

let mockArbitrator: ReturnType<typeof createMockLaneArbitrator>;
let mockLaneA: ReturnType<typeof createMockLaneA>;
let mockLaneB: ReturnType<typeof createMockLaneB>;
let mockControlEngine: ReturnType<typeof createMockControlEngine>;
let mockFallbackPlanner: ReturnType<typeof createMockFallbackPlanner>;

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

import { VoiceWebSocketServer } from "../../api/websocket.js";
import { config } from "../../config/index.js";
import { getSessionHistory, getTranscriptStore } from "../../storage/index.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockWs() {
  const ws = new EventEmitter();
  (ws as any).readyState = 1; // OPEN
  (ws as any).send = jest.fn();
  (ws as any).close = jest.fn();
  return ws as any;
}

async function setupConnection() {
  const server = new VoiceWebSocketServer({});
  const connectionHandler = mockWssOn.mock.calls.find(
    ([e]: [string]) => e === "connection",
  )?.[1];
  const mockWs = createMockWs();
  await connectionHandler(mockWs);
  return { server, mockWs };
}

async function sendMessage(mockWs: any, message: object) {
  const messageHandlers = mockWs.listeners("message");
  const handler = messageHandlers[0];
  await handler(Buffer.from(JSON.stringify(message)));
}

function createLoudAudioBase64(rms = 10000, samples = 100): string {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(rms, i * 2);
  }
  return buf.toString("base64");
}

function createSilentAudioBase64(samples = 100): string {
  return Buffer.alloc(samples * 2).toString("base64");
}

/** Extract all parsed JSON messages sent via ws.send() */
function getSentMessages(mockWs: any): any[] {
  return mockWs.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}

/** Find first sent message matching a type */
function findSentMessage(mockWs: any, type: string): any | undefined {
  return getSentMessages(mockWs).find((m: any) => m.type === type);
}

// ── Test Suite ──────────────────────────────────────────────────────

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  jest.setSystemTime(1000000);
  mockArbitrator = createMockLaneArbitrator();
  mockLaneA = createMockLaneA();
  mockLaneB = createMockLaneB();
  mockControlEngine = createMockControlEngine();
  mockFallbackPlanner = createMockFallbackPlanner();
  jest.spyOn(console, "log").mockImplementation();
  jest.spyOn(console, "warn").mockImplementation();
  jest.spyOn(console, "error").mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  jest.useFakeTimers();
});

// ────────────────────────────────────────────────────────────────────
// session.start
// ────────────────────────────────────────────────────────────────────
describe("session.start", () => {
  it("resets audioStopped to false", async () => {
    const { mockWs } = await setupConnection();

    // Trigger audio.stop first so audioStopped becomes true
    mockLaneB.isConnected.mockReturnValue(true);
    await sendMessage(mockWs, { type: "audio.stop" });

    // Now send session.start — audioStopped should reset
    mockLaneB.isConnected.mockReturnValue(false);
    await sendMessage(mockWs, { type: "session.start" });

    // Verify audio gate is open by sending audio.chunk
    // and confirming it gets past the audioStopped gate
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });
    expect(mockLaneB.sendAudio).toHaveBeenCalled();
  });

  it("connects Lane B and starts arbitrator when not already connected", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(false);

    await sendMessage(mockWs, { type: "session.start" });

    expect(mockLaneB.connect).toHaveBeenCalled();
    expect(mockArbitrator.startSession).toHaveBeenCalled();
    expect(mockSessionManager.updateSessionState).toHaveBeenCalledWith(
      "test-session-id",
      "listening",
    );
  });

  it("reuses existing Lane B connection if already connected", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);

    await sendMessage(mockWs, { type: "session.start" });

    expect(mockLaneB.connect).not.toHaveBeenCalled();
    expect(mockArbitrator.startSession).not.toHaveBeenCalled();
  });

  it("sends provider.ready with default context when persistent memory is off", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(false);

    await sendMessage(mockWs, { type: "session.start" });

    const ready = findSentMessage(mockWs, "provider.ready");
    expect(ready).toBeDefined();
    expect(ready.isReturningUser).toBe(false);
    expect(ready.previousSessionCount).toBe(0);
    expect(ready.voiceMode).toBe("push-to-talk");
    expect(ready.timestamp).toBe(1000000);
  });

  it("sets voice mode to push-to-talk when provided", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(false);

    await sendMessage(mockWs, {
      type: "session.start",
      voiceMode: "push-to-talk",
    });

    expect(mockLaneB.setVoiceMode).toHaveBeenCalledWith("push-to-talk");
    const ready = findSentMessage(mockWs, "provider.ready");
    expect(ready.voiceMode).toBe("push-to-talk");
  });

  it("sets voice mode to open-mic when provided", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(false);

    await sendMessage(mockWs, {
      type: "session.start",
      voiceMode: "open-mic",
    });

    expect(mockLaneB.setVoiceMode).toHaveBeenCalledWith("open-mic");
    const ready = findSentMessage(mockWs, "provider.ready");
    expect(ready.voiceMode).toBe("open-mic");
  });

  it("ignores invalid voice mode and keeps default", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(false);

    await sendMessage(mockWs, {
      type: "session.start",
      voiceMode: "invalid-mode",
    });

    expect(mockLaneB.setVoiceMode).not.toHaveBeenCalled();
    const ready = findSentMessage(mockWs, "provider.ready");
    expect(ready.voiceMode).toBe("push-to-talk");
  });

  describe("with persistent memory enabled", () => {
    beforeEach(() => {
      (config as any).features.enablePersistentMemory = true;
    });
    afterEach(() => {
      (config as any).features.enablePersistentMemory = false;
    });

    it("creates user from fingerprint and records session", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-123" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-abc",
        userAgent: "TestAgent/1.0",
      });

      expect(getSessionHistory).toHaveBeenCalled();
      expect(mockHistory.getOrCreateUser).toHaveBeenCalledWith("fp-abc", {
        userAgent: "TestAgent/1.0",
        createdFromSession: "test-session-id",
      });
      expect(mockHistory.recordSession).toHaveBeenCalled();
      expect(mockHistory.getSessionContext).toHaveBeenCalled();
    });

    it("falls back to anon-{sessionId} when no fingerprint provided", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-123" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, { type: "session.start" });

      expect(mockHistory.getOrCreateUser).toHaveBeenCalledWith(
        "anon-test-session-id",
        expect.objectContaining({
          createdFromSession: "test-session-id",
        }),
      );
    });

    it("sends provider.ready with returning user context", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-123" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: true,
          previousSessionCount: 5,
          conversationSummary: "Previous chat about widgets",
        })),
        generateSessionSummary: jest.fn(),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-returning",
      });

      const ready = findSentMessage(mockWs, "provider.ready");
      expect(ready.isReturningUser).toBe(true);
      expect(ready.previousSessionCount).toBe(5);

      // Verify context injection into Lane B
      expect(mockLaneB.setConversationContext).toHaveBeenCalledWith(
        "Previous chat about widgets",
      );
    });

    it("logs returning user info when isReturningUser is true", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-returning" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: true,
          previousSessionCount: 3,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-ret",
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Returning user"),
      );
    });

    it("does not inject conversation context when summary is null", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-new" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, { type: "session.start" });

      expect(mockLaneB.setConversationContext).not.toHaveBeenCalled();
    });

    it("catches and logs session context errors without crashing", async () => {
      (getSessionHistory as jest.Mock).mockImplementation(() => {
        throw new Error("DB connection failed");
      });

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      // Should not throw
      await sendMessage(mockWs, { type: "session.start" });

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to setup session context"),
        expect.any(Error),
      );

      // Should still send provider.ready
      const ready = findSentMessage(mockWs, "provider.ready");
      expect(ready).toBeDefined();
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// audio.chunk — 6 gates
// ────────────────────────────────────────────────────────────────────
describe("audio.chunk", () => {
  it("gate 1: drops audio when audioStopped is true", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);

    // Stop audio first
    await sendMessage(mockWs, { type: "audio.stop" });
    mockLaneB.sendAudio.mockClear();

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("gate 2: drops audio when Lane B is not connected", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(false);

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("gate 3: drops audio when arbitrator state is not LISTENING", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("B_RESPONDING");

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("gate 4: drops audio during cooldown after lastResponseEndTime", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    // First establish connection
    mockLaneB.isConnected.mockReturnValue(false);
    await sendMessage(mockWs, { type: "session.start" });
    mockLaneB.isConnected.mockReturnValue(true);

    // Simulate a Lane B response.done event by triggering the handler
    // We need to set lastResponseEndTime. The server sets it via lane handlers.
    // Instead, we can use playback.ended to set lastPlaybackEndTime.
    jest.setSystemTime(999000); // Set playback end time
    await sendMessage(mockWs, { type: "playback.ended" });

    // Now move time forward within the 1500ms cooldown
    jest.setSystemTime(999000 + 1000); // 1000ms after — still within 1500ms cooldown

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("gate 4: passes audio after cooldown has elapsed", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    // Set playback end time
    jest.setSystemTime(999000);
    await sendMessage(mockWs, { type: "playback.ended" });

    // Move time well past the 1500ms cooldown
    jest.setSystemTime(999000 + 2000);

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).toHaveBeenCalled();
  });

  it("gate 4: skips cooldown check when cooldownAnchor is 0", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    // No playback or response end has occurred, so both timestamps are 0
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).toHaveBeenCalled();
  });

  it("gate 5: drops audio when RMS energy is below threshold (silence)", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createSilentAudioBase64(),
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("gate 5: drops audio when RMS is below MIN_AUDIO_RMS (199)", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(100), // RMS=100 which is < 200
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("gate 6 (success): forwards loud audio to Lane B", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    const audioData = createLoudAudioBase64(10000);
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: audioData,
    });

    expect(mockLaneB.sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "pcm",
        sampleRate: 24000,
      }),
    );
  });

  it("uses provided format and sampleRate when specified", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
      format: "opus",
      sampleRate: 48000,
    });

    expect(mockLaneB.sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "opus",
        sampleRate: 48000,
      }),
    );
  });

  it("emits audio.chunk event to eventBus on success", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio.chunk",
        source: "client",
        session_id: "test-session-id",
      }),
    );
  });

  it("touches session on successful audio forwarding", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockSessionManager.touchSession).toHaveBeenCalledWith(
      "test-session-id",
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// audio.stop
// ────────────────────────────────────────────────────────────────────
describe("audio.stop", () => {
  it("sets audioStopped and clears input buffer", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);

    await sendMessage(mockWs, { type: "audio.stop" });

    expect(mockLaneB.clearInputBuffer).toHaveBeenCalled();

    // Verify audioStopped by attempting audio.chunk
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });
    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("cancels Lane B when a response is in progress", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.getIsResponding.mockReturnValue(true);

    await sendMessage(mockWs, { type: "audio.stop" });

    expect(mockLaneB.cancel).toHaveBeenCalled();
  });

  it("does not cancel Lane B when no response is in progress", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.getIsResponding.mockReturnValue(false);

    await sendMessage(mockWs, { type: "audio.stop" });

    expect(mockLaneB.cancel).not.toHaveBeenCalled();
  });

  it("resets arbitrator when in B_RESPONDING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("B_RESPONDING");

    await sendMessage(mockWs, { type: "audio.stop" });

    expect(mockArbitrator.resetResponseInProgress).toHaveBeenCalled();
  });

  it("resets arbitrator when in B_PLAYING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("B_PLAYING");

    await sendMessage(mockWs, { type: "audio.stop" });

    expect(mockArbitrator.resetResponseInProgress).toHaveBeenCalled();
  });

  it("does not reset arbitrator when in LISTENING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, { type: "audio.stop" });

    expect(mockArbitrator.resetResponseInProgress).not.toHaveBeenCalled();
  });

  it("sends audio.stop.ack and response.end", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "audio.stop" });

    const ack = findSentMessage(mockWs, "audio.stop.ack");
    const end = findSentMessage(mockWs, "response.end");

    expect(ack).toBeDefined();
    expect(ack.timestamp).toBe(1000000);
    expect(end).toBeDefined();
    expect(end.timestamp).toBe(1000000);
  });
});

// ────────────────────────────────────────────────────────────────────
// audio.cancel
// ────────────────────────────────────────────────────────────────────
describe("audio.cancel", () => {
  it("sets audioStopped and clears input buffer", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);

    await sendMessage(mockWs, { type: "audio.cancel" });

    expect(mockLaneB.clearInputBuffer).toHaveBeenCalled();

    // Verify audioStopped by attempting audio.chunk
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });
    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("cancels Lane B when a response is in progress", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.getIsResponding.mockReturnValue(true);

    await sendMessage(mockWs, { type: "audio.cancel" });

    expect(mockLaneB.cancel).toHaveBeenCalled();
  });

  it("does not cancel Lane B when no response is in progress", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.getIsResponding.mockReturnValue(false);

    await sendMessage(mockWs, { type: "audio.cancel" });

    expect(mockLaneB.cancel).not.toHaveBeenCalled();
  });

  it("resets arbitrator when in B_RESPONDING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("B_RESPONDING");

    await sendMessage(mockWs, { type: "audio.cancel" });

    expect(mockArbitrator.resetResponseInProgress).toHaveBeenCalled();
  });

  it("resets arbitrator when in B_PLAYING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("B_PLAYING");

    await sendMessage(mockWs, { type: "audio.cancel" });

    expect(mockArbitrator.resetResponseInProgress).toHaveBeenCalled();
  });

  it("does not reset arbitrator when in LISTENING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, { type: "audio.cancel" });

    expect(mockArbitrator.resetResponseInProgress).not.toHaveBeenCalled();
  });

  it("sends audio.cancel.ack (NOT audio.stop.ack) and response.end", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "audio.cancel" });

    const cancelAck = findSentMessage(mockWs, "audio.cancel.ack");
    const stopAck = findSentMessage(mockWs, "audio.stop.ack");
    const end = findSentMessage(mockWs, "response.end");

    expect(cancelAck).toBeDefined();
    expect(cancelAck.timestamp).toBe(1000000);
    expect(stopAck).toBeUndefined();
    expect(end).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// playback.ended
// ────────────────────────────────────────────────────────────────────
describe("playback.ended", () => {
  it("updates lastPlaybackEndTime to current time", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    jest.setSystemTime(500000);
    await sendMessage(mockWs, { type: "playback.ended" });

    // Verify the cooldown anchor is set by sending audio within cooldown
    jest.setSystemTime(500000 + 1000); // 1000ms < 1500ms cooldown

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// audio.commit
// ────────────────────────────────────────────────────────────────────
describe("audio.commit", () => {
  it("sets audioStopped to true", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, { type: "audio.commit" });

    // Verify audioStopped by sending audio chunk
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });
    expect(mockLaneB.sendAudio).not.toHaveBeenCalled();
  });

  it("calls onUserSpeechEnded when arbitrator is in LISTENING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, { type: "audio.commit" });

    expect(mockArbitrator.onUserSpeechEnded).toHaveBeenCalled();
  });

  it("does NOT call onUserSpeechEnded when arbitrator is NOT in LISTENING state", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("B_RESPONDING");

    await sendMessage(mockWs, { type: "audio.commit" });

    expect(mockArbitrator.onUserSpeechEnded).not.toHaveBeenCalled();
  });

  it("calls laneB.commitAudio()", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");

    await sendMessage(mockWs, { type: "audio.commit" });

    expect(mockLaneB.commitAudio).toHaveBeenCalled();
  });

  it("does not send commit.skipped when commit succeeds", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");
    mockLaneB.commitAudio.mockResolvedValue(true);

    await sendMessage(mockWs, { type: "audio.commit" });

    // commit.skipped uses ws.send directly, not sendToClient
    const allSent = getSentMessages(mockWs);
    const skipped = allSent.find((m) => m.type === "commit.skipped");
    expect(skipped).toBeUndefined();
  });

  it("sends commit.skipped via ws.send when commit returns false", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");
    mockLaneB.commitAudio.mockResolvedValue(false);

    await sendMessage(mockWs, { type: "audio.commit" });

    // commit.skipped is sent via ws.send() directly (not sendToClient)
    const allSent = getSentMessages(mockWs);
    const skipped = allSent.find((m) => m.type === "commit.skipped");
    expect(skipped).toBeDefined();
    expect(skipped.reason).toBe("buffer_too_small");
    expect(skipped.timestamp).toBe(1000000);
  });

  it("resets arbitrator and re-enables audio when commit fails", async () => {
    const { mockWs } = await setupConnection();
    mockArbitrator.getState.mockReturnValue("LISTENING");
    mockLaneB.commitAudio.mockResolvedValue(false);

    await sendMessage(mockWs, { type: "audio.commit" });

    expect(mockArbitrator.resetResponseInProgress).toHaveBeenCalled();

    // Verify audioStopped is false again (re-enabled)
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");
    mockLaneB.sendAudio.mockClear();

    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });

    expect(mockLaneB.sendAudio).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// user.barge_in
// ────────────────────────────────────────────────────────────────────
describe("user.barge_in", () => {
  it("clears audioStopped (re-enables audio acceptance)", async () => {
    const { mockWs } = await setupConnection();
    mockLaneB.isConnected.mockReturnValue(true);
    mockArbitrator.getState.mockReturnValue("LISTENING");

    // Stop audio first
    await sendMessage(mockWs, { type: "audio.stop" });
    mockLaneB.sendAudio.mockClear();

    // Barge in should re-enable audio
    await sendMessage(mockWs, { type: "user.barge_in" });

    // Audio should now flow again
    await sendMessage(mockWs, {
      type: "audio.chunk",
      data: createLoudAudioBase64(),
    });
    expect(mockLaneB.sendAudio).toHaveBeenCalled();
  });

  it("calls arbitrator.onUserBargeIn()", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "user.barge_in" });

    expect(mockArbitrator.onUserBargeIn).toHaveBeenCalled();
  });

  it("sends user.barge_in.ack", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "user.barge_in" });

    const ack = findSentMessage(mockWs, "user.barge_in.ack");
    expect(ack).toBeDefined();
    expect(ack.timestamp).toBe(1000000);
  });

  it("emits barge-in event to eventBus", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "user.barge_in" });

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user.barge_in",
        source: "client",
        session_id: "test-session-id",
      }),
    );
  });

  it("updates session state to listening", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "user.barge_in" });

    expect(mockSessionManager.updateSessionState).toHaveBeenCalledWith(
      "test-session-id",
      "listening",
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// session.end
// ────────────────────────────────────────────────────────────────────
describe("session.end", () => {
  it("ends arbitrator session and disconnects Lane B", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "session.end" });

    expect(mockArbitrator.endSession).toHaveBeenCalled();
    expect(mockLaneB.disconnect).toHaveBeenCalled();
  });

  it("ends session in session manager and closes WS", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "session.end" });

    expect(mockSessionManager.endSession).toHaveBeenCalledWith(
      "test-session-id",
      "user_ended",
    );
    expect(mockWs.close).toHaveBeenCalled();
  });

  it("does not save summary when persistent memory is disabled", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "session.end" });

    expect(getSessionHistory).not.toHaveBeenCalled();
  });

  describe("with persistent memory enabled", () => {
    beforeEach(() => {
      (config as any).features.enablePersistentMemory = true;
    });
    afterEach(() => {
      (config as any).features.enablePersistentMemory = false;
    });

    it("does not save summary when userId is null", async () => {
      // userId is null by default (no session.start with persistent memory)
      (config as any).features.enablePersistentMemory = false;
      const { mockWs } = await setupConnection();
      (config as any).features.enablePersistentMemory = true;

      // Clear any calls from setup
      (getSessionHistory as jest.Mock).mockClear();

      await sendMessage(mockWs, { type: "session.end" });

      // getSessionHistory should not be called in session.end
      // when userId is null, but it may have been called during setup
      expect(
        (getSessionHistory as jest.Mock).mock.calls.filter(
          // filter for calls happening after clear
          () => true,
        ).length,
      ).toBe(0);
    });

    it("saves summary when userId exists and turnCount > 0", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-save" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(() => "Session summary text"),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      const mockTranscript = {
        save: jest.fn(),
        getSessionTurnCount: jest.fn(() => 3),
        cleanupNonFinal: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);
      (getTranscriptStore as jest.Mock).mockReturnValue(mockTranscript);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      // First do session.start to set userId
      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-save",
      });

      await sendMessage(mockWs, { type: "session.end" });

      expect(mockHistory.generateSessionSummary).toHaveBeenCalledWith(
        "test-session-id",
      );
      expect(mockHistory.saveConversationSummary).toHaveBeenCalledWith(
        "user-save",
        "test-session-id",
        "Session summary text",
        3,
      );
      expect(mockHistory.endSession).toHaveBeenCalledWith(
        "test-session-id",
        "user_ended",
      );
      expect(mockTranscript.cleanupNonFinal).toHaveBeenCalledWith(
        "test-session-id",
      );
    });

    it("does not save summary when turnCount is 0", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-zero" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(() => "Some summary"),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      const mockTranscript = {
        save: jest.fn(),
        getSessionTurnCount: jest.fn(() => 0),
        cleanupNonFinal: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);
      (getTranscriptStore as jest.Mock).mockReturnValue(mockTranscript);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-zero",
      });

      await sendMessage(mockWs, { type: "session.end" });

      expect(mockHistory.saveConversationSummary).not.toHaveBeenCalled();
    });

    it("does not save summary when summary is null/empty", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-null-sum" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(() => null),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      const mockTranscript = {
        save: jest.fn(),
        getSessionTurnCount: jest.fn(() => 5),
        cleanupNonFinal: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);
      (getTranscriptStore as jest.Mock).mockReturnValue(mockTranscript);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-nullsum",
      });

      await sendMessage(mockWs, { type: "session.end" });

      expect(mockHistory.saveConversationSummary).not.toHaveBeenCalled();
    });

    it("catches and logs errors during summary save without crashing", async () => {
      const mockHistory = {
        getOrCreateUser: jest.fn(() => ({ id: "user-err" })),
        recordSession: jest.fn(),
        getSessionContext: jest.fn(() => ({
          isReturningUser: false,
          previousSessionCount: 0,
          conversationSummary: null,
        })),
        generateSessionSummary: jest.fn(() => {
          throw new Error("DB write failed");
        }),
        saveConversationSummary: jest.fn(),
        endSession: jest.fn(),
      };
      (getSessionHistory as jest.Mock).mockReturnValue(mockHistory);

      const { mockWs } = await setupConnection();
      mockLaneB.isConnected.mockReturnValue(false);

      await sendMessage(mockWs, {
        type: "session.start",
        fingerprint: "fp-err",
      });

      // Should not throw
      await sendMessage(mockWs, { type: "session.end" });

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save session summary"),
        expect.any(Error),
      );

      // Should still close the connection
      expect(mockWs.close).toHaveBeenCalled();
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// session.set_mode
// ────────────────────────────────────────────────────────────────────
describe("session.set_mode", () => {
  it("sets mode to push-to-talk and notifies client", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, {
      type: "session.set_mode",
      voiceMode: "push-to-talk",
    });

    expect(mockLaneB.setVoiceMode).toHaveBeenCalledWith("push-to-talk");
    const modeChanged = findSentMessage(mockWs, "session.mode_changed");
    expect(modeChanged).toBeDefined();
    expect(modeChanged.voiceMode).toBe("push-to-talk");
    expect(modeChanged.timestamp).toBe(1000000);
  });

  it("sets mode to open-mic and notifies client", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, {
      type: "session.set_mode",
      voiceMode: "open-mic",
    });

    expect(mockLaneB.setVoiceMode).toHaveBeenCalledWith("open-mic");
    const modeChanged = findSentMessage(mockWs, "session.mode_changed");
    expect(modeChanged).toBeDefined();
    expect(modeChanged.voiceMode).toBe("open-mic");
  });

  it("rejects invalid voice mode with warning", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, {
      type: "session.set_mode",
      voiceMode: "walkie-talkie",
    });

    expect(mockLaneB.setVoiceMode).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid voice mode"),
    );

    // No mode_changed message should be sent
    const modeChanged = findSentMessage(mockWs, "session.mode_changed");
    expect(modeChanged).toBeUndefined();
  });

  it("rejects undefined voice mode", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "session.set_mode" });

    expect(mockLaneB.setVoiceMode).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid voice mode"),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// default (unknown type)
// ────────────────────────────────────────────────────────────────────
describe("unknown message type", () => {
  it("logs a warning for unknown message types", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "banana.split" });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown message type: banana.split"),
    );
  });

  it("does not crash or send error on unknown types", async () => {
    const { mockWs } = await setupConnection();

    await sendMessage(mockWs, { type: "nonexistent.action" });

    const errorMsg = findSentMessage(mockWs, "error");
    expect(errorMsg).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// JSON parse error
// ────────────────────────────────────────────────────────────────────
describe("JSON parse error", () => {
  it("sends error message when JSON parsing fails", async () => {
    const { mockWs } = await setupConnection();

    // Send invalid JSON directly
    const messageHandlers = mockWs.listeners("message");
    const handler = messageHandlers[0];
    await handler(Buffer.from("not-valid-json{{{"));

    const errorMsg = findSentMessage(mockWs, "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg.error).toEqual(expect.any(String));
    expect(errorMsg.timestamp).toBe(1000000);
  });

  it("uses error.message when error is an Error instance", async () => {
    const { mockWs } = await setupConnection();

    const messageHandlers = mockWs.listeners("message");
    const handler = messageHandlers[0];
    await handler(Buffer.from("{invalid json}"));

    const errorMsg = findSentMessage(mockWs, "error");
    expect(errorMsg).toBeDefined();
    // JSON.parse throws a SyntaxError which is an Error instance.
    // The exact message varies by Node.js version, so just verify
    // it is a non-empty string (confirming error.message was used).
    expect(typeof errorMsg.error).toBe("string");
    expect(errorMsg.error.length).toBeGreaterThan(0);
  });

  it("logs the error to console.error", async () => {
    const { mockWs } = await setupConnection();

    const messageHandlers = mockWs.listeners("message");
    const handler = messageHandlers[0];
    await handler(Buffer.from("<<<>>>"));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Error handling message"),
      expect.any(Error),
    );
  });
});
