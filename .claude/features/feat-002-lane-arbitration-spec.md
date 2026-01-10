# Feature Spec: Lane Arbitration

**Feature ID:** feat-002
**Feature Name:** Lane Arbitration (Lanes A & B)
**Priority:** Critical
**Milestone:** 2 - Lane Arbitration
**Estimated Complexity:** High

## Description

Implement the dual-lane arbitration system where Lane A provides immediate acknowledgements (reflex responses) while Lane B processes substantive responses. The orchestrator ensures only one lane owns audio output at a time, with Lane B preempting Lane A immediately when ready.

## User Stories

1. **As a user**, I want to hear a brief acknowledgement when I stop speaking, so I know the system heard me while it's thinking.

2. **As a user**, I want the acknowledgement to stop instantly when the real response starts, so there's no awkward overlap.

3. **As a user**, I want responses to feel natural and responsive, with no noticeable gaps or overlaps.

4. **As a developer**, I want to see lane ownership transitions in the debug overlay, so I can verify the system works correctly.

## Acceptance Criteria

- [ ] Lane A plays reflex audio (acknowledgements) after user speech ends
- [ ] Lane B preempts Lane A immediately when first audio chunk is ready
- [ ] Lane A and Lane B audio never overlap
- [ ] Lane B takes ownership within one audio chunk (~100ms)
- [ ] Barge-in works from any lane state
- [ ] Lane transitions are logged and visible in debug overlay
- [ ] Reflex responses are from whitelist only (no factual claims)
- [ ] Lane A can be disabled via configuration

## Technical Requirements

### Server Components

**New Modules:**

- `server/src/lanes/LaneA.ts` - Reflex engine
- `server/src/lanes/LaneB.ts` - Reasoning engine (wraps OpenAI adapter)
- `server/src/orchestrator/LaneArbitrator.ts` - State machine and ownership
- `server/src/config/reflexWhitelist.ts` - Approved Lane A utterances

**Modified Modules:**

- `server/src/api/websocket.ts` - Route through arbitrator
- `server/src/orchestrator/EventBus.ts` - Lane transition events
- `server/src/schemas/events.ts` - Lane event types

### Client Components

**Modified Modules:**

- `client/src/state/SessionManager.ts` - Handle lane.owner_changed events
- `client/src/ui/DebugOverlay.tsx` - Display current lane owner

### Lane A: Reflex Engine

**Purpose:** Provide immediate acknowledgement while Lane B works

**Characteristics:**

- Sub-200ms response time
- Whitelist-based utterances only
- No factual claims allowed
- Instantly cancelable

**Whitelist Examples:**

```typescript
const REFLEX_WHITELIST = [
  "I hear you",
  "One moment",
  "Let me check on that",
  "Sure thing",
  "Working on it",
  "Got it",
];
```

**Implementation Options:**

1. Pre-generated audio clips (fastest)
2. TTS cache with pre-rendered audio
3. On-demand TTS with minimal latency

### Lane B: Reasoning Engine

**Purpose:** Substantive response with full AI capabilities

**Characteristics:**

- Uses OpenAI Realtime API (already implemented)
- Preempts Lane A immediately when ready
- Supports RAG integration (future)
- Policy-compliant (future)

**Integration:**

- Wraps existing `OpenAIRealtimeAdapter`
- Emits `b_first_audio_ready` event
- Handles response lifecycle

### Lane Arbitrator

**State Machine:**

```
States:
- IDLE           - No active audio
- LISTENING      - Receiving user input
- A_PLAYING      - Lane A reflex audio playing
- B_RESPONDING   - Lane B processing (no audio yet)
- B_PLAYING      - Lane B audio playing
- ENDED          - Session ended

Transitions:
- IDLE -> LISTENING           (session.start)
- LISTENING -> A_PLAYING      (user_speech_ended, B not ready)
- LISTENING -> B_RESPONDING   (user_speech_ended, skip A)
- A_PLAYING -> B_PLAYING      (b_first_audio_ready)
- B_RESPONDING -> B_PLAYING   (b_first_audio_ready)
- B_PLAYING -> LISTENING      (b_response_done)
- *_PLAYING -> LISTENING      (user_barge_in)
- * -> ENDED                  (session.end)
```

**Core Invariants:**

1. **Single audio owner:** Only one lane plays audio at a time
2. **B preempts A:** Lane B takes ownership immediately when ready
3. **Barge-in universal:** User speech stops any assistant audio
4. **No audio gaps:** Transition happens within one chunk boundary

### Event Types

**New Events:**

```typescript
// Lane ownership changed
interface LaneOwnerChangedEvent {
  type: "lane.owner_changed";
  from: "none" | "A" | "B";
  to: "none" | "A" | "B";
  cause:
    | "user_speech_ended"
    | "b_first_audio_ready"
    | "user_barge_in"
    | "response_done";
}

// Lane A reflex triggered
interface LaneAReflexEvent {
  type: "lane.a_reflex";
  utterance: string;
}

// Lane B ready
interface LaneBReadyEvent {
  type: "lane.b_ready";
  latency_ms: number;
}
```

## Architecture Design

### Audio Flow with Lanes

```
User Speech Ends
       ↓
[LaneArbitrator] checks Lane B readiness
       ↓
   ┌───┴───┐
   │       │
   ↓       ↓
Lane B    Lane B
Ready?    Not Ready
   ↓       ↓
Skip A    Play Lane A
   ↓       ↓
   └───┬───┘
       ↓
[Lane B becomes ready]
       ↓
[Cancel Lane A if playing]
       ↓
[Play Lane B audio]
       ↓
[Response complete]
       ↓
[Return to LISTENING]
```

### Preemption Flow

```
Lane A Playing
     ↓
[Lane B first audio chunk ready]
     ↓
[LaneArbitrator.transition(B, "b_first_audio_ready")]
     ↓
[AudioPlayback.stop()]  ← Immediate, mid-chunk
     ↓
[Lane B audio starts]
     ↓
[Smooth handoff, no overlap]
```

## Performance Targets

- **Lane A latency:** <200ms from user speech end to reflex audio start
- **Preemption latency:** <100ms from B ready to A stop
- **Lane B TTFB:** <400ms p50, <900ms p95 (unchanged from MVP)
- **No audio overlap:** 0 instances of dual-lane audio

## Configuration

```typescript
interface LaneConfig {
  // Lane A settings
  laneA: {
    enabled: boolean; // Can disable reflex entirely
    minDelayMs: number; // Min wait before triggering (avoid false triggers)
    maxDurationMs: number; // Max reflex duration before auto-cancel
    utterances: string[]; // Whitelist of allowed phrases
  };

  // Lane B settings
  laneB: {
    preemptThresholdMs: number; // How quickly B must be ready to skip A
  };

  // Arbitration settings
  arbitrator: {
    transitionGapMs: number; // Tiny gap between A stop and B start (avoid click)
  };
}
```

## Implementation Phases

### Phase 1: Lane Arbitrator Core

- Implement state machine
- Add lane transition events
- Integrate with existing audio flow

### Phase 2: Lane A Reflex

- Create reflex whitelist
- Implement pre-generated audio or TTS cache
- Add reflex triggering logic

### Phase 3: Lane B Integration

- Wrap OpenAI adapter in Lane B
- Emit b_first_audio_ready event
- Handle preemption

### Phase 4: Client Integration

- Handle lane.owner_changed in SessionManager
- Display lane state in DebugOverlay
- Update audio playback for lane transitions

### Phase 5: Testing & Tuning

- Unit tests for state machine
- Integration tests for lane transitions
- Performance validation
- Tune timing thresholds

## Testing Strategy

### Unit Tests

- LaneArbitrator state transitions
- Lane A whitelist validation
- Preemption logic
- Event emission

### Integration Tests

- Full lane transition flow
- Barge-in from A_PLAYING state
- Barge-in from B_PLAYING state
- Lane A timeout handling
- Skip Lane A when B is immediate

### Performance Tests

- Lane A response latency
- Preemption timing
- Audio overlap detection
- Sustained conversation with lane transitions

## Dependencies

**Depends on:**

- feat-001: Voice Loop MVP (complete)

**Blocks:**

- feat-003: Control Plane (Lane C needs arbitration infrastructure)
- feat-004: RAG Integration (Lane B needs to support instruction injection)

## Risks & Mitigations

**Risk:** Lane A audio clips sound robotic
**Mitigation:** Use high-quality TTS or pre-record with natural voice

**Risk:** Preemption causes audio click/pop
**Mitigation:** Implement tiny crossfade or gap

**Risk:** Lane A triggers too often (annoying)
**Mitigation:** Add minimum delay threshold and skip when B is fast

**Risk:** State machine complexity leads to bugs
**Mitigation:** Comprehensive unit tests for all transitions

## Success Metrics

- [ ] All acceptance criteria met
- [ ] Lane A latency <200ms p95
- [ ] Preemption latency <100ms p95
- [ ] Zero audio overlaps in 10-minute session
- [ ] Clean state transitions in debug overlay
- [ ] Test coverage >85% for lane modules

## Next Steps After Completion

1. Manual testing with various conversation patterns
2. Performance profiling of lane transitions
3. Create checkpoint
4. Begin feat-003: Control Plane (Lane C)
