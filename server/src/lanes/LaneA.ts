/**
 * Lane A - Reflex Engine
 *
 * Provides immediate acknowledgements while Lane B processes.
 * Uses pre-configured whitelist phrases for fast, non-committal responses.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../orchestrator/EventBus.js";
import { getWeightedReflex } from "../config/reflexWhitelist.js";
import { LaneAReflexEvent } from "../schemas/events.js";

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
  useTTS: boolean; // If true, use TTS; if false, use pre-cached audio
  ttsVoice?: string;
  defaultSampleRate: number;
}

const DEFAULT_CONFIG: LaneAConfig = {
  enabled: true,
  useTTS: false, // Default to pre-cached for speed
  defaultSampleRate: 24000,
};

/**
 * Pre-cached audio for common reflexes (PCM16 @ 24kHz)
 * In production, these would be loaded from actual audio files
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

  constructor(sessionId: string, config: Partial<LaneAConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize audio cache with synthesized placeholder audio
    this.initializeAudioCache();
  }

  /**
   * Initialize the audio cache with placeholder audio
   * In production, this would load actual pre-recorded audio files
   */
  private initializeAudioCache(): void {
    // For now, we'll generate silence as placeholder
    // Real implementation would load pre-recorded or TTS-generated audio
    const reflexPhrases = [
      "Got it",
      "One moment",
      "Sure thing",
      "Working on it",
      "Let me check",
      "I hear you",
    ];

    for (const phrase of reflexPhrases) {
      // Generate ~500ms of silence (24000 * 0.5 * 2 bytes = 24000 bytes)
      const durationMs = 500;
      const samples = Math.floor(
        (this.config.defaultSampleRate * durationMs) / 1000,
      );
      const audioData = Buffer.alloc(samples * 2); // PCM16 = 2 bytes per sample

      // Add a tiny click at start to confirm audio is playing (for debugging)
      // In production, this would be actual audio
      audioData.writeInt16LE(1000, 0);
      audioData.writeInt16LE(-1000, 2);

      this.audioCache.set(phrase.toLowerCase(), {
        utterance: phrase,
        audioData,
        durationMs,
      });
    }

    console.log(
      `[LaneA] Audio cache initialized with ${this.audioCache.size} reflexes`,
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
   * Get audio for an utterance (from cache or TTS)
   */
  private async getAudio(utterance: string): Promise<CachedAudio | null> {
    const cached = this.audioCache.get(utterance.toLowerCase());
    if (cached) {
      return cached;
    }

    if (this.config.useTTS) {
      // TTS integration would go here
      // For now, return null to indicate no audio
      console.log(`[LaneA] TTS not implemented for: "${utterance}"`);
      return null;
    }

    return null;
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
  preloadAudio(phrases: string[]): void {
    // In production, this would trigger TTS or load audio files
    console.log(`[LaneA] Preloading ${phrases.length} phrases`);
  }

  /**
   * Set TTS configuration for dynamic generation
   */
  setTTSConfig(enabled: boolean, voice?: string): void {
    this.config.useTTS = enabled;
    if (voice) {
      this.config.ttsVoice = voice;
    }
  }
}
