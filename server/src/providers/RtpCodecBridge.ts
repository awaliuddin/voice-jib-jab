/**
 * RtpCodecBridge — G.711 ↔ PCM16 codec conversion with linear resampling.
 *
 * Inbound (SIP → AI):  G.711 μ-law decode → PCM16 at 8kHz → upsample 8k→24k
 * Outbound (AI → SIP): PCM16 at 24kHz → downsample 24k→8k → G.711 μ-law encode
 *
 * All operations are synchronous, pure functions over typed buffers.
 * No external dependencies — codec tables are included inline.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CodecType = "mulaw" | "alaw";

export interface RtpCodecBridgeConfig {
  /** Codec to use for G.711 encoding/decoding. Default: "mulaw" */
  codec?: CodecType;
  /** Sample rate of inbound SIP audio in Hz. Default: 8000 */
  inboundSampleRate?: number;
  /** Sample rate expected by the AI backend in Hz. Default: 24000 */
  outboundSampleRate?: number;
}

// ── G.711 μ-law codec ────────────────────────────────────────────────────────

/**
 * Decode a single G.711 μ-law byte to a signed 16-bit linear PCM sample.
 *
 * Algorithm: invert all bits, then extract sign, 3-bit exponent, and 4-bit
 * mantissa to reconstruct the linear sample.
 */
function mulawDecode(mulaw: number): number {
  mulaw = ~mulaw & 0xff;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;
  let sample = ((mantissa << 1) + 33) << exponent;
  sample -= 33;
  return sign ? -sample : sample;
}

/**
 * Encode a signed 16-bit linear PCM sample to a G.711 μ-law byte.
 *
 * Algorithm: apply μ-law companding, find the exponent band, then pack
 * sign + exponent + mantissa into one byte and invert all bits.
 */
function mulawEncode(sample: number): number {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  const sign = sample < 0 ? 0x80 : 0;
  if (sign) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;
  sample += MULAW_BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // scan downward until we find the leading bit
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const result = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return result;
}

// ── G.711 a-law codec ────────────────────────────────────────────────────────

/**
 * Decode a single G.711 a-law byte to a signed 16-bit linear PCM sample.
 *
 * A-law encoding uses a piecewise linear compression. The standard decoding
 * procedure inverts the even bits (XOR 0x55), then reconstructs the linear
 * value from sign, exponent, and mantissa.
 */
function alawDecode(alaw: number): number {
  alaw ^= 0x55;
  const sign = alaw & 0x80;
  const exponent = (alaw >> 4) & 0x07;
  const mantissa = alaw & 0x0f;
  let sample: number;
  if (exponent === 0) {
    // Linear region: mantissa maps directly (shifted up to PCM16 range)
    sample = (mantissa << 1) | 1;
  } else {
    // Exponential region
    sample = ((mantissa << 1) | 0x21) << (exponent - 1);
  }
  // Scale to 16-bit range (a-law produces 13-bit + sign values)
  sample <<= 3;
  return sign ? sample : -sample;
}

/**
 * Encode a signed 16-bit linear PCM sample to a G.711 a-law byte.
 *
 * Applies the a-law companding law: find exponent band, pack the mantissa,
 * then XOR with 0x55 to invert alternate bits per the G.711 standard.
 */
function alawEncode(sample: number): number {
  const sign = sample >= 0 ? 0x80 : 0;
  if (!sign) sample = -sample;
  // Scale down from PCM16 (13-bit representation used internally)
  sample >>= 3;
  if (sample > 0x0fff) sample = 0x0fff;

  let exponent: number;
  let mantissa: number;
  if (sample < 0x20) {
    // Linear segment
    exponent = 0;
    mantissa = sample >> 1;
  } else {
    // Find exponent
    exponent = 1;
    let step = 0x40;
    while (sample > step + step - 1 && exponent < 7) {
      exponent++;
      step <<= 1;
    }
    mantissa = (sample >> exponent) & 0x0f;
  }
  const result = (sign | (exponent << 4) | mantissa) ^ 0x55;
  return result & 0xff;
}

// ── Linear resampling ────────────────────────────────────────────────────────

/**
 * Upsample an array of int16 PCM samples by an integer factor using linear
 * interpolation.
 *
 * For each pair of adjacent samples [i] and [i+1], the output contains
 * `factor` interpolated samples. The final input sample is repeated to fill
 * the last output block.
 *
 * @param samples Array of int16 values at the input rate.
 * @param factor  Integer upsample factor (e.g. 3 for 8k→24k).
 * @returns       Array of int16 values at factor × input rate.
 */
function upsampleLinear(samples: Int16Array, factor: number): Int16Array {
  const inLen = samples.length;
  if (inLen === 0) return new Int16Array(0);

  const outLen = inLen * factor;
  const out = new Int16Array(outLen);

  for (let i = 0; i < inLen; i++) {
    const curr = samples[i];
    const next = i + 1 < inLen ? samples[i + 1] : curr;
    for (let j = 0; j < factor; j++) {
      out[i * factor + j] = Math.round(curr + (j * (next - curr)) / factor);
    }
  }
  return out;
}

/**
 * Downsample an array of int16 PCM samples by an integer factor by averaging
 * each block of `factor` samples into one output sample.
 *
 * Trailing samples that do not fill a complete block are discarded.
 *
 * @param samples Array of int16 values at the input rate.
 * @param factor  Integer downsample factor (e.g. 3 for 24k→8k).
 * @returns       Array of int16 values at input rate / factor.
 */
function downsampleLinear(samples: Int16Array, factor: number): Int16Array {
  const outLen = Math.floor(samples.length / factor);
  if (outLen === 0) return new Int16Array(0);

  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) {
      sum += samples[i * factor + j];
    }
    const avg = Math.round(sum / factor);
    // Clamp to int16 range
    out[i] = Math.max(-32768, Math.min(32767, avg));
  }
  return out;
}

// ── RtpCodecBridge ───────────────────────────────────────────────────────────

/**
 * Bridges G.711 RTP audio (as received from SIP endpoints) to and from the
 * PCM16 format required by the OpenAI Realtime API.
 *
 * Inbound path  (SIP → AI):
 *   G.711 bytes → decode to PCM16 at inboundSampleRate → upsample to outboundSampleRate
 *
 * Outbound path (AI → SIP):
 *   PCM16 at outboundSampleRate → downsample to inboundSampleRate → encode to G.711 bytes
 *
 * All conversions are synchronous and produce a new Buffer on each call.
 * The instance is stateless between calls — no internal sample buffer is kept.
 */
export class RtpCodecBridge {
  private readonly _codec: CodecType;
  private readonly _inboundRate: number;
  private readonly _outboundRate: number;
  private readonly _resampleFactor: number;

  constructor(config?: RtpCodecBridgeConfig) {
    this._codec = config?.codec ?? "mulaw";
    this._inboundRate = config?.inboundSampleRate ?? 8000;
    this._outboundRate = config?.outboundSampleRate ?? 24000;

    if (this._outboundRate % this._inboundRate !== 0) {
      throw new Error(
        `outboundSampleRate (${this._outboundRate}) must be an integer multiple of inboundSampleRate (${this._inboundRate})`,
      );
    }
    this._resampleFactor = this._outboundRate / this._inboundRate;
  }

  /**
   * Decode a G.711 payload and upsample to outboundSampleRate.
   *
   * @param g711Bytes Buffer of G.711 encoded bytes (one byte = one inbound sample).
   * @returns Buffer of little-endian PCM16 samples at outboundSampleRate (2 bytes per sample).
   */
  decodeInbound(g711Bytes: Buffer): Buffer {
    const inLen = g711Bytes.length;
    // Step 1: decode G.711 bytes to int16 PCM at inbound rate
    const decoded = new Int16Array(inLen);
    if (this._codec === "mulaw") {
      for (let i = 0; i < inLen; i++) {
        decoded[i] = mulawDecode(g711Bytes[i]);
      }
    } else {
      for (let i = 0; i < inLen; i++) {
        decoded[i] = alawDecode(g711Bytes[i]);
      }
    }

    // Step 2: upsample to outbound rate
    const upsampled = upsampleLinear(decoded, this._resampleFactor);

    // Step 3: pack into a Buffer as little-endian int16
    const out = Buffer.allocUnsafe(upsampled.length * 2);
    for (let i = 0; i < upsampled.length; i++) {
      out.writeInt16LE(upsampled[i], i * 2);
    }
    return out;
  }

  /**
   * Downsample PCM16 from outboundSampleRate to inboundSampleRate and encode to G.711.
   *
   * @param pcm16Bytes Buffer of little-endian PCM16 samples at outboundSampleRate (2 bytes per sample).
   * @returns Buffer of G.711 encoded bytes at inboundSampleRate (one byte per sample).
   */
  encodeOutbound(pcm16Bytes: Buffer): Buffer {
    const sampleCount = Math.floor(pcm16Bytes.length / 2);

    // Step 1: unpack little-endian int16 samples
    const pcm = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      pcm[i] = pcm16Bytes.readInt16LE(i * 2);
    }

    // Step 2: downsample to inbound rate
    const downsampled = downsampleLinear(pcm, this._resampleFactor);

    // Step 3: encode to G.711
    const out = Buffer.allocUnsafe(downsampled.length);
    if (this._codec === "mulaw") {
      for (let i = 0; i < downsampled.length; i++) {
        out[i] = mulawEncode(downsampled[i]);
      }
    } else {
      for (let i = 0; i < downsampled.length; i++) {
        out[i] = alawEncode(downsampled[i]);
      }
    }
    return out;
  }

  /**
   * Number of G.711 bytes produced per millisecond at the inbound sample rate.
   *
   * At 8000 samples/s, one sample is emitted per G.711 byte, so the rate is
   * exactly 8 bytes/ms. Useful for jitter-buffer sizing calculations.
   */
  get bytesPerMs(): number {
    return this._inboundRate / 1000;
  }

  /** The configured codec type. */
  get codec(): CodecType {
    return this._codec;
  }
}
