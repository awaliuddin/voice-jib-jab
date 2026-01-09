/**
 * Audio Playback Module
 * Handles streaming audio playback with barge-in support
 */

export class AudioPlayback {
  private audioContext: AudioContext | null = null;
  private audioQueue: AudioBuffer[] = [];
  private isPlaying: boolean = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private nextPlayTime: number = 0;
  private onPlaybackEnd: (() => void) | null = null;

  async initialize(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    console.log('[AudioPlayback] Initialized');
  }

  /**
   * Add audio chunk to playback queue
   */
  async enqueueAudio(pcm16Data: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      throw new Error('AudioPlayback not initialized');
    }

    try {
      // Convert PCM16 to AudioBuffer
      const audioBuffer = await this.pcm16ToAudioBuffer(pcm16Data);
      this.audioQueue.push(audioBuffer);

      // Start playback if not already playing
      if (!this.isPlaying) {
        this.startPlayback();
      }
    } catch (error) {
      console.error('[AudioPlayback] Error enqueueing audio:', error);
    }
  }

  private async pcm16ToAudioBuffer(pcm16Data: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }

    const dataView = new DataView(pcm16Data);
    const numSamples = pcm16Data.byteLength / 2;

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(
      1,
      numSamples,
      this.audioContext.sampleRate
    );

    const channelData = audioBuffer.getChannelData(0);

    // Convert PCM16 to Float32
    for (let i = 0; i < numSamples; i++) {
      const sample = dataView.getInt16(i * 2, true);
      channelData[i] = sample / 0x7fff;
    }

    return audioBuffer;
  }

  private startPlayback(): void {
    if (!this.audioContext || this.isPlaying) {
      return;
    }

    this.isPlaying = true;
    this.nextPlayTime = this.audioContext.currentTime;

    this.playNextChunk();
  }

  private playNextChunk(): void {
    if (!this.audioContext || !this.isPlaying) {
      return;
    }

    const audioBuffer = this.audioQueue.shift();

    if (!audioBuffer) {
      // No more chunks, wait a bit then check again
      setTimeout(() => {
        if (this.audioQueue.length === 0 && this.isPlaying) {
          this.stopPlayback();
        } else if (this.isPlaying) {
          this.playNextChunk();
        }
      }, 100);
      return;
    }

    // Create source node
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Schedule playback
    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;

    // Store current source for potential cancellation
    this.currentSource = source;

    // Schedule next chunk
    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
      this.playNextChunk();
    };

    console.log(`[AudioPlayback] Playing chunk: ${audioBuffer.duration.toFixed(3)}s`);
  }

  /**
   * Stop playback immediately (for barge-in)
   */
  stop(): void {
    if (!this.audioContext) return;

    this.isPlaying = false;

    // Stop current source
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Already stopped
      }
      this.currentSource = null;
    }

    // Clear queue
    this.audioQueue = [];
    this.nextPlayTime = this.audioContext.currentTime;

    if (this.onPlaybackEnd) {
      this.onPlaybackEnd();
    }

    console.log('[AudioPlayback] Stopped');
  }

  private stopPlayback(): void {
    this.isPlaying = false;
    this.currentSource = null;

    if (this.onPlaybackEnd) {
      this.onPlaybackEnd();
    }

    console.log('[AudioPlayback] Playback ended naturally');
  }

  setOnPlaybackEnd(callback: () => void): void {
    this.onPlaybackEnd = callback;
  }

  cleanup(): void {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log('[AudioPlayback] Cleaned up');
  }

  isActive(): boolean {
    return this.isPlaying;
  }

  getQueueSize(): number {
    return this.audioQueue.length;
  }
}
