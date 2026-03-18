/**
 * VjjClient — TypeScript WebSocket SDK for voice-jib-jab
 *
 * Provides a typed, event-driven interface to the voice-jib-jab
 * 3-lane voice agent runtime over WebSocket.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Voice interaction mode. */
export type VoiceMode = "push-to-talk" | "open-mic";

/** Client connection state machine. */
export type ConnectionState = "disconnected" | "connecting" | "ready" | "error";

/** Lane C policy decision values. */
export type PolicyDecision =
  | "allow"
  | "rewrite"
  | "refuse"
  | "escalate"
  | "cancel_output";

/** Options accepted by the VjjClient constructor. */
export interface VjjClientOptions {
  /** WebSocket endpoint URL (ws:// or wss://). */
  url: string;
  /** Tenant identifier for multi-tenant isolation. */
  tenantId?: string;
  /** Client fingerprint for session correlation. */
  fingerprint?: string;
  /** User-agent string sent with session.start. */
  userAgent?: string;
  /** Initial voice mode. Defaults to "push-to-talk". */
  voiceMode?: VoiceMode;
  /** Enable automatic reconnection on unexpected close. */
  reconnect?: boolean;
  /** Delay in milliseconds before a reconnection attempt. Defaults to 2000. */
  reconnectDelay?: number;
}

/** Payload emitted with the "transcript" event. */
export interface TranscriptPayload {
  text: string;
  isFinal: boolean;
}

/** Payload emitted with the "policyDecision" event. */
export interface PolicyDecisionPayload {
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: string;
  safeRewrite?: string;
}

// ---------------------------------------------------------------------------
// Internal message shapes
// ---------------------------------------------------------------------------

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// VjjClient
// ---------------------------------------------------------------------------

/**
 * WebSocket client SDK for the voice-jib-jab voice agent runtime.
 *
 * Wraps the low-level WebSocket protocol into a clean, typed EventEmitter
 * interface with lifecycle management and automatic reconnection support.
 *
 * @example
 * ```ts
 * const client = new VjjClient({ url: "ws://localhost:3000", tenantId: "org_acme" });
 * await client.connect();
 * client.on("transcript", ({ text, isFinal }) => console.log(text));
 * client.sendAudioChunk(base64Data);
 * ```
 */
export class VjjClient extends EventEmitter {
  private readonly options: Required<
    Pick<VjjClientOptions, "url" | "reconnect" | "reconnectDelay">
  > &
    VjjClientOptions;

  private ws: WebSocket | null = null;
  private _sessionId: string | null = null;
  private _state: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VjjClientOptions) {
    super();
    this.options = {
      ...options,
      reconnect: options.reconnect ?? false,
      reconnectDelay: options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY_MS,
    };
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  /** The session ID assigned by the server, or null if not yet connected. */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Whether the WebSocket is open and a session has been established. */
  get connected(): boolean {
    return this._state === "ready";
  }

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /**
   * Open a WebSocket connection and initiate a session.
   *
   * Resolves when the server responds with `session.ready`.
   * Rejects if the server sends `session.error` or the connection times out.
   */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._state === "connecting" || this._state === "ready") {
        reject(new Error("Already connected or connecting"));
        return;
      }

      this.setState("connecting");

      const ws = new WebSocket(this.options.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        cleanup();
        this.closeSocket();
        this.setState("error");
        reject(new Error("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
      };

      ws.onopen = () => {
        this.sendSessionStart();
      };

      let settled = false;

      ws.onmessage = (event: MessageEvent) => {
        const msg = this.parseMessage(event.data as string);
        if (!msg) return;

        if (!settled) {
          if (msg.type === "session.ready") {
            settled = true;
            cleanup();
            this._sessionId = msg.sessionId as string;
            this.setState("ready");
            // Switch to steady-state message handler
            ws.onmessage = (ev: MessageEvent) => {
              const m = this.parseMessage(ev.data as string);
              if (m) this.routeMessage(m);
            };
            this.emit("ready", this._sessionId);
            resolve();
            return;
          }

          if (msg.type === "session.error") {
            settled = true;
            cleanup();
            this.setState("error");
            const error = new Error(
              (msg.message as string) ?? "Session error",
            );
            this.emit("error", error);
            reject(error);
            return;
          }
        }

        this.routeMessage(msg);
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          cleanup();
          this.setState("error");
          const error = new Error("WebSocket error");
          this.emit("error", error);
          reject(error);
        }
      };

      ws.onclose = () => {
        if (!settled) {
          settled = true;
          cleanup();
        }
        const wasReady = this._state === "ready";
        this.setState("disconnected");
        this._sessionId = null;
        this.emit("close");

        if (wasReady && this.options.reconnect) {
          this.scheduleReconnect();
        }
      };
    });
  }

  /**
   * Gracefully end the session and close the WebSocket.
   */
  disconnect(): void {
    this.cancelReconnect();

    if (this.ws) {
      this.send({ type: "session.end" });
      this.closeSocket();
    }

    this._sessionId = null;
    this.setState("disconnected");
  }

  // -----------------------------------------------------------------------
  // Send helpers — Client -> Server messages
  // -----------------------------------------------------------------------

  /** Send a base64-encoded PCM16 audio chunk. */
  sendAudioChunk(base64Data: string): void {
    this.assertConnected();
    this.send({ type: "audio.chunk", data: base64Data });
  }

  /** Signal end of the current utterance. */
  sendAudioStop(): void {
    this.assertConnected();
    this.send({ type: "audio.stop", timestamp: Date.now() });
  }

  /** Cancel the current audio stream. */
  sendAudioCancel(): void {
    this.assertConnected();
    this.send({ type: "audio.cancel" });
  }

  /** Commit the audio buffer for processing. */
  commitAudio(): void {
    this.assertConnected();
    this.send({ type: "audio.commit" });
  }

  /** Signal a user barge-in (interruption). */
  bargeIn(): void {
    this.assertConnected();
    this.send({ type: "user.barge_in" });
  }

  /** Notify the server that playback of the last response has ended. */
  playbackEnded(): void {
    this.assertConnected();
    this.send({ type: "playback.ended", timestamp: Date.now() });
  }

  /** Switch voice interaction mode. */
  setMode(mode: VoiceMode): void {
    this.assertConnected();
    this.send({ type: "session.set_mode", mode });
  }

  // -----------------------------------------------------------------------
  // Message routing — Server -> Client messages
  // -----------------------------------------------------------------------

  private routeMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "audio.chunk":
        this.emit("audio", msg.data as string);
        break;
      case "transcript":
        this.emit("transcript", {
          text: msg.text as string,
          isFinal: msg.is_final as boolean,
        });
        break;
      case "user_transcript":
        this.emit("userTranscript", {
          text: msg.text as string,
          isFinal: msg.is_final as boolean,
        });
        break;
      case "policy.decision":
        this.emit("policyDecision", {
          decision: msg.decision as PolicyDecision,
          reasonCodes: msg.reason_codes as string[],
          severity: msg.severity as string,
          safeRewrite: msg.safe_rewrite as string | undefined,
        });
        break;
      case "response.start":
        this.emit("responseStart");
        break;
      case "response.end":
        this.emit("responseEnd");
        break;
      case "speech.started":
        this.emit("speechStarted");
        break;
      case "speech.stopped":
        this.emit("speechStopped");
        break;
      case "provider.ready":
        this.emit("providerReady");
        break;
      case "session.error": {
        const error = new Error(
          (msg.message as string) ?? "Session error",
        );
        this.emit("error", error);
        break;
      }
      case "session.mode_changed":
        this.emit("modeChanged", msg.mode as VoiceMode);
        break;
      // Acknowledgements and metadata are emitted generically
      case "audio.stop.ack":
      case "audio.cancel.ack":
      case "response.metadata":
      case "lane.state_changed":
      case "lane.owner_changed":
      case "session.ready":
        // session.ready already handled in connect(); no additional dispatch needed.
        break;
      default:
        // Unknown message types are silently ignored to allow protocol evolution.
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private sendSessionStart(): void {
    const payload: Record<string, unknown> = {
      type: "session.start",
    };
    if (this.options.tenantId) payload.tenantId = this.options.tenantId;
    if (this.options.fingerprint) payload.fingerprint = this.options.fingerprint;
    if (this.options.userAgent) payload.userAgent = this.options.userAgent;
    if (this.options.voiceMode) payload.voiceMode = this.options.voiceMode;

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

  private closeSocket(): void {
    if (this.ws) {
      // Remove handlers to prevent further callbacks
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    this.cancelReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Reconnection failed; will be retried on next close if still enabled.
      });
    }, this.options.reconnectDelay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
