/**
 * FallbackPlanner
 *
 * Provides safe, pre-approved fallback audio when Lane C cancels output.
 * Emits audio chunks for playback and signals when playback completes.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../orchestrator/EventBus.js";
import { getTTSInstance } from "../services/OpenAITTS.js";
import type {
  Event,
  FallbackEventPayload,
  FallbackMode,
  PolicyDecisionPayload,
} from "../schemas/events.js";

interface AudioChunk {
  data: Buffer;
  format: "pcm";
  sampleRate: number;
}

interface CachedAudio {
  utterance: string;
  audioData: Buffer;
  durationMs: number;
}

export type FallbackOutput = "audio" | "text";
export type ResolvedFallbackMode = Exclude<FallbackMode, "auto">;

export interface FallbackPlan {
  mode: ResolvedFallbackMode;
  utterance: string;
  output: FallbackOutput;
}

export interface FallbackPlannerConfig {
  enabled: boolean;
  mode: FallbackMode;
  phrases: string[];
  clarifyingQuestions: string[];
  textSummaryPrompts: string[];
  escalationPhrases: string[];
  offerEmailOrLinkPhrases: string[];
  defaultSampleRate: number;
}

const DEFAULT_CONFIG: FallbackPlannerConfig = {
  enabled: true,
  mode: "auto",
  phrases: [
    "Sorry, I can't help with that.",
    "I can't assist with that request. Please ask something else.",
    "I'm not able to answer that, but I'm happy to help with other questions.",
  ],
  clarifyingQuestions: [
    "Could you clarify what you mean or provide more details?",
    "Can you share a bit more context so I can help?",
    "What specific part would you like help with?",
  ],
  textSummaryPrompts: [
    "I can switch to a text summary instead. Would you like that?",
    "If you prefer, I can provide a concise text summary.",
  ],
  escalationPhrases: [
    "I cannot handle that directly. I can escalate this to a human reviewer.",
    "This looks like it needs human review. I can escalate it for you.",
  ],
  offerEmailOrLinkPhrases: [
    "I can send a link or email with the details. What is the best address?",
    "If you want, I can send a link or email with more information.",
  ],
  defaultSampleRate: 24000,
};

export class FallbackPlanner extends EventEmitter {
  private sessionId: string;
  private config: FallbackPlannerConfig;
  private audioCache: Map<string, CachedAudio> = new Map();
  private isPlaying: boolean = false;
  private playbackTimer: NodeJS.Timeout | null = null;
  private currentUtterance: string | null = null;
  private currentMode: ResolvedFallbackMode | null = null;
  private currentOutput: FallbackOutput | null = null;
  private lastDecision: PolicyDecisionPayload | null = null;

  constructor(sessionId: string, config: Partial<FallbackPlannerConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isActive(): boolean {
    return this.isPlaying;
  }

  getCurrentUtterance(): string | null {
    return this.currentUtterance;
  }

  getCurrentMode(): ResolvedFallbackMode | null {
    return this.currentMode;
  }

  async trigger(payload?: PolicyDecisionPayload): Promise<void> {
    if (!this.config.enabled) {
      console.log("[FallbackPlanner] Disabled - skipping fallback");
      return;
    }

    if (this.isPlaying) {
      console.log("[FallbackPlanner] Already playing - skipping");
      return;
    }

    const mode = this.resolveMode(payload);
    const plan = this.buildPlan(mode, payload);

    this.currentUtterance = plan.utterance;
    this.currentMode = plan.mode;
    this.currentOutput = plan.output;
    this.lastDecision = payload ?? null;
    this.isPlaying = true;

    this.emit("started", {
      utterance: plan.utterance,
      mode: plan.mode,
      output: plan.output,
      decision: payload?.decision,
    });
    this.emitFallbackEvent("fallback.started", {
      mode: plan.mode,
      decision: payload?.decision,
      reason_codes: payload?.reason_codes,
      utterance: plan.utterance,
      output: plan.output,
      status: "started",
    });
    console.log(
      `[FallbackPlanner] Playing fallback (${plan.mode}) for session ${this.sessionId}: "${plan.utterance}"`,
    );

    try {
      if (plan.output === "text") {
        this.emit("text", { text: plan.utterance, mode: plan.mode });
        this.finish("done");
        return;
      }

      const audio = await this.getAudio(plan.utterance);
      if (!audio) {
        console.warn("[FallbackPlanner] Failed to generate fallback audio");
        this.finish("done");
        return;
      }
      await this.streamAudio(audio);
    } catch (error) {
      console.error("[FallbackPlanner] Error during fallback playback:", error);
      this.finish("done");
    }
  }

  stop(): void {
    if (!this.isPlaying) {
      return;
    }

    console.log("[FallbackPlanner] Stopping fallback playback");
    this.finish("stopped");
  }

  private resolveMode(payload?: PolicyDecisionPayload): ResolvedFallbackMode {
    if (this.config.mode !== "auto") {
      return this.config.mode as ResolvedFallbackMode;
    }

    const payloadMode = payload?.fallback_mode;
    if (payloadMode && payloadMode !== "auto") {
      return payloadMode as ResolvedFallbackMode;
    }

    switch (payload?.decision) {
      case "escalate":
        return "escalate_to_human";
      case "refuse":
      case "cancel_output":
        return "refuse_politely";
      case "rewrite":
        return "ask_clarifying_question";
      default:
        return "refuse_politely";
    }
  }

  private buildPlan(
    mode: ResolvedFallbackMode,
    payload?: PolicyDecisionPayload,
  ): FallbackPlan {
    switch (mode) {
      case "ask_clarifying_question":
        return this.askClarifyingQuestion(payload);
      case "switch_to_text_summary":
        return this.switchToTextSummary(payload);
      case "escalate_to_human":
        return this.escalateToHuman(payload);
      case "offer_email_or_link":
        return this.offerEmailOrLink(payload);
      case "refuse_politely":
      default:
        return this.refusePolitely(payload);
    }
  }

  // ── Safe fallback maneuvers (stub implementations) ──────────────────

  askClarifyingQuestion(payload?: PolicyDecisionPayload): FallbackPlan {
    void payload;
    return {
      mode: "ask_clarifying_question",
      utterance: this.pickPhrase(
        this.config.clarifyingQuestions,
        "Could you clarify what you need?",
      ),
      output: "audio",
    };
  }

  refusePolitely(payload?: PolicyDecisionPayload): FallbackPlan {
    void payload;
    return {
      mode: "refuse_politely",
      utterance: this.pickPhrase(
        this.config.phrases,
        "Sorry, I can't help with that.",
      ),
      output: "audio",
    };
  }

  switchToTextSummary(payload?: PolicyDecisionPayload): FallbackPlan {
    void payload;
    return {
      mode: "switch_to_text_summary",
      utterance: this.pickPhrase(
        this.config.textSummaryPrompts,
        "I can switch to a text summary instead. Would you like that?",
      ),
      output: "audio",
    };
  }

  escalateToHuman(payload?: PolicyDecisionPayload): FallbackPlan {
    void payload;
    return {
      mode: "escalate_to_human",
      utterance: this.pickPhrase(
        this.config.escalationPhrases,
        "This looks like it needs human review. I can escalate it for you.",
      ),
      output: "audio",
    };
  }

  offerEmailOrLink(payload?: PolicyDecisionPayload): FallbackPlan {
    void payload;
    return {
      mode: "offer_email_or_link",
      utterance: this.pickPhrase(
        this.config.offerEmailOrLinkPhrases,
        "I can send a link or email with the details. What is the best address?",
      ),
      output: "audio",
    };
  }

  private pickPhrase(list: string[], fallback: string): string {
    if (!Array.isArray(list) || list.length === 0) {
      return fallback;
    }

    const index = Math.floor(Math.random() * list.length);
    return list[index] || fallback;
  }

  private emitFallbackEvent(
    type: "fallback.started" | "fallback.completed",
    payload: FallbackEventPayload,
  ): void {
    const event: Event = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "orchestrator",
      type,
      payload,
    };
    eventBus.emit(event);
  }

  private async getAudio(utterance: string): Promise<CachedAudio | null> {
    const cacheKey = utterance.toLowerCase();
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const bytesPerSecond = this.config.defaultSampleRate * 2;

    try {
      const tts = getTTSInstance();
      const audioData = await tts.generateSpeech(utterance);
      const durationMs = (audioData.length / bytesPerSecond) * 1000;

      const audio: CachedAudio = {
        utterance,
        audioData,
        durationMs,
      };

      this.audioCache.set(cacheKey, audio);
      return audio;
    } catch (error) {
      console.warn(
        "[FallbackPlanner] TTS failed, using fallback tone:",
        error,
      );

      const audioData = this.generateTone(800);
      const durationMs = (audioData.length / bytesPerSecond) * 1000;

      const audio: CachedAudio = {
        utterance,
        audioData,
        durationMs,
      };

      this.audioCache.set(cacheKey, audio);
      return audio;
    }
  }

  private generateTone(durationMs: number): Buffer {
    const samples = Math.floor(
      (this.config.defaultSampleRate * durationMs) / 1000,
    );
    const audioData = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
      const t = i / this.config.defaultSampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.2 * 32767;
      audioData.writeInt16LE(Math.round(sample), i * 2);
    }

    return audioData;
  }

  private async streamAudio(audio: CachedAudio): Promise<void> {
    const bytesPerSample = 2;
    const chunkDurationMs = 100;
    const chunkSize = Math.floor(
      (this.config.defaultSampleRate * chunkDurationMs) / 1000,
    ) * bytesPerSample;

    let offset = 0;

    const streamChunk = () => {
      if (!this.isPlaying) {
        return;
      }

      if (offset >= audio.audioData.length) {
        this.finish("done");
        return;
      }

      const chunk = audio.audioData.subarray(
        offset,
        Math.min(offset + chunkSize, audio.audioData.length),
      );

      const audioChunk: AudioChunk = {
        data: Buffer.from(chunk),
        format: "pcm",
        sampleRate: this.config.defaultSampleRate,
      };

      this.emit("audio", audioChunk);
      offset += chunkSize;

      this.playbackTimer = setTimeout(streamChunk, chunkDurationMs);
    };

    streamChunk();
  }

  private finish(reason: "done" | "stopped"): void {
    if (!this.isPlaying) {
      return;
    }

    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }

    const utterance = this.currentUtterance;
    const mode = this.currentMode ?? "refuse_politely";
    const output = this.currentOutput ?? "audio";
    const decision = this.lastDecision;

    this.currentUtterance = null;
    this.currentMode = null;
    this.currentOutput = null;
    this.lastDecision = null;
    this.isPlaying = false;

    this.emit("done", { reason, utterance, mode });
    this.emitFallbackEvent("fallback.completed", {
      mode,
      decision: decision?.decision,
      reason_codes: decision?.reason_codes,
      utterance,
      output,
      status: "completed",
      reason,
    });
  }
}
