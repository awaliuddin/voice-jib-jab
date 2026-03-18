/**
 * SIP Telephony Adapter — N-11 SIP Telephony Prototype
 *
 * Defines the SipTelephonyAdapter interface and supporting types, plus
 * fully-functional in-process stubs for testing. No real SIP stack is
 * required; the StubSipTelephonyAdapter drives the same event contracts
 * that a production SIP implementation would honour.
 *
 * The SipBridgeService wires an adapter to a SipSessionFactory, routing
 * inbound audio to voice sessions and piping response audio back to the
 * caller — the same bridging pattern used by the 3-lane runtime for
 * WebSocket audio.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ── Core domain types ────────────────────────────────────────────────────────

/**
 * Represents a single active SIP call.
 *
 * A SipCall is obtained either from the 'call' event emitted by a
 * SipTelephonyAdapter or from StubSipTelephonyAdapter.simulateInboundCall().
 * All state-mutating operations are async to accommodate network I/O in
 * production implementations.
 */
export interface SipCall {
  /** Unique identifier for this call leg. */
  readonly id: string;

  /** Originating SIP URI, e.g. "sip:alice@example.com". */
  readonly from: string;

  /** Destination SIP URI, e.g. "sip:ivr@company.com". */
  readonly to: string;

  /**
   * Accept the inbound call (send 200 OK).
   * Resolves once the call is in the connected state.
   */
  accept(): Promise<void>;

  /**
   * Reject the inbound call.
   * @param statusCode SIP response code to send (default 486 Busy Here).
   */
  reject(statusCode?: number): void;

  /**
   * Send a raw audio buffer to the remote party over the established media
   * channel. Callers are responsible for encoding (PCM-16 at 8 kHz is the
   * common SIP baseline).
   * @param audio Raw audio bytes.
   */
  sendAudio(audio: Buffer): Promise<void>;

  /**
   * Terminate the call (send BYE).
   * Resolves once the hangup has been acknowledged.
   */
  hangup(): Promise<void>;
}

/**
 * Manages the lifecycle of a SIP listener and fires events for each
 * inbound call.
 *
 * Events emitted:
 *   - `'call'`    (call: SipCall)                — new inbound call arrived
 *   - `'audio'`   (callId: string, chunk: Buffer) — RTP audio from a caller
 *   - `'hangup'`  (callId: string)                — remote party hung up
 *   - `'error'`   (err: Error)                    — transport-level error
 *   - `'listening'` (port: number)                — adapter is ready to accept calls
 */
export interface SipTelephonyAdapter extends NodeJS.EventEmitter {
  /**
   * Bind to the given UDP/TCP port and start accepting SIP INVITE requests.
   * @param port Local port to listen on (default 5060).
   */
  start(port?: number): Promise<void>;

  /**
   * Stop accepting new calls and release the bound port.
   * Active calls are hung up before the adapter fully stops.
   */
  stop(): Promise<void>;

  /** Returns true when the adapter is bound and ready to accept calls. */
  isListening(): boolean;
}

/**
 * Represents a voice session attached to a SIP call leg.
 *
 * The session receives raw audio from the caller, processes it through the
 * 3-lane runtime, and emits response audio back via the registered listener.
 */
export interface SipVoiceSession {
  /**
   * Feed inbound audio (from the SIP caller) into the session.
   * @param audio Raw PCM or encoded audio bytes.
   */
  handleAudio(audio: Buffer): void;

  /**
   * Register a listener that is called whenever the session produces
   * response audio to be sent back to the caller.
   * @param listener Callback receiving each outbound audio chunk.
   */
  onResponseAudio(listener: (audio: Buffer) => void): void;

  /**
   * Terminate the session and release all held resources.
   * Called when the associated SIP call ends.
   */
  end(): void;
}

/**
 * Factory that creates SipVoiceSession instances for inbound calls.
 *
 * In production this wires a session to the 3-lane runtime. In tests a
 * jest mock is substituted.
 */
export interface SipSessionFactory {
  /**
   * Construct a new voice session for the given call leg.
   * @param callId   Unique ID of the SIP call.
   * @param from     Originating SIP URI.
   * @param to       Destination SIP URI.
   */
  createSession(callId: string, from: string, to: string): SipVoiceSession;
}

// ── StubSipCall ──────────────────────────────────────────────────────────────

/**
 * In-process stub for SipCall.
 *
 * Records every state-mutating operation so tests can make assertions
 * without a real SIP stack. Returned by
 * StubSipTelephonyAdapter.simulateInboundCall().
 */
export class StubSipCall extends EventEmitter implements SipCall {
  readonly id: string;
  readonly from: string;
  readonly to: string;

  /** True after accept() has been called. */
  accepted: boolean = false;

  /** True after reject() has been called. */
  rejected: boolean = false;

  /** True after hangup() has been called. */
  hungUp: boolean = false;

  /**
   * Status code supplied to reject(), or undefined if reject() was not
   * called.
   */
  rejectedStatusCode: number | undefined = undefined;

  /**
   * Ordered list of all audio buffers delivered via sendAudio() so that
   * tests can verify both the count and the content of audio transmissions.
   */
  readonly sentAudioChunks: Buffer[] = [];

  constructor(id: string, from: string, to: string) {
    super();
    this.id = id;
    this.from = from;
    this.to = to;
  }

  /** Accept the call. Sets accepted = true. */
  accept(): Promise<void> {
    this.accepted = true;
    return Promise.resolve();
  }

  /**
   * Reject the call.
   * @param statusCode SIP response code (default 486).
   */
  reject(statusCode = 486): void {
    this.rejected = true;
    this.rejectedStatusCode = statusCode;
  }

  /**
   * Record an outbound audio chunk.
   * @param audio Buffer to enqueue.
   */
  sendAudio(audio: Buffer): Promise<void> {
    this.sentAudioChunks.push(audio);
    return Promise.resolve();
  }

  /** Hang up the call. Sets hungUp = true. */
  hangup(): Promise<void> {
    this.hungUp = true;
    return Promise.resolve();
  }
}

// ── StubSipTelephonyAdapter ──────────────────────────────────────────────────

/**
 * In-process stub implementing SipTelephonyAdapter.
 *
 * Provides test helpers (simulateInboundCall, simulateAudioChunk) that fire
 * the same events a production SIP stack would emit, allowing SipBridgeService
 * and other consumers to be exercised without network access.
 *
 * Thread-safety note: this stub is single-threaded (Node.js event loop) and
 * is not safe to use across worker threads.
 */
export class StubSipTelephonyAdapter extends EventEmitter implements SipTelephonyAdapter {
  private _listening = false;
  private readonly _activeCalls = new Map<string, StubSipCall>();

  /**
   * Mark the adapter as listening.
   * Idempotent: if already listening the call is a no-op.
   * @param port Port number to report in the 'listening' event (default 5060).
   */
  start(port = 5060): Promise<void> {
    if (this._listening) {
      return Promise.resolve();
    }
    this._listening = true;
    this.emit('listening', port);
    return Promise.resolve();
  }

  /**
   * Mark the adapter as stopped and hang up every active call.
   * Order of hangups is deterministic (Map insertion order).
   */
  async stop(): Promise<void> {
    this._listening = false;
    for (const call of this._activeCalls.values()) {
      await call.hangup();
    }
    this._activeCalls.clear();
  }

  /** True when the adapter has been started and not yet stopped. */
  isListening(): boolean {
    return this._listening;
  }

  // ── Test helpers ────────────────────────────────────────────────────────

  /**
   * Simulate an inbound SIP INVITE arriving at the adapter.
   *
   * Creates a StubSipCall, registers it in the active-call map, emits the
   * 'call' event, and returns the call so tests can make further assertions.
   *
   * @param opts.from  Originating SIP URI.
   * @param opts.to    Destination SIP URI.
   * @param opts.id    Optional fixed call ID (defaults to a random UUID).
   */
  simulateInboundCall(opts: { from: string; to: string; id?: string }): StubSipCall {
    const id = opts.id ?? randomUUID();
    const call = new StubSipCall(id, opts.from, opts.to);
    this._activeCalls.set(id, call);
    this.emit('call', call);
    return call;
  }

  /**
   * Simulate RTP audio arriving for an active call.
   *
   * Emits the 'audio' event only if the callId is known. Unknown IDs are
   * silently ignored so tests that deliberately pass a stale ID do not
   * receive unexpected errors.
   *
   * @param callId Identifier of the target call.
   * @param audio  Audio payload.
   */
  simulateAudioChunk(callId: string, audio: Buffer): void {
    if (!this._activeCalls.has(callId)) {
      return;
    }
    this.emit('audio', callId, audio);
  }

  /**
   * Return the StubSipCall for a given ID, or undefined if not found.
   * @param callId Call identifier.
   */
  getActiveCall(callId: string): StubSipCall | undefined {
    return this._activeCalls.get(callId);
  }

  /** Number of currently active (not yet hung-up) call legs. */
  get activeCallCount(): number {
    return this._activeCalls.size;
  }
}

// ── SipBridgeService ─────────────────────────────────────────────────────────

/**
 * Wires a SipTelephonyAdapter to a SipSessionFactory, bridging inbound SIP
 * calls into the voice session runtime.
 *
 * For each inbound call the bridge:
 *   1. Accepts the call.
 *   2. Creates a SipVoiceSession via the factory.
 *   3. Routes adapter 'audio' events for that callId into the session.
 *   4. Routes session response audio back to the SIP call via sendAudio().
 *   5. Cleans up the session when the 'hangup' event fires.
 *
 * The bridge does not own the adapter lifecycle; callers are responsible for
 * constructing the adapter before passing it in.
 */
export class SipBridgeService {
  private readonly _sessions = new Map<string, SipVoiceSession>();

  /** Bound listener references kept for removeListener() cleanup. */
  private readonly _audioListener: (callId: string, chunk: Buffer) => void;
  private readonly _hangupListener: (callId: string) => void;
  private readonly _callListener: (call: SipCall) => void;

  constructor(
    private readonly adapter: SipTelephonyAdapter,
    private readonly factory: SipSessionFactory,
  ) {
    this._callListener = (call: SipCall) => this.handleInboundCall(call);
    this._audioListener = (callId: string, chunk: Buffer) => {
      const session = this._sessions.get(callId);
      if (session !== undefined) {
        session.handleAudio(chunk);
      }
    };
    this._hangupListener = (callId: string) => this.handleHangup(callId);
  }

  /**
   * Start the bridge: binds event handlers and starts the adapter.
   *
   * Must be called before any calls can be processed. Safe to await — the
   * promise resolves once the adapter reports it is listening.
   */
  async start(): Promise<void> {
    this.adapter.on('call', this._callListener);
    this.adapter.on('audio', this._audioListener);
    this.adapter.on('hangup', this._hangupListener);
    await this.adapter.start();
  }

  /**
   * Stop the bridge: ends all active sessions and stops the adapter.
   *
   * After stop() returns no further call or audio events will be processed
   * even if the adapter fires them (listeners are removed before adapter.stop()
   * is awaited so any hangup events during shutdown do not re-enter
   * handleHangup).
   */
  async stop(): Promise<void> {
    this.adapter.removeListener('call', this._callListener);
    this.adapter.removeListener('audio', this._audioListener);
    this.adapter.removeListener('hangup', this._hangupListener);

    for (const session of this._sessions.values()) {
      session.end();
    }
    this._sessions.clear();

    await this.adapter.stop();
  }

  /** Number of voice sessions currently open. */
  get activeSessions(): number {
    return this._sessions.size;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Handle a new inbound SIP call:
   *   - Accept the call.
   *   - Create a voice session via the factory.
   *   - Wire session response audio → call.sendAudio().
   *   - Register the session under its callId.
   */
  private handleInboundCall(call: SipCall): void {
    void call.accept().then(() => {
      const session = this.factory.createSession(call.id, call.from, call.to);

      session.onResponseAudio((audio: Buffer) => {
        void call.sendAudio(audio);
      });

      this._sessions.set(call.id, session);
    });
  }

  /**
   * Handle a remote hangup: end the session and remove it from the map.
   * @param callId Identifier of the call that ended.
   */
  private handleHangup(callId: string): void {
    const session = this._sessions.get(callId);
    if (session !== undefined) {
      session.end();
      this._sessions.delete(callId);
    }
  }
}
