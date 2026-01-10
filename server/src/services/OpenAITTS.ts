/**
 * OpenAI TTS Service
 *
 * Generates real speech audio using OpenAI's TTS API.
 * Returns PCM16 audio at 24kHz for compatibility with the voice system.
 */

import OpenAI from "openai";
import { config } from "../config/index.js";

export interface TTSConfig {
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  speed: number;
}

const DEFAULT_CONFIG: TTSConfig = {
  voice: "alloy",
  speed: 1.0,
};

/**
 * OpenAI TTS Service
 */
export class OpenAITTS {
  private client: OpenAI;
  private config: TTSConfig;
  private cache: Map<string, Buffer> = new Map();

  constructor(ttsConfig: Partial<TTSConfig> = {}) {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.config = { ...DEFAULT_CONFIG, ...ttsConfig };
  }

  /**
   * Generate speech from text using OpenAI TTS API
   * Returns PCM16 audio buffer at 24kHz
   */
  async generateSpeech(text: string): Promise<Buffer> {
    // Check cache first
    const cacheKey = `${text}:${this.config.voice}:${this.config.speed}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`[TTS] Cache hit for: "${text}"`);
      return cached;
    }

    console.log(`[TTS] Generating speech for: "${text}"`);

    try {
      const response = await this.client.audio.speech.create({
        model: "tts-1",
        voice: this.config.voice,
        input: text,
        response_format: "pcm",
        speed: this.config.speed,
      });

      // Get the audio data as ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Cache the result
      this.cache.set(cacheKey, buffer);

      console.log(
        `[TTS] Generated ${buffer.length} bytes for: "${text}" (${(buffer.length / 48000).toFixed(2)}s)`,
      );

      return buffer;
    } catch (error) {
      console.error(`[TTS] Failed to generate speech for "${text}":`, error);
      throw error;
    }
  }

  /**
   * Pre-generate speech for multiple phrases (for faster playback)
   */
  async preloadPhrases(phrases: string[]): Promise<Map<string, Buffer>> {
    console.log(`[TTS] Preloading ${phrases.length} phrases...`);

    const results = new Map<string, Buffer>();

    // Generate in parallel but with some throttling
    const batchSize = 3;
    for (let i = 0; i < phrases.length; i += batchSize) {
      const batch = phrases.slice(i, i + batchSize);
      const promises = batch.map(async (phrase) => {
        try {
          const audio = await this.generateSpeech(phrase);
          results.set(phrase.toLowerCase(), audio);
        } catch {
          console.warn(`[TTS] Failed to preload: "${phrase}"`);
        }
      });
      await Promise.all(promises);
    }

    console.log(`[TTS] Preloaded ${results.size}/${phrases.length} phrases`);
    return results;
  }

  /**
   * Set voice configuration
   */
  setVoice(voice: TTSConfig["voice"]): void {
    this.config.voice = voice;
    // Clear cache when voice changes
    this.cache.clear();
  }

  /**
   * Clear the audio cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Singleton instance for shared TTS
 */
let ttsInstance: OpenAITTS | null = null;

export function getTTSInstance(): OpenAITTS {
  if (!ttsInstance) {
    ttsInstance = new OpenAITTS();
  }
  return ttsInstance;
}
