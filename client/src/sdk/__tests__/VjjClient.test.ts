/**
 * VjjClient SDK Unit Tests
 *
 * Uses the MockWebSocket provided by the global test setup (setup.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VjjClient } from "../VjjClient";
import type { VjjClientOptions } from "../VjjClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Access the underlying MockWebSocket instance from the client. */
function getWs(client: VjjClient): {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: Event) => void) | null;
  readyState: number;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).ws;
}

function simulateServerMessage(client: VjjClient, msg: Record<string, unknown>): void {
  const ws = getWs(client);
  ws?.onmessage?.({ data: JSON.stringify(msg) });
}

function defaultOptions(overrides: Partial<VjjClientOptions> = {}): VjjClientOptions {
  return { url: "ws://localhost:3000", ...overrides };
}

/**
 * Connect a client: start the connect promise, advance timers just enough
 * for MockWebSocket's setTimeout(0) to fire onopen, then simulate
 * session.ready before the 5s connect timeout fires.
 */
async function connectClient(
  client: VjjClient,
  sessionId = "sess_abc123",
): Promise<void> {
  const p = client.connect();
  // Advance just enough for MockWebSocket's setTimeout(0) onopen callback
  await vi.advanceTimersByTimeAsync(1);
  // Server responds with session.ready
  simulateServerMessage(client, {
    type: "session.ready",
    sessionId,
    timestamp: Date.now(),
  });
  await p;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VjjClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("should initialise with default state", () => {
      const client = new VjjClient(defaultOptions());
      expect(client.state).toBe("disconnected");
      expect(client.connected).toBe(false);
      expect(client.sessionId).toBeNull();
    });

    it("should accept custom options", () => {
      const client = new VjjClient(
        defaultOptions({
          tenantId: "org_test",
          fingerprint: "fp_123",
          voiceMode: "open-mic",
          reconnect: true,
          reconnectDelay: 5000,
        }),
      );
      expect(client.state).toBe("disconnected");
    });
  });

  // -------------------------------------------------------------------------
  // connect()
  // -------------------------------------------------------------------------

  describe("connect()", () => {
    it("should resolve on session.ready", async () => {
      const client = new VjjClient(defaultOptions());
      await connectClient(client);

      expect(client.state).toBe("ready");
      expect(client.connected).toBe(true);
      expect(client.sessionId).toBe("sess_abc123");
    });

    it("should send session.start with tenantId and fingerprint on open", async () => {
      const client = new VjjClient(
        defaultOptions({
          tenantId: "org_acme",
          fingerprint: "fp_xyz",
          voiceMode: "push-to-talk",
        }),
      );
      const p = client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = getWs(client);
      expect(ws.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe("session.start");
      expect(sent.tenantId).toBe("org_acme");
      expect(sent.fingerprint).toBe("fp_xyz");
      expect(sent.voiceMode).toBe("push-to-talk");

      simulateServerMessage(client, {
        type: "session.ready",
        sessionId: "sess_1",
        timestamp: Date.now(),
      });
      await p;
    });

    it("should reject on session.error", async () => {
      const client = new VjjClient(defaultOptions());
      // Attach error listener to prevent EventEmitter from throwing
      const errorSpy = vi.fn();
      client.on("error", errorSpy);

      const p = client.connect();
      await vi.advanceTimersByTimeAsync(1);

      simulateServerMessage(client, {
        type: "session.error",
        code: "AUTH_FAILED",
        message: "Invalid tenant",
        timestamp: Date.now(),
      });

      await expect(p).rejects.toThrow("Invalid tenant");
      expect(client.state).toBe("error");
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it("should reject on timeout", async () => {
      const client = new VjjClient(defaultOptions());
      // Attach error listener to prevent unhandled rejection from close event
      client.on("error", () => {});

      const p = client.connect();
      await vi.advanceTimersByTimeAsync(1); // onopen fires

      // Set up the rejection handler before advancing timers to avoid
      // vitest flagging it as an unhandled rejection.
      const rejection = expect(p).rejects.toThrow("Connection timeout");

      // Advance past the 5s timeout without sending session.ready
      await vi.advanceTimersByTimeAsync(6_000);

      await rejection;
      expect(client.state).toBe("error");
    });

    it("should transition state to connecting immediately", () => {
      const client = new VjjClient(defaultOptions());
      client.connect().catch(() => {
        /* swallow */
      });
      expect(client.state).toBe("connecting");
    });

    it("should reject if already connecting", async () => {
      const client = new VjjClient(defaultOptions());
      client.connect().catch(() => {
        /* swallow */
      });

      await expect(client.connect()).rejects.toThrow(
        "Already connected or connecting",
      );
    });

    it("should emit 'ready' event with sessionId", async () => {
      const client = new VjjClient(defaultOptions());
      const readySpy = vi.fn();
      client.on("ready", readySpy);

      await connectClient(client, "sess_emit");

      expect(readySpy).toHaveBeenCalledWith("sess_emit");
    });
  });

  // -------------------------------------------------------------------------
  // Send methods
  // -------------------------------------------------------------------------

  describe("send methods", () => {
    let client: VjjClient;

    beforeEach(async () => {
      client = new VjjClient(defaultOptions());
      await connectClient(client);
    });

    it("sendAudioChunk sends audio.chunk message", () => {
      client.sendAudioChunk("AQID");
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("audio.chunk");
      expect(sent.data).toBe("AQID");
    });

    it("sendAudioStop sends audio.stop message", () => {
      client.sendAudioStop();
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("audio.stop");
      expect(sent.timestamp).toBeTypeOf("number");
    });

    it("sendAudioCancel sends audio.cancel message", () => {
      client.sendAudioCancel();
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("audio.cancel");
    });

    it("commitAudio sends audio.commit message", () => {
      client.commitAudio();
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("audio.commit");
    });

    it("bargeIn sends user.barge_in message", () => {
      client.bargeIn();
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("user.barge_in");
    });

    it("playbackEnded sends playback.ended message", () => {
      client.playbackEnded();
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("playback.ended");
      expect(sent.timestamp).toBeTypeOf("number");
    });

    it("setMode sends session.set_mode with correct mode", () => {
      client.setMode("open-mic");
      const ws = getWs(client);
      const sent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(sent.type).toBe("session.set_mode");
      expect(sent.mode).toBe("open-mic");
    });

    it("should throw when not connected", () => {
      const disconnected = new VjjClient(defaultOptions());
      expect(() => disconnected.sendAudioChunk("x")).toThrow(
        "Client is not connected",
      );
      expect(() => disconnected.sendAudioStop()).toThrow(
        "Client is not connected",
      );
      expect(() => disconnected.sendAudioCancel()).toThrow(
        "Client is not connected",
      );
      expect(() => disconnected.commitAudio()).toThrow(
        "Client is not connected",
      );
      expect(() => disconnected.bargeIn()).toThrow("Client is not connected");
      expect(() => disconnected.playbackEnded()).toThrow(
        "Client is not connected",
      );
      expect(() => disconnected.setMode("push-to-talk")).toThrow(
        "Client is not connected",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Events — server messages routed to typed events
  // -------------------------------------------------------------------------

  describe("events", () => {
    let client: VjjClient;

    beforeEach(async () => {
      client = new VjjClient(defaultOptions());
      await connectClient(client);
    });

    it("emits 'audio' on audio.chunk message", () => {
      const spy = vi.fn();
      client.on("audio", spy);

      simulateServerMessage(client, {
        type: "audio.chunk",
        data: "base64audio",
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledWith("base64audio");
    });

    it("emits 'transcript' on transcript message with isFinal", () => {
      const spy = vi.fn();
      client.on("transcript", spy);

      simulateServerMessage(client, {
        type: "transcript",
        text: "Hello world",
        is_final: true,
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledWith({ text: "Hello world", isFinal: true });
    });

    it("emits 'transcript' with isFinal false for partial transcripts", () => {
      const spy = vi.fn();
      client.on("transcript", spy);

      simulateServerMessage(client, {
        type: "transcript",
        text: "Hel",
        is_final: false,
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledWith({ text: "Hel", isFinal: false });
    });

    it("emits 'userTranscript' on user_transcript message", () => {
      const spy = vi.fn();
      client.on("userTranscript", spy);

      simulateServerMessage(client, {
        type: "user_transcript",
        text: "What time is it?",
        is_final: true,
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledWith({
        text: "What time is it?",
        isFinal: true,
      });
    });

    it("emits 'policyDecision' on policy.decision message", () => {
      const spy = vi.fn();
      client.on("policyDecision", spy);

      simulateServerMessage(client, {
        type: "policy.decision",
        decision: "rewrite",
        reason_codes: ["PII_DETECTED", "TONE_AGGRESSIVE"],
        severity: "medium",
        safe_rewrite: "I can help with that.",
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledWith({
        decision: "rewrite",
        reasonCodes: ["PII_DETECTED", "TONE_AGGRESSIVE"],
        severity: "medium",
        safeRewrite: "I can help with that.",
      });
    });

    it("emits 'policyDecision' without safeRewrite when absent", () => {
      const spy = vi.fn();
      client.on("policyDecision", spy);

      simulateServerMessage(client, {
        type: "policy.decision",
        decision: "refuse",
        reason_codes: ["PROHIBITED_TOPIC"],
        severity: "high",
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledWith({
        decision: "refuse",
        reasonCodes: ["PROHIBITED_TOPIC"],
        severity: "high",
        safeRewrite: undefined,
      });
    });

    it("emits 'responseStart' on response.start", () => {
      const spy = vi.fn();
      client.on("responseStart", spy);
      simulateServerMessage(client, { type: "response.start", timestamp: Date.now() });
      expect(spy).toHaveBeenCalledOnce();
    });

    it("emits 'responseEnd' on response.end", () => {
      const spy = vi.fn();
      client.on("responseEnd", spy);
      simulateServerMessage(client, { type: "response.end", timestamp: Date.now() });
      expect(spy).toHaveBeenCalledOnce();
    });

    it("emits 'speechStarted' on speech.started", () => {
      const spy = vi.fn();
      client.on("speechStarted", spy);
      simulateServerMessage(client, { type: "speech.started", timestamp: Date.now() });
      expect(spy).toHaveBeenCalledOnce();
    });

    it("emits 'speechStopped' on speech.stopped", () => {
      const spy = vi.fn();
      client.on("speechStopped", spy);
      simulateServerMessage(client, { type: "speech.stopped", timestamp: Date.now() });
      expect(spy).toHaveBeenCalledOnce();
    });

    it("emits 'providerReady' on provider.ready", () => {
      const spy = vi.fn();
      client.on("providerReady", spy);
      simulateServerMessage(client, { type: "provider.ready", timestamp: Date.now() });
      expect(spy).toHaveBeenCalledOnce();
    });

    it("emits 'error' on session.error", () => {
      const spy = vi.fn();
      client.on("error", spy);

      simulateServerMessage(client, {
        type: "session.error",
        code: "RATE_LIMIT",
        message: "Too many requests",
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(spy.mock.calls[0][0].message).toBe("Too many requests");
    });
  });

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  describe("state", () => {
    it("starts as disconnected", () => {
      const client = new VjjClient(defaultOptions());
      expect(client.state).toBe("disconnected");
    });

    it("transitions to connecting on connect()", () => {
      const client = new VjjClient(defaultOptions());
      client.connect().catch(() => {});
      expect(client.state).toBe("connecting");
    });

    it("transitions to ready on session.ready", async () => {
      const client = new VjjClient(defaultOptions());
      await connectClient(client);
      expect(client.state).toBe("ready");
    });

    it("transitions to error on session.error", async () => {
      const client = new VjjClient(defaultOptions());
      // Attach error listener to prevent EventEmitter from throwing
      client.on("error", () => {});

      const p = client.connect();
      await vi.advanceTimersByTimeAsync(1);

      simulateServerMessage(client, {
        type: "session.error",
        code: "ERR",
        message: "fail",
        timestamp: Date.now(),
      });

      await p.catch(() => {});
      expect(client.state).toBe("error");
    });
  });

  // -------------------------------------------------------------------------
  // disconnect()
  // -------------------------------------------------------------------------

  describe("disconnect()", () => {
    it("sends session.end and transitions to disconnected", async () => {
      const client = new VjjClient(defaultOptions());
      await connectClient(client);

      const ws = getWs(client);
      client.disconnect();

      const lastSent = JSON.parse(ws.send.mock.lastCall[0]);
      expect(lastSent.type).toBe("session.end");
      expect(client.state).toBe("disconnected");
      expect(client.connected).toBe(false);
    });

    it("clears sessionId", async () => {
      const client = new VjjClient(defaultOptions());
      await connectClient(client);
      expect(client.sessionId).not.toBeNull();

      client.disconnect();
      expect(client.sessionId).toBeNull();
    });

    it("emits close event on WebSocket close", async () => {
      const client = new VjjClient(defaultOptions());
      await connectClient(client);

      const spy = vi.fn();
      client.on("close", spy);

      // Simulate server-initiated close
      const ws = getWs(client);
      ws.onclose?.({ code: 1000, reason: "bye" });

      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // sessionId
  // -------------------------------------------------------------------------

  describe("sessionId", () => {
    it("is null before connect", () => {
      const client = new VjjClient(defaultOptions());
      expect(client.sessionId).toBeNull();
    });

    it("is populated after session.ready", async () => {
      const client = new VjjClient(defaultOptions());
      await connectClient(client, "sess_populated");
      expect(client.sessionId).toBe("sess_populated");
    });
  });
});
