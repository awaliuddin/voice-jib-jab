# Voice Jib-Jab: NextGen AI Voice Orchestrator

A production voice agent runtime focused on eliminating the two things that kill enterprise voice deployments: **bad latency** and **ungoverned output**. Browser-based speech-to-speech assistant with lane-based orchestration, async policy enforcement, and retrieval-augmented generation.

**Status:** 17/17 initiatives SHIPPED + 1 BUILDING | 2,533 server + 79 client tests | 91%+ coverage

## Architecture

### Three-Lane System

- **Lane A (Reflex):** Instant backchannel audio and short acknowledgements (<50ms)
- **Lane B (Reasoned):** Streaming intelligent responses with RAG grounding
- **Lane C (Control):** Parallel async policy enforcement — moderation, PII redaction, claims verification, OPA declarative rules, audit trail

### Lane C — Async Governance Pipeline

Lane C runs in parallel with Lane B, never blocking audio. As of N-15 (2026-03-17), the policy check chain is fully async:

- `PolicyCheck.evaluate()` → `Promise<CheckResult>` — enables dense embedding inference without latency penalty
- `OpaClaimsCheck` routes through dense embedding similarity (`AllowedClaimsRegistry.getEmbeddingSimilarityScore()`) when the model is initialized, falling back to TF-IDF at runtime
- `ControlEngine.initialize()` wires both OPA WASM and the dense embedding model at startup

### Tech Stack

**Client:** React 18 + TypeScript + Vite
**Server:** Node.js 20 + TypeScript + Express + WebSocket
**Voice Provider:** OpenAI Realtime API (pluggable)
**Vector Store:** ChromaDB
**Real-time:** WebSocket

## Enterprise Features

### Multi-Tenant Isolation (N-13)
- Per-tenant `AllowedClaimsRegistry` via `TenantClaimsLoader` — isolated claim sets, zero cross-tenant leakage
- OPA input namespace isolation — per-tenant moderation thresholds via `OpaEvaluator.setTenantPolicyData()`
- ChromaDB collection-per-tenant — `knowledge_{tenantId}` collections via `TenantVectorStoreFactory`
- Full E2E verified: `MultiTenantE2E.test.ts` (24 tests, dual-tenant, all 3 phases)

### Ticketing Integration (N-12)
- Fire-and-forget escalation tickets via `GitHubIssuesMcpClient` (`@modelcontextprotocol/sdk`)
- `TicketingClient` interface reusable for Linear, Jira, ServiceNow
- Zero latency impact: ticket creation void-launched from `evaluate()`

### Governance Engine (N-14)
- OPA WASM policy evaluation — sub-1ms, in-process, no sidecar
- Two-tier moderation: pattern engine (Tier 1, <0.5ms) + OPA threshold (Tier 2)
- Dense embedding claims matching via `all-MiniLM-L6-v2` ONNX (22MB, offline)
- 7 moderation categories: JAILBREAK, SELF_HARM, VIOLENCE_THREATS, HATE_SPEECH, ILLEGAL_ACTIVITY, EXPLICIT_CONTENT, HARASSMENT

### SIP Telephony (N-11 — BUILDING)
- `SipTelephonyAdapter` interface + `StubSipTelephonyAdapter` prototype
- `SipBridgeService` wires inbound SIP calls to existing Lane A/B/C pipeline
- Phase 2 (real SIP.js adapter + G.711 codec) pending

## Performance

| Metric | Value |
|--------|-------|
| TTFB p50 | <200ms |
| TTFB p95 | <400ms (load test: 126.7ms at 200 concurrent sessions) |
| Barge-in stop | <250ms |
| OPA policy eval | <1ms (WASM in-process) |
| Tenant registry lookup | <0.1ms (O(1) Map) |
| Fire-and-forget ticket overhead | 0ms |
| Test suite | 2,612 tests (2,533 server + 79 client), 0 failures |
| Server coverage | >91% lines |

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- OpenAI API key

### Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start development servers
npm run dev
```

This starts:
- Client on http://localhost:5173
- Server on http://localhost:3000

### Project Structure

```
voice-jib-jab/
├── client/           # React browser application
│   └── src/
│       ├── audio/    # Mic capture, playback
│       ├── ui/       # UI components
│       ├── state/    # State management
│       └── events/   # Event handling
├── server/           # Node.js orchestrator
│   └── src/
│       ├── api/      # HTTP endpoints
│       ├── orchestrator/  # Session manager, event bus
│       ├── lanes/    # Lane A, B, C implementations
│       ├── providers/     # Voice provider adapters
│       ├── retrieval/     # RAG and vector store
│       ├── insurance/     # PolicyGate, audit, etc.
│       └── schemas/  # Event schemas
├── knowledge/        # NextGen AI knowledge pack
├── docs/            # Documentation
└── .claude/         # NXTG-Forge configuration
```

## Development

### NXTG-Forge Commands

```bash
/status           # View project state
/enable-forge     # Activate forge orchestrator
/feature "name"   # Add new feature
/report           # View session activity
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Linting

```bash
npm run lint
npm run format
```

## Quality

| Metric | Value |
|--------|-------|
| Test count | 2,612 (2,533 server + 79 client) |
| Statement coverage | 91%+ |
| Branch coverage | 81%+ |
| Coverage floor (enforced) | stmt 88 / branch 78 / fn 87 / lines 88 |
| Roadmap initiatives SHIPPED | 17/17 + 1 BUILDING |
| Mutation testing | Stryker baseline established (PolicyGate, AllowedClaimsRegistry, LaneArbitrator) |

## Documentation

- [Project Spec](docs/PROJECT-SPEC.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Contributing](CONTRIBUTING.md)
- [Demo Guide](DEMO-GUIDE.md)
- [Voice UX Principles](.claude/skills/domain/voice-ux.md)
- [Lane System Architecture](.claude/skills/domain/lane-system.md)

## License

MIT
