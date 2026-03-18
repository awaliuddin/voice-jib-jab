/**
 * VoiceClient unit tests.
 *
 * Uses a mock WebSocket that captures sent messages and allows
 * simulating server messages, open, close, and error events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceClient } from "../VoiceClient.js";
import type { VoiceClientCallbacks, TranscriptEvent, PolicyEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WSHandler = ((...args: unknown[]) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: WSHandler = null;
  onmessage: WSHandler = null;
  onerror: WSHandler = null;
  onclose: WSHandler = null;

  constructor(public url: string) {
    // Store instance so tests can drive it
    MockWebSocket.lastInstance = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // --- Test helpers ---

  static lastInstance: MockWebSocket | null = null;

  /** Simulate the WebSocket opening. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  /** Simulate receiving a server message. */
  simulateMessage(data: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  /** Simulate a WebSocket error. */
  simulateError(): void {
    this.onerror?.({} as Event);
  }

  /** Simulate the WebSocket closing. */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  /** Parse the last sent message as JSON. */
  lastSentJson(): Record<string, unknown> | null {
    if (this.sent.length === 0) return null;
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalWebSocket: typeof globalThis.WebSocket;

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  MockWebSocket.lastInstance = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions() {
  return { url: "ws://localhost:3000" };
}

/** Drive a client through to the ready state. Returns the mock WS. */
function driveToReady(client: VoiceClient, sessionId = "sess-123"): MockWebSocket {
  const promise = client.connect();
  const ws = MockWebSocket.lastInstance!;
  ws.simulateOpen();
  ws.simulateMessage({ type: "session.ready", sessionId });
  // We don't await here -- caller can if needed
  void promise;
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceClient", () => {
  // --- Constructor ---

  describe("constructor", () => {
    it("accepts options and optional callbacks", () => {
      const onReady = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onReady });
      expect(client.state).toBe("disconnected");
      expect(client.sessionId).toBeNull();
      expect(client.connected).toBe(false);
    });

    it("works without callbacks", () => {
      const client = new VoiceClient(defaultOptions());
      expect(client.state).toBe("disconnected");
    });

    it("uses default timeout and reconnect values", () => {
      // Just ensuring no errors on construction with minimal options
      const client = new VoiceClient({ url: "ws://localhost:9999" });
      expect(client.connected).toBe(false);
    });
  });

  // --- connect() ---

  describe("connect()", () => {
    it("sends session.start on WebSocket open", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;

      ws.simulateOpen();
      expect(ws.lastSentJson()).toEqual({ type: "session.start" });

      ws.simulateMessage({ type: "session.ready", sessionId: "s1" });
      await connectPromise;
    });

    it("sends session config fields when provided", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect({
        tenantId: "org_acme",
        fingerprint: "fp-abc",
        voiceMode: "open-mic",
        userAgent: "test/1.0",
      });
      const ws = MockWebSocket.lastInstance!;

      ws.simulateOpen();
      expect(ws.lastSentJson()).toEqual({
        type: "session.start",
        tenantId: "org_acme",
        fingerprint: "fp-abc",
        voiceMode: "open-mic",
        userAgent: "test/1.0",
      });

      ws.simulateMessage({ type: "session.ready", sessionId: "s2" });
      await connectPromise;
    });

    it("resolves with sessionId on session.ready", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;

      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "sess-42" });

      const result = await connectPromise;
      expect(result).toBe("sess-42");
    });

    it("transitions state disconnected -> connecting -> ready", async () => {
      const client = new VoiceClient(defaultOptions());
      expect(client.state).toBe("disconnected");

      const connectPromise = client.connect();
      expect(client.state).toBe("connecting");

      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "s1" });

      await connectPromise;
      expect(client.state).toBe("ready");
    });

    it("rejects on connection timeout", async () => {
      vi.useFakeTimers();
      const client = new VoiceClient({
        url: "ws://localhost:3000",
        connectTimeoutMs: 100,
      });

      const connectPromise = client.connect();

      // Advance past timeout without opening
      vi.advanceTimersByTime(150);

      await expect(connectPromise).rejects.toThrow("Connection timeout");
      expect(client.state).toBe("error");

      vi.useRealTimers();
    });

    it("rejects on session.error from server", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;

      ws.simulateOpen();
      ws.simulateMessage({ type: "session.error", message: "Unauthorized" });

      await expect(connectPromise).rejects.toThrow("Unauthorized");
      expect(client.state).toBe("error");
    });

    it("rejects on WebSocket error during connect", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;

      ws.simulateError();

      await expect(connectPromise).rejects.toThrow("WebSocket error");
      expect(client.state).toBe("error");
    });

    it("throws if already connecting", async () => {
      const client = new VoiceClient(defaultOptions());
      const p1 = client.connect();

      expect(() => client.connect()).toThrow("Already connected or connecting");

      // Clean up: drive to ready so p1 resolves
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "s1" });
      await p1;
    });
  });

  // --- sendAudio() ---

  describe("sendAudio()", () => {
    it("sends audio.chunk with base64 data", async () => {
      const client = new VoiceClient(defaultOptions());
      const ws = driveToReady(client);

      client.sendAudio("AQID");
      expect(ws.lastSentJson()).toEqual({ type: "audio.chunk", data: "AQID" });
    });

    it("throws when not connected", () => {
      const client = new VoiceClient(defaultOptions());
      expect(() => client.sendAudio("data")).toThrow("Client is not connected");
    });
  });

  // --- stopAudio() ---

  describe("stopAudio()", () => {
    it("sends audio.stop message", () => {
      const client = new VoiceClient(defaultOptions());
      const ws = driveToReady(client);

      client.stopAudio();
      const msg = ws.lastSentJson()!;
      expect(msg.type).toBe("audio.stop");
      expect(msg.timestamp).toBeTypeOf("number");
    });
  });

  // --- cancelAudio() ---

  describe("cancelAudio()", () => {
    it("sends audio.cancel message", () => {
      const client = new VoiceClient(defaultOptions());
      const ws = driveToReady(client);

      client.cancelAudio();
      expect(ws.lastSentJson()).toEqual({ type: "audio.cancel" });
    });
  });

  // --- playbackEnded() ---

  describe("playbackEnded()", () => {
    it("sends playback.ended message", () => {
      const client = new VoiceClient(defaultOptions());
      const ws = driveToReady(client);

      client.playbackEnded();
      const msg = ws.lastSentJson()!;
      expect(msg.type).toBe("playback.ended");
      expect(msg.timestamp).toBeTypeOf("number");
    });
  });

  // --- on() ---

  describe("on()", () => {
    it("registers callbacks after construction", async () => {
      const client = new VoiceClient(defaultOptions());
      const onReady = vi.fn();
      client.on({ onReady });

      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "s1" });
      await connectPromise;

      expect(onReady).toHaveBeenCalledWith("s1");
    });

    it("merges with existing callbacks", async () => {
      const onError = vi.fn();
      const onReady = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onError });
      client.on({ onReady });

      // Both callbacks should be present
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "s1" });
      await connectPromise;

      expect(onReady).toHaveBeenCalled();
      // onError should still be registered (not overwritten)
      // We verify by triggering it later if needed
    });
  });

  // --- endSession() ---

  describe("endSession()", () => {
    it("sends session.end and transitions to disconnected", () => {
      const client = new VoiceClient(defaultOptions());
      const ws = driveToReady(client);

      client.endSession();

      expect(ws.lastSentJson()).toEqual({ type: "session.end" });
      expect(client.state).toBe("disconnected");
      expect(client.sessionId).toBeNull();
      expect(client.connected).toBe(false);
    });
  });

  // --- Callbacks ---

  describe("callbacks", () => {
    it("calls onReady with sessionId", async () => {
      const onReady = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onReady });

      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "ready-1" });
      await connectPromise;

      expect(onReady).toHaveBeenCalledWith("ready-1");
    });

    it("calls onAudio with base64 data", () => {
      const onAudio = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onAudio });
      const ws = driveToReady(client);

      ws.simulateMessage({ type: "audio.chunk", data: "bXlkYXRh" });
      expect(onAudio).toHaveBeenCalledWith("bXlkYXRh");
    });

    it("calls onTranscript for assistant transcript", () => {
      const onTranscript = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onTranscript });
      const ws = driveToReady(client);

      ws.simulateMessage({ type: "transcript", text: "Hello", is_final: true });
      expect(onTranscript).toHaveBeenCalledWith({
        text: "Hello",
        isFinal: true,
        role: "assistant",
      } satisfies TranscriptEvent);
    });

    it("calls onTranscript for user transcript", () => {
      const onTranscript = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onTranscript });
      const ws = driveToReady(client);

      ws.simulateMessage({ type: "user_transcript", text: "Hi", is_final: false });
      expect(onTranscript).toHaveBeenCalledWith({
        text: "Hi",
        isFinal: false,
        role: "user",
      } satisfies TranscriptEvent);
    });

    it("calls onPolicyEvent with decision details", () => {
      const onPolicyEvent = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onPolicyEvent });
      const ws = driveToReady(client);

      ws.simulateMessage({
        type: "policy.decision",
        decision: "rewrite",
        reason_codes: ["PII_DETECTED"],
        severity: 7,
        safe_rewrite: "I can help with that.",
      });

      expect(onPolicyEvent).toHaveBeenCalledWith({
        decision: "rewrite",
        reasonCodes: ["PII_DETECTED"],
        severity: 7,
        safeRewrite: "I can help with that.",
      } satisfies PolicyEvent);
    });

    it("calls onResponseStart", () => {
      const onResponseStart = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onResponseStart });
      const ws = driveToReady(client);

      ws.simulateMessage({ type: "response.start" });
      expect(onResponseStart).toHaveBeenCalledOnce();
    });

    it("calls onResponseEnd", () => {
      const onResponseEnd = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onResponseEnd });
      const ws = driveToReady(client);

      ws.simulateMessage({ type: "response.end" });
      expect(onResponseEnd).toHaveBeenCalledOnce();
    });

    it("calls onError on session error during active session", () => {
      const onError = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onError });
      const ws = driveToReady(client);

      ws.simulateMessage({ type: "session.error", message: "Rate limited" });
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Rate limited" }));
    });

    it("calls onClose when WebSocket closes", () => {
      const onClose = vi.fn();
      const client = new VoiceClient(defaultOptions(), { onClose });
      const ws = driveToReady(client);

      ws.simulateClose();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  // --- sessionId ---

  describe("sessionId", () => {
    it("is null before connect", () => {
      const client = new VoiceClient(defaultOptions());
      expect(client.sessionId).toBeNull();
    });

    it("is populated after ready", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "abc-123" });
      await connectPromise;

      expect(client.sessionId).toBe("abc-123");
    });
  });

  // --- connected ---

  describe("connected", () => {
    it("is false before ready", () => {
      const client = new VoiceClient(defaultOptions());
      expect(client.connected).toBe(false);
    });

    it("is true after ready", async () => {
      const client = new VoiceClient(defaultOptions());
      const connectPromise = client.connect();
      const ws = MockWebSocket.lastInstance!;
      ws.simulateOpen();
      ws.simulateMessage({ type: "session.ready", sessionId: "s1" });
      await connectPromise;

      expect(client.connected).toBe(true);
    });

    it("is false after endSession", () => {
      const client = new VoiceClient(defaultOptions());
      driveToReady(client);

      client.endSession();
      expect(client.connected).toBe(false);
    });
  });
});
