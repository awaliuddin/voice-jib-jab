# Lane System Architecture

## Three-Lane System

### Lane A: Reflex (Experience Plane)
**Purpose:** Immediate acknowledgement while Lane B works

**Characteristics:**
- Sub-200ms response time
- Whitelist-based utterances only
- No factual claims
- Instantly cancelable

**Implementation:**
- Pre-generated audio clips or TTS cache
- Strict whitelist: ["I hear you", "One moment", "Let me check"]
- State: can be skipped if Lane B ready immediately

**Module:** `server/src/lanes/laneA_reflex.ts`

### Lane B: Reasoned (Experience Plane)
**Purpose:** Substantive, RAG-grounded response

**Characteristics:**
- RAG retrieval integration
- Tool call support
- Streaming audio response
- Policy-compliant

**Flow:**
1. Receive user intent (from transcript)
2. Query RAG retriever → facts pack
3. Build instruction set with retrieved facts
4. Execute tool calls if needed
5. Stream response to provider
6. Emit audio chunks to client
7. Track internal citations for audit

**Module:** `server/src/lanes/laneB_reasoning.ts`

### Lane C: Control (Control Plane)
**Purpose:** Policy enforcement and audit

**Characteristics:**
- Parallel to Lane B
- Never generates user-facing content
- Can cancel Lane B output
- Append-only audit trail

**Subcomponents:**
- **Moderator:** Classify policy risk
- **ClaimsChecker:** Validate against AllowedClaimsRegistry
- **PIIRedactor:** Scrub sensitive data
- **OverrideController:** Trigger cancellation and fallback

**Module:** `server/src/lanes/laneC_control.ts`

## Lane Arbitration

### State Machine

```
States:
- IDLE
- LISTENING
- A_REFLEX_PLAYING
- B_RESPONDING
- B_PLAYING
- C_OVERRIDE
- FALLBACK_PLAYING
- ENDED
```

### Transitions

```
LISTENING -> A_REFLEX_PLAYING
  Trigger: user_speech_detected (optional)
  Condition: Lane B not ready within threshold

A_REFLEX_PLAYING -> B_PLAYING
  Trigger: b_first_audio_ready
  Action: Cancel Lane A immediately

B_PLAYING -> LISTENING
  Trigger: b_response_done

B_PLAYING -> C_OVERRIDE
  Trigger: policy_cancel_output

C_OVERRIDE -> FALLBACK_PLAYING
  Trigger: fallback_selected

*_PLAYING -> LISTENING
  Trigger: user_barge_in
  Action: Stop all audio immediately
```

### Core Invariants

1. **Single audio owner:** Only one lane plays audio at a time
2. **B preempts A:** Lane B takes ownership immediately when ready
3. **C overrides B:** Lane C can cancel Lane B at any point
4. **Barge-in universal:** User speech stops any assistant audio

### Arbitration Logic

**Module:** `server/src/orchestrator/lane_arbitrator.ts`

```typescript
interface LaneState {
  current: Lane | null;
  pending: Lane | null;
  canTransition(to: Lane): boolean;
  transition(to: Lane, cause: string): void;
}
```

## Event Flow

### User Speech Detected
```
1. Client detects speech
2. Client streams audio to server
3. Orchestrator emits: user_speech_started
4. All lanes receive event
5. Lane A may trigger reflex (if configured)
6. Lane B begins processing
7. Lane C begins transcript analysis
```

### Lane B Response
```
1. Lane B retrieves RAG facts
2. Lane B builds instruction set
3. Lane B calls provider adapter
4. Provider streams audio
5. Orchestrator checks: is Lane A playing?
6. If yes: cancel Lane A, transition to Lane B
7. Lane B audio chunks flow to client
```

### Policy Override
```
1. Lane C detects policy violation
2. Lane C emits: policy_cancel_output
3. Orchestrator stops Lane B immediately
4. Orchestrator transitions to C_OVERRIDE
5. FallbackPlanner selects safe response
6. Fallback plays to user
```

### Barge-in
```
1. Client detects user speech during assistant audio
2. Client emits: user_barge_in
3. Orchestrator stops current lane immediately
4. Audio playback cancelled
5. Orchestrator transitions to LISTENING
6. New turn begins
```

## Implementation Notes

### Provider Adapter Contract
Must support:
- `startResponse(sessionId, instruction)`
- `streamAudio(sessionId, chunk)`
- `cancel(sessionId)` ← critical for barge-in

### Cancellation Handling
- Must be synchronous and immediate
- Clean up resources
- Emit cancellation event for audit

### Lane Communication
- Use event bus (in-memory or Redis)
- No direct lane-to-lane calls
- All communication through orchestrator

## Testing Lane System

### Unit Tests
- State transition validation
- Preemption logic
- Cancellation handling

### Integration Tests
- Full turn flow
- Barge-in during each state
- Policy override scenarios

### Performance Tests
- Lane A response time (<200ms)
- Lane B preemption time (<100ms)
- Barge-in stop latency (<250ms)
