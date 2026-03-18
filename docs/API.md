# voice-jib-jab — WebSocket API Reference

This document describes the WebSocket protocol and voice pipeline configuration for the voice-jib-jab server. All client communication happens over a single persistent WebSocket connection. There is no REST API for the voice loop.

---

## Table of Contents

1. [WebSocket Connection](#1-websocket-connection)
2. [Message Quick Reference](#2-message-quick-reference)
3. [Client → Server Messages](#3-client--server-messages)
4. [Server → Client Messages](#4-server--client-messages)
5. [Voice Pipeline Configuration](#5-voice-pipeline-configuration)
6. [Policy Decision Events](#6-policy-decision-events)
7. [Error Handling](#7-error-handling)

---

## 1. WebSocket Connection

### Endpoint

```
ws://<host>:<port>/
```

Default port is `3000` (configurable via `PORT` environment variable). TLS termination is the responsibility of the upstream proxy in production.

### Authentication

There is no built-in token-based authentication at the WebSocket handshake level. Identity is established at the application layer via the `session.start` message using a client-supplied `fingerprint` string. When `ENABLE_PERSISTENT_MEMORY=true`, the server maps this fingerprint to a persistent user record.

### Connection Lifecycle

```
Client                                    Server
  |                                          |
  |------- TCP / WebSocket upgrade -------->|
  |                                          |
  |<------ { type: "session.ready" } -------|  (immediate, before session.start)
  |                                          |
  |------- { type: "session.start" } ------->|
  |                                          |
  |<------ { type: "provider.ready" } ------|  (OpenAI connected)
  |                                          |
  |   ... audio exchange and responses ...   |
  |                                          |
  |------- { type: "session.end" } -------->|  (client-initiated clean close)
  |                                          |
  |<------ TCP close ------------------------|
```

**Connection events on the server side:**

- On connect: a `session.ready` message is sent immediately before `session.start` is received. A session ID is assigned at this point.
- On disconnect (without `session.end`): the server saves any pending conversation summary, tears down all three lanes, and removes the connection from the registry.
- On WebSocket error: a `session.error` event is emitted to the internal event bus; the connection is cleaned up.

---

## 2. Message Quick Reference

All messages are JSON objects sent as text frames. All messages include a `type` field.

### Client → Server

| `type`            | Description                                                   |
|-------------------|---------------------------------------------------------------|
| `session.start`   | Begin a session; connect to OpenAI; optionally set voice mode |
| `session.end`     | Gracefully end the session and close the connection           |
| `session.set_mode`| Change voice interaction mode during an active session        |
| `audio.chunk`     | Send a raw audio chunk (base64 PCM/Opus)                      |
| `audio.commit`    | Commit audio buffer to trigger a response (push-to-talk)      |
| `audio.stop`      | Signal end of user audio capture; cancel any in-flight response |
| `audio.cancel`    | Cancel active audio capture and any in-progress response      |
| `playback.ended`  | Notify server that the client finished playing AI audio       |
| `user.barge_in`   | Signal that the user is interrupting AI speech                |

### Server → Client

| `type`                | Trigger                                                          |
|-----------------------|------------------------------------------------------------------|
| `session.ready`       | Immediately on WebSocket connection                              |
| `provider.ready`      | OpenAI Realtime API connected, session ready for audio          |
| `session.mode_changed`| Confirmation after `session.set_mode`                           |
| `audio.chunk`         | Outbound audio frame (Lane A, Lane B, or fallback)              |
| `transcript`          | Assistant transcript segment (delta or final)                   |
| `user_transcript`     | User's speech-to-text transcript                                |
| `speech.started`      | OpenAI detected start of user speech                            |
| `speech.stopped`      | OpenAI detected end of user speech                              |
| `response.start`      | AI response generation has begun                                |
| `response.end`        | AI response complete (or cancelled)                             |
| `lane.state_changed`  | Lane arbitrator state machine changed state                     |
| `lane.owner_changed`  | Active audio output lane changed                                |
| `commit.skipped`      | `audio.commit` was ignored because the buffer was too small     |
| `audio.stop.ack`      | Acknowledgement of `audio.stop`                                 |
| `audio.cancel.ack`    | Acknowledgement of `audio.cancel`                               |
| `user.barge_in.ack`   | Acknowledgement of `user.barge_in`                              |
| `error`               | Unhandled error in message processing or Lane B                 |

---

## 3. Client → Server Messages

### `session.start`

Opens the voice session. Connects Lane B (OpenAI Realtime API) and starts the lane arbitrator. Safe to send only once per connection; re-sending when already connected is a no-op.

```typescript
interface SessionStartMessage {
  type: "session.start";
  voiceMode?: "push-to-talk" | "open-mic"; // default: "push-to-talk"
  fingerprint?: string;   // client identity token for persistent memory
  userAgent?: string;     // stored in session history for diagnostics
}
```

`fingerprint` is any stable string that identifies the end user's device or account (e.g., a hashed user ID). When omitted, the server generates an anonymous fingerprint (`anon-<sessionId>`). If `ENABLE_PERSISTENT_MEMORY=true`, this fingerprint is used to retrieve prior conversation context which is injected into Lane B.

---

### `session.end`

Gracefully closes the session. The server saves a conversation summary (if persistent memory is enabled), ends the session in storage, and closes the WebSocket.

```typescript
interface SessionEndMessage {
  type: "session.end";
}
```

---

### `session.set_mode`

Changes the voice interaction mode dynamically during an active session.

```typescript
interface SessionSetModeMessage {
  type: "session.set_mode";
  voiceMode: "push-to-talk" | "open-mic";
}
```

**Modes:**

- `push-to-talk` — The user holds a button to speak. The client is expected to send `audio.commit` when the button is released to trigger a response.
- `open-mic` — Continuous voice activity detection. OpenAI decides when the user has finished speaking. The client does not need to send `audio.commit`.

---

### `audio.chunk`

Sends a raw audio frame to Lane B (OpenAI Realtime API). Audio is silently dropped if:

- The lane arbitrator is not in `LISTENING` state (AI is speaking or processing).
- The `audioStopped` gate is set (client sent `audio.stop` or `audio.commit`).
- The chunk's RMS energy is below the noise floor (~-44 dBFS).
- The server is within the 1500 ms post-response cooldown period.

```typescript
interface AudioChunkMessage {
  type: "audio.chunk";
  data: string;          // base64-encoded PCM16 or Opus audio
  format?: "pcm" | "opus"; // default: "pcm"
  sampleRate?: number;   // default: 24000 Hz
}
```

Audio must be PCM 16-bit little-endian at 24000 Hz to match OpenAI's Realtime API requirements. Opus is accepted but conversion happens upstream.

---

### `audio.commit`

Signals that the user has finished speaking (push-to-talk button released). Commits the accumulated audio buffer to OpenAI to trigger a response. If the buffer is below the minimum size threshold, the commit is silently skipped and a `commit.skipped` message is returned.

```typescript
interface AudioCommitMessage {
  type: "audio.commit";
}
```

This message has no additional fields. Once received, the server sets the `audioStopped` gate and advances the arbitrator state from `LISTENING`.

---

### `audio.stop`

Signals that the client has stopped capturing audio. Cancels any in-progress response and clears the OpenAI input buffer. Distinct from `audio.cancel` in that it is a normal end-of-utterance signal rather than an explicit user cancel action, but the server behavior is equivalent.

```typescript
interface AudioStopMessage {
  type: "audio.stop";
}
```

The server responds with `audio.stop.ack` followed by `response.end`.

---

### `audio.cancel`

Cancels an in-progress response and discards the audio buffer. Used when the user explicitly cancels (e.g., by pressing a cancel button). The server responds with `audio.cancel.ack` followed by `response.end`.

```typescript
interface AudioCancelMessage {
  type: "audio.cancel";
}
```

---

### `playback.ended`

Informs the server that the client has finished playing all AI audio through its speakers. This anchors the echo-suppression cooldown window. The server uses the later of the server-side `response.end` time and this client-reported time to prevent the AI's voice echo from being picked up by the microphone.

```typescript
interface PlaybackEndedMessage {
  type: "playback.ended";
}
```

**This message is important for echo prevention.** Clients that use a speaker for output should send this immediately after playback finishes.

---

### `user.barge_in`

Signals that the user has interrupted AI speech. Re-enables audio acceptance and triggers a lane ownership transfer via the arbitrator. The server responds with `user.barge_in.ack`.

```typescript
interface UserBargeInMessage {
  type: "user.barge_in";
}
```

---

## 4. Server → Client Messages

All server messages include a `timestamp` field (Unix milliseconds) unless otherwise noted.

### `session.ready`

Sent immediately on WebSocket connection, before the client sends `session.start`.

```typescript
interface SessionReadyMessage {
  type: "session.ready";
  sessionId: string;   // UUID assigned to this connection
  timestamp: number;
}
```

---

### `provider.ready`

Sent after `session.start` completes and Lane B is connected to OpenAI.

```typescript
interface ProviderReadyMessage {
  type: "provider.ready";
  isReturningUser: boolean;       // true if fingerprint matched a previous session
  previousSessionCount: number;   // number of prior sessions for this user
  voiceMode: "push-to-talk" | "open-mic";
  timestamp: number;
}
```

---

### `session.mode_changed`

Confirms a successful `session.set_mode` request.

```typescript
interface SessionModeChangedMessage {
  type: "session.mode_changed";
  voiceMode: "push-to-talk" | "open-mic";
  timestamp: number;
}
```

---

### `audio.chunk`

An outbound audio frame from one of the three audio lanes.

```typescript
interface AudioChunkMessage {
  type: "audio.chunk";
  data: string;         // base64-encoded PCM16 audio
  format: string;       // "pcm" or "opus"
  sampleRate: number;   // typically 24000
  lane: "A" | "B" | "fallback";
  timestamp: number;
}
```

**Lane meanings:**

- `A` — Reflex acknowledgement audio (Lane A). A short filler phrase ("Sure, let me check that...") to fill silence while Lane B processes. Typically 150–400 ms latency.
- `B` — Full AI response audio from OpenAI (Lane B). Begins playing after Lane B's first audio frame arrives and the arbitrator transfers ownership from Lane A.
- `fallback` — Policy-triggered fallback audio. Played when a `cancel_output`, `refuse`, or `escalate` policy decision stops Lane B.

---

### `transcript`

An assistant transcript segment produced by Lane B.

```typescript
interface TranscriptMessage {
  type: "transcript";
  text: string;
  confidence: number;    // 0.0 – 1.0
  isFinal: boolean;      // true on the final segment for this response turn
  timestamp: number;
}
```

---

### `user_transcript`

The user's speech-to-text transcript as recognized by OpenAI.

```typescript
interface UserTranscriptMessage {
  type: "user_transcript";
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}
```

---

### `speech.started`

OpenAI detected that the user has started speaking. Only sent in `open-mic` mode (VAD-driven sessions).

```typescript
interface SpeechStartedMessage {
  type: "speech.started";
  timestamp: number;
}
```

---

### `speech.stopped`

OpenAI detected that the user has stopped speaking. Only sent in `open-mic` mode.

```typescript
interface SpeechStoppedMessage {
  type: "speech.stopped";
  timestamp: number;
}
```

---

### `response.start`

The AI has begun generating a response (Lane B or fallback).

```typescript
interface ResponseStartMessage {
  type: "response.start";
  timestamp: number;
}
```

---

### `response.end`

The AI response has finished (completed naturally, or was cancelled). Also sent as a result of `audio.stop` and `audio.cancel`.

```typescript
interface ResponseEndMessage {
  type: "response.end";
  timestamp: number;
}
```

---

### `lane.state_changed`

The lane arbitrator's internal state machine transitioned states. Informational; most clients can ignore this.

```typescript
interface LaneStateChangedMessage {
  type: "lane.state_changed";
  from: string;   // previous state name
  to: string;     // new state name
  cause: string;  // trigger that caused the transition
  timestamp: number;
}
```

---

### `lane.owner_changed`

The active audio output lane changed. Clients can use this to drive UI indicators.

```typescript
interface LaneOwnerChangedMessage {
  type: "lane.owner_changed";
  from: "none" | "A" | "B" | "fallback";
  to: "none" | "A" | "B" | "fallback";
  cause: "b_first_audio_ready" | "policy_cancel" | "user_barge_in" | "response_done" | "user_speech_ended";
  timestamp: number;
}
```

---

### `commit.skipped`

The `audio.commit` was ignored because the audio buffer was too small to constitute a valid utterance.

```typescript
interface CommitSkippedMessage {
  type: "commit.skipped";
  reason: "buffer_too_small";
  timestamp: number;
}
```

When this is received, the client should re-enable audio capture — the session is back in `LISTENING` state.

---

### `audio.stop.ack`

Acknowledgement of `audio.stop`.

```typescript
interface AudioStopAckMessage {
  type: "audio.stop.ack";
  timestamp: number;
}
```

---

### `audio.cancel.ack`

Acknowledgement of `audio.cancel`. After this message, no further `audio.chunk` messages will be sent for the cancelled response.

```typescript
interface AudioCancelAckMessage {
  type: "audio.cancel.ack";
  timestamp: number;
}
```

---

### `user.barge_in.ack`

Acknowledgement of `user.barge_in`.

```typescript
interface UserBargeInAckMessage {
  type: "user.barge_in.ack";
  timestamp: number;
}
```

---

### `error`

A processing error occurred. The connection remains open unless it is a fatal transport error.

```typescript
interface ErrorMessage {
  type: "error";
  error: string;   // human-readable error description
  timestamp: number;
}
```

---

## 5. Voice Pipeline Configuration

Configuration is loaded from environment variables at startup. The `ServerConfig` interface maps directly to `.env` keys.

### Feature Flags

| Environment Variable        | Type    | Default | Description                                            |
|-----------------------------|---------|---------|--------------------------------------------------------|
| `ENABLE_LANE_A`             | boolean | `true`  | Enable Lane A reflex acknowledgements                  |
| `ENABLE_RAG`                | boolean | `true`  | Enable retrieval-augmented generation in Lane B        |
| `ENABLE_POLICY_GATE`        | boolean | `true`  | Enable Lane C (ControlEngine) policy evaluation        |
| `ENABLE_AUDIT_TRAIL`        | boolean | `true`  | Write audit events to SQLite + JSONL                   |
| `ENABLE_PERSISTENT_MEMORY`  | boolean | `true`  | Persist transcripts and user history across sessions   |

### Core Settings

| Environment Variable  | Type    | Default        | Description                           |
|-----------------------|---------|----------------|---------------------------------------|
| `PORT`                | number  | `3000`         | HTTP/WebSocket server port            |
| `NODE_ENV`            | string  | `development`  | Node environment                      |
| `OPENAI_API_KEY`      | string  | required       | OpenAI API key                        |
| `OPENAI_MODEL`        | string  | `gpt-realtime` | OpenAI Realtime model identifier      |

### Latency Targets

These values are recorded in metrics but do not affect runtime behavior directly.

| Environment Variable    | Type   | Default | Description                                  |
|-------------------------|--------|---------|----------------------------------------------|
| `TTFB_TARGET_P50`       | number | `400`   | Target TTFB at P50 in milliseconds           |
| `TTFB_TARGET_P95`       | number | `900`   | Target TTFB at P95 in milliseconds           |
| `BARGE_IN_TARGET_P95`   | number | `250`   | Target barge-in latency at P95 in ms         |

### Safety Settings

| Environment Variable          | Type    | Default | Description                                                        |
|-------------------------------|---------|---------|--------------------------------------------------------------------|
| `ENABLE_PII_REDACTION`        | boolean | `true`  | Redact PII from transcripts before policy evaluation and storage   |
| `STORE_RAW_AUDIO`             | boolean | `false` | Whether to store raw audio in the audit trail                      |
| `MAX_SESSION_DURATION_MINUTES`| number  | `30`    | Maximum session duration before automatic teardown                 |

### RAG Settings

| Environment Variable | Type   | Default | Description                                                |
|----------------------|--------|---------|------------------------------------------------------------|
| `RAG_TOP_K`          | number | `5`     | Number of top knowledge chunks to retrieve per query       |
| `RAG_MAX_TOKENS`     | number | `600`   | Maximum tokens from retrieved context to inject into Lane B |
| `RAG_MAX_BYTES`      | number | `4000`  | Maximum byte length of retrieved context                   |

### Storage Settings

| Environment Variable   | Type    | Default                          | Description                                           |
|------------------------|---------|----------------------------------|-------------------------------------------------------|
| `DATABASE_PATH`        | string  | `../data/voice-jib-jab.db`       | Path to the SQLite database                           |
| `DATABASE_WAL_MODE`    | boolean | `true`                           | Enable SQLite WAL mode for concurrent access          |
| `MAX_HISTORY_TURNS`    | number  | `20`                             | Number of prior turns to include in session context   |
| `MAX_SUMMARY_LENGTH`   | number  | `2000`                           | Maximum character length of a saved conversation summary |

### Fallback Settings

| Environment Variable | Type   | Default  | Description                                              |
|----------------------|--------|----------|----------------------------------------------------------|
| `FALLBACK_MODE`      | string | `auto`   | Default fallback behavior when policy blocks a response  |

Valid values for `FALLBACK_MODE`:

| Value                      | Behavior                                               |
|----------------------------|--------------------------------------------------------|
| `auto`                     | Server selects the most appropriate mode               |
| `ask_clarifying_question`  | Ask the user to rephrase                               |
| `refuse_politely`          | Politely decline to respond                            |
| `switch_to_text_summary`   | Provide a text summary instead of voice               |
| `escalate_to_human`        | Hand off to a human agent                              |
| `offer_email_or_link`      | Offer an alternative channel                           |

### OPA Policy Engine

| Environment Variable | Type    | Default                          | Description                                            |
|----------------------|---------|----------------------------------|--------------------------------------------------------|
| `ENABLE_OPA`         | boolean | `false`                          | Enable OPA WASM policy engine                          |
| `OPA_BUNDLE_PATH`    | string  | `server/policies/bundle.tar.gz`  | Path to the compiled OPA WASM bundle                   |

### ControlEngine Configuration (`ControlEngineConfig`)

The `ControlEngine` (Lane C) is configured per-session. The following table describes all `ControlEngineConfig` fields.

| Field                    | Type                         | Default          | Description                                                                                   |
|--------------------------|------------------------------|------------------|-----------------------------------------------------------------------------------------------|
| `enabled`                | `boolean`                    | `true`           | Enable/disable the entire policy pipeline                                                     |
| `moderationDenyPatterns` | `RegExp[]`                   | `[]`             | Legacy flat deny-list patterns (used only when `moderationCategories` is empty)               |
| `moderationCategories`   | `ModerationCategory[]`       | default set      | Categorized moderation rules with per-category decisions and reason codes (see below)         |
| `claimsRegistry`         | `AllowedClaimsRegistry`      | empty registry   | Registry of approved claims for the claims checker                                            |
| `evaluateDeltas`         | `boolean`                    | `false`          | Whether to run policy checks on partial (non-final) transcript segments                       |
| `cancelOutputThreshold`  | `number`                     | `4`              | Severity level at or above which `refuse`/`escalate` is upgraded to `cancel_output`          |
| `enablePIIRedaction`     | `boolean`                    | `true`           | Enable PII redaction pass before moderation and storage                                       |
| `piiRedactionMode`       | `"redact"` or `"flag"`       | `"redact"`       | Whether PII is replaced with redaction markers or only flagged                                |
| `piiScanMetadata`        | `boolean`                    | `true`           | Whether PII redaction also scans event metadata fields                                        |
| `opaEvaluator`           | `OpaEvaluator` (optional)    | `undefined`      | When provided, replaces pattern-matching with OPA WASM evaluation                            |
| `moderationThresholds`   | `Record<string, number>`     | `undefined`      | Per-category score thresholds passed to OPA (e.g., `{ "default": 0.5, "SELF_HARM": 0.3 }`)  |
| `opaClaimsThreshold`     | `number` (optional)          | `0.6`            | Cosine similarity threshold used by the OPA claims checker                                   |

### Default Moderation Categories

When `opaEvaluator` is not configured, the server uses a categorized regex-pattern moderator. The default categories are:

| Category          | Severity | Decision    | Description                                           |
|-------------------|----------|-------------|-------------------------------------------------------|
| `JAILBREAK`       | 4        | `refuse`    | Prompt injection and instruction override attempts    |
| `SELF_HARM`       | 4        | `escalate`  | Suicidal ideation and self-harm requests              |
| `VIOLENCE_THREATS`| 4        | `refuse`    | Explicit threats and requests for violence instructions|
| `HATE_SPEECH`     | 4        | `refuse`    | Content targeting protected groups                    |
| `ILLEGAL_ACTIVITY`| 3        | `refuse`    | Instructions for illegal activities                   |
| `EXPLICIT_CONTENT`| 3        | `refuse`    | Sexually explicit requests                            |
| `HARASSMENT`      | 4        | `refuse`    | Targeted personal attacks and doxxing                 |

Severity 4 at or above the `cancelOutputThreshold` (default `4`) causes `refuse` to be upgraded to `cancel_output`, immediately stopping Lane B audio.

### Claims Registry (`AllowedClaimsRegistry`)

The claims registry controls what factual assertions the AI is permitted to make. It loads from `knowledge/allowed_claims.json` at startup (path configurable via `KNOWLEDGE_DIR` environment variable).

**Catalog file format:**

```json
{
  "allowed_claims": [
    {
      "id": "CLAIM-001",
      "text": "Our product is ISO 27001 certified.",
      "source": "Legal review 2025-01",
      "category": "compliance",
      "required_disclaimer_id": "DISC-SECURITY",
      "last_verified": "2025-01-15"
    }
  ],
  "disallowed_patterns": [
    "guaranteed returns",
    "risk-free investment"
  ]
}
```

**`AllowedClaimsRegistryConfig` options:**

| Field                    | Type             | Default  | Description                                                           |
|--------------------------|------------------|----------|-----------------------------------------------------------------------|
| `claims`                 | `ApprovedClaim[]`| `[]`     | Claims to register directly (skips file load when populated)          |
| `disallowedPatterns`     | `string[]`       | `[]`     | Substrings that are always refused regardless of claim matches        |
| `partialMatchThreshold`  | `number`         | `0.6`    | Minimum word-overlap score for a partial claim match (0.0–1.0)       |
| `sourcePath`             | `string`         | auto     | Explicit path to `allowed_claims.json`                                |
| `knowledgeDir`           | `string`         | auto     | Directory to search for `allowed_claims.json`                         |
| `enableFileLoad`         | `boolean`        | `true`   | Whether to load from the JSON file at startup                         |

When `ENABLE_OPA=true`, the claims check uses cosine similarity (dense embeddings via `all-MiniLM-L6-v2`, with TF-IDF fallback) against the default threshold of `0.6`. The threshold is configurable per-session via `opaClaimsThreshold`.

---

## 6. Policy Decision Events

Lane C (ControlEngine) evaluates every user and assistant transcript through a three-stage pipeline: PII redaction → moderation → claims check. The result is a `policy.decision` event on the internal event bus. The five possible decisions and their client-observable effects are:

### `allow`

The content passed all checks. No action is taken. Lane B continues normally. The client does not receive any notification of an `allow` decision.

### `rewrite`

The content contains issues that can be corrected (typically PII redaction). The `safe_rewrite` field in the policy payload contains the corrected text that Lane B will use instead. The client does not receive a direct notification, but may observe changes in transcript content.

```typescript
// PolicyDecisionPayload when decision is "rewrite"
{
  decision: "rewrite",
  reason_codes: ["PII:EMAIL"],
  safe_rewrite: "Hello [REDACTED], your account is...",
  severity: 2,
  fallback_mode: "ask_clarifying_question"
}
```

### `refuse`

The content violated policy (e.g., illegal activity, explicit content). Lane B is NOT automatically stopped for low-severity refuses (severity < `cancelOutputThreshold`). The FallbackPlanner is triggered to play an appropriate fallback response instead. The client observes: `response.start` → `audio.chunk` (fallback) → `response.end`.

### `escalate`

The content requires human intervention (specifically: self-harm triggers). Lane B is stopped. The FallbackPlanner triggers with `escalate_to_human` mode. This is distinct from `refuse` because the user needs support, not a generic denial. The client observes the same pattern as `refuse` but the fallback audio will indicate a human handoff.

### `cancel_output`

The most severe decision. Triggered either directly by a critical moderation hit (severity >= `cancelOutputThreshold`, default `4`) or by the OverrideController upgrading a `refuse`/`escalate` at high severity. The orchestrator immediately stops Lane B, stops Lane A, and cancels the OpenAI response stream. The FallbackPlanner is triggered with `refuse_politely` mode.

**Client observable sequence for `cancel_output`:**

```
Server → client: response.end          (cancellation)
Server → client: lane.owner_changed    (to: "fallback")
Server → client: response.start        (fallback begins)
Server → client: audio.chunk (lane: "fallback")  x N
Server → client: response.end          (fallback complete)
```

**ControlEngine audit events** (internal event bus only, not sent to client):

```typescript
// control.audit — emitted for every evaluation
interface ControlAuditPayload {
  evaluationId: string;
  role: "user" | "assistant";
  textSnippet: string;     // first 200 chars, PII-redacted
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  checksRun: string[];
  durationMs: number;
}

// control.override — emitted when OverrideController upgrades a decision
interface ControlOverridePayload {
  evaluationId: string;
  originalDecision: PolicyDecision;
  effectiveDecision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  cancelThreshold: number;
}

// control.metrics — emitted at session end (and on demand)
interface ControlMetricsPayload {
  evaluationCount: number;
  allowCount: number;
  rewriteCount: number;
  refuseCount: number;
  escalateCount: number;
  cancelCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
}
```

---

## 7. Error Handling

### Connection Errors

WebSocket errors are caught at the `ws.on("error", ...)` handler. The error is emitted as a `session.error` event on the internal event bus and the connection is cleaned up. The client will observe a TCP close.

### Message Parse Errors

If a client message cannot be JSON-parsed or causes an unhandled exception in the message handler, the server catches the error and sends:

```typescript
{ type: "error", error: "<message>", timestamp: number }
```

The connection stays open. The client can continue sending messages.

### Unknown Message Types

Unknown `type` values are logged as warnings and silently dropped. No response is sent to the client.

### Lane B (OpenAI) Errors

Errors from the OpenAI Realtime API connection are forwarded to the client as:

```typescript
{ type: "error", error: "<openai error message>", timestamp: number }
```

### Policy Violations

Policy violations do not produce `error` messages to the client. Instead, they result in one of the five policy decisions described in section 6. The most visible signal of a policy block is the `response.end` arriving without the expected AI response, followed by a fallback audio sequence.

### Audio Rejection (Silent)

The following conditions cause audio chunks to be silently dropped without any error response:

- `audio.chunk` received while arbitrator state is not `LISTENING` (AI is speaking or processing).
- `audio.chunk` received during the 1500 ms post-response echo-suppression cooldown.
- `audio.chunk` with RMS energy below `~200` (approximately -44 dBFS).
- Any message received after `audio.stop` or `audio.commit` until the response cycle completes.

Clients implementing a recording indicator should use `speech.started` and `speech.stopped` server events (open-mic mode) or the `audio.commit` → `commit.skipped`/`response.start` sequence (push-to-talk mode) to determine when the server is actually processing audio.

### Session Cleanup on Abnormal Disconnect

If the WebSocket closes without a `session.end` message, the server:

1. Removes event bus listeners for `policy.decision` and `rag.result`.
2. Saves a conversation summary if `ENABLE_PERSISTENT_MEMORY=true` and the session has transcript turns.
3. Calls `laneArbitrator.endSession()`, `fallbackPlanner.stop()`, `controlEngine.destroy()`, and `laneB.disconnect()`.
4. Marks the session as ended with reason `connection_closed` in the storage layer.
