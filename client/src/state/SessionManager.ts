/**
 * Client-side Session Manager
 * Coordinates audio capture, playback, and server communication
 * With persistent memory support via fingerprinting
 */

import { MicrophoneCapture } from "../audio/MicrophoneCapture";
import { AudioPlayback } from "../audio/AudioPlayback";
import { WebSocketClient } from "../events/WebSocketClient";
import { getPersistedFingerprint } from "../utils/fingerprint";

export type SessionState =
  | "idle"
  | "initializing"
  | "connected"
  | "talking"
  | "listening"
  | "error";

export type LaneOwner = "none" | "A" | "B";
export type LaneState =
  | "IDLE"
  | "LISTENING"
  | "A_PLAYING"
  | "B_RESPONDING"
  | "B_PLAYING"
  | "ENDED";

export interface LatencyMetrics {
  ttfb: number | null;
  turnLatency: number | null;
  bargeInStop: number | null;
}

export interface LaneInfo {
  owner: LaneOwner;
  state: LaneState;
}

export class SessionManager {
  private wsClient: WebSocketClient;
  private micCapture: MicrophoneCapture;
  private audioPlayback: AudioPlayback;
  private state: SessionState = "idle";
  private sessionId: string | null = null;
  private fingerprint: string | null = null;
  private isReturningUser: boolean = false;
  private previousSessionCount: number = 0;
  private metrics: LatencyMetrics = {
    ttfb: null,
    turnLatency: null,
    bargeInStop: null,
  };
  private laneInfo: LaneInfo = {
    owner: "none",
    state: "IDLE",
  };
  private lastUserSpeechEnd: number = 0;
  private firstAudioChunkTime: number = 0;
  private onStateChange: ((state: SessionState) => void) | null = null;
  private onMetricsUpdate: ((metrics: LatencyMetrics) => void) | null = null;
  private onLaneChange: ((laneInfo: LaneInfo) => void) | null = null;

  constructor(wsUrl: string) {
    this.wsClient = new WebSocketClient(wsUrl);
    this.micCapture = new MicrophoneCapture();
    this.audioPlayback = new AudioPlayback();
  }

  async initialize(): Promise<void> {
    this.setState("initializing");

    try {
      // Generate fingerprint for persistent memory
      this.fingerprint = await getPersistedFingerprint();
      console.log(
        `[SessionManager] Fingerprint: ${this.fingerprint.substring(0, 16)}...`,
      );

      // Initialize WebSocket and audio playback first
      // Microphone is initialized lazily when user starts talking
      await Promise.all([
        this.audioPlayback.initialize(),
        this.wsClient.connect(),
      ]);

      // Setup WebSocket handlers
      this.setupWebSocketHandlers();

      // Setup audio playback callback
      this.audioPlayback.setOnPlaybackEnd(() => {
        if (this.state === "listening") {
          this.setState("connected");
        }
      });

      this.setState("connected");
      console.log(
        "[SessionManager] Initialized successfully (mic will init on first talk)",
      );
    } catch (error) {
      console.error("[SessionManager] Initialization failed:", error);
      this.setState("error");
      throw error;
    }
  }

  private async ensureMicrophoneInitialized(): Promise<boolean> {
    if (this.micCapture.isInitialized()) {
      return true;
    }

    try {
      await this.micCapture.initialize();
      console.log("[SessionManager] Microphone initialized on demand");
      return true;
    } catch (error) {
      console.error(
        "[SessionManager] Microphone initialization failed:",
        error,
      );
      return false;
    }
  }

  private setupWebSocketHandlers(): void {
    // Session ready
    this.wsClient.on("session.ready", (message) => {
      this.sessionId = message.sessionId;
      console.log(`[SessionManager] Session ready: ${this.sessionId}`);
    });

    // Provider (OpenAI) connected
    this.wsClient.on("provider.ready", (message) => {
      console.log("[SessionManager] Provider connection ready");
      // Capture returning user info for persistent memory
      this.isReturningUser = message.isReturningUser || false;
      this.previousSessionCount = message.previousSessionCount || 0;

      if (this.isReturningUser) {
        console.log(
          `[SessionManager] Welcome back! ${this.previousSessionCount} previous sessions detected.`,
        );
      }
    });

    // Response started - AI is about to speak
    this.wsClient.on("response.start", () => {
      console.log("[SessionManager] AI response starting");
      this.setState("listening");
    });

    // Audio chunk from server
    this.wsClient.on("audio.chunk", async (message) => {
      // Record TTFB if this is first chunk
      if (this.firstAudioChunkTime === 0) {
        this.firstAudioChunkTime = Date.now();
        const ttfb = this.firstAudioChunkTime - this.lastUserSpeechEnd;
        this.metrics.ttfb = ttfb;
        this.notifyMetricsUpdate();
        console.log(`[SessionManager] TTFB: ${ttfb}ms`);
      }

      try {
        const pcm16Data = Uint8Array.from(atob(message.data), (c) =>
          c.charCodeAt(0),
        ).buffer;
        await this.audioPlayback.enqueueAudio(pcm16Data);

        if (this.state !== "listening") {
          this.setState("listening");
        }
      } catch (error) {
        console.error("[SessionManager] Error playing audio:", error);
      }
    });

    // Response end
    this.wsClient.on("response.end", () => {
      console.log("[SessionManager] Response ended");
      this.firstAudioChunkTime = 0;

      // Transition to connected when response ends
      // This allows the user to start talking again
      if (this.state === "listening" || this.state === "talking") {
        this.setState("connected");
      }
    });

    // Error - handle based on error type
    this.wsClient.on("error", (message) => {
      console.error("[SessionManager] Server error:", message.error);

      // Only transition to error state for fatal/connection errors
      // Recoverable errors like "buffer too small" or temporary OpenAI issues
      // should not disable the entire UI
      const fatalErrors = [
        "connection failed",
        "authentication failed",
        "invalid api key",
        "websocket error",
      ];

      const errorLower = (message.error || "").toLowerCase();
      const isFatalError = fatalErrors.some((fatal) =>
        errorLower.includes(fatal),
      );

      if (isFatalError) {
        this.setState("error");
      } else {
        // For non-fatal errors, log but don't change state
        console.warn("[SessionManager] Non-fatal error, continuing...");
      }
    });

    // Handle connection failure event from WebSocketClient
    this.wsClient.on("connection.failed", () => {
      console.error("[SessionManager] Connection failed after max retries");
      this.setState("error");
    });

    // Lane state changed
    this.wsClient.on("lane.state_changed", (message) => {
      console.log(
        `[SessionManager] Lane state: ${message.from} -> ${message.to} (${message.cause})`,
      );
      this.laneInfo.state = message.to as LaneState;
      this.notifyLaneChange();
    });

    // Lane owner changed
    this.wsClient.on("lane.owner_changed", (message) => {
      console.log(
        `[SessionManager] Lane owner: ${message.from} -> ${message.to} (${message.cause})`,
      );
      this.laneInfo.owner = message.to as LaneOwner;
      this.notifyLaneChange();
    });
  }

  async startTalking(): Promise<void> {
    if (this.state !== "connected") {
      console.warn("[SessionManager] Cannot start talking, not connected");
      return;
    }

    // Ensure microphone is initialized (lazy init on first use)
    const micReady = await this.ensureMicrophoneInitialized();
    if (!micReady) {
      console.error("[SessionManager] Cannot start talking without microphone");
      return;
    }

    this.setState("talking");
    console.log("[SessionManager] Connecting to OpenAI...");

    // Send session start and wait for provider.ready
    const providerReady = new Promise<void>((resolve) => {
      const handler = () => {
        this.wsClient.off("provider.ready", handler);
        resolve();
      };
      this.wsClient.on("provider.ready", handler);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.wsClient.off("provider.ready", handler);
        resolve(); // Resolve anyway to avoid hanging
      }, 10000);
    });

    // Send session start with fingerprint for persistent memory
    this.wsClient.send({
      type: "session.start",
      fingerprint: this.fingerprint,
      userAgent: navigator.userAgent,
    });
    await providerReady;

    console.log("[SessionManager] OpenAI ready, starting audio capture");

    // Now start capturing microphone - OpenAI is ready
    this.micCapture.start((audioChunk) => {
      const pcm16Buffer = MicrophoneCapture.float32ToPCM16(audioChunk);
      const base64Data = btoa(
        String.fromCharCode(...new Uint8Array(pcm16Buffer)),
      );

      this.wsClient.send({
        type: "audio.chunk",
        data: base64Data,
        format: "pcm",
        sampleRate: 24000,
      });
    });

    console.log("[SessionManager] Started talking");
  }

  stopTalking(): void {
    if (this.state !== "talking") {
      return;
    }

    this.micCapture.stop();
    this.lastUserSpeechEnd = Date.now();

    // Tell server to commit audio buffer and generate response
    this.wsClient.send({ type: "audio.commit" });

    // Stay in talking state until we get response.start
    // This keeps the button in "processing" state
    console.log("[SessionManager] Stopped talking, waiting for response...");
  }

  /**
   * Trigger barge-in (interrupt assistant)
   */
  async bargeIn(): Promise<void> {
    if (!this.audioPlayback.isActive()) {
      return;
    }

    const bargeInStart = Date.now();

    // Stop audio immediately
    this.audioPlayback.stop();

    const bargeInStop = Date.now() - bargeInStart;
    this.metrics.bargeInStop = bargeInStop;
    this.notifyMetricsUpdate();

    // Notify server
    this.wsClient.send({ type: "user.barge_in" });

    console.log(`[SessionManager] Barge-in stop time: ${bargeInStop}ms`);

    // Transition to connected state first, then start talking
    if (this.state === "listening") {
      this.setState("connected");
      await this.startTalking();
    }
  }

  disconnect(): void {
    if (this.state === "idle") {
      return;
    }

    this.wsClient.send({ type: "session.end" });
    this.wsClient.disconnect();
    this.micCapture.cleanup();
    this.audioPlayback.cleanup();

    this.setState("idle");
    this.sessionId = null;

    console.log("[SessionManager] Disconnected");
  }

  private setState(newState: SessionState): void {
    if (this.state === newState) return;

    this.state = newState;

    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }

  private notifyMetricsUpdate(): void {
    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({ ...this.metrics });
    }
  }

  getState(): SessionState {
    return this.state;
  }

  getMetrics(): LatencyMetrics {
    return { ...this.metrics };
  }

  setOnStateChange(callback: (state: SessionState) => void): void {
    this.onStateChange = callback;
  }

  setOnMetricsUpdate(callback: (metrics: LatencyMetrics) => void): void {
    this.onMetricsUpdate = callback;
  }

  isAudioPlaying(): boolean {
    return this.audioPlayback.isActive();
  }

  getLaneInfo(): LaneInfo {
    return { ...this.laneInfo };
  }

  setOnLaneChange(callback: (laneInfo: LaneInfo) => void): void {
    this.onLaneChange = callback;
  }

  private notifyLaneChange(): void {
    if (this.onLaneChange) {
      this.onLaneChange({ ...this.laneInfo });
    }
  }

  /**
   * Check if this is a returning user with conversation history
   */
  getIsReturningUser(): boolean {
    return this.isReturningUser;
  }

  /**
   * Get the number of previous sessions for this user
   */
  getPreviousSessionCount(): number {
    return this.previousSessionCount;
  }

  /**
   * Get the current fingerprint (for debugging)
   */
  getFingerprint(): string | null {
    return this.fingerprint;
  }
}
