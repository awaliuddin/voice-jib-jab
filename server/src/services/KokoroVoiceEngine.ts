/**
 * KokoroVoiceEngine — Local TTS engine backed by the Kokoro HTTP server.
 *
 * Kokoro runs at http://localhost:8880 and exposes an OpenAI-compatible
 * /v1/audio/speech endpoint that returns WAV audio buffers.
 *
 * Usage:
 *   const engine = new KokoroVoiceEngine({ defaultVoice: "af_bella" });
 *   const audio = await engine.synthesize("Hello, world!");
 */

// ── Types ─────────────────────────────────────────────────────────────

/** Connection and default voice settings for a TTS engine. */
export interface VoiceEngineConfig {
  baseUrl: string;
  timeoutMs: number;
  defaultVoice: string;
}

/** Per-call overrides for voice ID and playback speed. */
export interface SynthesisOptions {
  voiceId?: string;
  speed?: number;
}

/** Pluggable TTS engine contract for text-to-speech synthesis. */
export interface VoiceEngine {
  synthesize(text: string, options?: SynthesisOptions): Promise<Buffer>;
  isAvailable(): Promise<boolean>;
}

// ── Defaults ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: VoiceEngineConfig = {
  baseUrl: "http://localhost:8880",
  timeoutMs: 10000,
  defaultVoice: "af_bella",
};

// ── KokoroVoiceEngine ─────────────────────────────────────────────────

/** Local TTS engine backed by the Kokoro HTTP server (OpenAI-compatible API). */
export class KokoroVoiceEngine implements VoiceEngine {
  private config: VoiceEngineConfig;

  constructor(config?: Partial<VoiceEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Synthesize text to audio using the Kokoro TTS server.
   *
   * @param text - The text to convert to speech
   * @param options - Optional voice and speed overrides
   * @returns WAV audio buffer
   */
  async synthesize(text: string, options?: SynthesisOptions): Promise<Buffer> {
    const voiceId = options?.voiceId ?? this.config.defaultVoice;
    const speed = options?.speed ?? 1.0;

    console.log(`[KokoroTTS] Synthesizing ${text.length} chars with voice ${voiceId}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kokoro",
          voice: voiceId,
          input: text,
          response_format: "wav",
          speed,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Kokoro TTS failed: HTTP ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("Kokoro TTS timeout");
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Kokoro TTS timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check whether the Kokoro TTS server is reachable.
   *
   * @returns true if the server responds with 200, false otherwise.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`);
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
