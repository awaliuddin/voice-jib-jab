# Voice Jib-Jab: NextGen AI Voice Orchestrator

**Version:** 1.0.0
**Project Type:** Browser-first voice assistant
**Architecture:** Lane-based orchestrator with RAG

## Overview

Voice Jib-Jab is a browser-based speech-to-speech voice assistant featuring a sophisticated lane-based orchestration system that ensures responsive, natural conversations with built-in safety controls and retrieval-augmented generation.

## Architecture

### Three-Lane System

**Lane A (Reflex):** Instant backchannel audio and short acknowledgements
**Lane B (Reasoned):** Streaming intelligent responses with RAG grounding
**Lane C (Control):** Parallel policy enforcement, moderation, audit

### Tech Stack

#### Client (Browser)
- Framework: React 18+ with Vite
- Language: TypeScript 5+
- Audio: Web Audio API, MediaRecorder API
- Transport: WebSocket for real-time
- UI: Minimal with debug overlay

#### Server (Orchestrator)
- Runtime: Node.js 20+
- Framework: Express with WebSocket (ws)
- Language: TypeScript 5+
- Voice Provider: OpenAI Realtime API (pluggable adapter pattern)
- Vector Store: ChromaDB or Pinecone
- Event Bus: In-memory (Redis optional for scale)

#### Infrastructure
- Containerization: Docker + Docker Compose
- CI/CD: GitHub Actions
- Monitoring: Structured JSON logs
- Metrics: Custom latency tracking

## Core Modules

### Server Modules

1. **Orchestrator Core** (`/server/src/orchestrator`)
   - Session lifecycle management
   - Lane arbitration state machine
   - Event bus coordination

2. **Lane A: ReflexEngine** (`/server/src/lanes/laneA_reflex.ts`)
   - Whitelist-based acknowledgements
   - No factual claims
   - Instant cancellation support

3. **Lane B: ReasoningEngine** (`/server/src/lanes/laneB_reasoning.ts`)
   - RAG retrieval integration
   - Tool call execution
   - Streaming response management
   - Citation tracking

4. **Lane C: ControlEngine** (`/server/src/lanes/laneC_control.ts`)
   - PolicyGate: allow/refuse/rewrite/escalate
   - ClaimsChecker: validate against AllowedClaimsRegistry
   - PIIRedactor: scrub sensitive data
   - OverrideController: cancel and fallback

5. **Provider Adapter** (`/server/src/providers`)
   - Abstract interface for voice providers
   - OpenAI Realtime implementation
   - Support for cancellation and barge-in

6. **Insurance Modules** (`/server/src/insurance`)
   - `policy_gate.ts`: Policy decision engine
   - `allowed_claims_registry.ts`: Approved facts database
   - `audit_trail.ts`: Append-only event log
   - `latency_budget.ts`: Performance tracking
   - `fallback_planner.ts`: Safe fallback strategies

### Client Modules

1. **Audio Capture** (`/client/src/audio`)
   - Microphone access
   - Audio chunk streaming
   - Playback control

2. **UI Components** (`/client/src/ui`)
   - Talk button
   - Debug overlay (latency, state, policy flags)

3. **State Management** (`/client/src/state`)
   - Session state
   - Connection status
   - Audio playback queue

4. **Event Handling** (`/client/src/events`)
   - Client-side event emitter
   - Server message handling

## Data Contracts

### Event Schema
```typescript
interface Event {
  event_id: string;
  session_id: string;
  t_ms: number;
  source: 'client' | 'orchestrator' | 'laneA' | 'laneB' | 'laneC' | 'provider' | 'retriever';
  type: string;
  payload: unknown;
}
```

### Key Event Types
- `transcript.delta` / `transcript.final`
- `policy.decision`
- `lane.owner_changed`
- `audio.chunk`
- `tool.call` / `tool.result`

## Performance Targets

- **TTFB p50:** <400ms, p95: <900ms
- **Barge-in stop p95:** <250ms
- **Turn latency p95:** <1200ms

## Development Phases

### Milestone 1: Voice Loop MVP
- [ ] Browser mic capture
- [ ] Provider adapter connected
- [ ] Streaming audio playback
- [ ] Basic barge-in

### Milestone 2: Lane Arbitration
- [ ] Lane A reflex implementation
- [ ] Lane B preemption
- [ ] State machine validation

### Milestone 3: Control Plane
- [ ] Transcript collection
- [ ] PolicyGate stub
- [ ] Audit timeline

### Milestone 4: RAG Integration
- [ ] NextGen AI Knowledge Pack
- [ ] Retrieval tool
- [ ] Facts pack injection

## Quality Standards

- Test Coverage: 85% minimum
- TypeScript: Strict mode
- Linting: ESLint + Prettier
- Documentation: TSDoc for all public APIs

## Safety & Compliance

- Server-controlled system instructions
- Rate limiting per client
- PII redaction configurable
- Raw audio storage disabled by default
- Audit trail for all sessions
