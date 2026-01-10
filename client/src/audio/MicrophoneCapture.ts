/**
 * Microphone Capture Module
 * Handles browser microphone access and audio streaming
 *
 * Note: Browsers don't support 24kHz directly. We capture at native rate
 * and resample to 24kHz for OpenAI Realtime API compatibility.
 */

const TARGET_SAMPLE_RATE = 24000;

export class MicrophoneCapture {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isCapturing: boolean = false;
  private onAudioChunk: ((chunk: Float32Array) => void) | null = null;
  private resampleRatio: number = 1;

  async initialize(): Promise<void> {
    try {
      // Request microphone access - let browser choose sample rate
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Get the actual sample rate from the audio track
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();
      const nativeSampleRate = settings.sampleRate || 48000;

      console.log(`[MicCapture] Native sample rate: ${nativeSampleRate}Hz`);

      // Create audio context at native rate (required for MediaStreamSource)
      this.audioContext = new AudioContext({ sampleRate: nativeSampleRate });

      // Calculate resample ratio for conversion to 24kHz
      this.resampleRatio = nativeSampleRate / TARGET_SAMPLE_RATE;

      console.log(
        `[MicCapture] Resample ratio: ${this.resampleRatio} (${nativeSampleRate} -> ${TARGET_SAMPLE_RATE})`,
      );

      // Create source from stream
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create processor for audio chunks
      // Note: ScriptProcessorNode is deprecated, but still widely supported
      // TODO: Migrate to AudioWorklet for production
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (this.isCapturing && this.onAudioChunk) {
          const inputData = event.inputBuffer.getChannelData(0);
          // Resample to 24kHz
          const resampled = this.resample(inputData);
          this.onAudioChunk(resampled);
        }
      };

      // Connect audio graph
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log("[MicCapture] Initialized successfully");
    } catch (error) {
      console.error("[MicCapture] Initialization failed:", error);
      throw new Error("Failed to access microphone. Please grant permission.");
    }
  }

  /**
   * Resample audio from native rate to 24kHz using linear interpolation
   */
  private resample(input: Float32Array): Float32Array {
    if (this.resampleRatio === 1) {
      return input;
    }

    const outputLength = Math.floor(input.length / this.resampleRatio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * this.resampleRatio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
      const t = srcIndex - srcIndexFloor;

      // Linear interpolation
      output[i] = input[srcIndexFloor] * (1 - t) + input[srcIndexCeil] * t;
    }

    return output;
  }

  start(onAudioChunk: (chunk: Float32Array) => void): void {
    if (!this.audioContext || !this.processor) {
      throw new Error("MicrophoneCapture not initialized");
    }

    this.onAudioChunk = onAudioChunk;
    this.isCapturing = true;

    // Resume audio context if suspended
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    console.log("[MicCapture] Started capturing");
  }

  stop(): void {
    this.isCapturing = false;
    this.onAudioChunk = null;
    console.log("[MicCapture] Stopped capturing");
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

    console.log("[MicCapture] Cleaned up");
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
