# Voice Jib-Jab Gap Analysis

**Date:** 2026-01-10
**Compared Against:** `docs/PROJECT-SPEC.md` and `spec-jib-jab.md`

---

## Executive Summary

The project has a solid foundation for Milestones 1 and 2, but the user's concern about **"no persistent memory"** is valid. The OpenAI Realtime API maintains conversation context within a single WebSocket session, but there is:

1. **No cross-session conversation persistence** - When the user disconnects and reconnects, all context is lost
2. **No server-side conversation history storage** - Transcripts are emitted to EventBus but never persisted
3. **Milestone 3 (Control Plane) is NOT implemented** - Only stubs exist
4. **Milestone 4 (RAG Integration) is NOT implemented** - Knowledge files exist but are unused

---

## Implementation Status Table

### Milestone 1: Voice Loop MVP

| Feature                    | Status  | Notes                                                        |
| -------------------------- | ------- | ------------------------------------------------------------ |
| Browser mic capture        | ✅ Done | `MicrophoneCapture.ts` - Float32 to PCM16 conversion working |
| Provider adapter connected | ✅ Done | `OpenAIRealtimeAdapter.ts` - Full WebSocket implementation   |
| Streaming audio playback   | ✅ Done | `AudioPlayback.ts` - Web Audio API with queue management     |
| Basic barge-in             | ✅ Done | `user.barge_in` message handling, audio stops immediately    |
| TTFB/Latency metrics       | ✅ Done | `LatencyBudget.ts` - p50/p95/p99 calculations                |

**Milestone 1: COMPLETE**

---

### Milestone 2: Lane Arbitration

| Feature                      | Status  | Notes                                                              |
| ---------------------------- | ------- | ------------------------------------------------------------------ |
| Lane A reflex implementation | ✅ Done | `LaneA.ts` - TTS audio cache, whitelist phrases                    |
| Lane B reasoning wrapper     | ✅ Done | `LaneB.ts` - Wraps OpenAI adapter with first-audio detection       |
| Lane B preemption            | ✅ Done | `LaneArbitrator.ts` - B preempts A on `b_first_audio_ready`        |
| State machine validation     | ✅ Done | States: IDLE, LISTENING, A_PLAYING, B_RESPONDING, B_PLAYING, ENDED |
| No audio overlap             | ✅ Done | Single audio owner enforced via arbitrator                         |

**Milestone 2: COMPLETE**

---

### Milestone 3: Control Plane (Lane C)

| Feature                    | Status     | Notes                                        |
| -------------------------- | ---------- | -------------------------------------------- |
| Transcript collection      | 🔶 Partial | Events emitted to EventBus but NOT persisted |
| PolicyGate stub            | ❌ Missing | Config flag exists, NO implementation        |
| Moderator (allow/refuse)   | ❌ Missing | Not implemented                              |
| ClaimsChecker              | ❌ Missing | Not implemented                              |
| PIIRedactor                | ❌ Missing | Not implemented                              |
| OverrideController         | ❌ Missing | Not implemented                              |
| Audit timeline             | ❌ Missing | No persistence layer                         |
| AuditTrail module          | ❌ Missing | Not created                                  |
| FallbackPlanner            | ❌ Missing | Not created                                  |
| Policy cancel stops Lane B | ❌ Missing | Lane C doesn't exist to trigger              |

**Milestone 3: NOT STARTED (0% complete)**

---

### Milestone 4: RAG Integration

| Feature                   | Status     | Notes                                         |
| ------------------------- | ---------- | --------------------------------------------- |
| NextGen AI Knowledge Pack | 🔶 Partial | `knowledge/nxtg_facts.jsonl` exists (5 facts) |
| Vector store integration  | ❌ Missing | `/server/src/retrieval/` is empty             |
| Retrieval tool definition | ❌ Missing | Tool schemas defined, no implementation       |
| Facts pack injection      | ❌ Missing | No RAG pipeline                               |
| retrieve_nxtg_facts tool  | ❌ Missing | Not implemented                               |
| lookup_disclaimer tool    | ❌ Missing | Not implemented                               |
| Grounded responses        | ❌ Missing | Responses NOT using knowledge pack            |

**Milestone 4: 10% complete (data files only)**

---

### Insurance Modules

| Module                | Status     | File Path                                                 |
| --------------------- | ---------- | --------------------------------------------------------- |
| LatencyBudget         | ✅ Done    | `/server/src/insurance/LatencyBudget.ts`                  |
| PolicyGate            | ❌ Missing | Not created                                               |
| AllowedClaimsRegistry | ❌ Missing | Data exists in `knowledge/allowed_claims.json`, no loader |
| AuditTrail            | ❌ Missing | Not created                                               |
| FallbackPlanner       | ❌ Missing | Not created                                               |

---

## Critical Gap: Persistent Memory / Conversation Context

### What the User Reported

> "There is no persistent memory with this voice chat"

### Root Cause Analysis

1. **Within-Session Memory: Works (via OpenAI)**
   - OpenAI Realtime API maintains conversation context during a single WebSocket connection
   - The session includes conversation turns automatically

2. **Cross-Session Memory: Does NOT Work**
   - When WebSocket closes, OpenAI session ends
   - No server-side transcript storage
   - No conversation history database
   - On reconnect, AI has zero memory of previous conversations

3. **Missing Components for Memory:**

   | Component              | Purpose                       | Status     |
   | ---------------------- | ----------------------------- | ---------- |
   | Transcript persistence | Store user/assistant text     | ❌ Missing |
   | Session history DB     | PostgreSQL/SQLite for history | ❌ Missing |
   | Context injection      | Add history to system prompt  | ❌ Missing |
   | Summary generation     | Compress old conversations    | ❌ Missing |

### Evidence from Code

```typescript
// SessionManager.ts - Session data is in-memory only
private sessions: Map<string, Session>;  // Lost on server restart

// EventBus.ts - Events are emitted but never persisted
emit(event: Event): void {
  this.emitter.emit(event.type, event);  // No storage
}

// websocket.ts - Transcripts forwarded to client, not stored
laneB.on("transcript", (segment) => {
  this.sendToClient(ws, { type: "transcript", ... });  // Gone after send
});
```

---

## Priority Ranking for Missing Features

### Priority 1: Critical (Blocks User Experience)

| Feature                          | Impact                              | Effort |
| -------------------------------- | ----------------------------------- | ------ |
| Conversation History Persistence | User expects memory across sessions | Medium |
| Transcript Storage (AuditTrail)  | Required for history + compliance   | Medium |
| Context Injection on Reconnect   | Resume conversations naturally      | Low    |

### Priority 2: High (Core Spec Compliance)

| Feature         | Impact                                | Effort |
| --------------- | ------------------------------------- | ------ |
| RAG Integration | Grounded responses, knowledge queries | High   |
| PolicyGate      | Safety controls                       | Medium |
| FallbackPlanner | Graceful error handling               | Low    |

### Priority 3: Medium (Production Readiness)

| Feature                      | Impact                  | Effort |
| ---------------------------- | ----------------------- | ------ |
| PIIRedactor                  | Privacy compliance      | Medium |
| ClaimsChecker                | Prevent false claims    | Medium |
| AllowedClaimsRegistry loader | Use existing data files | Low    |

### Priority 4: Low (Nice to Have)

| Feature                      | Impact                | Effort    |
| ---------------------------- | --------------------- | --------- |
| Full observability dashboard | Metrics visualization | High      |
| Multi-agent workflows        | Future feature        | Very High |

---

## Files/Modules That Need Work

### New Files Required

```
/server/src/
  ├── insurance/
  │   ├── PolicyGate.ts         # Decision engine
  │   ├── AuditTrail.ts         # Append-only event log
  │   ├── FallbackPlanner.ts    # Safe fallback strategies
  │   └── index.ts              # Module exports
  ├── lanes/
  │   └── LaneC.ts              # Control engine
  ├── retrieval/
  │   ├── VectorStore.ts        # ChromaDB/Pinecone client
  │   ├── KnowledgePack.ts      # Load and query facts
  │   └── RAGPipeline.ts        # Orchestrate retrieval
  └── storage/
      ├── TranscriptStore.ts    # Persist transcripts
      ├── SessionHistory.ts     # Cross-session memory
      └── Database.ts           # SQLite/PostgreSQL adapter
```

### Existing Files Needing Modification

| File                         | Changes Needed                              |
| ---------------------------- | ------------------------------------------- |
| `websocket.ts`               | Add Lane C integration, persist transcripts |
| `LaneB.ts`                   | Add RAG injection before responses          |
| `SessionManager.ts` (server) | Add history retrieval on session create     |
| `OpenAIRealtimeAdapter.ts`   | Add context injection to system prompt      |
| `config/index.ts`            | Add database config, RAG settings           |

---

## Recommendations for Next Steps

### Immediate: Fix "No Memory" Issue

1. **Create `/server/src/storage/TranscriptStore.ts`**
   - SQLite for simplicity (file-based, no setup)
   - Store: session_id, timestamp, role (user/assistant), text

2. **Create `/server/src/storage/SessionHistory.ts`**
   - Track user identity (via client fingerprint or token)
   - Retrieve last N turns on session start

3. **Modify `OpenAIRealtimeAdapter.createSession()`**
   - Inject conversation summary into `instructions` field
   - Example: "Previous conversation summary: [User asked about X, you explained Y]"

### Short-term: Milestone 3 Implementation

1. Create `LaneC.ts` - Control engine skeleton
2. Create `AuditTrail.ts` - JSONL file append for now
3. Wire transcript events to AuditTrail
4. Implement basic PolicyGate (pattern matching)

### Medium-term: Milestone 4 Implementation

1. Set up ChromaDB locally (Docker)
2. Create `VectorStore.ts` adapter
3. Index knowledge pack on startup
4. Add `retrieve_nxtg_facts` tool to OpenAI session
5. Inject RAG results into Lane B prompts

---

## Architecture Diagram: Current vs. Spec

### Current State

```
Client ──WebSocket──> Orchestrator ──> OpenAI Realtime
                           │
                      EventBus (in-memory)
                           │
                    Lane A ─── Lane B
                         (No Lane C)
                         (No Storage)
                         (No RAG)
```

### Target State (Per Spec)

```
Client ──WebSocket──> Orchestrator ──> OpenAI Realtime
                           │
                      EventBus ──> AuditTrail (persistent)
                           │
    Lane A ─── Lane B ─── Lane C (PolicyGate, Claims, PII)
                 │
           RAG Pipeline ──> VectorStore ──> Knowledge Pack
```

---

## Conclusion

The voice loop and lane arbitration are solid (Milestones 1-2). However, the project is missing critical components for a production-ready voice assistant:

1. **Memory/Persistence** - The #1 user complaint; no conversation history across sessions
2. **Control Plane** - Lane C is completely unimplemented
3. **RAG** - Knowledge files exist but aren't used

**Recommended Priority:**

1. Fix memory issue first (highest user impact)
2. Add RAG for grounded responses
3. Implement Lane C for safety/compliance
