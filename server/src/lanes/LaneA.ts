/**
 * Lane A - Reflex Engine
 *
 * Provides immediate acknowledgements while Lane B processes.
 * Uses pre-configured whitelist phrases for fast, non-committal responses.
 * Audio is generated using OpenAI TTS API for natural speech.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../orchestrator/EventBus.js";
import {
  getWeightedReflex,
  REFLEX_WHITELIST,
} from "../config/reflexWhitelist.js";
import { LaneAReflexEvent } from "../schemas/events.js";
import { getTTSInstance } from "../services/OpenAITTS.js";

// Local type for audio chunk emission
interface AudioChunk {
  data: Buffer;
  format: "pcm" | "opus";
  sampleRate: number;
}

/**
 * Lane A configuration
 */
export interface LaneAConfig {
  enabled: boolean;
  ttsVoice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  defaultSampleRate: number;
}

const DEFAULT_CONFIG: LaneAConfig = {
  enabled: true,
  defaultSampleRate: 24000,
};

/**
 * Pre-cached audio for common reflexes (PCM16 @ 24kHz)
 */
interface CachedAudio {
  utterance: string;
  audioData: Buffer;
  durationMs: number;
}

export class LaneA extends EventEmitter {
  private sessionId: string;
  private config: LaneAConfig;
  private audioCache: Map<string, CachedAudio> = new Map();
  private isPlaying: boolean = false;
  private playbackTimer: NodeJS.Timeout | null = null;
  private currentUtterance: string | null = null;
  private initialized: boolean = false;

  constructor(sessionId: string, config: Partial<LaneAConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start async initialization
    this.initializeAudioCache();
  }

  /**
   * Initialize the audio cache with real TTS audio from OpenAI
   */
  private async initializeAudioCache(): Promise<void> {
    // Use phrases from config - these are the natural sounds like "Mmhmm", "Yeah", etc.
    const reflexPhrases = REFLEX_WHITELIST;

    try {
      const tts = getTTSInstance();
      const audioMap = await tts.preloadPhrases(reflexPhrases);

      // Convert to our cache format
      for (const [key, audioData] of audioMap) {
        // Calculate duration: PCM16 @ 24kHz = 48000 bytes per second
        const durationMs = (audioData.length / 48000) * 1000;

        this.audioCache.set(key, {
          utterance: reflexPhrases.find((p) => p.toLowerCase() === key) || key,
          audioData,
          durationMs,
        });
      }

      this.initialized = true;
      console.log(
        `[LaneA] Audio cache initialized with ${this.audioCache.size} reflexes`,
      );
    } catch (error) {
      console.error("[LaneA] Failed to initialize TTS audio:", error);
      // Fall back to minimal placeholder if TTS fails completely
      this.initializeFallbackAudio(reflexPhrases);
    }
  }

  /**
   * Fallback audio initialization if TTS fails
   */
  private initializeFallbackAudio(phrases: string[]): void {
    console.warn("[LaneA] Using fallback placeholder audio");

    for (const phrase of phrases) {
      const durationMs = 300;
      const samples = Math.floor(
        (this.config.defaultSampleRate * durationMs) / 1000,
      );
      const audioData = Buffer.alloc(samples * 2);

      // Generate a simple tone instead of silence
      for (let i = 0; i < samples; i++) {
        const t = i / this.config.defaultSampleRate;
        const sample = Math.sin(2 * Math.PI * 440 * t) * 0.3 * 32767;
        audioData.writeInt16LE(Math.round(sample), i * 2);
      }

      this.audioCache.set(phrase.toLowerCase(), {
        utterance: phrase,
        audioData,
        durationMs,
      });
    }

    this.initialized = true;
    console.log(
      `[LaneA] Fallback audio cache initialized with ${this.audioCache.size} reflexes`,
    );
  }

  /**
   * Check if Lane A is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Get current utterance being played
   */
  getCurrentUtterance(): string | null {
    return this.currentUtterance;
  }

  /**
   * Play a reflex acknowledgement
   */
  async playReflex(): Promise<void> {
    if (!this.config.enabled) {
      console.log("[LaneA] Disabled - skipping reflex");
      return;
    }

    if (this.isPlaying) {
      console.log("[LaneA] Already playing - skipping");
      return;
    }

    // Select a reflex phrase
    const utterance = getWeightedReflex();
    this.currentUtterance = utterance;
    this.isPlaying = true;

    console.log(`[LaneA] Playing reflex: "${utterance}"`);

    // Emit reflex event
    const reflexEvent: LaneAReflexEvent = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneA",
      type: "lane.a_reflex",
      payload: { utterance },
    };
    eventBus.emit(reflexEvent);

    // Get cached audio or generate via TTS
    const audio = await this.getAudio(utterance);

    if (audio) {
      // Stream audio in chunks
      await this.streamAudio(audio);
    } else {
      console.warn(`[LaneA] No audio found for: "${utterance}"`);
      this.stop();
    }
  }

  /**
   * Get audio for an utterance (from cache or generate via TTS)
   */
  private async getAudio(utterance: string): Promise<CachedAudio | null> {
    const cached = this.audioCache.get(utterance.toLowerCase());
    if (cached) {
      return cached;
    }

    // Generate via TTS if not cached
    try {
      console.log(`[LaneA] Generating TTS for uncached phrase: "${utterance}"`);
      const tts = getTTSInstance();
      const audioData = await tts.generateSpeech(utterance);
      const durationMs = (audioData.length / 48000) * 1000;

      const audio: CachedAudio = {
        utterance,
        audioData,
        durationMs,
      };

      // Cache for future use
      this.audioCache.set(utterance.toLowerCase(), audio);

      return audio;
    } catch (error) {
      console.error(
        `[LaneA] Failed to generate TTS for "${utterance}":`,
        error,
      );
      return null;
    }
  }

  /**
   * Stream audio in chunks to simulate playback
   */
  private async streamAudio(audio: CachedAudio): Promise<void> {
    const chunkSize = 4800; // ~100ms at 24kHz PCM16
    const chunkDurationMs = 100;
    let offset = 0;

    const streamChunk = () => {
      if (!this.isPlaying || offset >= audio.audioData.length) {
        this.stop();
        return;
      }

      const chunk = audio.audioData.subarray(
        offset,
        Math.min(offset + chunkSize, audio.audioData.length),
      );

      // Emit audio chunk
      const audioChunk: AudioChunk = {
        data: Buffer.from(chunk),
        format: "pcm",
        sampleRate: this.config.defaultSampleRate,
      };

      this.emit("audio", audioChunk);
      offset += chunkSize;

      // Schedule next chunk
      this.playbackTimer = setTimeout(streamChunk, chunkDurationMs);
    };

    // Start streaming
    streamChunk();
  }

  /**
   * Stop current playback immediately
   */
  stop(): void {
    if (!this.isPlaying) {
      return;
    }

    console.log(`[LaneA] Stopping playback`);

    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }

    this.isPlaying = false;
    this.currentUtterance = null;
    this.emit("stopped");
  }

  /**
   * Preload audio for specific phrases (for faster playback)
   */
  async preloadAudio(phrases: string[]): Promise<void> {
    console.log(`[LaneA] Preloading ${phrases.length} phrases`);
    const tts = getTTSInstance();
    const audioMap = await tts.preloadPhrases(phrases);

    for (const [key, audioData] of audioMap) {
      const durationMs = (audioData.length / 48000) * 1000;
      this.audioCache.set(key, {
        utterance: phrases.find((p) => p.toLowerCase() === key) || key,
        audioData,
        durationMs,
      });
    }
  }

  /**
   * Set TTS voice for dynamic generation
   */
  setVoice(
    voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
  ): void {
    this.config.ttsVoice = voice;
    const tts = getTTSInstance();
    tts.setVoice(voice);
  }

  /**
   * Check if TTS audio is ready
   */
  isReady(): boolean {
    return this.initialized;
  }
}
