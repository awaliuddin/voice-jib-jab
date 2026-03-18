/**
 * VoiceClient -- standalone callback-based SDK for voice-jib-jab.
 *
 * Wraps the WebSocket wire protocol into a simple, callback-driven
 * API suitable for browser <script> tags, bundlers, and Node.js 22+.
 */

import type {
  VoiceClientOptions,
  VoiceClientCallbacks,
  SessionConfig,
  ConnectionState,
  PolicyDecision,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// Internal message shape
// ---------------------------------------------------------------------------

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// VoiceClient
// ---------------------------------------------------------------------------

/**
 * Callback-based WebSocket client for the voice-jib-jab voice agent runtime.
 *
 * Unlike the internal EventEmitter-based VjjClient, VoiceClient uses plain
 * callback objects -- no Node.js dependencies, works in any JS environment.
 *
 * @example
 * ```ts
 * const client = new VoiceClient(
 *   { url: "wss://api.example.com/voice" },
 *   {
 *     onReady: (id) => console.log("Session", id),
 *     onTranscript: (t) => console.log(t.text),
 *   },
 * );
 * await client.connect({ tenantId: "org_acme" });
 * client.sendAudio(base64Chunk);
 * ```
 */
export class VoiceClient {
  private ws: WebSocket | null = null;
  private _sessionId: string | null = null;
  private _state: ConnectionState = "disconnected";
  private callbacks: VoiceClientCallbacks = {};
  private connectResolve?: (sessionId: string) => void;
  private connectReject?: (err: Error) => void;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private sessionConfig?: SessionConfig;

  private readonly connectTimeoutMs: number;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;

  constructor(
    private readonly options: VoiceClientOptions,
    callbacks?: VoiceClientCallbacks,
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.autoReconnect = options.autoReconnect ?? false;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    if (callbacks) {
      this.callbacks = { ...callbacks };
    }
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  /** The session ID assigned by the server, or null before session.ready. */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /** Whether the client has an active, ready session. */
  get connected(): boolean {
    return this._state === "ready";
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /**
   * Connect to the WebSocket server and start a voice session.
   *
   * Resolves with the server-assigned session ID once session.ready is received.
   * Rejects if the connection times out or the server sends session.error.
   *
   * @param sessionConfig - Optional session parameters sent with session.start.
   * @returns The server-assigned session ID.
   */
  async connect(sessionConfig?: SessionConfig): Promise<string> {
    if (this._state === "connecting" || this._state === "ready") {
      throw new Error("Already connected or connecting");
    }

    this.sessionConfig = sessionConfig;
    this.setState("connecting");

    return new Promise<string>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      this.connectTimer = setTimeout(() => {
        this.handleConnectTimeout();
      }, this.connectTimeoutMs);

      const ws = new WebSocket(this.options.url);
      this.ws = ws;

      ws.onopen = () => this.handleOpen();
      ws.onmessage = (event: MessageEvent) => this.handleMessage(event);
      ws.onerror = () => this.handleError();
      ws.onclose = () => this.handleClose();
    });
  }

  /**
   * Send raw PCM16 audio data (base64-encoded) to the server.
   *
   * @param base64Data - Base64-encoded PCM16 audio chunk.
   */
  sendAudio(base64Data: string): void {
    this.assertConnected();
    this.send({ type: "audio.chunk", data: base64Data });
  }

  /** Signal end of the user's audio input. */
  stopAudio(): void {
    this.assertConnected();
    this.send({ type: "audio.stop", timestamp: Date.now() });
  }

  /** Cancel the current audio response from the server. */
  cancelAudio(): void {
    this.assertConnected();
    this.send({ type: "audio.cancel" });
  }

  /** Signal that audio playback of the last response has completed. */
  playbackEnded(): void {
    this.assertConnected();
    this.send({ type: "playback.ended", timestamp: Date.now() });
  }

  /**
   * Register additional callbacks. Merges with existing callbacks.
   *
   * @param newCallbacks - Partial set of callbacks to register.
   */
  on(newCallbacks: Partial<VoiceClientCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...newCallbacks };
  }

  /** End the session and close the WebSocket connection. */
  endSession(): void {
    this.cancelScheduledReconnect();

    if (this.ws) {
      this.send({ type: "session.end" });
      this.closeSocket();
    }

    this._sessionId = null;
    this.setState("disconnected");
  }

  // -----------------------------------------------------------------------
  // WebSocket event handlers
  // -----------------------------------------------------------------------

  private handleOpen(): void {
    this.sendSessionStart();
  }

  private handleMessage(event: MessageEvent): void {
    const msg = this.parseMessage(event.data as string);
    if (!msg) return;

    if (this._state === "connecting") {
      this.handleConnectingMessage(msg);
      return;
    }

    this.routeMessage(msg);
  }

  private handleConnectingMessage(msg: ServerMessage): void {
    if (msg.type === "session.ready") {
      this.clearConnectTimer();
      this._sessionId = msg.sessionId as string;
      this.setState("ready");
      this.callbacks.onReady?.(this._sessionId);
      this.connectResolve?.(this._sessionId);
      this.connectResolve = undefined;
      this.connectReject = undefined;
      return;
    }

    if (msg.type === "session.error") {
      this.clearConnectTimer();
      this.setState("error");
      const error = new Error((msg.message as string) ?? "Session error");
      this.callbacks.onError?.(error);
      this.connectReject?.(error);
      this.connectResolve = undefined;
      this.connectReject = undefined;
      return;
    }

    // Forward other messages that arrive during handshake
    this.routeMessage(msg);
  }

  private handleError(): void {
    if (this._state === "connecting") {
      this.clearConnectTimer();
      this.setState("error");
      const error = new Error("WebSocket error");
      this.callbacks.onError?.(error);
      this.connectReject?.(error);
      this.connectResolve = undefined;
      this.connectReject = undefined;
    }
  }

  private handleClose(): void {
    const wasReady = this._state === "ready";

    if (this._state === "connecting") {
      this.clearConnectTimer();
      this.connectReject?.(new Error("WebSocket closed before ready"));
      this.connectResolve = undefined;
      this.connectReject = undefined;
    }

    this._sessionId = null;
    this.setState("disconnected");
    this.callbacks.onClose?.();

    if (wasReady && this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleConnectTimeout(): void {
    this.closeSocket();
    this.setState("error");
    const error = new Error("Connection timeout");
    this.callbacks.onError?.(error);
    this.connectReject?.(error);
    this.connectResolve = undefined;
    this.connectReject = undefined;
  }

  // -----------------------------------------------------------------------
  // Message routing -- Server -> Client
  // -----------------------------------------------------------------------

  private routeMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "audio.chunk":
        this.callbacks.onAudio?.(msg.data as string);
        break;
      case "transcript":
        this.callbacks.onTranscript?.({
          text: msg.text as string,
          isFinal: msg.is_final as boolean,
          role: "assistant",
        });
        break;
      case "user_transcript":
        this.callbacks.onTranscript?.({
          text: msg.text as string,
          isFinal: msg.is_final as boolean,
          role: "user",
        });
        break;
      case "policy.decision":
        this.callbacks.onPolicyEvent?.({
          decision: msg.decision as PolicyDecision,
          reasonCodes: (msg.reason_codes as string[]) ?? [],
          severity: (msg.severity as number) ?? 0,
          safeRewrite: msg.safe_rewrite as string | undefined,
        });
        break;
      case "response.start":
        this.callbacks.onResponseStart?.();
        break;
      case "response.end":
        this.callbacks.onResponseEnd?.();
        break;
      case "session.error": {
        const error = new Error((msg.message as string) ?? "Session error");
        this.callbacks.onError?.(error);
        break;
      }
      default:
        // Unknown message types silently ignored for protocol evolution.
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private sendSessionStart(): void {
    const payload: Record<string, unknown> = { type: "session.start" };
    const cfg = this.sessionConfig;
    if (cfg?.tenantId) payload.tenantId = cfg.tenantId;
    if (cfg?.fingerprint) payload.fingerprint = cfg.fingerprint;
    if (cfg?.userAgent) payload.userAgent = cfg.userAgent;
    if (cfg?.voiceMode) payload.voiceMode = cfg.voiceMode;
    this.send(payload);
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private parseMessage(raw: string): ServerMessage | null {
    try {
      return JSON.parse(raw) as ServerMessage;
    } catch {
      return null;
    }
  }

  private assertConnected(): void {
    if (this._state !== "ready") {
      throw new Error("Client is not connected");
    }
  }

  private setState(next: ConnectionState): void {
    this._state = next;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    this.cancelScheduledReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.sessionConfig).catch(() => {
        // Reconnection failed; will retry on next close if autoReconnect is enabled.
      });
    }, this.reconnectDelayMs);
  }

  private cancelScheduledReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
