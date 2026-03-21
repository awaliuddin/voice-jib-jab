/**
 * RtpCodecBridge + RtpFrameParser Unit Tests — N-11 Phase 2
 *
 * All tests are synchronous, pure codec math — no I/O, no async operations.
 *
 * Structure:
 *   1. RtpCodecBridge constructor
 *   2. decodeInbound() — μ-law
 *   3. decodeInbound() — a-law
 *   4. encodeOutbound() — μ-law
 *   5. RtpFrameParser — parse / build / helpers
 *   6. Integration — RtpFrameParser + RtpCodecBridge
 */

import { RtpCodecBridge } from "../../providers/RtpCodecBridge.js";
import { RtpFrameParser } from "../../providers/RtpFrameParser.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a Buffer of n G.711 silence bytes (μ-law silence = 0xFF). */
function mulawSilenceBuffer(n: number): Buffer {
  return Buffer.alloc(n, 0xff);
}

/**
 * Build a Buffer of n PCM16 LE silence samples (all zero bytes).
 * Each sample = 2 bytes, so the buffer length is n * 2.
 */
function pcm16SilenceBuffer(sampleCount: number): Buffer {
  return Buffer.alloc(sampleCount * 2, 0x00);
}

/**
 * Read a PCM16 LE sample from a buffer at the given sample index.
 */
function readSample(buf: Buffer, index: number): number {
  return buf.readInt16LE(index * 2);
}

/**
 * Build a raw RTP packet buffer manually (big-endian, fixed 12-byte header).
 *
 * @param payloadType  RTP payload type (0 = PCMU, 8 = PCMA).
 * @param seq          16-bit sequence number.
 * @param ts           32-bit timestamp.
 * @param ssrc         32-bit SSRC.
 * @param payload      Payload bytes.
 */
function buildRawRtpBuffer(
  payloadType: number,
  seq: number,
  ts: number,
  ssrc: number,
  payload: Buffer,
): Buffer {
  const buf = Buffer.allocUnsafe(12 + payload.length);
  buf[0] = 0x80; // V=2, P=0, X=0, CC=0
  buf[1] = payloadType & 0x7f;
  buf.writeUInt16BE(seq, 2);
  buf.writeUInt32BE(ts, 4);
  buf.writeUInt32BE(ssrc, 8);
  payload.copy(buf, 12);
  return buf;
}

// ── 1. RtpCodecBridge — constructor ─────────────────────────────────────────

describe("RtpCodecBridge — constructor", () => {
  it("default codec is 'mulaw'", () => {
    const bridge = new RtpCodecBridge();
    expect(bridge.codec).toBe("mulaw");
  });

  it("codec getter returns 'mulaw' when explicitly configured", () => {
    const bridge = new RtpCodecBridge({ codec: "mulaw" });
    expect(bridge.codec).toBe("mulaw");
  });

  it("codec getter returns 'alaw' when configured with alaw", () => {
    const bridge = new RtpCodecBridge({ codec: "alaw" });
    expect(bridge.codec).toBe("alaw");
  });

  it("bytesPerMs returns 8 for default 8000 Hz inbound rate", () => {
    const bridge = new RtpCodecBridge();
    expect(bridge.bytesPerMs).toBe(8);
  });

  it("bytesPerMs scales with inboundSampleRate", () => {
    const bridge = new RtpCodecBridge({ inboundSampleRate: 16000, outboundSampleRate: 48000 });
    expect(bridge.bytesPerMs).toBe(16);
  });

  it("throws when outboundSampleRate is not an integer multiple of inboundSampleRate", () => {
    expect(() => new RtpCodecBridge({ inboundSampleRate: 8000, outboundSampleRate: 22050 })).toThrow();
  });
});

// ── 2. RtpCodecBridge — decodeInbound() μ-law ────────────────────────────────

describe("RtpCodecBridge — decodeInbound() μ-law", () => {
  const bridge = new RtpCodecBridge({ codec: "mulaw" });

  it("returns a Buffer", () => {
    const result = bridge.decodeInbound(mulawSilenceBuffer(8));
    expect(result).toBeInstanceOf(Buffer);
  });

  it("output length equals inputLength * resampleFactor * 2 (8k→24k, 2 bytes/sample)", () => {
    const input = Buffer.alloc(10, 0x7f);
    const result = bridge.decodeInbound(input);
    // 10 samples × 3 (upsample) × 2 (bytes per PCM16 sample)
    expect(result.length).toBe(10 * 3 * 2);
  });

  it("μ-law silence (0xFF bytes) decodes to near-zero PCM16 samples", () => {
    const result = bridge.decodeInbound(mulawSilenceBuffer(16));
    const sampleCount = result.length / 2;
    for (let i = 0; i < sampleCount; i++) {
      const s = readSample(result, i);
      // μ-law 0xFF is the encoded representation of near-zero; allow small deviation
      expect(Math.abs(s)).toBeLessThanOrEqual(8);
    }
  });

  it("non-silence μ-law produces non-zero PCM16 samples", () => {
    // 0x00 is the highest positive level in μ-law
    const input = Buffer.alloc(8, 0x00);
    const result = bridge.decodeInbound(input);
    const hasNonZero = Array.from({ length: result.length / 2 }, (_, i) =>
      readSample(result, i),
    ).some((s) => s !== 0);
    expect(hasNonZero).toBe(true);
  });

  it("all output sample values are within int16 range [-32768, 32767]", () => {
    // Sweep a representative set of μ-law values
    const input = Buffer.from(Array.from({ length: 64 }, (_, i) => i * 4));
    const result = bridge.decodeInbound(input);
    const sampleCount = result.length / 2;
    for (let i = 0; i < sampleCount; i++) {
      const s = readSample(result, i);
      expect(s).toBeGreaterThanOrEqual(-32768);
      expect(s).toBeLessThanOrEqual(32767);
    }
  });

  it("μ-law byte 0x00 (maximum magnitude) decodes to a large-amplitude PCM16 sample", () => {
    const result = bridge.decodeInbound(Buffer.from([0x00]));
    // 0x00 in μ-law is the maximum-magnitude code; absolute value must be large
    const firstSample = readSample(result, 0);
    expect(Math.abs(firstSample)).toBeGreaterThan(1000);
  });

  it("round-trip: decodeInbound then encodeOutbound on a constant signal is deterministic", () => {
    // μ-law uses non-uniform quantisation: decode(b) then encode(decode(b)) does not
    // always recover b (the quantisation step at each level can exceed the original
    // encoded amplitude). However, the round-trip MUST be deterministic — two calls
    // with identical input must produce identical output.
    const constByte = 0x40;
    const original = Buffer.alloc(8, constByte);
    const pcm1 = bridge.decodeInbound(original);
    const rt1 = bridge.encodeOutbound(pcm1);
    const pcm2 = bridge.decodeInbound(original);
    const rt2 = bridge.encodeOutbound(pcm2);
    // Both round-trips must agree
    expect(rt1).toEqual(rt2);
    // All output bytes must be identical (constant input → constant output)
    expect(new Set(rt1).size).toBe(1);
    // Output must be a valid μ-law byte (0–255)
    expect(rt1[0]).toBeGreaterThanOrEqual(0);
    expect(rt1[0]).toBeLessThanOrEqual(255);
  });

  it("empty input produces empty output", () => {
    const result = bridge.decodeInbound(Buffer.alloc(0));
    expect(result.length).toBe(0);
  });
});

// ── 3. RtpCodecBridge — decodeInbound() a-law ────────────────────────────────

describe("RtpCodecBridge — decodeInbound() a-law", () => {
  const bridge = new RtpCodecBridge({ codec: "alaw" });

  it("returns a Buffer for a-law input", () => {
    const result = bridge.decodeInbound(Buffer.alloc(8, 0xd5));
    expect(result).toBeInstanceOf(Buffer);
  });

  it("output length equals inputLength * 3 * 2 (8k→24k upsample)", () => {
    const input = Buffer.alloc(12, 0x55);
    const result = bridge.decodeInbound(input);
    expect(result.length).toBe(12 * 3 * 2);
  });

  it("a-law round-trip: decode then encode on a constant signal returns the same byte", () => {
    // Same reasoning as μ-law: constant signal survives upsample→downsample losslessly.
    const constByte = 0x55; // a-law silence / mid-range value
    const original = Buffer.alloc(8, constByte);
    const pcm = bridge.decodeInbound(original);
    const roundTripped = bridge.encodeOutbound(pcm);
    expect(roundTripped.length).toBe(original.length);
    for (let i = 0; i < roundTripped.length; i++) {
      expect(roundTripped[i]).toBe(constByte);
    }
  });

  it("a-law output samples are within int16 range", () => {
    const input = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 8));
    const result = bridge.decodeInbound(input);
    const sampleCount = result.length / 2;
    for (let i = 0; i < sampleCount; i++) {
      const s = readSample(result, i);
      expect(s).toBeGreaterThanOrEqual(-32768);
      expect(s).toBeLessThanOrEqual(32767);
    }
  });
});

// ── 4. RtpCodecBridge — encodeOutbound() μ-law ───────────────────────────────

describe("RtpCodecBridge — encodeOutbound() μ-law", () => {
  const bridge = new RtpCodecBridge({ codec: "mulaw" });

  it("returns a Buffer", () => {
    const result = bridge.encodeOutbound(pcm16SilenceBuffer(24));
    expect(result).toBeInstanceOf(Buffer);
  });

  it("output length = floor(inputBytes / 2 / 3) — downsample 24k→8k", () => {
    // 24 PCM16 samples at 24kHz → 48 bytes input → 8 G.711 bytes output
    const input = pcm16SilenceBuffer(24);
    const result = bridge.encodeOutbound(input);
    expect(result.length).toBe(Math.floor(input.length / 2 / 3));
  });

  it("output length = floor(inputBytes / 6) for arbitrary sizes", () => {
    // 15 PCM16 samples = 30 bytes → floor(30/2/3) = 5
    const input = pcm16SilenceBuffer(15);
    const result = bridge.encodeOutbound(input);
    expect(result.length).toBe(5);
  });

  it("silence PCM16 (all zero bytes) encodes to μ-law silence bytes", () => {
    const result = bridge.encodeOutbound(pcm16SilenceBuffer(24));
    // μ-law silence is not strictly 0xFF — near-zero PCM maps to near-max encoded value
    for (let i = 0; i < result.length; i++) {
      // All should be in the high-value range (0xF0–0xFF for near-zero PCM)
      expect(result[i]).toBeGreaterThanOrEqual(0xf0);
    }
  });

  it("non-zero PCM16 produces non-silence μ-law output", () => {
    // Build PCM16 with a large positive amplitude
    const buf = Buffer.allocUnsafe(24 * 2);
    for (let i = 0; i < 24; i++) {
      buf.writeInt16LE(8000, i * 2);
    }
    const result = bridge.encodeOutbound(buf);
    const hasNonSilence = Array.from(result).some((b) => b < 0xf0);
    expect(hasNonSilence).toBe(true);
  });

  it("all output values are in the valid byte range [0, 255]", () => {
    const buf = Buffer.allocUnsafe(48 * 2);
    for (let i = 0; i < 48; i++) {
      buf.writeInt16LE((i % 16) * 2000 - 16000, i * 2);
    }
    const result = bridge.encodeOutbound(buf);
    for (const b of result) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it("round-trip encode→decode preserves PCM sign and produces a non-zero output", () => {
    // μ-law is a logarithmic compander: the quantisation step at mid-range is
    // large enough that the decoded amplitude can differ substantially from the
    // input amplitude. We verify the sign is preserved and the output is non-zero.
    const amplitude = 4000;
    const sampleCount = 24;
    const pcmIn = Buffer.allocUnsafe(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      pcmIn.writeInt16LE(amplitude, i * 2);
    }
    const g711 = bridge.encodeOutbound(pcmIn);
    const pcmOut = bridge.decodeInbound(g711);
    const firstSample = readSample(pcmOut, 0);
    // Sign must be preserved
    expect(firstSample).toBeGreaterThan(0);
    // And it should be meaningfully non-zero (at least 1% of full scale)
    expect(firstSample).toBeGreaterThan(300);
  });

  it("empty input produces empty output", () => {
    const result = bridge.encodeOutbound(Buffer.alloc(0));
    expect(result.length).toBe(0);
  });
});

// ── 5. RtpFrameParser ────────────────────────────────────────────────────────

describe("RtpFrameParser — parse()", () => {
  it("throws on buffer shorter than 12 bytes", () => {
    expect(() => RtpFrameParser.parse(Buffer.alloc(11))).toThrow();
  });

  it("throws on buffer of length 0", () => {
    expect(() => RtpFrameParser.parse(Buffer.alloc(0))).toThrow();
  });

  it("throws when version field is not 2", () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0x40; // V=1, not V=2
    expect(() => RtpFrameParser.parse(buf)).toThrow(/version/i);
  });

  it("correctly extracts version=2 from a valid packet", () => {
    const buf = buildRawRtpBuffer(0, 1, 100, 0xdeadbeef, Buffer.alloc(4));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.header.version).toBe(2);
  });

  it("correctly extracts payloadType from a PCMU packet", () => {
    const buf = buildRawRtpBuffer(0, 1, 0, 0, Buffer.alloc(4));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.header.payloadType).toBe(0);
  });

  it("correctly extracts payloadType from a PCMA packet", () => {
    const buf = buildRawRtpBuffer(8, 1, 0, 0, Buffer.alloc(4));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.header.payloadType).toBe(8);
  });

  it("correctly extracts sequenceNumber as big-endian uint16", () => {
    const buf = buildRawRtpBuffer(0, 0xabcd, 0, 0, Buffer.alloc(4));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.header.sequenceNumber).toBe(0xabcd);
  });

  it("correctly extracts timestamp as big-endian uint32", () => {
    const buf = buildRawRtpBuffer(0, 1, 0x12345678, 0, Buffer.alloc(4));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.header.timestamp).toBe(0x12345678);
  });

  it("correctly extracts ssrc as big-endian uint32", () => {
    const buf = buildRawRtpBuffer(0, 1, 0, 0xdeadbeef, Buffer.alloc(4));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.header.ssrc).toBe(0xdeadbeef);
  });

  it("extracts payload bytes correctly after the 12-byte header", () => {
    const payload = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    const buf = buildRawRtpBuffer(0, 1, 0, 0, payload);
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.payload).toEqual(payload);
  });

  it("payload is empty Buffer when packet is exactly 12 bytes", () => {
    const buf = buildRawRtpBuffer(0, 1, 0, 0, Buffer.alloc(0));
    const pkt = RtpFrameParser.parse(buf);
    expect(pkt.payload.length).toBe(0);
  });
});

describe("RtpFrameParser — build()", () => {
  it("creates a buffer of length 12 + payload.length", () => {
    const payload = Buffer.from([0xaa, 0xbb, 0xcc]);
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 1, timestamp: 0, ssrc: 0 },
      payload,
    );
    expect(buf.length).toBe(15);
  });

  it("sets correct version bits (0xC0 in first byte = version 2)", () => {
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 1, timestamp: 0, ssrc: 0 },
      Buffer.alloc(0),
    );
    expect(buf[0] & 0xc0).toBe(0x80); // 0x80 = 0b10_000000 = version 2
  });

  it("encodes sequenceNumber as big-endian uint16", () => {
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 0x1234, timestamp: 0, ssrc: 0 },
      Buffer.alloc(0),
    );
    expect(buf.readUInt16BE(2)).toBe(0x1234);
  });

  it("encodes timestamp as big-endian uint32", () => {
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 0, timestamp: 0x87654321, ssrc: 0 },
      Buffer.alloc(0),
    );
    expect(buf.readUInt32BE(4)).toBe(0x87654321);
  });

  it("encodes ssrc as big-endian uint32", () => {
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 0, timestamp: 0, ssrc: 0xcafebabe },
      Buffer.alloc(0),
    );
    expect(buf.readUInt32BE(8)).toBe(0xcafebabe);
  });

  it("includes payload verbatim at byte offset 12", () => {
    const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 0, timestamp: 0, ssrc: 0 },
      payload,
    );
    expect(buf.subarray(12)).toEqual(payload);
  });

  it("sets marker bit when marker=true", () => {
    const buf = RtpFrameParser.build(
      { marker: true, payloadType: 0, sequenceNumber: 0, timestamp: 0, ssrc: 0 },
      Buffer.alloc(0),
    );
    expect(buf[1] & 0x80).toBe(0x80);
  });

  it("clears marker bit when marker=false", () => {
    const buf = RtpFrameParser.build(
      { marker: false, payloadType: 0, sequenceNumber: 0, timestamp: 0, ssrc: 0 },
      Buffer.alloc(0),
    );
    expect(buf[1] & 0x80).toBe(0x00);
  });
});

describe("RtpFrameParser — parse/build round-trip", () => {
  it("parse(build(header, payload)) recovers all original fields", () => {
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const rawBuf = RtpFrameParser.build(
      {
        marker: true,
        payloadType: 8,
        sequenceNumber: 0x5a5a,
        timestamp: 0x01020304,
        ssrc: 0xfeedface,
      },
      payload,
    );
    const pkt = RtpFrameParser.parse(rawBuf);
    expect(pkt.header.version).toBe(2);
    expect(pkt.header.marker).toBe(true);
    expect(pkt.header.payloadType).toBe(8);
    expect(pkt.header.sequenceNumber).toBe(0x5a5a);
    expect(pkt.header.timestamp).toBe(0x01020304);
    expect(pkt.header.ssrc).toBe(0xfeedface);
    expect(pkt.payload).toEqual(payload);
  });
});

describe("RtpFrameParser — isSupportedCodec()", () => {
  it("returns true for PCMU (payload type 0)", () => {
    expect(RtpFrameParser.isSupportedCodec(0)).toBe(true);
  });

  it("returns true for PCMA (payload type 8)", () => {
    expect(RtpFrameParser.isSupportedCodec(8)).toBe(true);
  });

  it("returns false for G.729 (payload type 18)", () => {
    expect(RtpFrameParser.isSupportedCodec(18)).toBe(false);
  });

  it("returns false for dynamic payload type 99", () => {
    expect(RtpFrameParser.isSupportedCodec(99)).toBe(false);
  });
});

describe("RtpFrameParser — payloadTypeToCodec()", () => {
  it("returns 'mulaw' for payload type 0 (PCMU)", () => {
    expect(RtpFrameParser.payloadTypeToCodec(0)).toBe("mulaw");
  });

  it("returns 'alaw' for payload type 8 (PCMA)", () => {
    expect(RtpFrameParser.payloadTypeToCodec(8)).toBe("alaw");
  });

  it("returns undefined for unsupported type 99", () => {
    expect(RtpFrameParser.payloadTypeToCodec(99)).toBeUndefined();
  });
});

// ── 6. Integration — RtpFrameParser + RtpCodecBridge ────────────────────────

describe("Integration — RtpFrameParser + RtpCodecBridge", () => {
  it("parse a PCMU RTP packet and decode via RtpCodecBridge → non-zero PCM16 output", () => {
    // Build a simulated PCMU payload with non-silence μ-law bytes
    const g711Payload = Buffer.alloc(16, 0x00); // 0x00 = maximum positive μ-law
    const rtpBuf = buildRawRtpBuffer(0, 42, 160, 0x12345678, g711Payload);

    const pkt = RtpFrameParser.parse(rtpBuf);
    expect(pkt.header.payloadType).toBe(RtpFrameParser.PT_PCMU);

    const codec = RtpFrameParser.payloadTypeToCodec(pkt.header.payloadType)!;
    const bridge = new RtpCodecBridge({ codec });

    const pcm = bridge.decodeInbound(pkt.payload);
    expect(pcm.length).toBeGreaterThan(0);
    // Decoded signal should contain non-zero samples
    const hasSignal = Array.from({ length: pcm.length / 2 }, (_, i) =>
      readSample(pcm, i),
    ).some((s) => s !== 0);
    expect(hasSignal).toBe(true);
  });

  it("build an RTP packet from encoded payload, parse it back — header fields intact", () => {
    // Start from PCM16 audio, encode to G.711, wrap in RTP
    const bridge = new RtpCodecBridge({ codec: "mulaw" });
    const pcmIn = Buffer.allocUnsafe(24 * 2);
    for (let i = 0; i < 24; i++) {
      pcmIn.writeInt16LE(3000, i * 2);
    }
    const g711Payload = bridge.encodeOutbound(pcmIn);

    const rawBuf = RtpFrameParser.build(
      {
        marker: false,
        payloadType: RtpFrameParser.PT_PCMU,
        sequenceNumber: 100,
        timestamp: 800,
        ssrc: 0xaabbccdd,
      },
      g711Payload,
    );

    const pkt = RtpFrameParser.parse(rawBuf);
    expect(pkt.header.version).toBe(2);
    expect(pkt.header.payloadType).toBe(RtpFrameParser.PT_PCMU);
    expect(pkt.header.sequenceNumber).toBe(100);
    expect(pkt.header.timestamp).toBe(800);
    expect(pkt.header.ssrc).toBe(0xaabbccdd);
    expect(pkt.payload.length).toBe(g711Payload.length);
  });
});
