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

export type LaneOwner = "none" | "A" | "B" | "fallback";
export type LaneState =
  | "IDLE"
  | "LISTENING"
  | "A_PLAYING"
  | "B_RESPONDING"
  | "B_PLAYING"
  | "FALLBACK_PLAYING"
  | "ENDED";

export type VoiceMode = "push-to-talk" | "open-mic";

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
  private providerSessionActive: boolean = false; // Track if OpenAI session is active
  private voiceMode: VoiceMode = "push-to-talk"; // Default to push-to-talk
  private openMicActive: boolean = false; // Whether open mic is currently capturing
  private onStateChange: ((state: SessionState) => void) | null = null;
  private onMetricsUpdate: ((metrics: LatencyMetrics) => void) | null = null;
  private onLaneChange: ((laneInfo: LaneInfo) => void) | null = null;
  private onVoiceModeChange: ((mode: VoiceMode) => void) | null = null;

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
        // Notify server that speakers are now silent so it can start
        // the echo-cooldown timer from the right moment.
        this.wsClient.send({ type: "playback.ended", timestamp: Date.now() });

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

      // Only transition to connected if audio playback is already done.
      // If audio is still playing through speakers, stay in "listening"
      // so the UI shows the interrupt button (Bug #2 fix).
      // The playbackEnd callback will handle the transition once audio finishes.
      if (this.audioPlayback.isActive()) {
        console.log(
          "[SessionManager] Audio still playing, staying in listening state",
        );
        return;
      }

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

    // Commit skipped (buffer too small) — ensure we're not stuck
    this.wsClient.on("commit.skipped", () => {
      console.log("[SessionManager] Commit skipped (buffer too small)");
      if (this.state === "talking") {
        this.setState("connected");
      }
    });

    // Cancel/barge-in acks (state already transitioned optimistically)
    this.wsClient.on("audio.cancel.ack", () => {
      console.log("[SessionManager] Server acknowledged audio.cancel");
      // Server confirmed cancel — ensure we're in connected state
      // and audio is stopped (delivery confirmation for Bug #3)
      if (this.audioPlayback.isActive()) {
        this.audioPlayback.stop();
      }
      if (this.state === "listening" || this.state === "talking") {
        this.setState("connected");
      }
    });

    this.wsClient.on("audio.stop.ack", () => {
      console.log("[SessionManager] Server acknowledged audio.stop");
    });

    this.wsClient.on("user.barge_in.ack", () => {
      console.log("[SessionManager] Server acknowledged barge-in");
    });

    // Voice mode changed
    this.wsClient.on("session.mode_changed", (message) => {
      console.log(
        `[SessionManager] Voice mode changed to: ${message.voiceMode}`,
      );
      this.voiceMode = message.voiceMode as VoiceMode;
      this.notifyVoiceModeChange();
    });
  }

  async startTalking(): Promise<void> {
    if (this.state !== "connected") {
      console.warn("[SessionManager] Cannot start talking, not connected");
      return;
    }

    // Stop any playing audio to prevent feedback loop
    // (microphone picking up speaker output and sending to OpenAI)
    if (this.audioPlayback.isActive()) {
      console.log("[SessionManager] Stopping audio playback before capturing");
      this.audioPlayback.stop();
      // Notify server of implicit barge-in
      this.wsClient.send({ type: "user.barge_in" });
    }

    // Ensure microphone is initialized (lazy init on first use)
    const micReady = await this.ensureMicrophoneInitialized();
    if (!micReady) {
      console.error("[SessionManager] Cannot start talking without microphone");
      return;
    }

    this.setState("talking");

    // Only initialize OpenAI session on first talk
    // Subsequent talks reuse the existing session
    if (!this.providerSessionActive) {
      console.log("[SessionManager] Connecting to OpenAI...");

      // Send session start and wait for provider.ready
      const providerReady = new Promise<void>((resolve) => {
        const handler = () => {
          this.wsClient.off("provider.ready", handler);
          this.providerSessionActive = true;
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

      console.log("[SessionManager] OpenAI session ready");
    } else {
      console.log("[SessionManager] Reusing existing OpenAI session");
    }

    // If user released the button while we were waiting for provider, abort
    // (state may have changed during the async wait above)
    if ((this.state as SessionState) !== "talking") {
      console.log("[SessionManager] User released button during setup, aborting");
      return;
    }

    console.log("[SessionManager] Starting audio capture");

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

    // Commit the buffered audio to trigger AI response.
    // Do NOT send audio.stop/clear first — that would wipe the buffer
    // before commit can process it. The server's response.created handler
    // sends input_audio_buffer.clear to OpenAI after the response cycle starts.
    this.wsClient.send({ type: "audio.commit" });

    // Immediately transition to connected so the button is responsive again.
    // When the AI response arrives (response.start), state transitions to "listening".
    // If commit is skipped (buffer too small), we're already in "connected" — no deadlock.
    this.setState("connected");
    console.log("[SessionManager] Stopped talking, ready for next interaction");
  }

  /**
   * Force-cancel recording: stops mic and tells server to clear the audio buffer.
   * No AI response will be generated.
   */
  cancelTalking(): void {
    this.micCapture.stop();
    this.wsClient.send({ type: "audio.cancel" });
    this.setState("connected");
    console.log("[SessionManager] Cancelled talking, buffer cleared");
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

  /**
   * Force-stop the assistant: stops local playback and tells the server
   * to cancel the active response. Unlike bargeIn(), this has no
   * isActive() guard — it always works, fixing the "3 clicks" bug.
   */
  stopAssistant(): void {
    this.audioPlayback.stop();
    this.wsClient.send({ type: "audio.cancel" });

    if (this.state === "listening" || this.state === "talking") {
      this.setState("connected");
    }

    console.log("[SessionManager] Stopped assistant");
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
    this.providerSessionActive = false;

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

  /**
   * Get the current voice mode
   */
  getVoiceMode(): VoiceMode {
    return this.voiceMode;
  }

  /**
   * Set the voice mode
   * @param mode - 'push-to-talk' or 'open-mic'
   */
  setVoiceMode(mode: VoiceMode): void {
    if (this.voiceMode === mode) {
      return; // No change
    }

    // If switching from open-mic, stop capturing
    if (this.voiceMode === "open-mic" && this.openMicActive) {
      this.stopOpenMic();
    }

    this.voiceMode = mode;

    // Notify server of mode change
    if (this.providerSessionActive) {
      this.wsClient.send({ type: "session.set_mode", voiceMode: mode });
    }

    this.notifyVoiceModeChange();
    console.log(`[SessionManager] Voice mode set to: ${mode}`);
  }

  /**
   * Toggle the voice mode between push-to-talk and open-mic
   */
  toggleVoiceMode(): void {
    const newMode =
      this.voiceMode === "push-to-talk" ? "open-mic" : "push-to-talk";
    this.setVoiceMode(newMode);
  }

  /**
   * Start open mic mode (continuous capture)
   */
  async startOpenMic(): Promise<void> {
    if (this.voiceMode !== "open-mic") {
      console.warn(
        "[SessionManager] Cannot start open mic: not in open-mic mode",
      );
      return;
    }

    if (this.openMicActive) {
      console.log("[SessionManager] Open mic already active");
      return;
    }

    // Stop any playing audio
    if (this.audioPlayback.isActive()) {
      this.audioPlayback.stop();
      this.wsClient.send({ type: "user.barge_in" });
    }

    // Ensure microphone is initialized
    const micReady = await this.ensureMicrophoneInitialized();
    if (!micReady) {
      console.error(
        "[SessionManager] Cannot start open mic without microphone",
      );
      return;
    }

    // Ensure provider session is active
    if (!this.providerSessionActive) {
      console.log("[SessionManager] Connecting to OpenAI for open mic...");

      const providerReady = new Promise<void>((resolve) => {
        const handler = () => {
          this.wsClient.off("provider.ready", handler);
          this.providerSessionActive = true;
          resolve();
        };
        this.wsClient.on("provider.ready", handler);

        setTimeout(() => {
          this.wsClient.off("provider.ready", handler);
          resolve();
        }, 10000);
      });

      this.wsClient.send({
        type: "session.start",
        fingerprint: this.fingerprint,
        userAgent: navigator.userAgent,
        voiceMode: "open-mic",
      });
      await providerReady;
    }

    this.openMicActive = true;
    this.setState("talking");

    // Start continuous capture — suppress while AI audio is playing
    // to prevent the microphone from picking up speaker output.
    this.micCapture.start((audioChunk) => {
      if (!this.openMicActive) {
        return;
      }

      // Client-side echo gate: don't send audio while speakers are active.
      // The server also gates, but dropping early saves bandwidth and
      // prevents any edge-case where echoed audio slips through.
      if (this.audioPlayback.isActive()) {
        return;
      }

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

    console.log("[SessionManager] Open mic started");
  }

  /**
   * Stop open mic mode
   */
  stopOpenMic(): void {
    if (!this.openMicActive) {
      return;
    }

    this.openMicActive = false;
    this.micCapture.stop();
    this.setState("connected");

    console.log("[SessionManager] Open mic stopped");
  }

  /**
   * Check if open mic is currently active
   */
  isOpenMicActive(): boolean {
    return this.openMicActive;
  }

  /**
   * Set callback for voice mode changes
   */
  setOnVoiceModeChange(callback: (mode: VoiceMode) => void): void {
    this.onVoiceModeChange = callback;
  }

  private notifyVoiceModeChange(): void {
    if (this.onVoiceModeChange) {
      this.onVoiceModeChange(this.voiceMode);
    }
  }
}
