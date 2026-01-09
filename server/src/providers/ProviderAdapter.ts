/**
 * Abstract Provider Adapter interface
 * Allows pluggable voice providers (OpenAI, Claude, etc.)
 */

import { EventEmitter } from 'events';

export interface ProviderConfig {
  apiKey: string;
  model: string;
  systemInstructions?: string;
}

export interface AudioChunk {
  data: Buffer;
  format: 'pcm' | 'opus';
  sampleRate: number;
}

export interface TranscriptSegment {
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

/**
 * Abstract base class for voice provider adapters
 */
export abstract class ProviderAdapter extends EventEmitter {
  protected config: ProviderConfig;
  protected sessionId: string | null = null;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize connection to provider
   */
  abstract connect(sessionId: string): Promise<void>;

  /**
   * Send audio chunk to provider
   */
  abstract sendAudio(chunk: AudioChunk): Promise<void>;

  /**
   * Cancel current response (for barge-in)
   */
  abstract cancel(): Promise<void>;

  /**
   * Disconnect from provider
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  abstract isConnected(): boolean;

  /**
   * Events emitted:
   * - 'audio' (chunk: AudioChunk) - Audio response from provider
   * - 'transcript' (segment: TranscriptSegment) - Transcript of user or assistant
   * - 'response_start' - Assistant started responding
   * - 'response_end' - Assistant finished responding
   * - 'error' (error: Error) - Error occurred
   */
}
