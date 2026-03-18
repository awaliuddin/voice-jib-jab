# @nxtg/vjj-sdk

Browser and Node.js SDK for the voice-jib-jab voice agent runtime.

## Installation

```bash
npm install @nxtg/vjj-sdk
```

## Quick Start

```typescript
import { VoiceClient } from "@nxtg/vjj-sdk";

const client = new VoiceClient(
  { url: "wss://api.example.com/voice" },
  {
    onReady: (sessionId) => console.log("Session started:", sessionId),
    onTranscript: (event) => {
      console.log(`[${event.role}] ${event.text}${event.isFinal ? " (final)" : ""}`);
    },
    onPolicyEvent: (event) => {
      console.log(`Policy: ${event.decision}`, event.reasonCodes);
    },
    onAudio: (base64Data) => {
      // Decode and play audio
    },
    onError: (error) => console.error("Error:", error.message),
    onClose: () => console.log("Disconnected"),
  },
);

// Connect with optional session config
const sessionId = await client.connect({
  tenantId: "org_acme",
  voiceMode: "push-to-talk",
});

// Send audio (base64-encoded PCM16)
client.sendAudio(base64AudioChunk);

// Signal end of speech
client.stopAudio();

// End session
client.endSession();
```

## Browser (Script Tag)

```html
<script src="https://unpkg.com/@nxtg/vjj-sdk/dist/index.global.js"></script>
<script>
  const client = new VjjSdk.VoiceClient(
    { url: "wss://api.example.com/voice" },
    {
      onReady: function (sessionId) {
        console.log("Connected:", sessionId);
      },
      onTranscript: function (event) {
        document.getElementById("transcript").textContent += event.text;
      },
    },
  );

  client.connect({ tenantId: "org_acme" });
</script>
```

## API Reference

### `new VoiceClient(options, callbacks?)`

Create a new voice client instance.

#### Options

| Property           | Type      | Default | Description                                  |
| ------------------ | --------- | ------- | -------------------------------------------- |
| `url`              | `string`  | -       | WebSocket endpoint (ws:// or wss://)         |
| `connectTimeoutMs` | `number`  | `5000`  | Connection handshake timeout in milliseconds |
| `autoReconnect`    | `boolean` | `false` | Automatically reconnect on unexpected close  |
| `reconnectDelayMs` | `number`  | `2000`  | Delay before reconnection attempt            |

### Methods

| Method                         | Description                                            |
| ------------------------------ | ------------------------------------------------------ |
| `connect(config?)`             | Connect and start session. Returns `Promise<sessionId>`|
| `sendAudio(base64Data)`        | Send base64-encoded PCM16 audio chunk                  |
| `stopAudio()`                  | Signal end of user audio input                         |
| `cancelAudio()`                | Cancel current audio response                          |
| `playbackEnded()`              | Signal audio playback completed                        |
| `on(callbacks)`                | Register additional callbacks (merges with existing)   |
| `endSession()`                 | End session and close connection                       |

### Properties

| Property    | Type              | Description                              |
| ----------- | ----------------- | ---------------------------------------- |
| `sessionId` | `string \| null`  | Server-assigned session ID               |
| `state`     | `ConnectionState` | Current connection state                 |
| `connected` | `boolean`         | Whether the client has an active session |

### Callbacks

| Callback         | Signature                              | Description                         |
| ---------------- | -------------------------------------- | ----------------------------------- |
| `onReady`        | `(sessionId: string) => void`          | Session established                 |
| `onAudio`        | `(base64Data: string) => void`         | Audio chunk received                |
| `onTranscript`   | `(event: TranscriptEvent) => void`     | Transcript update (user/assistant)  |
| `onPolicyEvent`  | `(event: PolicyEvent) => void`         | Lane C policy decision              |
| `onResponseStart`| `() => void`                           | Assistant response started          |
| `onResponseEnd`  | `() => void`                           | Assistant response ended            |
| `onError`        | `(error: Error) => void`               | Error occurred                      |
| `onClose`        | `() => void`                           | Connection closed                   |

## TypeScript

All types are exported for full TypeScript support:

```typescript
import type {
  VoiceClientOptions,
  VoiceClientCallbacks,
  SessionConfig,
  PolicyDecision,
  PolicyEvent,
  TranscriptEvent,
  VoiceMode,
  ConnectionState,
} from "@nxtg/vjj-sdk";
```

## Compatibility

- **Browsers**: All modern browsers with WebSocket support
- **Node.js**: 22+ (uses built-in WebSocket)
- **Bundlers**: ESM and CJS exports, tree-shakeable
- **CDN**: IIFE/UMD bundle available as `dist/index.global.js`
