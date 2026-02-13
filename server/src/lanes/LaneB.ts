/**
 * Lane B - Reasoning Engine
 *
 * Wraps the OpenAI Realtime adapter to provide substantive responses.
 * Signals when first audio is ready for preemption of Lane A.
 */

import { EventEmitter } from "events";
import { OpenAIRealtimeAdapter } from "../providers/OpenAIRealtimeAdapter.js";
import { ProviderConfig, AudioChunk } from "../providers/ProviderAdapter.js";
import { formatDisclaimerBlock } from "../retrieval/DisclaimerLookup.js";
import { RAGPipeline } from "../retrieval/RAGPipeline.js";
import { retrievalService } from "../retrieval/index.js";
import { PIIRedactor } from "../insurance/policy_gate.js";

/**
 * Lane B configuration
 */
export interface LaneBConfig {
  providerConfig: ProviderConfig;
  rag?: {
    enabled: boolean;
    topK?: number;
  };
  safety?: {
    enablePIIRedaction?: boolean;
    piiRedactionMode?: "redact" | "flag";
  };
}

export class LaneB extends EventEmitter {
  private sessionId: string;
  private adapter: OpenAIRealtimeAdapter;
  private isResponding: boolean = false;
  private firstAudioEmitted: boolean = false;
  private responseStartTime: number | null = null;
  private firstAudioTime: number | null = null;
  private conversationContext: string | null = null;
  private requiredDisclaimerIds: string[] = [];
  private ragPipeline: RAGPipeline | null = null;

  constructor(sessionId: string, config: LaneBConfig) {
    super();
    this.sessionId = sessionId;
    this.adapter = new OpenAIRealtimeAdapter(config.providerConfig);

    if (config.rag?.enabled) {
      const piiEnabled = config.safety?.enablePIIRedaction ?? true;
      const piiMode = config.safety?.piiRedactionMode ?? "redact";
      const piiRedactor =
        piiEnabled && piiMode === "redact"
          ? new PIIRedactor({ mode: piiMode })
          : null;

      this.ragPipeline = new RAGPipeline(sessionId, retrievalService, {
        topK: config.rag.topK,
        piiRedactor,
        redactToolCalls: piiEnabled && piiMode === "redact",
      });

      this.adapter.setResponseInstructionsProvider((transcript) => {
        if (!this.ragPipeline) return null;
        const context = this.ragPipeline.buildResponseContext(transcript);
        if (
          context.factsPack?.facts?.length &&
          context.factsPack.disclaimers?.length
        ) {
          this.setRequiredDisclaimers(context.factsPack.disclaimers);
        }
        return context.instructions;
      });

      console.log("[LaneB] RAG pipeline enabled");
    }

    this.setupAdapterHandlers();
  }

  /**
   * Set conversation context from previous sessions
   * This will be injected into the system prompt when connecting
   */
  setConversationContext(context: string): void {
    this.conversationContext = context;
    console.log(`[LaneB] Conversation context set (${context.length} chars)`);
  }

  /**
   * Get the current conversation context
   */
  getConversationContext(): string | null {
    return this.conversationContext;
  }

  /**
   * Set disclaimer IDs that must be appended to the next assistant response.
   */
  setRequiredDisclaimers(disclaimerIds: string[]): void {
    this.requiredDisclaimerIds = Array.from(
      new Set(disclaimerIds.filter((id) => id)),
    );
  }

  /**
   * Clear any pending disclaimer requirements.
   */
  clearRequiredDisclaimers(): void {
    this.requiredDisclaimerIds = [];
  }

  /**
   * Get the currently required disclaimer IDs.
   */
  getRequiredDisclaimers(): string[] {
    return [...this.requiredDisclaimerIds];
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

    // Forward transcripts (append disclaimers when required)
    this.adapter.on("transcript", (segment) => {
      const updatedSegment = this.applyDisclaimersToTranscript(segment);
      this.emit("transcript", updatedSegment);
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
      this.requiredDisclaimerIds = [];

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
   * If conversation context is set, it will be injected into the session
   */
  async connect(): Promise<void> {
    // Pass conversation context to adapter if available
    if (this.conversationContext) {
      this.adapter.setConversationContext(this.conversationContext);
    }
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
   * Returns true if commit was sent, false if skipped due to guards
   */
  async commitAudio(): Promise<boolean> {
    return await this.adapter.commitAudio();
  }

  /**
   * Clear the OpenAI input audio buffer.
   * Called when the client signals audio stop to discard any in-flight chunks.
   */
  clearInputBuffer(): void {
    this.adapter.clearInputBuffer();
  }

  /**
   * Cancel current response (for barge-in)
   */
  async cancel(): Promise<void> {
    await this.adapter.cancel();
    this.isResponding = false;
    this.firstAudioEmitted = false;
    this.requiredDisclaimerIds = [];
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

  /**
   * Set the voice interaction mode
   * @param mode - 'push-to-talk' or 'open-mic'
   */
  setVoiceMode(mode: "push-to-talk" | "open-mic"): void {
    this.adapter.setVoiceMode(mode);
    console.log(`[LaneB] Voice mode set to: ${mode}`);
  }

  /**
   * Get the current voice mode
   */
  getVoiceMode(): "push-to-talk" | "open-mic" {
    return this.adapter.getVoiceMode();
  }

  /**
   * Append any required disclaimers to the final transcript.
   * Disclaimers are consumed after use to avoid repeat append.
   */
  private applyDisclaimersToTranscript(
    segment: {
      text: string;
      confidence: number;
      isFinal: boolean;
      timestamp: number;
    },
  ):
    | {
        text: string;
        confidence: number;
        isFinal: boolean;
        timestamp: number;
      }
    | typeof segment {
    if (!segment.isFinal || !this.isResponding) {
      return segment;
    }

    if (this.requiredDisclaimerIds.length === 0) {
      return segment;
    }

    const { text: disclaimerText, missing } = formatDisclaimerBlock(
      this.requiredDisclaimerIds,
    );

    // Consume disclaimers regardless of lookup success to avoid loops
    this.requiredDisclaimerIds = [];

    if (missing.length > 0) {
      console.warn(
        `[LaneB] Missing disclaimer IDs: ${missing.join(", ")}`,
      );
    }

    if (!disclaimerText) {
      return segment;
    }

    return {
      ...segment,
      text: `${segment.text}\n\n${disclaimerText}`,
    };
  }
}
