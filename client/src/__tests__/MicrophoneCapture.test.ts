/**
 * MicrophoneCapture Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MicrophoneCapture } from "../audio/MicrophoneCapture";
import { mockMediaDevices, MockMediaStream } from "./setup";

describe("MicrophoneCapture", () => {
  let micCapture: MicrophoneCapture;

  beforeEach(() => {
    // Reset the mock and provide implementation
    mockMediaDevices.getUserMedia.mockReset();
    mockMediaDevices.getUserMedia.mockResolvedValue(new MockMediaStream());
    micCapture = new MicrophoneCapture();
  });

  afterEach(() => {
    micCapture.cleanup();
  });

  describe("initialize", () => {
    it("should request microphone permissions", async () => {
      await micCapture.initialize();

      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000,
        },
      });
    });

    it("should set initialized state after success", async () => {
      await micCapture.initialize();

      expect(micCapture.isInitialized()).toBe(true);
    });

    it("should reject when permission denied", async () => {
      mockMediaDevices.getUserMedia.mockRejectedValueOnce(
        new Error("Permission denied"),
      );

      await expect(micCapture.initialize()).rejects.toThrow();
      expect(micCapture.isInitialized()).toBe(false);
    });
  });

  describe("start", () => {
    it("should start capturing when initialized", async () => {
      await micCapture.initialize();
      const callback = vi.fn();

      micCapture.start(callback);

      expect(micCapture.isActive()).toBe(true);
    });

    it("should throw when not initialized", () => {
      const callback = vi.fn();

      expect(() => micCapture.start(callback)).toThrow();
    });
  });

  describe("stop", () => {
    it("should stop capturing", async () => {
      await micCapture.initialize();
      const callback = vi.fn();

      micCapture.start(callback);
      micCapture.stop();

      expect(micCapture.isActive()).toBe(false);
    });

    it("should not throw when not capturing", () => {
      expect(() => micCapture.stop()).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should release all resources", async () => {
      await micCapture.initialize();
      const callback = vi.fn();
      micCapture.start(callback);

      micCapture.cleanup();

      expect(micCapture.isInitialized()).toBe(false);
      expect(micCapture.isActive()).toBe(false);
    });
  });

  describe("float32ToPCM16", () => {
    it("should convert Float32Array to PCM16", () => {
      const float32 = new Float32Array([0, 0.5, -0.5, 1, -1]);
      const pcm16 = MicrophoneCapture.float32ToPCM16(float32);

      expect(pcm16.byteLength).toBe(float32.length * 2);

      const view = new Int16Array(pcm16);
      expect(view[0]).toBe(0);
      // 0.5 * 32767 = 16383.5 -> rounds to 16383
      expect(Math.abs(view[1] - 16383)).toBeLessThanOrEqual(1);
      // -0.5 * 32767 = -16383.5 -> rounds to -16383 or -16384
      expect(Math.abs(view[2] + 16383)).toBeLessThanOrEqual(1);
      // 1 * 32767 = 32767 (max positive)
      expect(view[3]).toBe(32767);
      // -1 * 32767 = -32767 (not -32768 due to formula)
      expect(view[4]).toBe(-32767);
    });

    it("should handle empty array", () => {
      const float32 = new Float32Array([]);
      const pcm16 = MicrophoneCapture.float32ToPCM16(float32);

      expect(pcm16.byteLength).toBe(0);
    });
  });
});
