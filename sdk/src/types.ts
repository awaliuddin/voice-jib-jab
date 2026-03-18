/**
 * Public type definitions for the @nxtg/vjj-sdk package.
 *
 * These types mirror the voice-jib-jab wire protocol and provide
 * a strongly-typed surface for SDK consumers.
 */

/** Lane C policy decision values. */
export type PolicyDecision = "allow" | "rewrite" | "refuse" | "escalate" | "cancel_output";

/** Voice interaction mode. */
export type VoiceMode = "push-to-talk" | "open-mic";

/** Client connection state machine. */
export type ConnectionState = "disconnected" | "connecting" | "ready" | "error";

/** Configuration sent with session.start to initialize a voice session. */
export interface SessionConfig {
  /** Tenant identifier for multi-tenant isolation. */
  tenantId?: string;
  /** Client fingerprint for session correlation. */
  fingerprint?: string;
  /** Initial voice mode. Defaults to "push-to-talk". */
  voiceMode?: VoiceMode;
  /** User-agent string sent with session.start. */
  userAgent?: string;
}

/** Payload delivered when a Lane C policy decision is received. */
export interface PolicyEvent {
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  safeRewrite?: string;
}

/** Payload delivered when a transcript update is received. */
export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  role: "user" | "assistant";
}

/** Constructor options for VoiceClient. */
export interface VoiceClientOptions {
  /** WebSocket endpoint URL (ws:// or wss://). */
  url: string;
  /** Timeout in milliseconds for the initial connection handshake. Defaults to 5000. */
  connectTimeoutMs?: number;
  /** Enable automatic reconnection on unexpected close. Defaults to false. */
  autoReconnect?: boolean;
  /** Delay in milliseconds before a reconnection attempt. Defaults to 2000. */
  reconnectDelayMs?: number;
}

/** Callback functions for VoiceClient lifecycle and data events. */
export interface VoiceClientCallbacks {
  /** Called when the session is established and ready. */
  onReady?: (sessionId: string) => void;
  /** Called when a base64-encoded audio chunk is received from the server. */
  onAudio?: (base64Data: string) => void;
  /** Called when a transcript update is received (user or assistant). */
  onTranscript?: (event: TranscriptEvent) => void;
  /** Called when a Lane C policy decision is received. */
  onPolicyEvent?: (event: PolicyEvent) => void;
  /** Called when the assistant begins generating a response. */
  onResponseStart?: () => void;
  /** Called when the assistant finishes generating a response. */
  onResponseEnd?: () => void;
  /** Called when a WebSocket or session error occurs. */
  onError?: (error: Error) => void;
  /** Called when the WebSocket connection closes. */
  onClose?: () => void;
}
