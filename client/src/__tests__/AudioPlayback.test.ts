/**
 * AudioPlayback Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioPlayback } from "../audio/AudioPlayback";

describe("AudioPlayback", () => {
  let audioPlayback: AudioPlayback;

  beforeEach(() => {
    vi.clearAllMocks();
    audioPlayback = new AudioPlayback();
  });

  afterEach(() => {
    audioPlayback.cleanup();
  });

  describe("initialize", () => {
    it("should create audio context", async () => {
      await audioPlayback.initialize();

      expect(audioPlayback.isActive()).toBe(false);
    });

    it("should not throw on double initialization", async () => {
      await audioPlayback.initialize();

      await expect(audioPlayback.initialize()).resolves.toBeUndefined();
    });
  });

  describe("enqueueAudio", () => {
    it("should accept audio data when initialized", async () => {
      await audioPlayback.initialize();

      // Create PCM16 audio data (2 bytes per sample)
      const pcm16Data = new ArrayBuffer(4800 * 2); // 100ms at 24kHz

      await expect(
        audioPlayback.enqueueAudio(pcm16Data),
      ).resolves.toBeUndefined();
    });

    it("should handle empty buffer", async () => {
      await audioPlayback.initialize();
      const emptyBuffer = new ArrayBuffer(0);

      await expect(
        audioPlayback.enqueueAudio(emptyBuffer),
      ).resolves.toBeUndefined();
    });
  });

  describe("stop", () => {
    it("should stop playback immediately", async () => {
      await audioPlayback.initialize();

      // Enqueue some audio
      const pcm16Data = new ArrayBuffer(4800 * 2);
      await audioPlayback.enqueueAudio(pcm16Data);

      audioPlayback.stop();

      expect(audioPlayback.isActive()).toBe(false);
    });

    it("should not throw when not playing", async () => {
      await audioPlayback.initialize();

      expect(() => audioPlayback.stop()).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should release resources", async () => {
      await audioPlayback.initialize();
      const pcm16Data = new ArrayBuffer(4800 * 2);
      await audioPlayback.enqueueAudio(pcm16Data);

      audioPlayback.cleanup();

      expect(audioPlayback.isActive()).toBe(false);
    });

    it("should not throw when not initialized", () => {
      expect(() => audioPlayback.cleanup()).not.toThrow();
    });
  });

  describe("setOnPlaybackEnd", () => {
    it("should register callback", async () => {
      await audioPlayback.initialize();
      const callback = vi.fn();

      audioPlayback.setOnPlaybackEnd(callback);

      // Callback is registered but won't be called until playback ends
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getQueueSize", () => {
    it("should return 0 for empty queue", async () => {
      await audioPlayback.initialize();

      expect(audioPlayback.getQueueSize()).toBe(0);
    });
  });
});
