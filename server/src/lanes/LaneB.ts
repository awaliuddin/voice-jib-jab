/**
 * Lane B - Reasoning Engine
 *
 * Wraps the OpenAI Realtime adapter to provide substantive responses.
 * Signals when first audio is ready for preemption of Lane A.
 */

import { EventEmitter } from "events";
import { OpenAIRealtimeAdapter } from "../providers/OpenAIRealtimeAdapter.js";
import { ProviderConfig, AudioChunk } from "../providers/ProviderAdapter.js";

/**
 * Lane B configuration
 */
export interface LaneBConfig {
  providerConfig: ProviderConfig;
}

export class LaneB extends EventEmitter {
  private sessionId: string;
  private adapter: OpenAIRealtimeAdapter;
  private isResponding: boolean = false;
  private firstAudioEmitted: boolean = false;
  private responseStartTime: number | null = null;
  private firstAudioTime: number | null = null;

  constructor(sessionId: string, config: LaneBConfig) {
    super();
    this.sessionId = sessionId;
    this.adapter = new OpenAIRealtimeAdapter(config.providerConfig);

    this.setupAdapterHandlers();
  }

  /**
   * Setup handlers for the underlying provider adapter
   */
  private setupAdapterHandlers(): void {
    // Forward audio chunks and detect first audio
    this.adapter.on("audio", (chunk: AudioChunk) => {
      if (!this.firstAudioEmitted && this.isResponding) {
        this.firstAudioEmitted = true;
        this.firstAudioTime = Date.now();

        const latencyMs = this.responseStartTime
          ? this.firstAudioTime - this.responseStartTime
          : 0;

        console.log(`[LaneB] First audio ready after ${latencyMs}ms`);

        // Signal that Lane B is ready to take over
        this.emit("first_audio_ready", { latencyMs });
      }

      // Forward audio chunk
      this.emit("audio", chunk);
    });

    // Forward transcripts
    this.adapter.on("transcript", (segment) => {
      this.emit("transcript", segment);
    });

    this.adapter.on("user_transcript", (segment) => {
      this.emit("user_transcript", segment);
    });

    // Handle response lifecycle
    this.adapter.on("response_start", () => {
      this.isResponding = true;
      this.firstAudioEmitted = false;
      this.responseStartTime = Date.now();
      console.log(`[LaneB] Response started`);
      this.emit("response_start");
    });

    this.adapter.on("response_end", () => {
      this.isResponding = false;
      this.firstAudioEmitted = false;

      const totalMs = this.responseStartTime
        ? Date.now() - this.responseStartTime
        : 0;

      console.log(`[LaneB] Response complete (${totalMs}ms total)`);
      this.emit("response_end");
      this.responseStartTime = null;
      this.firstAudioTime = null;
    });

    // Forward speech detection
    this.adapter.on("speech_started", () => {
      this.emit("speech_started");
    });

    this.adapter.on("speech_stopped", () => {
      this.emit("speech_stopped");
    });

    // Forward errors
    this.adapter.on("error", (error) => {
      console.error(`[LaneB] Error:`, error);
      this.emit("error", error);
    });
  }

  /**
   * Connect to the provider
   */
  async connect(): Promise<void> {
    await this.adapter.connect(this.sessionId);
    console.log(`[LaneB] Connected for session: ${this.sessionId}`);
  }

  /**
   * Disconnect from the provider
   */
  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
    console.log(`[LaneB] Disconnected`);
  }

  /**
   * Send audio to the provider
   */
  async sendAudio(chunk: AudioChunk): Promise<void> {
    await this.adapter.sendAudio(chunk);
  }

  /**
   * Commit audio buffer and trigger response
   */
  async commitAudio(): Promise<void> {
    await this.adapter.commitAudio();
  }

  /**
   * Cancel current response (for barge-in)
   */
  async cancel(): Promise<void> {
    await this.adapter.cancel();
    this.isResponding = false;
    this.firstAudioEmitted = false;
    console.log(`[LaneB] Response cancelled`);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.adapter.isConnected();
  }

  /**
   * Check if currently responding
   */
  getIsResponding(): boolean {
    return this.isResponding;
  }

  /**
   * Check if first audio has been emitted
   */
  hasFirstAudioEmitted(): boolean {
    return this.firstAudioEmitted;
  }

  /**
   * Get TTFB (time to first byte) for current response
   */
  getTTFB(): number | null {
    if (this.responseStartTime && this.firstAudioTime) {
      return this.firstAudioTime - this.responseStartTime;
    }
    return null;
  }

  /**
   * Get the underlying adapter (for advanced operations)
   */
  getAdapter(): OpenAIRealtimeAdapter {
    return this.adapter;
  }
}
