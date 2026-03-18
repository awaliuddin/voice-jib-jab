# N-11 SIP Telephony Integration — Research Document

**Initiative:** N-11
**Project:** voice-jib-jab (P-07, Voice & Media vertical)
**Date:** 2026-03-18
**Status:** Research / Pre-implementation

---

## Overview

This document assesses the technical feasibility and implementation strategy for adding PSTN/SIP telephony as an inbound audio source to voice-jib-jab. Today, the runtime accepts audio exclusively from browser WebSocket clients. The goal is to accept SIP INVITE calls from phones and SIP trunks and route them through the same 3-lane arbitration pipeline without disturbing the existing WebSocket path or the sub-400ms latency SLA.

The integration point is a new `SipTelephonyAdapter` that mirrors the role `VoiceWebSocketServer` plays today: it creates a session, constructs the lane pipeline, and feeds audio into `LaneArbitrator` / `LaneB` exactly as the WebSocket server does.

---

## 1. SIP Library Assessment

| Library | Runtime target | TypeScript | SIP/2.0 compliance | WebRTC bridge support | Last active | Assessment |
|---|---|---|---|---|---|---|
| **drachtio-srf** | Node.js (server-only) | Types via `@types/drachtio-srf` (community, incomplete) | High — SIP/2.0, INVITE, BYE, ACK, re-INVITE | Via external media server (Freeswitch/Asterisk sidecar) | 2024 | Production-proven in telco environments; EventEmitter API maps cleanly to the existing adapter pattern. Requires running `drachtio-server` as a separate sidecar binary — significant ops overhead. |
| **JsSIP** | Originally browser; `node-jssip` fork adds Node support | No official types; community `@types/jssip` | Moderate — core SIP/2.0 plus WebSocket SIP (RFC 7118) | Via WebRTC in browser; Node fork bypasses WebRTC | 2023 (node fork 2022) | Lightest weight option. No sidecar needed. Node fork maintenance is sparse; RFC coverage is incomplete for enterprise scenarios. |
| **SIP.js** | Browser + Node.js | Yes — ships `index.d.ts`; strict-mode compatible | High — SIP/2.0, SIP over WebSocket (RFC 7118), RFC 3261 request/response lifecycle | Yes — designed around WebRTC `RTCPeerConnection`; Node.js path uses the same transport abstraction | Active (2024) | Best TypeScript story. WebSocket SIP transport aligns directly with the existing `ws` infrastructure. No sidecar required for prototype; can be layered with an RTP gateway for production PSTN. |
| **node-sip** | Node.js | No types | Low-level — raw SIP message parsing only | None built-in | 2021 | Useful only as a learning reference. No high-level call state machine; all INVITE/BYE/ACK handling must be written from scratch. |

**Recommendation: SIP.js for the prototype.**

SIP.js is the correct starting point because:

1. It ships TypeScript declarations, which means it compiles cleanly under the project's strict mode without requiring hand-written type stubs.
2. Its transport layer is WebSocket-first (RFC 7118), which means the prototype can test signalling against a softphone (e.g., Zoiper, Linphone) over the same WebSocket infrastructure already present in the server, without touching UDP/TCP SIP ports in the dev environment.
3. The `UserAgent` and `Session` abstractions in SIP.js map directly to the session lifecycle already modelled in `SessionManager` and `ClientConnection`.
4. Migration to drachtio-srf for a full PSTN production deployment (Phase 3) is possible without changing the `SipBridgeService` contract — only the adapter implementation changes.

---

## 2. WebRTC Bridge Options

### The codec mismatch problem

SIP devices on the PSTN (IP phones, ATA adaptors, SIP trunks) negotiate RTP streams carrying G.711 audio:

- **G.711 μ-law (PCMU)** — the dominant codec on North American PSTN; 8kHz, 8-bit companded, 64 kbps
- **G.711 a-law (PCMA)** — European PSTN standard; same bitrate and sample rate

OpenAI Realtime API (the voice backend behind `LaneB`) expects **PCM16 at 24kHz** — uncompressed 16-bit linear PCM at 24,000 samples per second.

The bridge must therefore perform two transforms per direction:

**Inbound (phone to AI):**
1. Receive RTP packets over UDP
2. Decode G.711 (μ-law or a-law) bytes to 16-bit linear PCM at 8kHz
3. Upsample 8kHz → 24kHz (linear interpolation or sinc resampling)
4. Feed `AudioChunk` into `LaneB.sendAudio()`

**Outbound (AI to phone):**
1. Receive `AudioChunk` (PCM16 at 24kHz) from `LaneArbitrator`
2. Downsample 24kHz → 8kHz
3. Encode to G.711 μ-law bytes
4. Packetise into RTP and send via UDP

### Bridge implementation options

| Option | Description | Latency added | Complexity | Recommendation |
|---|---|---|---|---|
| `ffmpeg` via child process | Spawn `ffmpeg` process per call, pipe audio over stdin/stdout | High (50–200ms process overhead + buffering) | Low to implement; high to operate | Not suitable. Latency impact violates the 400ms SLA. |
| `node-rtp` + custom codec | Pure-JS RTP framing combined with manual G.711 codec | Low (~1ms) | Very high — RTP jitter buffer, SSRC management, RTCP must all be hand-rolled | Avoid for prototype; viable only if no npm codec library meets the need. |
| `wrtc` package (native WebRTC) | Compiles `libwebrtc` into Node.js; handles RTP, SRTP, codec negotiation via `RTCPeerConnection` | Low (2–5ms) | Moderate — large native dependency (~50MB); build complexity on CI | Good for a WebRTC-to-SIP scenario but adds heavy build toolchain. Better fit for Phase 2 production. |
| **`dgram` + `g711` npm package** | Node.js built-in UDP socket for RTP framing; `g711` package for codec encode/decode | Very low (~1–3ms) | Low — `dgram` is stdlib; `g711` is a pure-JS codec | **Recommended for prototype.** Minimal dependency surface, predictable latency, no native compilation. |

**Recommended approach for prototype: `dgram` + `g711`**

The `g711` npm package provides `mulaw.decode()` and `mulaw.encode()` as synchronous `Buffer` operations. Combined with Node.js `dgram` for UDP socket management and a simple linear resampler (no external library required — a 3× linear interpolation in a typed array loop), the full codec path can be implemented in under 200 lines of TypeScript with zero native dependencies.

The latency budget is comfortable: G.711 decode + 3× upsample on a 20ms RTP frame (160 bytes at 8kHz) takes approximately 0.2ms on a modern CPU. Even with jitter buffer overhead (one-frame lookahead = 20ms), total bridge contribution is well under the 400ms SLA.

---

## 3. PSTN Gateway Providers

For calls originating from the public telephone network, a SIP trunk provider terminates the PSTN call and forwards a SIP INVITE to the server's public IP.

| Provider | SIP trunking | WebRTC SIP (RFC 7118) | Approx. per-minute cost (inbound, US) | DID availability | SIP INVITE support | Notes |
|---|---|---|---|---|---|---|
| **Twilio** | Yes (Elastic SIP Trunking) | Yes (Twilio Client / Media Streams) | ~$0.0085/min | 140+ countries | Yes — full SIP INVITE with SDP negotiation | Best documentation; Media Streams API can send audio as WebSocket stream directly, which may bypass the need for RTP bridging entirely. Higher per-minute cost. |
| **Vonage (Nexmo)** | Yes (SIP Connect) | Yes (Voice API WebSocket) | ~$0.0090/min | 65+ countries | Yes | Voice API supports WebSocket audio delivery (similar to Twilio Media Streams). SIP Connect path adds complexity. |
| **Telnyx** | Yes (Mission Control Portal) | Partial — SIP over WebSocket in beta | ~$0.0040/min | 50+ countries | Yes — full RFC 3261 SIP INVITE | Lowest per-minute cost. SIP trunk is straightforward RFC 3261 with G.711 RTP. No proprietary WebSocket audio API; RTP bridge is required. Good choice for production cost optimisation. |
| **SignalWire** | Yes (SWML / RELAY) | Yes (RELAY WebSocket) | ~$0.0060/min | 40+ countries | Yes | Fork of FreeSWITCH/Twilio lineage. RELAY v4 provides a WebSocket-native call control API. Niche but technically competent. |

**Summary:**

- Twilio or Vonage are the lowest-friction path for a prototype because their WebSocket audio delivery APIs could allow the bridge to receive PCM audio over a WebSocket rather than raw RTP, eliminating the need for the `dgram` RTP layer at the cost of provider lock-in.
- Telnyx is the strongest production candidate on cost grounds and standard SIP compliance. The RTP bridge adds implementation work but yields a provider-agnostic architecture.
- For Phase 1 and Phase 2 prototyping, Twilio is recommended due to documentation quality. For Phase 3 production, evaluate Telnyx for cost.

---

## 4. Architecture Proposal

### Data flow diagram

```
Phone/PSTN
    |
    | SIP INVITE (via SIP trunk or SIP.js WebSocket)
    v
SipTelephonyAdapter          (new — mirrors VoiceWebSocketServer)
    |                         - handles SIP signalling lifecycle
    | RTP audio (G.711 8kHz)  - creates SessionManager session
    v                         - constructs LaneA / LaneB / ControlEngine
SipBridgeService             (new — codec + sample rate conversion)
    |                         - decodes G.711 PCMU → PCM16
    | AudioChunk              - resamples 8kHz → 24kHz
    | (PCM16, 24kHz)          - resamples 24kHz → 8kHz outbound
    v                         - encodes PCM16 → G.711 PCMU outbound
LaneArbitrator
    |
    +---> LaneA (reflex)      (unchanged)
    |
    +---> LaneB               (unchanged — sends AudioChunk to OpenAI Realtime)
    |
    +---> ControlEngine       (unchanged — Lane C policy gate)
    |
    v
OpenAI Realtime API
    |
    | AudioChunk response (PCM16 24kHz)
    v
LaneArbitrator
    |
    v
SipBridgeService             (outbound path)
    |
    | G.711 8kHz RTP
    v
SipTelephonyAdapter
    |
    | SIP 200 OK + RTP stream
    v
Phone/PSTN
```

### Integration notes

**Session mapping.** Each SIP INVITE creates exactly one voice session — the same cardinality as one WebSocket connection today. `SipTelephonyAdapter` calls `sessionManager.createSession()` on INVITE and `sessionManager.endSession()` on BYE, mirroring `handleConnection` and `handleClose` in `VoiceWebSocketServer`.

**Provider adapter reuse.** `LaneB` already accepts audio via `ProviderAdapter.sendAudio(chunk: AudioChunk)` where `AudioChunk.sampleRate` is caller-specified. After upsampling, `SipBridgeService` constructs `AudioChunk` with `sampleRate: 24000` and calls `laneB.sendAudio()` — no changes to `LaneB` or `ProviderAdapter` are required.

**Audio format conversion boundary.** The `AudioChunk` type in `ProviderAdapter.ts` uses `format: 'pcm' | 'opus'`. G.711 is decoded to `'pcm'` before entering the pipeline, so no new format value is needed in the existing interface.

**Outbound audio path.** The `audio` event emitted by `LaneArbitrator` (via `LaneA`, `LaneB`, or `FallbackPlanner`) carries `AudioChunk` at PCM16 24kHz. `SipBridgeService` subscribes to these events, downsamples, encodes to G.711, and writes RTP packets via the `dgram` socket. The WebSocket `sendToClient` path is not used for SIP sessions.

**DTMF.** RFC 2833 telephone-event RTP payloads (payload type 101) are decoded by `SipBridgeService` and emitted as synthetic `user_transcript` events containing the digit character. This lets Lane B and Lane C treat DTMF digits as text input without changes to the transcript pipeline. SIP INFO DTMF is handled in `SipTelephonyAdapter` and converted to the same event form.

**Audio gating.** The cooldown-period and RMS-energy gates in `VoiceWebSocketServer` (lines 769–800 of `websocket.ts`) protect against echo feedback. These gates are implemented per-session inside `SipBridgeService` for SIP sessions; the existing WebSocket gating logic is not modified.

---

## 5. Implementation Phases

### Phase 1 — Contract establishment (prototype, no real SIP)

Goal: define the interfaces and establish that SIP sessions can be wired into the existing lane pipeline without modifying any existing files.

Deliverables:

- `server/src/sip/SipTelephonyAdapter.ts` — interface (extends `EventEmitter`, mirrors `VoiceWebSocketServer` lifecycle) + `StubSipTelephonyAdapter` implementation that simulates a call with pre-recorded audio
- `server/src/sip/SipBridgeService.ts` — interface defining `inboundAudio(rtpPayload: Buffer): AudioChunk` and `outboundAudio(chunk: AudioChunk): Buffer`; stub implementation returns silence
- `server/src/sip/types.ts` — `SipCallInfo`, `SipSessionState`, `DtmfEvent` shared types
- Unit tests for the stub implementations confirming the session lifecycle events fire correctly

No real SIP library dependency is added in Phase 1. The stub is sufficient to validate the pipeline integration and write tests.

### Phase 2 — Real SIP signalling and RTP codec

Goal: replace stubs with a working SIP.js implementation and the `dgram` + `g711` codec bridge.

Deliverables:

- Replace `StubSipTelephonyAdapter` with `SipJsTelephonyAdapter` using SIP.js `UserAgent`
- Implement `RtpSipBridgeService` with `dgram` UDP socket, `g711` codec, and linear resampler
- Integration test: Zoiper or Linphone softphone dials the server and receives synthesised audio back
- Latency instrumentation: measure SIP codec contribution to the end-to-end latency budget

### Phase 3 — PSTN gateway and production readiness

Goal: accept calls from real phone numbers via a SIP trunk.

Deliverables:

- Telnyx (or Twilio) SIP trunk configuration and authentication (IP allowlist + SIP credentials)
- TLS transport for SIP signalling (replace WS with WSS; add SRTP for media where tenant compliance requires it)
- Inbound DID routing: map phone numbers to tenant configurations (ties into the multi-tenant work in N-13)
- Load testing: validate 400ms SLA under concurrent SIP call load
- Runbook for SIP trunk failover

---

## 6. Open Questions

1. **PSTN provider selection for production.** Telnyx offers the lowest per-minute cost (~$0.004/min) and standard RFC 3261 SIP INVITE, making it the cost-optimal choice. Twilio offers superior documentation and a WebSocket audio delivery API that could simplify the bridge. Which matters more for Phase 3: cost or implementation simplicity?

2. **Codec scope for Phase 2.** G.711 μ-law (PCMU) covers the vast majority of North American PSTN calls. G.711 a-law (PCMA) covers European deployments. G.722 (wideband, 8kHz audio at 16kHz sample rate) is supported by modern IP phones and delivers noticeably better audio quality. Recommendation: implement PCMU and PCMA in Phase 2; defer G.722 to Phase 3 unless a specific enterprise customer requires it.

3. **DTMF signalling method.** RFC 2833 (telephone-event RTP payload type 101) is the dominant in-band method and should be implemented in Phase 2. SIP INFO (out-of-band, RFC 2976) is used by some older PBX systems. Recommendation: implement RFC 2833 first; add SIP INFO support in Phase 3 if a specific integration requires it.

4. **TLS and SRTP requirements.** HIPAA-covered tenants require encrypted signalling (TLS) and encrypted media (SRTP). The SIP.js transport layer supports TLS out of the box. SRTP adds key management complexity (SDES or DTLS-SRTP). Recommendation: implement TLS SIP signalling from Phase 2 onward; add SRTP in Phase 3, gated by a per-tenant feature flag to avoid impacting non-HIPAA tenants.

---

## Appendix: Relevant existing interfaces

The following existing types and classes in the codebase are the primary integration surface. No modifications to these are expected in Phase 1 or Phase 2.

- `ProviderAdapter` (`server/src/providers/ProviderAdapter.ts`) — `AudioChunk` type (`{ data: Buffer; format: 'pcm' | 'opus'; sampleRate: number }`) is the currency of the audio pipeline. G.711-decoded, upsampled audio is wrapped in this type before entering `LaneB`.
- `VoiceWebSocketServer` (`server/src/api/websocket.ts`) — the session construction pattern (`createSession` → `new LaneB` → `new LaneA` → `new LaneArbitrator` → `new ControlEngine`) is replicated in `SipTelephonyAdapter`. The per-session `ClientConnection` object is the reference model for the equivalent SIP session state object.
- `LaneArbitrator` — `startSession()`, `endSession()`, `onUserSpeechEnded()`, `onLaneBReady()`, `onLaneBDone()` are the lifecycle hooks `SipBridgeService` calls; these are unchanged.
- `SessionManager` — `createSession()` and `endSession()` are called by `SipTelephonyAdapter` on SIP INVITE and BYE respectively.
