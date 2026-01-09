# Voice UX Principles

## Core Trust Principles

### 1. Latency is Trust
- Users judge trust by responsiveness
- TTFB p50 target: <400ms
- Barge-in stop target: <250ms p95
- Every millisecond matters in voice interaction

### 2. Never Hallucinate Claims
- Lane A: NEVER assert facts, only acknowledge
- Lane B: ONLY use RAG-retrieved facts for company assertions
- If facts missing, ASK clarifying questions instead of guessing
- Citations tracked internally even if not spoken

### 3. Interruption is Natural
- User speech MUST stop assistant audio immediately
- Barge-in is not rude - it's conversational
- System must be ready to resume or change direction

### 4. Progressive Disclosure
- Lane A provides immediate feedback ("I hear you...")
- Lane B delivers substantive answer when ready
- Never leave user in silence

## Lane Behavior Guidelines

### Lane A: Reflex
**Purpose:** Protect trust while Lane B works

**Allowed:**
- "I hear you"
- "One moment"
- "Let me check that"
- Neutral backchannel sounds

**NEVER:**
- Make factual claims
- Promise specific outcomes
- Provide answers
- Use complex sentences

### Lane B: Reasoned
**Purpose:** Substantive, grounded response

**Required:**
- Use RAG snippets for company facts
- Honor PolicyGate decisions
- Support cancellation at any point
- Include internal citations

**Pattern:**
```
1. Retrieve relevant facts
2. Build response with grounding
3. Stream audio while checking policy
4. Be ready to cancel if policy override
```

### Lane C: Control
**Purpose:** Govern Lane B, never answer directly

**Responsibilities:**
- Classify policy risk (allow/rewrite/refuse/escalate)
- Check claims against AllowedClaimsRegistry
- Redact PII if configured
- Emit audit events

**Never:**
- Generate user-facing responses
- Block on retrieval (parallel processing)

## Audio Quality

### Voice Characteristics
- Natural, conversational prosody
- Appropriate pacing (not too fast/slow)
- Clear articulation
- Emotional neutrality unless context demands otherwise

### Audio Format
- Sample rate: 24kHz minimum
- Format: PCM 16-bit or Opus
- Chunk size: Optimize for latency (50-100ms chunks)

## Error Handling

### Connection Loss
- Client: Display connection status
- Client: Buffer microphone input during reconnect
- Server: Preserve session state for 30s

### Provider Errors
- Fallback to safe response ("I'm having trouble...")
- Log error without exposing internal details
- Offer alternative ("Would you like to try text instead?")

### Policy Violations
- Lane C triggers safe fallback
- Options: ask clarifying question, refuse politely, escalate to human
- Never reveal internal policy logic to user

## Observable Metrics

### Real-time
- Current lane owner
- Transcript confidence
- Policy decision status
- Latency markers

### Aggregate
- p50/p95/p99 for TTFB, turn latency, barge-in stop
- Policy decision rates
- Fallback rates
- RAG hit rate

## Testing Voice UX

### Subjective Tests
- Does it feel responsive?
- Can I interrupt naturally?
- Do I trust the answers?
- Is the voice pleasant?

### Objective Tests
- Latency within targets
- Barge-in consistently <250ms
- No factual hallucinations
- Policy violations caught

## Common Pitfalls

1. **Over-talking:** Lane A too chatty while thinking
2. **Late cancellation:** Barge-in detection too slow
3. **Fact invention:** Lane B makes claims without RAG
4. **Policy bypass:** Lane C doesn't enforce decisions
5. **Dead air:** Silence longer than 1 second
