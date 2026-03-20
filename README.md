# Voice Jib-Jab: NextGen AI Voice Orchestrator

A production voice agent runtime focused on eliminating the two things that kill enterprise voice deployments: **bad latency** and **ungoverned output**. Browser-based speech-to-speech assistant with lane-based orchestration, async policy enforcement, and retrieval-augmented generation.

**Status:** 24/25 initiatives SHIPPED + 1 BUILDING | 3,746 server tests | 92%+ coverage

## Architecture

### Three-Lane System

Voice Jib-Jab processes every utterance through three parallel lanes:

- **Lane A (Reflex):** Instant backchannel audio and short acknowledgements (<50ms)
- **Lane B (Reasoned):** Streaming intelligent responses with RAG grounding via ChromaDB
- **Lane C (Control):** Parallel async policy enforcement -- moderation, PII redaction, claims verification, OPA declarative rules, audit trail

### System Components

```
                         +------------------+
                         |   Browser / SIP  |
                         +--------+---------+
                                  |
                      WebSocket / SIP Bridge
                                  |
                    +-------------v--------------+
                    |     Session Orchestrator    |
                    |  (tenant-isolated context)  |
                    +---+--------+--------+------+
                        |        |        |
                  Lane A    Lane B    Lane C
                 (Reflex)  (Reason)  (Control)
                    |        |        |
                    |   ChromaDB   OPA WASM
                    |   Vector     Policy
                    |   Store      Engine
                    +--------+--------+
                             |
                    +--------v--------+
                    |   Admin API /   |
                    |   Monitoring /  |
                    |   Webhooks      |
                    +-----------------+
```

**Interfaces:** WebSocket (browser), SIP telephony adapter (N-11, building)
**Policy Engine:** OPA WASM -- sub-1ms in-process evaluation, no sidecar
**Vector Store:** ChromaDB -- collection-per-tenant namespace isolation
**Admin API:** Tenant CRUD, runtime config, webhook voice triggers
**Session Recording:** Full session capture with replay endpoint for compliance audits
**Multi-Tenant Isolation:** Per-tenant claims registries, OPA policy data, and vector store collections

### Lane C -- Async Governance Pipeline

Lane C runs in parallel with Lane B, never blocking audio. The policy check chain is fully async:

- `PolicyCheck.evaluate()` returns `Promise<CheckResult>` -- enables dense embedding inference without latency penalty
- `OpaClaimsCheck` routes through dense embedding similarity (`AllowedClaimsRegistry.getEmbeddingSimilarityScore()`) when the model is initialized, falling back to TF-IDF at runtime
- `ControlEngine.initialize()` wires both OPA WASM and the dense embedding model at startup

### Tech Stack

**Client:** React 18 + TypeScript + Vite
**Server:** Node.js 20 + TypeScript + Express + WebSocket
**Voice Provider:** OpenAI Realtime API (pluggable)
**Policy Engine:** OPA WASM + dense embeddings (all-MiniLM-L6-v2 ONNX, 22MB)
**Vector Store:** ChromaDB (collection-per-tenant)
**Deployment:** Docker + docker-compose

## Enterprise Features

### Multi-Tenant Isolation (N-13)
- Per-tenant `AllowedClaimsRegistry` via `TenantClaimsLoader` -- isolated claim sets, zero cross-tenant leakage
- OPA input namespace isolation -- per-tenant moderation thresholds via `OpaEvaluator.setTenantPolicyData()`
- ChromaDB collection-per-tenant -- `knowledge_{tenantId}` collections via `TenantVectorStoreFactory`
- Full E2E verified: `MultiTenantE2E.test.ts` (24 tests, dual-tenant, all 3 phases)

### Governance Engine (N-14, N-15)
- OPA WASM policy evaluation -- sub-1ms, in-process, no sidecar
- Two-tier moderation: pattern engine (Tier 1, <0.5ms) + OPA threshold (Tier 2)
- Dense embedding claims matching via `all-MiniLM-L6-v2` ONNX (22MB, offline)
- 7 moderation categories: JAILBREAK, SELF_HARM, VIOLENCE_THREATS, HATE_SPEECH, ILLEGAL_ACTIVITY, EXPLICIT_CONTENT, HARASSMENT

### Ticketing Integration (N-12)
- Fire-and-forget escalation tickets via `GitHubIssuesMcpClient` (`@modelcontextprotocol/sdk`)
- `TicketingClient` interface reusable for Linear, Jira, ServiceNow
- Zero latency impact: ticket creation void-launched from `evaluate()`

### Session Recording + Replay
- Full session event capture (`/sessions`, `/sessions/:id`, `/sessions/:id/replay`)
- Compliance-ready audit trail with immutable timestamps
- Replay endpoint for post-session review

### Admin API
- Tenant CRUD (`/admin/tenants`) -- create, list, get, update, delete
- Runtime configuration (`/admin/config`) -- read and update
- Webhook voice triggers (`/voice/trigger`) -- programmatic session initiation

### Monitoring Dashboard
- Real-time metrics (`/metrics`) -- TTFB, policy decisions, session counts
- Dashboard view (`/dashboard`) -- aggregated system health
- Health and status endpoints (`/health`, `/status`)

### SIP Telephony (N-11 -- BUILDING)
- `SipTelephonyAdapter` interface + `StubSipTelephonyAdapter` prototype
- `SipBridgeService` wires inbound SIP calls to existing Lane A/B/C pipeline
- Phase 2 (real SIP.js adapter + G.711 codec) pending

### WebSocket Client SDK
- `VjjClient` -- typed WebSocket client for programmatic integration
- Event-driven API for session management and voice control

## API Surface

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | System status |
| `/metrics` | GET | Runtime metrics (TTFB, decisions, sessions) |
| `/dashboard` | GET | Aggregated monitoring dashboard |
| `/sessions` | GET | List recorded sessions |
| `/sessions/:id` | GET | Get session details |
| `/sessions/:id/replay` | GET | Replay session for audit |
| `/admin/tenants` | CRUD | Tenant management (POST, GET, PUT, DELETE) |
| `/admin/config` | GET/PUT | Runtime configuration |
| `/voice/trigger` | POST | Webhook-triggered voice session |
| `/voice/triggers` | GET | List active triggers |
| `/voice/triggers/:id` | GET | Get trigger status |
| `/voice/triggers/:id/complete` | POST | Mark trigger complete |

## Performance

| Metric | Value |
|--------|-------|
| TTFB p50 | <200ms |
| TTFB p95 | <400ms (load test: 126.7ms at 200 concurrent sessions) |
| Barge-in stop | <250ms |
| OPA policy eval | <1ms (WASM in-process) |
| Tenant registry lookup | <0.1ms (O(1) Map) |
| Fire-and-forget ticket overhead | 0ms |

## Quality

| Metric | Value |
|--------|-------|
| Test suite | 2,669 (2,590 server + 79 client), 0 failures |
| Statement coverage | 91%+ |
| Branch coverage | 81%+ |
| Coverage floor (enforced) | stmt 88 / branch 78 / fn 87 / lines 88 |
| Roadmap initiatives | 14 SHIPPED + 1 BUILDING |
| API endpoints | 18 routes across 8 path groups |
| Mutation testing | Stryker baseline (PolicyGate, AllowedClaimsRegistry, LaneArbitrator) |

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

### Docker

```bash
docker-compose up
```

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
│       ├── api/      # HTTP endpoints (admin, sessions, voice)
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

## Initiatives

| ID | Initiative | Status |
|----|-----------|--------|
| N-01 | Voice Loop MVP | SHIPPED |
| N-02 | Lane Arbitration System | SHIPPED |
| N-03 | Audio Buffer Race Fix | SHIPPED |
| N-04 | State Machine Resilience | SHIPPED |
| N-05 | Persistent Memory (ChromaDB) | SHIPPED |
| N-06 | Enterprise UI Transformation | SHIPPED |
| N-07 | Lane C Control Plane v1 | SHIPPED |
| N-08 | Knowledge Pack Retrieval | SHIPPED |
| N-09 | Unit Test Coverage (14% to 91%) | SHIPPED |
| N-10 | Production Readiness QA | SHIPPED |
| N-11 | SIP Telephony | BUILDING |
| N-12 | Ticketing Integration (MCP) | SHIPPED |
| N-13 | Multi-Tenant Isolation | SHIPPED |
| N-14 | Lane C v2: Semantic Governance | SHIPPED |
| N-15 | Dense Embedding Similarity | SHIPPED |
| N-16 | Call Routing + Queue System | SHIPPED |
| N-17 | Voice Agent Marketplace | SHIPPED |
| N-18 | Voice Biometrics — Caller ID | SHIPPED |
| N-19 | Custom TTS Voices + A/B Testing | SHIPPED |
| N-20 | Agent Personas — Per-Tenant Personality | SHIPPED |
| N-21 | Voice Agent React SDK | SHIPPED |
| N-22 | Conversation Flow Builder | SHIPPED |
| N-23 | Real-Time Translation Pipeline | SHIPPED |
| N-24 | Intent Detection — Smart Caller Routing | SHIPPED |
| N-25 | Voice Pipeline Profiler | SHIPPED |

## Documentation

- [Project Spec](docs/PROJECT-SPEC.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Demo Guide](DEMO-GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Voice UX Principles](.claude/skills/domain/voice-ux.md)
- [Lane System Architecture](.claude/skills/domain/lane-system.md)

## License

MIT
