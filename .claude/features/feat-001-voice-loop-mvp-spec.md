# Feature Spec: Voice Loop MVP

**Feature ID:** feat-001
**Feature Name:** Voice Loop MVP
**Priority:** Critical
**Milestone:** 1 - Voice Loop Works
**Estimated Complexity:** High

## Description

Implement the foundational voice interaction loop: browser microphone capture → WebSocket transport → OpenAI Realtime API → streaming audio playback, with basic barge-in support. This establishes the core infrastructure for all future voice features.

## User Stories

1. **As a user**, I want to click a "Talk" button and speak naturally, so that I can have a voice conversation with the assistant.

2. **As a user**, I want to hear the assistant's voice response streaming back to me, so that the interaction feels responsive and natural.

3. **As a user**, I want to interrupt the assistant when it's speaking, so that I can steer the conversation naturally (barge-in).

4. **As a developer**, I want to see latency metrics in real-time, so that I can monitor performance against targets.

## Acceptance Criteria

- [ ] User can click "Talk" button to start voice session
- [ ] Microphone captures audio and streams to server via WebSocket
- [ ] Server forwards audio to OpenAI Realtime API
- [ ] Assistant's voice response streams back to client and plays
- [ ] User can interrupt assistant audio by speaking (barge-in)
- [ ] Barge-in stops assistant audio within 250ms (p95 target)
- [ ] Session can sustain 2-minute conversation without errors
- [ ] TTFB (time to first byte) metrics are captured
- [ ] Turn latency metrics are captured
- [ ] Debug overlay shows real-time metrics

## Technical Requirements

### Client (Browser)

**New Components:**
- `client/src/audio/MicrophoneCapture.ts` - Capture microphone input
- `client/src/audio/AudioPlayback.ts` - Play streaming audio
- `client/src/audio/AudioContext.ts` - Web Audio API setup
- `client/src/state/SessionManager.ts` - Session state management
- `client/src/events/WebSocketClient.ts` - WebSocket connection
- `client/src/ui/TalkButton.tsx` - Main interaction button
- `client/src/ui/DebugOverlay.tsx` - Metrics display
- `client/src/App.tsx` - Main app component
- `client/vite.config.ts` - Vite configuration
- `client/tsconfig.json` - TypeScript configuration
- `client/index.html` - Entry point

**Dependencies:**
```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```

### Server (Orchestrator)

**New Modules:**
- `server/src/index.ts` - Server entry point
- `server/src/api/websocket.ts` - WebSocket server
- `server/src/orchestrator/SessionManager.ts` - Session lifecycle
- `server/src/orchestrator/EventBus.ts` - Event coordination
- `server/src/providers/ProviderAdapter.ts` - Abstract interface
- `server/src/providers/OpenAIRealtimeAdapter.ts` - OpenAI implementation
- `server/src/insurance/LatencyBudget.ts` - Performance tracking
- `server/src/config/index.ts` - Configuration loader
- `server/tsconfig.json` - TypeScript configuration

**Dependencies:**
```json
{
  "express": "^4.18.2",
  "ws": "^8.16.0",
  "openai": "^4.26.0",
  "dotenv": "^16.4.1",
  "uuid": "^9.0.1"
}
```

### Configuration

**Environment Variables (.env):**
```
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-realtime
PORT=3000
VITE_WS_URL=ws://localhost:3000
```

## Architecture Design

### Data Flow

```
User Speech (Browser)
  ↓
[MicrophoneCapture] → captures audio chunks
  ↓
[WebSocketClient] → sends audio chunks to server
  ↓
[Server WebSocket Handler] → receives audio
  ↓
[SessionManager] → routes to OpenAI adapter
  ↓
[OpenAIRealtimeAdapter] → forwards to OpenAI Realtime API
  ↓
[OpenAI Realtime API] → processes and returns audio
  ↓
[OpenAIRealtimeAdapter] → receives audio chunks
  ↓
[Server WebSocket Handler] → sends audio to client
  ↓
[WebSocketClient] → receives audio chunks
  ↓
[AudioPlayback] → plays audio
  ↓
User Hears Response
```

### Barge-in Flow

```
User Starts Speaking (during assistant playback)
  ↓
[MicrophoneCapture] → detects speech
  ↓
[Client] → emits barge-in event
  ↓
[AudioPlayback] → stops immediately
  ↓
[WebSocketClient] → sends barge-in to server
  ↓
[SessionManager] → cancels current response
  ↓
[OpenAIRealtimeAdapter] → cancels OpenAI stream
```

### Event Types

**Client → Server:**
- `session.start` - Initialize session
- `audio.chunk` - Audio data
- `user.barge_in` - Interrupt assistant
- `session.end` - Close session

**Server → Client:**
- `session.ready` - Session initialized
- `audio.chunk` - Assistant audio
- `audio.end` - Response complete
- `metrics.update` - Latency data
- `error` - Error occurred

## Performance Targets

- **TTFB p50:** <400ms
- **TTFB p95:** <900ms
- **Barge-in stop p95:** <250ms
- **Turn latency p95:** <1200ms

## Dependencies

**Depends on:**
- None (foundational feature)

**Blocks:**
- feat-002: Lane Arbitration (needs basic voice loop)
- feat-003: Control Plane (needs working session)
- feat-004: RAG Integration (needs conversation flow)

## Implementation Phases

### Phase 1: Core Infrastructure (Lead Architect + Backend Master)
- Server WebSocket setup
- Session management skeleton
- Event bus structure
- OpenAI Realtime adapter interface

### Phase 2: Client Audio (Frontend + Backend Master)
- Microphone capture
- Audio playback
- WebSocket client
- Basic UI

### Phase 3: Integration (Backend Master + Integration Specialist)
- Connect client to server
- OpenAI Realtime implementation
- End-to-end audio flow
- Error handling

### Phase 4: Barge-in (Backend Master)
- Speech detection
- Immediate audio stop
- Session cancellation
- State recovery

### Phase 5: Metrics & Polish (QA Sentinel + Backend Master)
- Latency tracking
- Debug overlay
- Performance validation
- Tests

## Testing Strategy

### Unit Tests
- MicrophoneCapture initialization and cleanup
- AudioPlayback buffer management
- SessionManager state transitions
- OpenAIRealtimeAdapter connection handling

### Integration Tests
- Complete audio flow (mic → OpenAI → playback)
- Barge-in during playback
- Session recovery after error
- Multiple conversation turns

### Performance Tests
- TTFB under various network conditions
- Barge-in latency consistency
- 2-minute sustained conversation
- Memory leak checks

## Documentation

- [ ] Update README with Voice Loop MVP setup
- [ ] Add API documentation for WebSocket events
- [ ] Create user guide for Talk button
- [ ] Document OpenAI API integration
- [ ] Update CHANGELOG

## Risks & Mitigations

**Risk:** OpenAI Realtime API rate limits
**Mitigation:** Implement exponential backoff and user feedback

**Risk:** Browser audio permissions denied
**Mitigation:** Clear error messaging and permission request flow

**Risk:** Network latency exceeds targets
**Mitigation:** Buffer management and timeout handling

**Risk:** Memory leaks in audio buffers
**Mitigation:** Proper cleanup and resource management

## Success Metrics

- [ ] All acceptance criteria met
- [ ] Test coverage >85%
- [ ] Performance targets achieved in local testing
- [ ] No console errors during 2-minute session
- [ ] Clean code review from QA Sentinel

## Next Steps After Completion

1. Manual testing session
2. Performance profiling
3. Create checkpoint
4. Begin feat-002: Lane Arbitration
