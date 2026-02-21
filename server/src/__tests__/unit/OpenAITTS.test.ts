/**
 * OpenAITTS Unit Tests
 *
 * Tests the OpenAI TTS service that generates speech audio via the
 * OpenAI API and caches results for fast replay. The OpenAI client
 * and config module are fully mocked so no real API calls are made.
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

const mockSpeechCreate = jest.fn().mockResolvedValue({
  arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(4800)),
});

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      audio: {
        speech: {
          create: mockSpeechCreate,
        },
      },
    })),
  };
});

jest.mock("../../config/index.js", () => ({
  config: {
    openai: { apiKey: "test-key" },
  },
}));

import { OpenAITTS, getTTSInstance } from "../../services/OpenAITTS.js";
import OpenAI from "openai";

// ── Tests ───────────────────────────────────────────────────────────────

describe("OpenAITTS", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default resolved value after clearAllMocks wipes it
    mockSpeechCreate.mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(4800)),
    });
    // Suppress console output during tests
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should create an instance with default config", () => {
      const tts = new OpenAITTS();
      expect(tts).toBeInstanceOf(OpenAITTS);
      expect(OpenAI).toHaveBeenCalledWith({ apiKey: "test-key" });
    });

    it("should create an OpenAI client on construction", () => {
      new OpenAITTS();
      expect(OpenAI).toHaveBeenCalledTimes(1);
    });

    it("should merge partial config with defaults", () => {
      const tts = new OpenAITTS({ voice: "nova" });
      expect(tts).toBeInstanceOf(OpenAITTS);
    });

    it("should accept speed override", () => {
      const tts = new OpenAITTS({ speed: 1.5 });
      expect(tts).toBeInstanceOf(OpenAITTS);
    });
  });

  // ── generateSpeech ──────────────────────────────────────────────────

  describe("generateSpeech()", () => {
    it("should call OpenAI API on cache miss and return buffer", async () => {
      const tts = new OpenAITTS();
      const result = await tts.generateSpeech("Hello");

      expect(mockSpeechCreate).toHaveBeenCalledTimes(1);
      expect(mockSpeechCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "tts-1",
          voice: "alloy",
          input: "Hello",
          response_format: "pcm",
          speed: 1.0,
        }),
      );
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(4800);
    });

    it("should return cached buffer on cache hit without calling API", async () => {
      const tts = new OpenAITTS();

      // First call populates cache
      const first = await tts.generateSpeech("Hello");
      expect(mockSpeechCreate).toHaveBeenCalledTimes(1);

      // Second call should hit cache
      const second = await tts.generateSpeech("Hello");
      expect(mockSpeechCreate).toHaveBeenCalledTimes(1); // Still 1
      expect(second).toBe(first); // Same buffer reference
    });

    it("should use separate cache keys for different texts", async () => {
      const tts = new OpenAITTS();

      await tts.generateSpeech("Hello");
      await tts.generateSpeech("Goodbye");

      expect(mockSpeechCreate).toHaveBeenCalledTimes(2);
    });

    it("should use voice in cache key so different voices are cached separately", async () => {
      const tts = new OpenAITTS({ voice: "alloy" });
      await tts.generateSpeech("Hello");

      // Change voice and request same text
      tts.setVoice("nova");
      await tts.generateSpeech("Hello");

      // setVoice clears cache, so API is called again
      expect(mockSpeechCreate).toHaveBeenCalledTimes(2);
    });

    it("should throw when OpenAI API fails", async () => {
      mockSpeechCreate.mockRejectedValue(new Error("API rate limited"));

      const tts = new OpenAITTS();

      await expect(tts.generateSpeech("Hello")).rejects.toThrow(
        "API rate limited",
      );
    });

    it("should use configured voice in API call", async () => {
      const tts = new OpenAITTS({ voice: "shimmer" });
      await tts.generateSpeech("Test");

      expect(mockSpeechCreate).toHaveBeenCalledWith(
        expect.objectContaining({ voice: "shimmer" }),
      );
    });

    it("should use configured speed in API call", async () => {
      const tts = new OpenAITTS({ speed: 1.25 });
      await tts.generateSpeech("Test");

      expect(mockSpeechCreate).toHaveBeenCalledWith(
        expect.objectContaining({ speed: 1.25 }),
      );
    });
  });

  // ── preloadPhrases ──────────────────────────────────────────────────

  describe("preloadPhrases()", () => {
    it("should preload phrases and return a Map of results", async () => {
      const tts = new OpenAITTS();
      const results = await tts.preloadPhrases(["Mmhmm", "Yeah"]);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(2);
      expect(results.has("mmhmm")).toBe(true);
      expect(results.has("yeah")).toBe(true);
    });

    it("should call generateSpeech for each phrase", async () => {
      const tts = new OpenAITTS();
      await tts.preloadPhrases(["One", "Two", "Three"]);

      expect(mockSpeechCreate).toHaveBeenCalledTimes(3);
    });

    it("should process phrases in batches of 3", async () => {
      // Track concurrent calls to verify batching
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockSpeechCreate.mockImplementation(() => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        return Promise.resolve({
          arrayBuffer: () => {
            currentConcurrent--;
            return Promise.resolve(new ArrayBuffer(4800));
          },
        });
      });

      const tts = new OpenAITTS();
      await tts.preloadPhrases(["A", "B", "C", "D", "E"]);

      // First batch is 3, second batch is 2
      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(mockSpeechCreate).toHaveBeenCalledTimes(5);
    });

    it("should handle individual phrase failures without breaking batch", async () => {
      let callCount = 0;
      mockSpeechCreate.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("TTS failed for phrase 2"));
        }
        return Promise.resolve({
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(new ArrayBuffer(4800)),
        });
      });

      const tts = new OpenAITTS();
      const results = await tts.preloadPhrases(["Good", "Bad", "Fine"]);

      // "Bad" failed, so only 2 out of 3 should be in the map
      expect(results.size).toBe(2);
      expect(results.has("good")).toBe(true);
      expect(results.has("bad")).toBe(false);
      expect(results.has("fine")).toBe(true);
    });

    it("should return empty map when all phrases fail", async () => {
      mockSpeechCreate.mockRejectedValue(new Error("All fail"));

      const tts = new OpenAITTS();
      const results = await tts.preloadPhrases(["A", "B"]);

      expect(results.size).toBe(0);
    });

    it("should return empty map for empty input array", async () => {
      const tts = new OpenAITTS();
      const results = await tts.preloadPhrases([]);

      expect(results.size).toBe(0);
      expect(mockSpeechCreate).not.toHaveBeenCalled();
    });

    it("should store results with lowercased keys", async () => {
      const tts = new OpenAITTS();
      const results = await tts.preloadPhrases(["HELLO", "World"]);

      expect(results.has("hello")).toBe(true);
      expect(results.has("world")).toBe(true);
      expect(results.has("HELLO")).toBe(false);
    });
  });

  // ── setVoice ────────────────────────────────────────────────────────

  describe("setVoice()", () => {
    it("should change the voice used in subsequent API calls", async () => {
      const tts = new OpenAITTS();
      tts.setVoice("nova");

      await tts.generateSpeech("Test");

      expect(mockSpeechCreate).toHaveBeenCalledWith(
        expect.objectContaining({ voice: "nova" }),
      );
    });

    it("should clear the cache when voice changes", async () => {
      const tts = new OpenAITTS();

      // Populate cache
      await tts.generateSpeech("Cached text");
      expect(mockSpeechCreate).toHaveBeenCalledTimes(1);

      // Change voice (clears cache)
      tts.setVoice("echo");

      // Same text should now miss cache
      await tts.generateSpeech("Cached text");
      expect(mockSpeechCreate).toHaveBeenCalledTimes(2);
    });
  });

  // ── clearCache ──────────────────────────────────────────────────────

  describe("clearCache()", () => {
    it("should empty the cache so next call hits API", async () => {
      const tts = new OpenAITTS();

      // Populate cache
      await tts.generateSpeech("Hello");
      expect(mockSpeechCreate).toHaveBeenCalledTimes(1);

      // Clear and re-request
      tts.clearCache();
      await tts.generateSpeech("Hello");
      expect(mockSpeechCreate).toHaveBeenCalledTimes(2);
    });

    it("should not throw when called on empty cache", () => {
      const tts = new OpenAITTS();
      expect(() => tts.clearCache()).not.toThrow();
    });
  });

  // ── getTTSInstance (singleton factory) ──────────────────────────────

  describe("getTTSInstance()", () => {
    it("should return an OpenAITTS instance", () => {
      const instance = getTTSInstance();
      expect(instance).toBeInstanceOf(OpenAITTS);
    });

    it("should return the same instance on repeated calls", () => {
      const first = getTTSInstance();
      const second = getTTSInstance();
      expect(first).toBe(second);
    });
  });
});
