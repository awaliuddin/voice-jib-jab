/**
 * RtpFrameParser — parse and construct RTP packet headers (RFC 3550).
 *
 * Handles the 12-byte fixed RTP header:
 *   V=2, P, X, CC, M, PT, SequenceNumber, Timestamp, SSRC
 *
 * Does NOT handle CSRC list, extension headers, or RTCP.
 * Payload type codes for G.711: PCMU=0, PCMA=8
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Parsed representation of the 12-byte fixed RTP header (RFC 3550 §5.1). */
export interface RtpHeader {
  /** RTP version — must be 2. */
  version: number;
  /** Padding flag: if true, the payload contains padding bytes at the end. */
  padding: boolean;
  /** Extension flag: if true, a header extension follows the fixed header. */
  extension: boolean;
  /** CSRC count: number of contributing source identifiers (0–15). */
  csrcCount: number;
  /** Marker bit: codec-specific significance (e.g. talk-spurt start for G.711). */
  marker: boolean;
  /** Payload type: 0 = PCMU (G.711 μ-law), 8 = PCMA (G.711 a-law). */
  payloadType: number;
  /** 16-bit sequence number, incremented by one per packet. */
  sequenceNumber: number;
  /** 32-bit sampling-instant timestamp (clock rate depends on codec). */
  timestamp: number;
  /** 32-bit synchronisation source identifier. */
  ssrc: number;
}

/** A fully parsed RTP packet with header metadata and raw payload bytes. */
export interface RtpPacket {
  header: RtpHeader;
  payload: Buffer;
}

// ── RtpFrameParser ───────────────────────────────────────────────────────────

/**
 * Static utility class for parsing and constructing minimal RTP packets.
 *
 * Only the 12-byte fixed RTP header is supported. CSRC lists, header
 * extensions, and RTCP packets are not handled.
 *
 * Usage:
 *   const pkt = RtpFrameParser.parse(udpBuffer);
 *   const raw = RtpFrameParser.build({ marker: false, payloadType: 0, ... }, payload);
 */
export class RtpFrameParser {
  /** Minimum valid RTP packet size: 12-byte fixed header with no payload. */
  static readonly MIN_PACKET_SIZE = 12;

  /** Payload type constant for G.711 μ-law (PCMU). */
  static readonly PT_PCMU = 0;

  /** Payload type constant for G.711 a-law (PCMA). */
  static readonly PT_PCMA = 8;

  /**
   * Parse a raw UDP buffer into an RtpPacket.
   *
   * The buffer must be at least 12 bytes and must carry a V=2 header. This
   * parser reads only the fixed 12-byte header; CSRC entries and extension
   * headers are NOT parsed (the csrcCount field in the returned header reflects
   * the wire value but the CSRC list bytes are included in the payload slice
   * for transparency).
   *
   * @param buffer Raw bytes received from a UDP socket.
   * @returns Parsed RtpPacket with header fields and payload Buffer.
   * @throws Error if the buffer is shorter than 12 bytes.
   * @throws Error if the version field is not 2.
   */
  static parse(buffer: Buffer): RtpPacket {
    if (buffer.length < RtpFrameParser.MIN_PACKET_SIZE) {
      throw new Error(
        `RTP packet too short: got ${buffer.length} bytes, expected at least ${RtpFrameParser.MIN_PACKET_SIZE}`,
      );
    }

    // Byte 0: V(2) P(1) X(1) CC(4)
    const byte0 = buffer[0];
    const version = (byte0 >> 6) & 0x03;
    if (version !== 2) {
      throw new Error(`Unsupported RTP version: ${version} (expected 2)`);
    }
    const padding = ((byte0 >> 5) & 0x01) === 1;
    const extension = ((byte0 >> 4) & 0x01) === 1;
    const csrcCount = byte0 & 0x0f;

    // Byte 1: M(1) PT(7)
    const byte1 = buffer[1];
    const marker = ((byte1 >> 7) & 0x01) === 1;
    const payloadType = byte1 & 0x7f;

    // Bytes 2–3: sequence number (big-endian uint16)
    const sequenceNumber = buffer.readUInt16BE(2);

    // Bytes 4–7: timestamp (big-endian uint32)
    const timestamp = buffer.readUInt32BE(4);

    // Bytes 8–11: SSRC (big-endian uint32)
    const ssrc = buffer.readUInt32BE(8);

    // Payload: everything after the 12-byte fixed header
    const payload = buffer.subarray(RtpFrameParser.MIN_PACKET_SIZE);

    return {
      header: {
        version,
        padding,
        extension,
        csrcCount,
        marker,
        payloadType,
        sequenceNumber,
        timestamp,
        ssrc,
      },
      payload,
    };
  }

  /**
   * Build a minimal RTP packet buffer from header fields and a payload.
   *
   * Sets V=2, P=0 (no padding), X=0 (no extension), CC=0 (no contributing
   * sources). The caller supplies marker, payloadType, sequenceNumber,
   * timestamp, and ssrc.
   *
   * @param header Header fields excluding version, padding, extension, csrcCount.
   * @param payload Raw payload bytes to append after the header.
   * @returns A Buffer containing the 12-byte header followed by the payload.
   */
  static build(
    header: Omit<RtpHeader, "version" | "padding" | "extension" | "csrcCount">,
    payload: Buffer,
  ): Buffer {
    const buf = Buffer.allocUnsafe(RtpFrameParser.MIN_PACKET_SIZE + payload.length);

    // Byte 0: V=2 (0b10), P=0, X=0, CC=0 → 0b10_0_0_0000 = 0x80
    buf[0] = 0x80;

    // Byte 1: M(1) PT(7)
    const markerBit = header.marker ? 0x80 : 0x00;
    buf[1] = markerBit | (header.payloadType & 0x7f);

    // Bytes 2–3: sequence number (big-endian uint16)
    buf.writeUInt16BE(header.sequenceNumber & 0xffff, 2);

    // Bytes 4–7: timestamp (big-endian uint32)
    buf.writeUInt32BE(header.timestamp >>> 0, 4);

    // Bytes 8–11: SSRC (big-endian uint32)
    buf.writeUInt32BE(header.ssrc >>> 0, 8);

    // Payload
    payload.copy(buf, RtpFrameParser.MIN_PACKET_SIZE);

    return buf;
  }

  /**
   * Return true if the given payload type corresponds to a G.711 codec
   * supported by this bridge (PCMU=0 or PCMA=8).
   *
   * @param payloadType RTP payload type field value.
   */
  static isSupportedCodec(payloadType: number): boolean {
    return payloadType === RtpFrameParser.PT_PCMU || payloadType === RtpFrameParser.PT_PCMA;
  }

  /**
   * Map an RTP payload type number to a CodecType string.
   *
   * @param payloadType RTP payload type field value.
   * @returns "mulaw" for PCMU, "alaw" for PCMA, or undefined for unknown types.
   */
  static payloadTypeToCodec(payloadType: number): "mulaw" | "alaw" | undefined {
    if (payloadType === RtpFrameParser.PT_PCMU) return "mulaw";
    if (payloadType === RtpFrameParser.PT_PCMA) return "alaw";
    return undefined;
  }
}
