/**
 * OpenAI Realtime API Adapter
 * Implements ProviderAdapter for OpenAI's Realtime API
 *
 * Protocol documentation: https://platform.openai.com/docs/guides/realtime
 */

import {
  ProviderAdapter,
  ProviderConfig,
  AudioChunk,
  TranscriptSegment,
} from "./ProviderAdapter.js";
import WebSocket from "ws";

/**
 * OpenAI Realtime API Message Types
 */
interface RealtimeMessage {
  type: string;
  [key: string]: any;
}

interface SessionConfig {
  modalities?: string[];
  instructions?: string;
  voice?: string;
  input_audio_format?: string;
  output_audio_format?: string;
  input_audio_transcription?: {
    model: string;
  };
  turn_detection?: {
    type: string;
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
  tools?: any[];
  tool_choice?: string;
  temperature?: number;
  max_response_output_tokens?: number | "inf";
}

export type VoiceMode = "push-to-talk" | "open-mic";

/**
 * Buffer state tracking for synchronization with OpenAI
 * Tracks local buffer state to prevent race conditions
 */
interface BufferState {
  localBytes: number; // Our tracking of bytes sent
  lastAppendTime: number; // Timestamp of last audio append
  speechDetected: boolean; // VAD confirmed OpenAI processed audio
  pendingCommit: boolean; // Commit waiting for confirmation
}

export class OpenAIRealtimeAdapter extends ProviderAdapter {
  private ws: WebSocket | null = null;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly reconnectDelay: number = 1000;
  private messageQueue: RealtimeMessage[] = [];
  private sessionCreated: boolean = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private responding: boolean = false;
  private audioBuffer: Buffer = Buffer.alloc(0);
  private conversationContext: string | null = null;
  private voiceMode: VoiceMode = "push-to-talk";
  private responseInstructionsProvider:
    | ((transcript: string) => string | null)
    | null = null;
  private pendingInputTranscript: string = "";

  // Buffer state synchronization
  private bufferState: BufferState = {
    localBytes: 0,
    lastAppendTime: 0,
    speechDetected: false,
    pendingCommit: false,
  };

  // TTFB drift prevention: Max buffer size (5 seconds of audio at 24kHz PCM16)
  private readonly MAX_AUDIO_BUFFER_SIZE = 24000 * 2 * 5; // 240KB
  private readonly MAX_MESSAGE_QUEUE_SIZE = 50;

  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Set conversation context from previous sessions
   * This will be included in the system instructions
   */
  setConversationContext(context: string): void {
    this.conversationContext = context;
    console.log(
      `[OpenAI] Conversation context set (${context.length} characters)`,
    );
  }

  /**
   * Provide dynamic response instructions based on input transcript.
   * Used for RAG injection before response creation.
   */
  setResponseInstructionsProvider(
    provider: ((transcript: string) => string | null) | null,
  ): void {
    this.responseInstructionsProvider = provider;
  }

  /**
   * Get the current conversation context
   */
  getConversationContext(): string | null {
    return this.conversationContext;
  }

  async connect(sessionId: string): Promise<void> {
    this.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      try {
        // Construct WebSocket URL with API key in query parameters
        const wsUrl = `wss://api.openai.com/v1/realtime?model=${this.config.model}`;

        console.log(
          `[OpenAI] Connecting to Realtime API for session: ${sessionId}`,
        );

        // Create WebSocket connection with proper headers
        this.ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "OpenAI-Beta": "realtime=v1",
          },
        });

        // Handle connection open
        this.ws.on("open", () => {
          console.log(`[OpenAI] WebSocket connected for session: ${sessionId}`);
          this.connected = true;
          this.reconnectAttempts = 0;

          // Create session with configuration
          this.createSession();

          // Start ping interval to keep connection alive
          this.startPingInterval();

          // Process any queued messages
          this.processMessageQueue();

          resolve();
        });

        // Handle incoming messages
        this.ws.on("message", (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as RealtimeMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error("[OpenAI] Failed to parse message:", error);
            this.emit("error", error);
          }
        });

        // Handle errors
        this.ws.on("error", (error: Error) => {
          console.error("[OpenAI] WebSocket error:", error);
          this.emit("error", error);

          if (!this.connected) {
            reject(error);
          }
        });

        // Handle connection close
        this.ws.on("close", (code: number, reason: Buffer) => {
          console.log(
            `[OpenAI] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`,
          );
          this.connected = false;
          this.sessionCreated = false;

          // Clear ping interval
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
          }

          // Attempt reconnection if not intentional disconnect
          if (
            code !== 1000 &&
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            this.attemptReconnect();
          }
        });
      } catch (error) {
        console.error("[OpenAI] Failed to create WebSocket connection:", error);
        reject(error);
      }
    });
  }

  /**
   * Create and configure the session
   * Incorporates conversation context if available for cross-session memory
   */
  private createSession(): void {
    this.updateSessionConfig();
  }

  /**
   * Update session configuration based on current voice mode
   * Called during initial session creation and when mode changes
   */
  private updateSessionConfig(): void {
    // Build system instructions with optional conversation context
    let instructions =
      this.config.systemInstructions ||
      "You are a helpful voice assistant. Please be concise and natural in your responses.";

    // Inject conversation context for returning users
    if (this.conversationContext) {
      instructions = `${instructions}

## Previous Conversation Context

You are speaking with a returning user. Here is a summary of your previous conversations with them. Use this context to provide a personalized, continuous experience. Reference previous topics naturally when relevant, but don't force it.

${this.conversationContext}

## Current Conversation

Continue the conversation naturally, keeping in mind the previous context.`;

      console.log(
        "[OpenAI] Injecting conversation context into system instructions",
      );
    }

    // Configure turn detection based on voice mode
    // Push-to-talk: Disable VAD - user controls turn-taking
    // Open-mic: Enable VAD with higher threshold to reduce false triggers
    const turnDetection =
      this.voiceMode === "open-mic"
        ? {
            type: "server_vad",
            threshold: 0.6, // Higher threshold for open-mic to reduce echo triggers
            prefix_padding_ms: 300,
            silence_duration_ms: 700, // Longer silence for open-mic
          }
        : undefined; // Push-to-talk: No VAD

    const sessionConfig: SessionConfig = {
      modalities: ["text", "audio"],
      instructions,
      voice: "alloy",
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: {
        model: "whisper-1",
      },
      turn_detection: turnDetection,
      temperature: 0.8,
      max_response_output_tokens: "inf",
    };

    this.sendMessage({
      type: "session.update",
      session: sessionConfig,
    });

    console.log(
      `[OpenAI] Session configuration sent (mode: ${this.voiceMode}, VAD: ${turnDetection ? "enabled" : "disabled"})`,
    );
  }

  /**
   * Set the voice interaction mode
   * @param mode - 'push-to-talk' or 'open-mic'
   */
  setVoiceMode(mode: VoiceMode): void {
    if (this.voiceMode === mode) {
      return; // No change needed
    }

    this.voiceMode = mode;
    console.log(`[OpenAI] Voice mode changed to: ${mode}`);

    // Update session config if connected
    if (this.isConnected() && this.sessionCreated) {
      this.updateSessionConfig();
    }
  }

  /**
   * Get the current voice mode
   */
  getVoiceMode(): VoiceMode {
    return this.voiceMode;
  }

  /**
   * Calculate buffer duration in milliseconds
   * PCM16 at 24kHz: 24000 samples/sec * 2 bytes/sample = 48000 bytes/sec
   */
  private getBufferDurationMs(): number {
    const BYTES_PER_SECOND = 48000; // 24kHz * 2 bytes per sample
    return Math.floor((this.bufferState.localBytes / BYTES_PER_SECOND) * 1000);
  }

  /**
   * Reset buffer state to initial values
   */
  private resetBufferState(): void {
    this.bufferState = {
      localBytes: 0,
      lastAppendTime: 0,
      speechDetected: false,
      pendingCommit: false,
    };
    this.audioBuffer = Buffer.alloc(0);
    this.pendingInputTranscript = "";
  }

  /**
   * Send audio chunk to OpenAI
   */
  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (!this.isConnected()) {
      console.warn("[OpenAI] Cannot send audio: not connected");
      return; // Silently return instead of throwing - prevents error spam
    }

    try {
      // OpenAI expects PCM16 audio as base64
      let audioData: string;

      if (chunk.format === "pcm") {
        // Convert PCM16 to base64
        audioData = chunk.data.toString("base64");
      } else {
        // Would need to convert other formats to PCM16 first
        throw new Error(`Unsupported audio format: ${chunk.format}`);
      }

      // Send audio to OpenAI
      this.sendMessage({
        type: "input_audio_buffer.append",
        audio: audioData,
      });

      // Track buffer state for synchronization
      this.bufferState.localBytes += chunk.data.length;
      this.bufferState.lastAppendTime = Date.now();

      // Accumulate audio for potential processing
      this.audioBuffer = Buffer.concat([this.audioBuffer, chunk.data]);

      // TTFB drift prevention: Prevent audio buffer from growing too large
      if (this.audioBuffer.length > this.MAX_AUDIO_BUFFER_SIZE) {
        console.warn(
          `[OpenAI] Audio buffer exceeded max size (${this.audioBuffer.length} bytes), clearing oldest data`,
        );
        // Keep only the most recent 2 seconds of audio
        const keepSize = 24000 * 2 * 2; // 2 seconds
        this.audioBuffer = this.audioBuffer.subarray(-keepSize);
        this.bufferState.localBytes = keepSize;
      }

      const durationMs = this.getBufferDurationMs();
      console.log(
        `[OpenAI] Sent audio chunk: ${chunk.data.length} bytes ` +
          `(local: ${this.bufferState.localBytes}, duration: ${durationMs}ms)`,
      );
    } catch (error) {
      console.error("[OpenAI] Failed to send audio:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Commit the audio buffer and trigger response
   * Enhanced with confirmation protocol to prevent race conditions
   * Returns boolean indicating if commit was attempted
   */
  async commitAudio(): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }

    const MIN_BUFFER_DURATION_MS = 100;
    const SAFETY_WINDOW_MS = 50; // Wait for network + OpenAI processing

    const durationMs = this.getBufferDurationMs();

    // Guard 1: Minimum duration check
    if (durationMs < MIN_BUFFER_DURATION_MS) {
      console.log(
        `[OpenAI] Skipping commit: buffer too small ` +
          `(${durationMs}ms < ${MIN_BUFFER_DURATION_MS}ms, ` +
          `${this.bufferState.localBytes} bytes)`,
      );
      this.resetBufferState();
      return false;
    }

    // Guard 2: Safety window - ensure OpenAI had time to process
    const timeSinceLastAppend = Date.now() - this.bufferState.lastAppendTime;

    if (timeSinceLastAppend < SAFETY_WINDOW_MS) {
      const waitTime = SAFETY_WINDOW_MS - timeSinceLastAppend;
      console.log(
        `[OpenAI] Waiting ${waitTime}ms for buffer stabilization ` +
          `(${durationMs}ms buffered)`,
      );

      // Wait for safety window, then continue
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    // Guard 3: Prefer VAD confirmation when available (indicates processing)
    if (!this.bufferState.speechDetected && durationMs < 500) {
      console.log(
        `[OpenAI] Warning: Committing without VAD confirmation ` +
          `(${durationMs}ms buffer) - OpenAI may not have processed audio yet`,
      );
    }

    try {
      console.log(
        `[OpenAI] Committing audio buffer ` +
          `(duration: ${durationMs}ms, bytes: ${this.bufferState.localBytes})`,
      );

      this.sendMessage({
        type: "input_audio_buffer.commit",
      });

      this.bufferState.pendingCommit = true;

      // DO NOT send response.create here - wait for input_audio_buffer.committed
      // This prevents the race condition where commit fails but response is requested

      console.log("[OpenAI] Audio buffer commit sent, awaiting confirmation");
      return true;
    } catch (error) {
      console.error("[OpenAI] Failed to commit audio:", error);
      this.resetBufferState();
      return false;
    }
  }

  /**
   * Clear the OpenAI input audio buffer and reset local buffer state.
   * Used when the client signals stop to immediately discard in-flight audio.
   */
  clearInputBuffer(): void {
    if (!this.isConnected()) {
      return;
    }

    this.sendMessage({ type: "input_audio_buffer.clear" });
    this.resetBufferState();
    console.log("[OpenAI] Input audio buffer cleared (client stop)");
  }

  /**
   * Cancel current response
   */
  async cancel(): Promise<void> {
    if (!this.connected || !this.ws) {
      return;
    }

    try {
      this.sendMessage({
        type: "response.cancel",
      });

      this.responding = false;
      console.log(`[OpenAI] Cancelled response for session: ${this.sessionId}`);
    } catch (error) {
      console.error("[OpenAI] Failed to cancel response:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Disconnect from OpenAI
   */
  async disconnect(): Promise<void> {
    if (!this.connected && !this.ws) {
      return;
    }

    try {
      // Clear ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Clear input buffer before closing to stop OpenAI processing
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(
            JSON.stringify({ type: "input_audio_buffer.clear" }),
          );
        } catch {
          // Best-effort — connection may already be closing
        }
      }

      // Close WebSocket connection
      if (this.ws) {
        this.ws.close(1000, "Client disconnect");
        this.ws = null;
      }

      this.connected = false;
      this.sessionCreated = false;
      this.sessionId = null;
      this.messageQueue = [];
      this.resetBufferState();

      console.log("[OpenAI] Disconnected session");
    } catch (error) {
      console.error("[OpenAI] Error during disconnect:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Check if session has been created with OpenAI
   */
  isSessionCreated(): boolean {
    return this.sessionCreated;
  }

  /**
   * Check if currently generating a response
   */
  isResponding(): boolean {
    return this.responding;
  }

  /**
   * Send message to OpenAI
   */
  private sendMessage(message: RealtimeMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message if not connected, but prevent queue from growing too large
      if (this.messageQueue.length >= this.MAX_MESSAGE_QUEUE_SIZE) {
        console.warn(
          `[OpenAI] Message queue full (${this.messageQueue.length}), dropping oldest message`,
        );
        this.messageQueue.shift(); // Remove oldest
      }
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      console.log(`[OpenAI] Sent message: ${message.type}`);
    } catch (error) {
      console.error("[OpenAI] Failed to send message:", error);
      this.emit("error", error);
    }
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendMessage(message);
      }
    }
  }

  /**
   * Handle incoming messages from OpenAI
   */
  private handleMessage(message: RealtimeMessage): void {
    console.log(`[OpenAI] Received message: ${message.type}`);

    switch (message.type) {
      case "session.created":
        this.sessionCreated = true;
        console.log("[OpenAI] Session created successfully");
        break;

      case "session.updated":
        console.log("[OpenAI] Session configuration updated");
        break;

      case "conversation.created":
        console.log("[OpenAI] Conversation created");
        break;

      case "input_audio_buffer.committed":
        console.log(
          `[OpenAI] Audio buffer committed successfully ` +
            `(was ${this.bufferState.localBytes} bytes)`,
        );

        // NOW trigger response creation - only after commit confirmation
        if (this.bufferState.pendingCommit && !this.responding) {
          const transcript = this.pendingInputTranscript.trim();
          let instructions: string | null = null;
          if (this.responseInstructionsProvider) {
            try {
              instructions = this.responseInstructionsProvider(transcript);
            } catch (error) {
              console.error(
                "[OpenAI] Response instructions provider failed:",
                error,
              );
            }
          }

          const responsePayload: any = {
            modalities: ["text", "audio"],
          };
          if (instructions) {
            responsePayload.instructions = instructions;
          }

          this.sendMessage({
            type: "response.create",
            response: responsePayload,
          });
          console.log("[OpenAI] Response requested after commit confirmation");
        }

        this.pendingInputTranscript = "";
        this.resetBufferState();
        break;

      case "input_audio_buffer.cleared":
        console.log("[OpenAI] Audio buffer cleared");
        break;

      case "input_audio_buffer.speech_started":
        console.log("[OpenAI] Speech detected - started (VAD confirmed processing)");
        // Mark that VAD has confirmed OpenAI processed audio
        this.bufferState.speechDetected = true;
        // DON'T reset buffer state here - we need it for commit duration checking
        // Buffer will be reset after successful commit confirmation
        this.emit("speech_started");
        break;

      case "input_audio_buffer.speech_stopped":
        console.log("[OpenAI] Speech detected - stopped");
        this.emit("speech_stopped");
        // Note: With server VAD enabled, OpenAI automatically commits the buffer
        // Do NOT call commitAudio() here - it would send an empty buffer commit
        break;

      case "conversation.item.created":
        if (message.item?.role === "user" && message.item?.content) {
          // User transcript
          const transcript = message.item.content.find(
            (c: any) => c.type === "input_text",
          );
          if (transcript?.text) {
            this.emit("transcript", {
              text: transcript.text,
              confidence: 1.0,
              isFinal: true,
              timestamp: Date.now(),
            } as TranscriptSegment);
          }
        }
        break;

      case "response.created":
        console.log("[OpenAI] Response started");
        this.responding = true;

        // CRITICAL: Clear input audio buffer when response starts
        // This prevents any echoed audio from being processed
        // and stops the feedback loop where AI answers itself
        this.sendMessage({ type: "input_audio_buffer.clear" });

        this.emit("response_start");
        break;

      case "response.audio_transcript.delta":
        // Incremental transcript
        if (message.delta) {
          this.emit("transcript", {
            text: message.delta,
            confidence: 1.0,
            isFinal: false,
            timestamp: Date.now(),
          } as TranscriptSegment);
        }
        break;

      case "response.audio_transcript.done":
        // Final transcript
        if (message.transcript) {
          this.emit("transcript", {
            text: message.transcript,
            confidence: 1.0,
            isFinal: true,
            timestamp: Date.now(),
          } as TranscriptSegment);
        }
        break;

      case "response.audio.delta":
        // Audio chunk from assistant
        if (message.delta) {
          // OpenAI sends base64 encoded PCM16 audio
          const audioBuffer = Buffer.from(message.delta, "base64");

          this.emit("audio", {
            data: audioBuffer,
            format: "pcm",
            sampleRate: 24000, // OpenAI uses 24kHz for PCM16
          } as AudioChunk);
        }
        break;

      case "response.audio.done":
        console.log("[OpenAI] Audio response complete");
        break;

      case "response.done":
        console.log("[OpenAI] Response complete");
        this.responding = false;
        this.emit("response_end");
        break;

      // Handle common message types that don't require action (silence warnings)
      case "response.output_item.added":
      case "response.output_item.done":
      case "response.content_part.added":
      case "response.content_part.done":
      case "conversation.item.input_audio_transcription.delta":
        if (message.delta) {
          this.pendingInputTranscript += message.delta;
        }
        break;

      case "conversation.item.input_audio_transcription.completed":
        // User's audio transcription completed
        if (message.transcript) {
          this.emit("user_transcript", {
            text: message.transcript,
            confidence: 1.0,
            isFinal: true,
            timestamp: Date.now(),
          } as TranscriptSegment);
        }
        break;

      case "conversation.item.input_audio_transcription.failed":
        console.error("[OpenAI] Transcription failed:", message.error);
        break;

      case "rate_limits.updated":
        console.log("[OpenAI] Rate limits updated:", message.rate_limits);
        break;

      case "error":
        console.error("[OpenAI] Error from API:", message.error);
        // Reset responding flag on error to prevent stuck state (TTFB drift fix)
        this.responding = false;
        // Clear audio buffer on error to prevent backlog
        this.audioBuffer = Buffer.alloc(0);
        this.emit(
          "error",
          new Error(message.error?.message || "Unknown error from OpenAI"),
        );
        break;

      default:
        console.log(`[OpenAI] Unhandled message type: ${message.type}`);
    }
  }

  /**
   * Attempt to reconnect after connection loss
   */
  private attemptReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[OpenAI] Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`,
    );

    setTimeout(() => {
      if (this.sessionId) {
        this.connect(this.sessionId).catch((error) => {
          console.error("[OpenAI] Reconnection failed:", error);
        });
      }
    }, delay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    // OpenAI Realtime API doesn't require explicit pings,
    // but we'll keep track of connection health
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Connection is healthy
        console.log("[OpenAI] Connection health check: OK");
      } else {
        console.warn("[OpenAI] Connection health check: Not connected");
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Create a response programmatically
   */
  async createResponse(
    text?: string,
    generateAudio: boolean = true,
  ): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected to OpenAI Realtime API");
    }

    try {
      if (text) {
        // Create response with specific text
        this.sendMessage({
          type: "response.create",
          response: {
            modalities: generateAudio ? ["text", "audio"] : ["text"],
            instructions: text,
          },
        });
      } else {
        // Create response based on current conversation context
        this.sendMessage({
          type: "response.create",
          response: {
            modalities: ["text", "audio"],
          },
        });
      }

      console.log("[OpenAI] Response creation requested");
    } catch (error) {
      console.error("[OpenAI] Failed to create response:", error);
      this.emit("error", error);
      throw error;
    }
  }
}
