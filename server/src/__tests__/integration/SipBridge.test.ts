/**
 * SipBridgeService Integration Tests — N-11 SIP Telephony Prototype
 *
 * Exercises StubSipTelephonyAdapter, StubSipCall, and SipBridgeService using
 * only in-process stubs — no real network, no real SIP stack.
 *
 * Structure:
 *   1. StubSipTelephonyAdapter — adapter lifecycle and test helpers
 *   2. StubSipCall            — per-call state tracking
 *   3. SipBridgeService       — call routing and session wiring
 */

import {
  StubSipTelephonyAdapter,
  StubSipCall,
  SipBridgeService,
} from "../../providers/SipTelephonyAdapter.js";
import type {
  SipSessionFactory,
  SipVoiceSession,
} from "../../providers/SipTelephonyAdapter.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal SipVoiceSession mock with jest.fn() for each method. */
function makeSessionMock(): jest.Mocked<SipVoiceSession> {
  const listeners: Array<(audio: Buffer) => void> = [];
  return {
    handleAudio: jest.fn(),
    onResponseAudio: jest.fn().mockImplementation((cb: (audio: Buffer) => void) => {
      listeners.push(cb);
    }),
    end: jest.fn(),
    // Expose listeners array via the mock so tests can trigger response audio.
    _listeners: listeners,
  } as unknown as jest.Mocked<SipVoiceSession>;
}

/** Build a SipSessionFactory mock that always returns the given session. */
function makeFactoryMock(session: jest.Mocked<SipVoiceSession>): jest.Mocked<SipSessionFactory> {
  return {
    createSession: jest.fn().mockReturnValue(session),
  };
}

/** Fire all onResponseAudio callbacks on a session mock. */
function fireResponseAudio(
  session: jest.Mocked<SipVoiceSession>,
  audio: Buffer,
): void {
  const listeners = (session as unknown as { _listeners: Array<(a: Buffer) => void> })._listeners;
  for (const cb of listeners) {
    cb(audio);
  }
}

// ── StubSipTelephonyAdapter ───────────────────────────────────────────────────

describe("StubSipTelephonyAdapter", () => {
  let adapter: StubSipTelephonyAdapter;

  beforeEach(() => {
    adapter = new StubSipTelephonyAdapter();
  });

  afterEach(async () => {
    await adapter.stop();
  });

  it("start() sets isListening() to true", async () => {
    expect(adapter.isListening()).toBe(false);
    await adapter.start();
    expect(adapter.isListening()).toBe(true);
  });

  it("stop() sets isListening() to false", async () => {
    await adapter.start();
    await adapter.stop();
    expect(adapter.isListening()).toBe(false);
  });

  it("start() is idempotent — second call is a no-op", async () => {
    const listeningEvents: number[] = [];
    adapter.on("listening", (port: number) => listeningEvents.push(port));

    await adapter.start(5060);
    await adapter.start(5060); // second call must not fire another event

    expect(listeningEvents).toHaveLength(1);
    expect(adapter.isListening()).toBe(true);
  });

  it("simulateInboundCall() emits 'call' event with a SipCall object", async () => {
    await adapter.start();
    const received: StubSipCall[] = [];
    adapter.on("call", (call: StubSipCall) => received.push(call));

    adapter.simulateInboundCall({ from: "sip:alice@example.com", to: "sip:ivr@company.com" });

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(StubSipCall);
    expect(received[0].from).toBe("sip:alice@example.com");
    expect(received[0].to).toBe("sip:ivr@company.com");
  });

  it("simulateInboundCall() uses the provided id when given", async () => {
    await adapter.start();
    const call = adapter.simulateInboundCall({
      from: "sip:alice@example.com",
      to: "sip:ivr@company.com",
      id: "fixed-id-001",
    });

    expect(call.id).toBe("fixed-id-001");
    expect(adapter.getActiveCall("fixed-id-001")).toBe(call);
  });

  it("simulateInboundCall() generates a UUID-style id when none provided", async () => {
    await adapter.start();
    const call = adapter.simulateInboundCall({
      from: "sip:bob@example.com",
      to: "sip:ivr@company.com",
    });

    // UUID v4 pattern: 8-4-4-4-12 hex chars
    expect(call.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("simulateAudioChunk() emits 'audio' event with (callId, chunk)", async () => {
    await adapter.start();
    const call = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    const received: Array<[string, Buffer]> = [];
    adapter.on("audio", (callId: string, chunk: Buffer) => received.push([callId, chunk]));

    const audio = Buffer.from([0x01, 0x02, 0x03]);
    adapter.simulateAudioChunk(call.id, audio);

    expect(received).toHaveLength(1);
    expect(received[0][0]).toBe(call.id);
    expect(received[0][1]).toStrictEqual(audio);
  });

  it("simulateAudioChunk() for an unknown callId is a no-op — does not throw", async () => {
    await adapter.start();
    const audioEvents: unknown[] = [];
    adapter.on("audio", () => audioEvents.push(true));

    expect(() =>
      adapter.simulateAudioChunk("does-not-exist", Buffer.from([0xff])),
    ).not.toThrow();

    expect(audioEvents).toHaveLength(0);
  });

  it("activeCallCount reflects the number of open calls", async () => {
    await adapter.start();
    expect(adapter.activeCallCount).toBe(0);

    const c1 = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    expect(adapter.activeCallCount).toBe(1);

    adapter.simulateInboundCall({ from: "sip:c@x.com", to: "sip:b@x.com" });
    expect(adapter.activeCallCount).toBe(2);

    // stop() hangs up all calls and clears the map
    await adapter.stop();
    expect(adapter.activeCallCount).toBe(0);
    expect(c1.hungUp).toBe(true);
  });

  it("stop() hangs up all active calls", async () => {
    await adapter.start();
    const c1 = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    const c2 = adapter.simulateInboundCall({ from: "sip:c@x.com", to: "sip:b@x.com" });

    await adapter.stop();

    expect(c1.hungUp).toBe(true);
    expect(c2.hungUp).toBe(true);
  });
});

// ── StubSipCall ───────────────────────────────────────────────────────────────

describe("StubSipCall", () => {
  let call: StubSipCall;

  beforeEach(() => {
    call = new StubSipCall("test-call-id", "sip:alice@example.com", "sip:ivr@company.com");
  });

  it("accept() sets accepted = true", async () => {
    expect(call.accepted).toBe(false);
    await call.accept();
    expect(call.accepted).toBe(true);
  });

  it("reject() sets rejected = true with default status 486", () => {
    expect(call.rejected).toBe(false);
    call.reject();
    expect(call.rejected).toBe(true);
    expect(call.rejectedStatusCode).toBe(486);
  });

  it("reject(503) stores the provided status code", () => {
    call.reject(503);
    expect(call.rejected).toBe(true);
    expect(call.rejectedStatusCode).toBe(503);
  });

  it("sendAudio() accumulates chunks in sentAudioChunks", async () => {
    const a = Buffer.from([0x01]);
    const b = Buffer.from([0x02, 0x03]);

    await call.sendAudio(a);
    await call.sendAudio(b);

    expect(call.sentAudioChunks).toHaveLength(2);
    expect(call.sentAudioChunks[0]).toStrictEqual(a);
    expect(call.sentAudioChunks[1]).toStrictEqual(b);
  });

  it("hangup() sets hungUp = true", async () => {
    expect(call.hungUp).toBe(false);
    await call.hangup();
    expect(call.hungUp).toBe(true);
  });
});

// ── SipBridgeService ──────────────────────────────────────────────────────────

describe("SipBridgeService", () => {
  let adapter: StubSipTelephonyAdapter;
  let sessionMock: jest.Mocked<SipVoiceSession>;
  let factoryMock: jest.Mocked<SipSessionFactory>;
  let bridge: SipBridgeService;

  beforeEach(() => {
    adapter = new StubSipTelephonyAdapter();
    sessionMock = makeSessionMock();
    factoryMock = makeFactoryMock(sessionMock);
    bridge = new SipBridgeService(adapter, factoryMock);
  });

  afterEach(async () => {
    // Always stop the bridge to remove listeners and avoid cross-test pollution.
    await bridge.stop();
  });

  it("start() calls adapter.start()", async () => {
    expect(adapter.isListening()).toBe(false);
    await bridge.start();
    expect(adapter.isListening()).toBe(true);
  });

  it("stop() calls adapter.stop()", async () => {
    await bridge.start();
    await bridge.stop();
    expect(adapter.isListening()).toBe(false);
  });

  it("stop() ends all active sessions", async () => {
    await bridge.start();
    adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    // Allow accept() promise microtask to settle before asserting
    await Promise.resolve();

    expect(sessionMock.end).not.toHaveBeenCalled();
    await bridge.stop();
    expect(sessionMock.end).toHaveBeenCalledTimes(1);
  });

  it("incoming call — factory is called with correct callId, from, to", async () => {
    await bridge.start();
    const call = adapter.simulateInboundCall({
      from: "sip:alice@example.com",
      to: "sip:ivr@company.com",
      id: "call-abc",
    });
    await Promise.resolve(); // allow accept() microtask

    expect(factoryMock.createSession).toHaveBeenCalledWith(
      call.id,
      "sip:alice@example.com",
      "sip:ivr@company.com",
    );
  });

  it("incoming call — call.accept() is called", async () => {
    await bridge.start();
    const call = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    await Promise.resolve();

    expect(call.accepted).toBe(true);
  });

  it("audio from adapter 'audio' event is forwarded to session.handleAudio()", async () => {
    await bridge.start();
    const call = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    await Promise.resolve();

    const audio = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    adapter.simulateAudioChunk(call.id, audio);

    expect(sessionMock.handleAudio).toHaveBeenCalledWith(audio);
  });

  it("session response audio is forwarded to call.sendAudio()", async () => {
    await bridge.start();
    const call = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    await Promise.resolve();

    const responseAudio = Buffer.from([0x11, 0x22, 0x33]);
    fireResponseAudio(sessionMock, responseAudio);
    // sendAudio is async; allow the void promise to flush
    await Promise.resolve();

    expect(call.sentAudioChunks).toHaveLength(1);
    expect(call.sentAudioChunks[0]).toStrictEqual(responseAudio);
  });

  it("'hangup' event from adapter triggers session.end()", async () => {
    await bridge.start();
    const call = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    await Promise.resolve();

    adapter.emit("hangup", call.id);

    expect(sessionMock.end).toHaveBeenCalledTimes(1);
  });

  it("'hangup' event removes the session from activeSessions", async () => {
    await bridge.start();
    const call = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    await Promise.resolve();

    expect(bridge.activeSessions).toBe(1);
    adapter.emit("hangup", call.id);
    expect(bridge.activeSessions).toBe(0);
  });

  it("activeSessions count tracks live sessions", async () => {
    // Create a separate session mock for each call
    const session2 = makeSessionMock();
    factoryMock.createSession
      .mockReturnValueOnce(sessionMock)
      .mockReturnValueOnce(session2);

    await bridge.start();
    expect(bridge.activeSessions).toBe(0);

    const call1 = adapter.simulateInboundCall({ from: "sip:a@x.com", to: "sip:b@x.com" });
    await Promise.resolve();
    expect(bridge.activeSessions).toBe(1);

    const call2 = adapter.simulateInboundCall({ from: "sip:c@x.com", to: "sip:b@x.com" });
    await Promise.resolve();
    expect(bridge.activeSessions).toBe(2);

    adapter.emit("hangup", call1.id);
    expect(bridge.activeSessions).toBe(1);

    adapter.emit("hangup", call2.id);
    expect(bridge.activeSessions).toBe(0);
  });

  it("two concurrent calls are handled independently — each gets its own session", async () => {
    const session2 = makeSessionMock();
    factoryMock.createSession
      .mockReturnValueOnce(sessionMock)
      .mockReturnValueOnce(session2);

    await bridge.start();

    const call1 = adapter.simulateInboundCall({
      from: "sip:alice@example.com",
      to: "sip:ivr@company.com",
      id: "call-1",
    });
    const call2 = adapter.simulateInboundCall({
      from: "sip:bob@example.com",
      to: "sip:ivr@company.com",
      id: "call-2",
    });
    await Promise.resolve();

    // Audio for call1 must not reach session2
    adapter.simulateAudioChunk(call1.id, Buffer.from([0x01]));
    expect(sessionMock.handleAudio).toHaveBeenCalledTimes(1);
    expect(session2.handleAudio).not.toHaveBeenCalled();

    // Audio for call2 must not reach session1
    adapter.simulateAudioChunk(call2.id, Buffer.from([0x02]));
    expect(session2.handleAudio).toHaveBeenCalledTimes(1);
    expect(sessionMock.handleAudio).toHaveBeenCalledTimes(1); // unchanged
  });

  it("after stop(), new inbound calls are not processed (adapter is stopped)", async () => {
    await bridge.start();
    await bridge.stop();

    // The adapter is now stopped; any further calls are not wired.
    // We emit directly on the stopped adapter to verify the bridge listener
    // was removed during stop().
    adapter.emit("call", new StubSipCall("orphan", "sip:x@x.com", "sip:y@y.com"));
    await Promise.resolve();

    expect(factoryMock.createSession).not.toHaveBeenCalled();
  });
});
