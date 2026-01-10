/**
 * Vitest setup file
 * Mocks browser APIs for testing
 */

import { vi } from "vitest";

// Mock Web Audio API
class MockAudioContext {
  state = "running";
  sampleRate = 48000; // Native browser rate (browsers don't support 24kHz)
  destination = {};
  currentTime = 0;

  createGain() {
    return {
      gain: { value: 1, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createScriptProcessor() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

// Mock MediaStream
class MockMediaStream {
  active = true;
  id = "mock-stream-id";

  getTracks() {
    return [
      {
        stop: vi.fn(),
        kind: "audio",
        enabled: true,
        getSettings: () => ({
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
      },
    ];
  }

  getAudioTracks() {
    return this.getTracks();
  }
}

// Mock MediaDevices
const mockMediaDevices = {
  getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
};

// Assign mocks to global
Object.defineProperty(globalThis, "AudioContext", {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(globalThis, "webkitAudioContext", {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(globalThis.navigator, "mediaDevices", {
  writable: true,
  value: mockMediaDevices,
});

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "Normal closure" });
  });
}

Object.defineProperty(globalThis, "WebSocket", {
  writable: true,
  value: MockWebSocket,
});

// Mock atob/btoa
globalThis.atob = (str: string) =>
  Buffer.from(str, "base64").toString("binary");
globalThis.btoa = (str: string) =>
  Buffer.from(str, "binary").toString("base64");

export { MockAudioContext, MockMediaStream, MockWebSocket, mockMediaDevices };
