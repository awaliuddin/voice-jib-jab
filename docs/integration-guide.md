# Integration Guide — voice-jib-jab WebSocket SDK

## Quick Start

### 1. Import the SDK

```typescript
import { VjjClient } from "@nxtg/vjj-client";
// or from source:
import { VjjClient } from "./sdk/VjjClient.js";
```

### 2. Connect to a session

```typescript
const client = new VjjClient({
  url: "ws://localhost:3000",
  tenantId: "org_my_company",
  fingerprint: "user-abc-123",
  voiceMode: "push-to-talk",
});

await client.connect();
console.log("Connected! Session:", client.sessionId);
```

### 3. Stream audio

```typescript
// From Web Audio API / getUserMedia:
const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

// Convert to PCM16 base64 chunks via a ScriptProcessorNode or AudioWorklet,
// then send each chunk:
client.sendAudioChunk(base64PcmChunk);

// When user releases PTT button:
client.sendAudioStop();
```

### 4. Receive responses

```typescript
client.on("audio", (base64Data) => {
  // Decode and play PCM16 audio
  playAudio(base64Data);
});

client.on("transcript", ({ text, isFinal }) => {
  if (isFinal) console.log("AI said:", text);
});

client.on("policyDecision", ({ decision, reasonCodes, severity }) => {
  if (decision === "refuse") showPolicyWarning(reasonCodes);
  if (decision === "escalate") triggerHumanHandoff();
});
```

---

## API Reference

### Constructor

```typescript
new VjjClient(options: VjjClientOptions)
```

| Option           | Type                               | Default          | Description                            |
| ---------------- | ---------------------------------- | ---------------- | -------------------------------------- |
| `url`            | `string`                           | *required*       | WebSocket endpoint (ws:// or wss://)   |
| `tenantId`       | `string`                           | `undefined`      | Tenant ID for multi-tenant isolation   |
| `fingerprint`    | `string`                           | `undefined`      | Client fingerprint for session linking |
| `userAgent`      | `string`                           | `undefined`      | User-agent sent with session.start     |
| `voiceMode`      | `"push-to-talk" \| "open-mic"`     | `undefined`      | Initial voice interaction mode         |
| `reconnect`      | `boolean`                          | `false`          | Auto-reconnect on unexpected close     |
| `reconnectDelay` | `number`                           | `2000`           | Milliseconds before reconnect attempt  |

### Methods

| Method                              | Returns         | Description                                    |
| ----------------------------------- | --------------- | ---------------------------------------------- |
| `connect()`                         | `Promise<void>` | Open WS, send session.start, await ready       |
| `disconnect()`                      | `void`          | Send session.end, close WebSocket              |
| `sendAudioChunk(base64Data)`        | `void`          | Send a base64-encoded PCM16 audio chunk        |
| `sendAudioStop()`                   | `void`          | Signal end of current utterance                 |
| `sendAudioCancel()`                 | `void`          | Cancel current audio stream                    |
| `commitAudio()`                     | `void`          | Commit audio buffer for processing             |
| `bargeIn()`                         | `void`          | Signal user interruption (barge-in)            |
| `playbackEnded()`                   | `void`          | Notify server that playback finished           |
| `setMode(mode)`                     | `void`          | Switch to "push-to-talk" or "open-mic"         |

### Properties

| Property    | Type                                                  | Description                                    |
| ----------- | ----------------------------------------------------- | ---------------------------------------------- |
| `sessionId` | `string \| null`                                      | Server-assigned session ID, null if unconnected |
| `connected` | `boolean`                                             | True when state is "ready"                     |
| `state`     | `"disconnected" \| "connecting" \| "ready" \| "error"` | Current connection state                       |

---

## Events Reference

| Event             | Payload                                                          | Description                              |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `ready`           | `sessionId: string`                                              | Session established, ready for audio     |
| `audio`           | `base64Data: string`                                             | Server audio chunk (PCM16 base64)        |
| `transcript`      | `{ text: string, isFinal: boolean }`                             | AI response transcript (partial or final)|
| `userTranscript`  | `{ text: string, isFinal: boolean }`                             | User speech transcript                   |
| `policyDecision`  | `{ decision, reasonCodes, severity, safeRewrite? }`              | Lane C governance decision               |
| `responseStart`   | *(none)*                                                         | AI response generation started           |
| `responseEnd`     | *(none)*                                                         | AI response generation ended             |
| `speechStarted`   | *(none)*                                                         | User speech detected                     |
| `speechStopped`   | *(none)*                                                         | User speech ended                        |
| `providerReady`   | *(none)*                                                         | Upstream AI provider connected           |
| `modeChanged`     | `mode: "push-to-talk" \| "open-mic"`                             | Voice mode changed                       |
| `error`           | `Error`                                                          | Session or connection error              |
| `close`           | *(none)*                                                         | WebSocket connection closed              |

---

## Multi-Tenant Usage

voice-jib-jab supports per-tenant isolation. Pass `tenantId` in the constructor:

```typescript
const client = new VjjClient({
  url: "wss://voice.example.com",
  tenantId: "org_acme_corp",
});
```

Each tenant gets:
- Isolated policy rules (Lane C)
- Separate audit trails
- Per-tenant rate limiting
- Dedicated ChromaDB memory namespace

The `tenantId` is sent in the `session.start` message and the server enforces isolation for the entire session lifecycle.

---

## Lane C Policy Events

Lane C is the governance lane that monitors all AI output in real-time. When a policy decision is made, the server sends a `policy.decision` message. The client emits this as a `policyDecision` event.

### Decision Types

| Decision         | Meaning                                    | Recommended Action                       |
| ---------------- | ------------------------------------------ | ---------------------------------------- |
| `allow`          | Output passed all policy checks            | No action needed                         |
| `rewrite`        | Output was rewritten for compliance        | Use `safeRewrite` as the display text    |
| `refuse`         | Output blocked by policy                   | Show a generic refusal message to user   |
| `escalate`       | Issue requires human review                | Trigger human-in-the-loop handoff        |
| `cancel_output`  | Output cancelled mid-stream                | Stop playback, discard buffered audio    |

### Handling Example

```typescript
client.on("policyDecision", ({ decision, reasonCodes, severity, safeRewrite }) => {
  switch (decision) {
    case "allow":
      // No action needed
      break;
    case "rewrite":
      displayTranscript(safeRewrite!);
      break;
    case "refuse":
      displayWarning("This response was blocked by policy.", reasonCodes);
      break;
    case "escalate":
      triggerHumanHandoff(reasonCodes);
      break;
    case "cancel_output":
      stopAudioPlayback();
      break;
  }
});
```

---

## Error Handling

### Connection Timeout

`connect()` rejects after 5 seconds if the server does not respond with `session.ready`:

```typescript
try {
  await client.connect();
} catch (err) {
  if (err.message === "Connection timeout") {
    // Server unreachable or unresponsive
    showConnectionError();
  }
}
```

### Session Errors

The server may send `session.error` at any time. Listen for the `error` event:

```typescript
client.on("error", (err) => {
  console.error("Session error:", err.message);
  // Display error UI, attempt reconnect, etc.
});
```

### WebSocket Close

When the WebSocket closes (server shutdown, network loss), the client emits `close`:

```typescript
client.on("close", () => {
  console.log("Connection lost");
  // The client will auto-reconnect if `reconnect: true` was set
});
```

### Automatic Reconnection

Enable reconnection for production deployments:

```typescript
const client = new VjjClient({
  url: "wss://voice.example.com",
  reconnect: true,
  reconnectDelay: 3000, // 3 seconds between attempts
});
```

---

## Audio Format

All audio transported over the WebSocket uses the following format:

| Property    | Value           |
| ----------- | --------------- |
| Encoding    | PCM16 (signed 16-bit integer) |
| Sample rate | 24 kHz          |
| Channels    | Mono (1)        |
| Byte order  | Little-endian   |
| Transport   | Base64-encoded  |

### Browser Audio Pipeline

Browsers typically capture at 48 kHz. You must downsample to 24 kHz before sending:

```typescript
// In an AudioWorklet or ScriptProcessorNode:
function downsampleTo24k(buffer: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / 24000;
  const outputLength = Math.floor(buffer.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sample = buffer[Math.floor(i * ratio)];
    output[i] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32768)));
  }

  return output;
}
```

---

## Production Deployment

### Server Setup

Use the provided `docker-compose.yml` for server deployment:

```bash
docker-compose up -d
```

### TLS Configuration

Always use `wss://` in production. The server should be behind a TLS-terminating reverse proxy (nginx, Caddy, or a cloud load balancer).

```typescript
const client = new VjjClient({
  url: "wss://voice.example.com",
  tenantId: "org_production",
  reconnect: true,
});
```

### Health Check

The server exposes a health endpoint at `GET /health` that returns the current status of all three lanes and the OpenAI provider connection.
