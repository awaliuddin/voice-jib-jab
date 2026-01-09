/**
 * Microphone Capture Module
 * Handles browser microphone access and audio streaming
 */

export class MicrophoneCapture {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isCapturing: boolean = false;
  private onAudioChunk: ((chunk: Float32Array) => void) | null = null;

  async initialize(): Promise<void> {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000,
        },
      });

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: 24000 });

      // Create source from stream
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create processor for audio chunks
      // Note: ScriptProcessorNode is deprecated, but still widely supported
      // TODO: Migrate to AudioWorklet for production
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (this.isCapturing && this.onAudioChunk) {
          const inputData = event.inputBuffer.getChannelData(0);
          this.onAudioChunk(inputData);
        }
      };

      // Connect audio graph
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log('[MicCapture] Initialized successfully');
    } catch (error) {
      console.error('[MicCapture] Initialization failed:', error);
      throw new Error('Failed to access microphone. Please grant permission.');
    }
  }

  start(onAudioChunk: (chunk: Float32Array) => void): void {
    if (!this.audioContext || !this.processor) {
      throw new Error('MicrophoneCapture not initialized');
    }

    this.onAudioChunk = onAudioChunk;
    this.isCapturing = true;

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    console.log('[MicCapture] Started capturing');
  }

  stop(): void {
    this.isCapturing = false;
    this.onAudioChunk = null;
    console.log('[MicCapture] Stopped capturing');
  }

  cleanup(): void {
    this.stop();

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    console.log('[MicCapture] Cleaned up');
  }

  isInitialized(): boolean {
    return this.audioContext !== null;
  }

  isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Convert Float32Array to PCM16 buffer for transmission
   */
  static float32ToPCM16(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, sample * 0x7fff, true);
    }

    return buffer;
  }
}
