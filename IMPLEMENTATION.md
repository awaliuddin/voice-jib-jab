# OpenAI Realtime API Implementation Documentation

## Executive Summary

**What**: Full implementation of OpenAI Realtime API WebSocket adapter for Voice Jib-Jab

**Why**: Enable real-time voice conversations between users and AI assistant

**How**: WebSocket-based bidirectional streaming with automatic speech detection and audio processing

## Architecture Decision Records (ADRs)

### ADR-001: WebSocket Protocol Choice

**Decision**: Use native WebSocket client for OpenAI connection
**Context**: Need reliable, low-latency bidirectional communication
**Alternatives**: HTTP polling, Server-Sent Events, WebRTC
**Rationale**: WebSocket provides lowest latency and is natively supported by OpenAI
**Consequences**: Requires connection management and reconnection logic

### ADR-002: Audio Format Selection

**Decision**: Use PCM16 format at 24kHz sample rate
**Context**: Need balance between quality and bandwidth
**Alternatives**: Opus codec, MP3, raw PCM at different rates
**Rationale**: PCM16 provides good quality, universal support, and simple processing
**Consequences**: Higher bandwidth usage than compressed formats, but simpler implementation

### ADR-003: Voice Activity Detection

**Decision**: Use server-side VAD with automatic turn-taking
**Context**: Need natural conversation flow without manual controls
**Alternatives**: Client-side VAD, manual push-to-talk, continuous streaming
**Rationale**: Server VAD is more accurate and reduces client complexity
**Consequences**: Relies on OpenAI's VAD implementation, less client control

### ADR-004: Error Recovery Strategy

**Decision**: Exponential backoff with automatic reconnection
**Context**: Network failures and API issues are inevitable
**Alternatives**: Simple retry, circuit breaker, manual reconnection
**Rationale**: Balances recovery speed with API rate limits
**Consequences**: May have brief interruptions, but maintains session continuity

## Implementation Details

### Core Components

#### 1. OpenAIRealtimeAdapter (`server/src/providers/OpenAIRealtimeAdapter.ts`)

Complete rewrite of stub implementation with:

- **WebSocket Management**: Full duplex connection to `wss://api.openai.com/v1/realtime`
- **Session Configuration**: Modalities, voice selection, VAD settings
- **Audio Processing**: PCM16 ↔ Base64 conversion for streaming
- **Message Handling**: 20+ message types from OpenAI protocol
- **State Management**: Connection, session, and response tracking
- **Error Recovery**: Automatic reconnection with exponential backoff
- **Event Emission**: Transform OpenAI events to provider-agnostic events

**Key Methods**:
- `connect()`: Establishes WebSocket connection and configures session
- `sendAudio()`: Streams PCM16 audio to OpenAI
- `commitAudio()`: Triggers response generation
- `cancel()`: Implements barge-in interruption
- `disconnect()`: Clean shutdown with resource cleanup

#### 2. WebSocket Server Updates (`server/src/api/websocket.ts`)

Enhanced event handling for:

- **Transcript Events**: Both user and assistant transcriptions
- **Speech Detection**: Start/stop events for UI feedback
- **Audio Streaming**: Bidirectional PCM16 audio flow
- **Error Propagation**: Client notification of provider errors

**New Event Handlers**:
```typescript
- 'transcript': Assistant's speech transcription
- 'user_transcript': User's speech transcription
- 'speech_started': VAD detected speech begin
- 'speech_stopped': VAD detected speech end
```

### Message Flow Architecture

```
User Speech → Microphone → Client WebSocket → Server WebSocket
    → OpenAI Adapter → OpenAI Realtime API

OpenAI Response → OpenAI Adapter → Server WebSocket
    → Client WebSocket → Audio Playback → Speakers
```

### Protocol Implementation

#### OpenAI → Adapter Message Handling

```typescript
Implemented message types:
- session.created/updated: Session lifecycle
- conversation.created: Conversation init
- input_audio_buffer.*: Audio buffer management
- conversation.item.created: Transcript items
- response.created: Response initiation
- response.audio.delta: Streaming audio chunks
- response.audio_transcript.*: Streaming transcripts
- response.done: Completion signal
- rate_limits.updated: Usage tracking
- error: Error handling
```

#### Adapter → OpenAI Message Sending

```typescript
Outbound message types:
- session.update: Configure session parameters
- input_audio_buffer.append: Stream audio input
- input_audio_buffer.commit: Trigger response
- response.cancel: Interrupt current response
- response.create: Programmatic response
```

### Audio Processing Pipeline

1. **Input Path** (User → AI):
   - Client captures PCM16 audio at 24kHz
   - Base64 encoding in client
   - WebSocket transport to server
   - Direct forwarding to OpenAI
   - Automatic VAD and transcription

2. **Output Path** (AI → User):
   - OpenAI streams base64 PCM16
   - Server decodes to Buffer
   - WebSocket transport to client
   - Client decodes and queues for playback
   - Web Audio API playback

### Connection Lifecycle

1. **Initialization**:
   ```
   Client connects → Server creates session → Adapter connects to OpenAI
   → Session configuration sent → Ready for conversation
   ```

2. **Conversation Loop**:
   ```
   User speaks → Audio streamed → Speech detected → Speech ends
   → Audio committed → Response generated → Audio streamed back
   → Playback to user → Wait for next turn
   ```

3. **Termination**:
   ```
   User disconnects → Cancel active responses → Close OpenAI connection
   → Cleanup resources → Session ended
   ```

### Quality Attributes

#### Reliability
- Automatic reconnection with exponential backoff
- Message queuing during connection loss
- Graceful degradation on errors
- Resource cleanup on disconnect

#### Performance
- Streaming architecture (no buffering delays)
- Minimal processing overhead
- Direct audio forwarding
- Connection pooling ready

#### Maintainability
- Clear separation of concerns
- Provider-agnostic interface
- Comprehensive logging
- Type-safe message handling

#### Security
- API key in environment variables
- No credential exposure to client
- Secure WebSocket (WSS) only
- Input validation on all messages

## Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...          # Your OpenAI API key
OPENAI_MODEL=gpt-4o-realtime-preview-2024-12-17  # Model version

# Optional (with defaults)
PORT=3000                       # Server port
NODE_ENV=development           # Environment mode
```

### Session Parameters

```typescript
{
  modalities: ["text", "audio"],      // Input/output modes
  voice: "alloy",                      // Voice selection
  input_audio_format: "pcm16",        // Audio codec
  output_audio_format: "pcm16",
  input_audio_transcription: {
    model: "whisper-1"                 // STT model
  },
  turn_detection: {
    type: "server_vad",                // VAD mode
    threshold: 0.5,                    // Sensitivity
    prefix_padding_ms: 300,            // Pre-buffer
    silence_duration_ms: 500           // Turn end delay
  },
  temperature: 0.8,                    // Response creativity
  max_response_output_tokens: "inf"   // No token limit
}
```

## Integration Points

### Events Emitted by Adapter

```typescript
// Audio events
'audio': AudioChunk                  // Response audio
'transcript': TranscriptSegment      // Assistant transcript
'user_transcript': TranscriptSegment // User transcript

// State events
'speech_started': void               // VAD triggered
'speech_stopped': void                // VAD released
'response_start': void                // Generation begin
'response_end': void                  // Generation complete

// Error events
'error': Error                        // Any error condition
```

### Client Integration

The client receives these WebSocket messages:

```typescript
// Audio/transcript messages
{ type: 'audio.chunk', data: base64, format: 'pcm', sampleRate: 24000 }
{ type: 'transcript', text: string, isFinal: boolean }
{ type: 'user_transcript', text: string, isFinal: boolean }

// State messages
{ type: 'session.ready', sessionId: string }
{ type: 'speech.started' }
{ type: 'speech.stopped' }
{ type: 'response.start' }
{ type: 'response.end' }

// Error messages
{ type: 'error', error: string }
```

## Testing Checklist

✅ **Implemented & Tested**:
- [x] WebSocket connection establishment
- [x] API authentication with headers
- [x] Session configuration
- [x] Audio streaming (both directions)
- [x] Base64 encoding/decoding
- [x] Message handler for all event types
- [x] Automatic reconnection
- [x] Error handling
- [x] Clean disconnect
- [x] Event emission
- [x] Server integration

⏳ **Ready for Testing**:
- [ ] End-to-end voice conversation
- [ ] Multi-turn dialogue
- [ ] Interruption (barge-in)
- [ ] Various voice options
- [ ] VAD sensitivity tuning
- [ ] Latency measurement
- [ ] Error recovery scenarios
- [ ] Long conversation stability

## Performance Considerations

### Latency Optimization
- Direct streaming without buffering
- Minimal processing in audio path
- Connection keep-alive with health checks
- Pre-warmed WebSocket connections

### Bandwidth Usage
- PCM16 at 24kHz = ~48KB/s per direction
- ~6MB per minute of conversation
- Consider Opus codec for production

### Scalability Notes
- Each session maintains one OpenAI WebSocket
- Server can handle multiple concurrent sessions
- Consider connection pooling for high scale
- Implement rate limiting for API quotas

## Security Considerations

1. **API Key Management**: Never expose to client
2. **Input Validation**: Sanitize all client messages
3. **Rate Limiting**: Prevent API abuse
4. **Session Timeout**: Auto-disconnect idle sessions
5. **Audio Privacy**: Option to disable audio storage

## Future Enhancements

1. **Codec Support**: Add Opus for bandwidth efficiency
2. **Multi-language**: Configure language per session
3. **Custom Voices**: User-selectable voice options
4. **Analytics**: Detailed conversation metrics
5. **Caching**: Response caching for common queries
6. **Fallback**: Backup providers for reliability

## Conclusion

The OpenAI Realtime API integration is now fully implemented and ready for testing. The architecture provides a robust foundation for real-time voice conversations with proper error handling, state management, and performance optimization. The modular design allows for easy extension and provider swapping if needed.