import { AudioChunk } from "../../providers/ProviderAdapter.js";

/**
 * Creates a silent audio chunk for a given duration.
 * Used for testing audio buffers and VAD.
 *
 * @param durationMs - The duration of the audio in milliseconds.
 * @param sampleRate - The sample rate of the audio (default: 24000).
 * @param channels - The number of channels (default: 1).
 * @returns An AudioChunk containing the silent audio data.
 */
export function createAudioForDuration(
  durationMs: number,
  sampleRate = 24000,
  channels = 1
): AudioChunk {
  const bytesPerSample = 2; // 16-bit audio
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const bufferSize = numSamples * channels * bytesPerSample;

  const buffer = Buffer.alloc(bufferSize);

  return {
    data: buffer,
    sampleRate,
    format: "pcm",
  };
}
