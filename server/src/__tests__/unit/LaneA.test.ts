/**
 * LaneA Unit Tests
 *
 * Tests the Lane A reflex engine that provides immediate acknowledgements
 * (e.g., "Mmhmm", "Yeah") while Lane B processes longer reasoning.
 *
 * Lane A uses pre-cached TTS audio for fast playback and streams audio
 * chunks via EventEmitter. All TTS and EventBus dependencies are mocked.
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

// Stable singleton mock so every getTTSInstance() call returns the same object
const mockTTS = {
  generateSpeech: jest.fn().mockResolvedValue(Buffer.alloc(4800)),
  preloadPhrases: jest.fn().mockResolvedValue(new Map()),
  setVoice: jest.fn(),
};

jest.mock("../../services/OpenAITTS.js", () => ({
  getTTSInstance: jest.fn(() => mockTTS),
}));

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
  },
}));

jest.mock("../../config/reflexWhitelist.js", () => ({
  REFLEX_WHITELIST: ["Mmhmm", "Yeah", "Okay"],
  getWeightedReflex: jest.fn(() => "Mmhmm"),
  getRandomReflex: jest.fn(() => "Mmhmm"),
  isApprovedReflex: jest.fn(() => true),
}));

import { LaneA } from "../../lanes/LaneA.js";
import { eventBus } from "../../orchestrator/EventBus.js";

// ── Helpers ─────────────────────────────────────────────────────────────

jest.useFakeTimers();

function createLaneA(
  config: Partial<import("../../lanes/LaneA.js").LaneAConfig> = {},
): LaneA {
  return new LaneA("test-session-001", config);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("LaneA", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore defaults after clearAllMocks wipes mock implementations
    mockTTS.generateSpeech.mockResolvedValue(Buffer.alloc(4800));
    mockTTS.preloadPhrases.mockResolvedValue(new Map());
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should create a LaneA instance with the given sessionId", () => {
      const lane = createLaneA();
      expect(lane).toBeInstanceOf(LaneA);
    });

    it("should apply default config when no overrides provided", () => {
      const lane = createLaneA();
      expect(lane.isEnabled()).toBe(true);
    });

    it("should merge provided config with defaults", () => {
      const lane = createLaneA({ enabled: false });
      expect(lane.isEnabled()).toBe(false);
    });

    it("should call TTS preloadPhrases during construction", () => {
      createLaneA();
      expect(mockTTS.preloadPhrases).toHaveBeenCalledWith([
        "Mmhmm",
        "Yeah",
        "Okay",
      ]);
    });
  });

  // ── isEnabled ───────────────────────────────────────────────────────

  describe("isEnabled()", () => {
    it("should return true by default", () => {
      const lane = createLaneA();
      expect(lane.isEnabled()).toBe(true);
    });

    it("should return false when config.enabled is false", () => {
      const lane = createLaneA({ enabled: false });
      expect(lane.isEnabled()).toBe(false);
    });
  });

  // ── getIsPlaying ────────────────────────────────────────────────────

  describe("getIsPlaying()", () => {
    it("should return false initially", () => {
      const lane = createLaneA();
      expect(lane.getIsPlaying()).toBe(false);
    });
  });

  // ── getCurrentUtterance ─────────────────────────────────────────────

  describe("getCurrentUtterance()", () => {
    it("should return null initially", () => {
      const lane = createLaneA();
      expect(lane.getCurrentUtterance()).toBeNull();
    });
  });

  // ── isReady ─────────────────────────────────────────────────────────

  describe("isReady()", () => {
    it("should return false before cache initialization completes", () => {
      const lane = createLaneA();
      // isReady is false because the async initializeAudioCache hasn't resolved
      expect(lane.isReady()).toBe(false);
    });

    it("should return true after cache initialization resolves", async () => {
      const lane = createLaneA();
      // Let the microtask queue flush so initializeAudioCache completes
      await jest.runAllTimersAsync();
      expect(lane.isReady()).toBe(true);
    });
  });

  // ── playReflex ──────────────────────────────────────────────────────

  describe("playReflex()", () => {
    it("should log and return without playing when disabled", async () => {
      const lane = createLaneA({ enabled: false });
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await lane.playReflex();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[LaneA] Disabled - skipping reflex",
      );
      expect(lane.getIsPlaying()).toBe(false);
      consoleSpy.mockRestore();
    });

    it("should skip when already playing", async () => {
      // Return large enough audio to keep streaming across multiple chunks
      mockTTS.generateSpeech.mockResolvedValue(Buffer.alloc(48000));

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Start first playback
      const firstPlay = lane.playReflex();
      // Allow the first play to set isPlaying=true
      await Promise.resolve();
      await Promise.resolve();

      expect(lane.getIsPlaying()).toBe(true);

      // Try to play again while first is still active
      await lane.playReflex();

      expect(consoleSpy).toHaveBeenCalledWith(
        "[LaneA] Already playing - skipping",
      );

      // Clean up
      lane.stop();
      await firstPlay;
      consoleSpy.mockRestore();
    });

    it("should set isPlaying to true and emit reflex event on success", async () => {
      mockTTS.generateSpeech.mockResolvedValue(Buffer.alloc(48000));

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      const playPromise = lane.playReflex();
      // Allow microtask to set isPlaying
      await Promise.resolve();
      await Promise.resolve();

      expect(lane.getIsPlaying()).toBe(true);
      expect(lane.getCurrentUtterance()).toBe("Mmhmm");
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "lane.a_reflex",
          source: "laneA",
          session_id: "test-session-001",
          payload: { utterance: "Mmhmm" },
        }),
      );

      lane.stop();
      await playPromise;
    });

    it("should emit audio chunks during streaming", async () => {
      // Create audio buffer: 2 chunks worth (9600 bytes = 2 x 4800)
      mockTTS.generateSpeech.mockResolvedValue(Buffer.alloc(9600));

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      const audioChunks: unknown[] = [];
      lane.on("audio", (chunk) => audioChunks.push(chunk));

      const playPromise = lane.playReflex();
      // First chunk is emitted synchronously in streamAudio
      await Promise.resolve();
      await Promise.resolve();

      // First chunk emitted immediately
      expect(audioChunks.length).toBeGreaterThanOrEqual(1);

      // Advance timer to trigger next chunk
      jest.advanceTimersByTime(100);

      expect(audioChunks.length).toBeGreaterThanOrEqual(2);

      lane.stop();
      await playPromise;
    });

    it("should stop after all audio chunks have been streamed", async () => {
      // Small buffer: exactly 1 chunk (4800 bytes)
      mockTTS.generateSpeech.mockResolvedValue(Buffer.alloc(4800));

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      const stoppedHandler = jest.fn();
      lane.on("stopped", stoppedHandler);

      await lane.playReflex();

      // First chunk streams, offset moves past audioData.length
      // Next streamChunk call should trigger stop
      jest.advanceTimersByTime(100);

      expect(stoppedHandler).toHaveBeenCalled();
      expect(lane.getIsPlaying()).toBe(false);
      expect(lane.getCurrentUtterance()).toBeNull();
    });

    it("should stop and warn when no audio is available", async () => {
      // generateSpeech throws, simulating TTS failure for uncached phrase
      mockTTS.generateSpeech.mockRejectedValue(
        new Error("TTS unavailable"),
      );

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      jest.spyOn(console, "warn").mockImplementation();
      jest.spyOn(console, "error").mockImplementation();
      jest.spyOn(console, "log").mockImplementation();

      await lane.playReflex();

      // getAudio tried generateSpeech which failed, returned null
      // playReflex should have called stop(), so isPlaying resets
      expect(lane.getIsPlaying()).toBe(false);
    });
  });

  // ── stop ────────────────────────────────────────────────────────────

  describe("stop()", () => {
    it("should be a no-op when not playing", () => {
      const lane = createLaneA();
      const stoppedHandler = jest.fn();
      lane.on("stopped", stoppedHandler);

      lane.stop();

      expect(stoppedHandler).not.toHaveBeenCalled();
    });

    it("should clear timer, reset state, and emit stopped event during playback", async () => {
      mockTTS.generateSpeech.mockResolvedValue(Buffer.alloc(48000));

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      const stoppedHandler = jest.fn();
      lane.on("stopped", stoppedHandler);

      const playPromise = lane.playReflex();
      await Promise.resolve();
      await Promise.resolve();

      expect(lane.getIsPlaying()).toBe(true);

      lane.stop();

      expect(lane.getIsPlaying()).toBe(false);
      expect(lane.getCurrentUtterance()).toBeNull();
      expect(stoppedHandler).toHaveBeenCalledTimes(1);

      await playPromise;
    });
  });

  // ── setVoice ────────────────────────────────────────────────────────

  describe("setVoice()", () => {
    it("should update config and call TTS setVoice", () => {
      const lane = createLaneA();

      lane.setVoice("nova");

      expect(mockTTS.setVoice).toHaveBeenCalledWith("nova");
    });
  });

  // ── preloadAudio ────────────────────────────────────────────────────

  describe("preloadAudio()", () => {
    it("should preload additional phrases via TTS", async () => {
      const mockMap = new Map([
        ["sure thing", Buffer.alloc(9600)],
        ["got it", Buffer.alloc(4800)],
      ]);
      mockTTS.preloadPhrases.mockResolvedValue(mockMap);

      const lane = createLaneA();
      await jest.runAllTimersAsync();

      await lane.preloadAudio(["Sure thing", "Got it"]);

      // preloadPhrases is called first during construction, then during preloadAudio
      expect(mockTTS.preloadPhrases).toHaveBeenCalledWith([
        "Sure thing",
        "Got it",
      ]);
    });
  });
});
