# Voice Jib-Jab: NextGen AI Voice Orchestrator

A production voice agent runtime that eliminates the two things that kill enterprise voice deployments: **bad latency** and **ungoverned output**. Browser-based and SIP-ready speech-to-speech assistant with three-lane orchestration, async policy enforcement, retrieval-augmented generation, and a full enterprise feature stack.

**Status:** 41/41 initiatives SHIPPED | 4,265 server tests | 92%+ coverage

---

## Architecture

### Three-Lane System

Every utterance is processed through three parallel lanes simultaneously:

- **Lane A (Reflex):** Instant backchannel audio and short acknowledgements (<50ms). Keeps the conversation feeling alive while Lane B thinks.
- **Lane B (Reasoned):** Streaming intelligent responses grounded by RAG via ChromaDB vector search, conversation memory, and agent persona injection.
- **Lane C (Control):** Fully async policy enforcement — moderation, PII redaction, claims verification, OPA declarative rules, escalation ticketing, audit trail. Never blocks audio.

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

**Voice I/O:** WebSocket (browser), SIP telephony adapter (building)
**Policy Engine:** OPA WASM — sub-1ms in-process evaluation, no sidecar
**Vector Store:** ChromaDB — collection-per-tenant namespace isolation
**TTS:** KokoroVoiceEngine — pluggable, supports A/B testing across voice profiles
**Memory:** Cross-session conversation memory with ChromaDB-backed recall

---

## Feature Stack

### Multi-Tenant Isolation

Every tenant runs in a fully isolated context — zero cross-tenant data leakage:

- **Claims isolation:** `TenantClaimsLoader` loads per-tenant allowed claims registries. `AllowedClaimsRegistry` instances are tenant-scoped; OPA input data is namespaced by tenant ID.
- **Vector store isolation:** `TenantVectorStoreFactory` creates `knowledge_{tenantId}` ChromaDB collections. No shared collection, no collection-scan risk.
- **Policy isolation:** `OpaEvaluator.setTenantPolicyData()` injects per-tenant moderation thresholds into OPA data document before each evaluation.
- **Memory isolation:** `ConversationMemoryStore` scoped to `(tenantId, sessionId)` — no cross-tenant recall possible.
- **Verified:** `MultiTenantE2E.test.ts` — 24 tests, dual-tenant, full pipeline, all 3 phases.

```typescript
// Per-tenant initialization
const engine = new ControlEngine({
  tenantId: "acme-corp",
  opaEvaluator: sharedWasmInstance,
  ticketingClient: githubClient,        // optional escalation sink
});
await engine.initialize();  // loads tenant claims + OPA data
```

---

### Lane C — Async Governance Pipeline

Policy enforcement runs in parallel with audio generation — never blocks TTFB:

- **Two-tier moderation:** Pattern engine (Tier 1, <0.5ms, 7 categories) → OPA threshold check (Tier 2, <1ms WASM)
- **7 moderation categories:** JAILBREAK, SELF_HARM, VIOLENCE_THREATS, HATE_SPEECH, ILLEGAL_ACTIVITY, EXPLICIT_CONTENT, HARASSMENT
- **Dense embedding claims matching:** `all-MiniLM-L6-v2` ONNX (22MB, offline) via `AllowedClaimsRegistry.getEmbeddingSimilarityScore()` — handles paraphrasing that TF-IDF misses
- **OPA claims check:** `OpaClaimsCheck` routes through embedding similarity score → Rego threshold rule → `CheckResult`
- **Decision hierarchy:** `cancel_output` > `escalate` > `refuse` > `rewrite` > `allow`
- **Audit trail:** Every evaluation produces an immutable timestamped record

```
PolicyGate.evaluate()
  → Tier 1: pattern scan (<0.5ms)
  → Tier 2: OPA WASM claims + moderation (< 1ms)
  → decision: allow | rewrite | refuse | escalate | cancel_output
  → audit event emitted (async, never blocks)
```

---

### Ticketing Integration (MCP)

When Lane C decides `escalate`, a GitHub issue is created automatically — zero latency impact via fire-and-forget:

```typescript
// Fire-and-forget: evaluate() resolves before ticket creation settles
void this.createEscalationTicket(ctx, result, evaluationId);

// Ticket payload
{
  title: "Voice Escalation: JAILBREAK, HARASSMENT",
  sessionId: "sess_abc123",
  severity: 4,
  reasonCodes: ["JAILBREAK", "HARASSMENT"],
  transcriptExcerpt: "first 200 chars...",
  customerContext: { tenantId: "acme-corp" }
}
```

- **Provider:** `GitHubIssuesMcpClient` via `@modelcontextprotocol/sdk` + `StdioClientTransport`
- **Interface:** `TicketingClient` — reusable for Linear, Jira, ServiceNow
- **Auth:** `GITHUB_PERSONAL_ACCESS_TOKEN` env var
- **Events:** `ticket_created` / `ticket_error` emitted on `ControlEngine`
- **Labels:** `voice-escalation`, `auto-generated` (configurable)

---

### Voice Biometrics — Caller Identification

Enroll voice embeddings and identify callers by voice on every inbound call:

```
POST /voiceprints/enroll     → store voice embedding for a caller
POST /voiceprints/identify   → match against enrolled prints (cosine similarity)
GET  /voiceprints?tenantId=  → list enrolled prints (embeddings stripped from response)
GET  /voiceprints/:id
DELETE /voiceprints/:id
```

- **Algorithm:** Cosine similarity on voice feature vectors
- **Threshold:** Configurable via `VOICEPRINT_IDENTIFY_THRESHOLD` (default: 0.82)
- **Tenant isolation:** All lookups scoped to tenantId
- **Memory enrichment:** On successful identification, caller context is injected into `ConversationMemoryStore` for that session
- **Privacy:** Raw embeddings are never returned in API responses — only metadata

---

### Agent Personas — Per-Tenant Personality

Each tenant can assign a distinct personality that governs the agent's tone and communication style:

```typescript
// 5 built-in personas (immutable)
persona_professional_support   // formal, standard vocabulary, standard length
persona_friendly_helper        // casual, simple vocabulary, brief
persona_technical_expert       // formal, technical vocabulary, detailed
persona_warm_receptionist      // casual, simple vocabulary, standard
persona_compliance_officer     // formal, technical vocabulary, detailed
```

```
POST   /personas                        → create custom persona
GET    /personas                        → list all (built-in + custom)
GET    /personas/:id
PUT    /personas/:id                    → update (built-in personas reject 403)
DELETE /personas/:id

POST   /tenants/:tenantId/persona       → assign persona to tenant
GET    /tenants/:tenantId/persona       → get assigned persona
DELETE /tenants/:tenantId/persona       → unassign
```

**`PersonaConfig` fields:** `name`, `tone` (formal/casual/empathetic), `vocabularyLevel` (simple/standard/technical), `responseLengthPreference` (brief/standard/detailed), `description`, `systemPromptSnippet` (injected into LLM system prompt).

---

### React Voice Agent SDK

Drop a voice agent into any React application in minutes:

```bash
npm install @nxtg/voice-agent-react
```

```tsx
import { VoiceAgent, useVoiceAgent } from "@nxtg/voice-agent-react";

// Component with default UI
<VoiceAgent
  wsUrl="ws://localhost:3000"
  tenantId="acme-corp"
  persona="persona_friendly_helper"
  autoConnect={false}
  onTranscript={(t) => console.log(t)}
  onPolicyEvent={(e) => console.log(e)}
  onStateChange={(s) => console.log(s)}
/>

// Or use the hook for custom UI
const { state, connect, disconnect, transcript, isConnected } = useVoiceAgent({
  wsUrl: "ws://localhost:3000",
  tenantId: "acme-corp",
});
```

- **`useVoiceAgent` hook:** Manages `VoiceClient` lifecycle. Callbacks stable via `optionsRef` — no stale closure issues.
- **State machine:** `idle` → `connecting` → `connected` → `listening` → `speaking` → `disconnected`
- **Events:** `transcript`, `policyEvent`, `stateChange`, `error`
- **Package:** `packages/voice-agent-react/` — TypeScript, fully typed, Vitest test suite

---

### Conversation Memory — Cross-Session Context

Agents remember callers across sessions, enabling continuity in long-running customer relationships:

```
POST /tenants/:tenantId/memory              → store memory entry
GET  /tenants/:tenantId/memory              → list (latest 50)
GET  /tenants/:tenantId/memory/:entryId
DELETE /tenants/:tenantId/memory
DELETE /tenants/:tenantId/memory/:entryId
```

- **Backend:** ChromaDB — vector-indexed for semantic recall
- **Recall at session start:** Top-k similar memories injected into Lane B system prompt
- **Tenant isolation:** Collection-per-tenant, no cross-tenant recall possible
- **Session enrichment:** Successful voice biometrics identification triggers memory lookup by callerId

---

### Intent Detection — Smart Caller Routing

Classify caller intent from the first utterance and route to the right agent template automatically:

```
POST /intents/detect        → { text } → { intent, confidence, detectedAt }
GET  /intents               → list detection logs with frequency counts
GET  /intents/config        → list intent→template mappings
POST /intents/config        → { intent, templateId } → set mapping
DELETE /intents/config/:intent
```

**5 intent categories:** `support`, `billing`, `sales`, `complaint`, `general` (fallback)

```typescript
// Detection result
{
  intent: "billing",
  confidence: 0.74,   // highScore / totalWords, clamped [0,1]
  detectedAt: "2026-03-19T18:40:00Z"
}

// Auto-routing: intent "billing" → templateId "billing-agent-v2"
// POST /intents/config { intent: "billing", templateId: "billing-agent-v2" }
```

- **Algorithm:** Keyword scoring across intent-specific lexicons — zero latency, zero external calls
- **Storage:** JSON-persisted intent logs + mappings via `IntentStore`
- **Frequency analytics:** `GET /intents` returns per-intent call counts for capacity planning

---

### Conversation Flow Builder

Define structured dialog trees and run them as live sessions:

```
POST   /flows                              → create flow
GET    /flows?tenantId=                    → list flows
GET    /flows/:id
PUT    /flows/:id
DELETE /flows/:id
POST   /flows/:id/start                    → start session → { sessionToken, currentNode }
POST   /flows/sessions/:token/advance      → { userInput } → { currentNode, ended }
GET    /flows/sessions/:token              → session state
```

**Node types:** `greeting`, `intent_detection`, `routing`, `response`, `follow_up`, `end`

```typescript
const flow = {
  name: "Support Triage",
  entryNodeId: "greet",
  nodes: [
    { id: "greet", type: "greeting", prompt: "Hello! How can I help?",
      transitions: [{ condition: "billing", nextNodeId: "billing" },
                    { condition: "technical", nextNodeId: "tech" }] },
    { id: "billing", type: "routing", prompt: "Routing to billing...", transitions: [] },
    { id: "tech", type: "routing", prompt: "Routing to tech support...", transitions: [] }
  ]
};
```

- **Execution:** `FlowEngine` — in-memory sessions, case-insensitive substring matching on transitions, first match wins
- **Validation:** Unique node IDs enforced, `entryNodeId` must reference a real node, node type enum checked

---

### Real-Time Translation — Cross-Language Voice Calls

Transparent bilingual voice calls — detect, translate, respond in the caller's language:

```
POST /translation/detect     → { text } → { language, confidence, supported }
POST /translation/translate  → { text, from, to } → { translatedText, provider, latencyMs }
POST /translation/pipeline   → { callerText, agentResponse, agentLanguage?, callerLanguage? }
                             → { callerLanguage, agentLanguage, translatedCallerText,
                                 translatedAgentResponse, latencyMs, translationsPerformed }
```

**Supported pairs:** EN↔ES, EN↔FR, EN↔DE

```typescript
// Full pipeline: Spanish caller, English agent
const result = await service.runPipeline(
  "¿Cuánto cuesta el plan básico?",  // callerText (auto-detected: es)
  "The basic plan is $29/month.",    // agentResponse (English)
);
// → callerLanguage: "es"
// → translatedCallerText: "What does the basic plan cost?"  (for agent)
// → translatedAgentResponse: "El plan básico cuesta $29/mes."  (for caller)
// → translationsPerformed: 2
```

- **Language detection:** `LanguageDetector` — Unicode script analysis + 20-word frequency scoring
- **Provider interface:** `TranslationProvider` — swap in DeepL or Google Translate with one class
- **Latency:** Sub-1ms with stub provider; `latencyMs` field for benchmarking real providers

---

### SIP Telephony (Building)

The full three-lane pipeline is media-source agnostic. SIP Phase 1 is complete:

- `SipTelephonyAdapter` interface + `StubSipTelephonyAdapter` — test harness
- `SipBridgeService` — wires inbound SIP sessions into Lane A/B/C pipeline
- G.711 codec bridge designed; Telnyx/SIP.js adapter pending (Phase 2)

```typescript
// SipBridgeService wires SIP → existing orchestrator
const bridge = new SipBridgeService(sipAdapter, sessionManager);
await bridge.handleInboundCall(callParams);
// → creates session → passes through same Lane A/B/C as WebSocket clients
```

---

### Voice Quality Scoring

Automated post-call quality assessment across 5 dimensions:

```
GET /quality/:sessionId     → QualityScorecard
PUT /quality/config         → { qualityThreshold, webhookUrl }
```

**Scorecard (0–100, grade A/B/C/D/F):**

| Dimension | Weight | Source |
|-----------|--------|--------|
| Policy Compliance | 20pts | Lane C decisions |
| Sentiment Trajectory | 20pts | SentimentTracker |
| Resolution Rate | 20pts | Session summary |
| Response Relevance | 20pts | RAG confidence |
| Latency Adherence | 20pts | TTFB vs target |

When score falls below threshold, a fire-and-forget webhook POST is triggered to `webhookUrl`. Useful for routing low-quality calls to human review queues.

---

### Conversation Playbooks

Scripted response libraries for common scenarios, surfaced at the right moment:

```
POST   /playbooks                    → create entry
GET    /playbooks                    → list (tenantId filter)
GET    /playbooks/suggest?text=      → top-3 keyword-matched entries
PUT    /playbooks/:entryId
DELETE /playbooks/:entryId
```

**Scenario types:** `greeting`, `escalation`, `closing`, `faq`, `custom`

`suggestEntries(text, { tenantId })` — keyword substring match, enabled entries only, sorted by match count, top 3 returned.

---

### IVR Menu System + DTMF Detection

Phone-tree menus with natural-language digit detection:

```
POST /ivr/menus                      → create menu
GET  /ivr/menus
GET  /ivr/menus/:menuId
PUT  /ivr/menus/:menuId
DELETE /ivr/menus/:menuId
POST /ivr/menus/:menuId/process      → { nodeId, userInput } → next node
```

`DtmfDetector` maps transcript text to DTMF digits:
- Exact character match: `"2"` → `"2"` (confidence 1.0)
- Spoken words: `"press two"`, `"option three"`, `"star"` → digits (confidence 0.7–1.0)
- Returns 422 when no digit detected

---

### Voice A/B Testing

Run controlled experiments across TTS voice profiles:

```
POST /voices/abtests                    → create experiment
GET  /voices/abtests                    → list
GET  /voices/abtests/:id
PUT  /voices/abtests/:id/activate
PUT  /voices/abtests/:id/deactivate
POST /voices/abtests/:id/record-result  → record outcome
GET  /voices/abtests/:id/results        → statistics
```

Route traffic across voice variants by percentage split. Record conversion/satisfaction outcomes per variant. Statistical results endpoint for experiment evaluation.

---

### Custom TTS Voices

```
POST /:profileId/synthesize   → synthesize speech with a specific voice profile
GET  /voices                  → list all profiles
GET  /voices/available        → list available voices from KokoroEngine
POST /voices                  → create profile
GET  /voices/:profileId
PUT  /voices/:profileId
DELETE /voices/:profileId
```

`KokoroVoiceEngine` is pluggable — swap TTS providers without touching the orchestrator. Voice profiles store provider, voice name, speed, pitch, and per-tenant configuration.

---

### Call Routing + Queue System

```
POST /routing/rules              → create routing rule
GET  /routing/rules
PUT  /routing/rules/:ruleId
DELETE /routing/rules/:ruleId
POST /routing/evaluate           → { tenantId, intent, language, ... } → matched rule
POST /routing/queue/enqueue      → enqueue a call
POST /routing/queue/dequeue      → dequeue next
GET  /routing/queue              → queue depth
GET  /routing/queue/:tenantId    → per-tenant depth
```

`RoutingEngine` evaluates rules by priority order. `CallQueueService` provides FIFO queuing with per-tenant depth tracking. Designed to feed into SIP bridge for real telephony routing.

---

### Agent Template Marketplace

Pre-built agent templates with a publish/install workflow:

```
GET  /templates                           → list all (built-in + community)
GET  /templates/builtin                   → built-in only
GET  /templates/marketplace               → published templates
GET  /templates/:templateId
POST /templates                           → create
PUT  /templates/:templateId
DELETE /templates/:templateId
POST /templates/:templateId/publish       → publish to marketplace
POST /templates/:templateId/unpublish
POST /templates/marketplace/:id/install   → install to tenant (clones template)
GET  /templates/:templateId/config        → LLM config for template
```

**4 built-in templates:** `builtin-support-en`, `builtin-support-es`, `builtin-support-fr`, `builtin-support-de` (language-specific voice + system prompt). Community templates follow same schema — any tenant can publish.

---

### Pipeline Profiler — Latency Breakdown

Per-session flamechart-style timing across every pipeline stage:

```
POST /sessions/:sessionId/profile                   → record stage timing
GET  /sessions/:sessionId/profile                   → full profile
GET  /sessions/:sessionId/profile/bottlenecks       → stages >200ms avg
DELETE /sessions/:sessionId/profile                 → clear
```

**Stages:** `stt`, `lane_a`, `lane_b`, `lane_c`, `policy_gate`, `tts`, `total`

```typescript
// Profile response
{
  sessionId: "sess_abc123",
  stages: {
    stt:    { avg: 145, min: 120, max: 180, count: 12 },
    lane_b: { avg: 210, min: 190, max: 250, count: 12 },  // ← bottleneck
    tts:    { avg: 88,  min: 72,  max: 110, count: 12 }
  }
}
```

Bottleneck threshold: 200ms. `GET .../bottlenecks` returns only stages exceeding it.

---

### Supervisor System

Real-time session monitoring and intervention for human supervisors:

```
GET /supervisor/sessions              → list active sessions
POST /supervisor/whisper/:sessionId   → inject hint into live session
WebSocket ws://host/supervisor        → live session stream
```

`SupervisorWebSocketServer` streams session events to connected supervisors. `injectWhisper()` pushes a hint into Lane B's context for the next response — the agent receives coaching without the caller hearing it.

---

### Analytics + Reporting

```
GET /analytics/sessions              → paginated session list with metrics
GET /analytics/dashboard             → aggregate: sentiment, decisions, compliance
GET /analytics/tenants               → side-by-side tenant comparison
GET /analytics/calls-per-day         → time-series call volume
GET /analytics/export.csv            → CSV export (sessionId, tenantId, TTFB, quality, compliance)
```

**Sentiment distribution:** positive/neutral/negative/frustrated per tenant. **Top policy violations:** top-5 reason codes by frequency. **Tenant comparison:** normalized metrics across tenants for benchmarking.

---

### Session Recording + Compliance

```
GET /sessions                        → list recorded sessions
GET /sessions/:id                    → session detail
GET /sessions/:id/replay             → full event replay for audit
GET /sessions/:id/summary            → AI-generated summary (topics, decisions, action items)
GET /sessions/:id/compliance         → EU AI Act Article 13 compliance export
GET /tenants/:tenantId/compliance-report  → aggregate compliance metrics
```

**Compliance report fields:** totalSessions, totalPolicyDecisions, complianceRate, totalEscalations, totalClaimsChecked. Optional `?from`/`?to` ISO date filters.

---

### Knowledge Base (RAG)

```
POST /tenants/:tenantId/kb           → add KB entry
GET  /tenants/:tenantId/kb           → list entries
GET  /tenants/:tenantId/kb/search    → keyword search
GET  /tenants/:tenantId/kb/:entryId
PUT  /tenants/:tenantId/kb/:entryId
DELETE /tenants/:tenantId/kb/:entryId
DELETE /tenants/:tenantId/kb         → clear all
```

Each tenant has an isolated KB. Entries are vector-indexed in ChromaDB (`knowledge_{tenantId}` collection). Lane B retrieves top-k relevant entries on each turn via `RAGPipeline` and injects them into the system prompt.

---

### Language Detection + Template Routing

```
GET /language/detect?text=    → { language, confidence, templateId }
GET /language/templates       → templates grouped by greeting language
```

`LanguageDetector` — Unicode script analysis + 20-word frequency scoring (en/es/fr/de/pt). Auto-routes to language-matched built-in template.

---

### Admin API

```
POST   /admin/tenants         → create tenant
GET    /admin/tenants         → list tenants
GET    /admin/tenants/:id
PUT    /admin/tenants/:id
DELETE /admin/tenants/:id
GET    /admin/config          → runtime configuration
PUT    /admin/config          → update runtime config
```

---

### Voice Trigger Webhooks

Programmatic session initiation from external systems:

```
POST /voice/trigger                       → trigger session
GET  /voice/triggers                      → list active triggers
GET  /voice/triggers/:triggerId
POST /voice/triggers/:triggerId/complete  → mark complete
```

Useful for outbound campaign automation — CRM systems or workflow engines can fire a voice session without a WebSocket client.

---

## API Surface Reference

| Mount | Description |
|-------|-------------|
| `GET /health` | Health check |
| `GET /status` | Active sessions + config |
| `GET /metrics` | TTFB, memory, session counts |
| `GET /dashboard` | Live metrics UI (auto-refresh) |
| `/sessions` | Session recording, replay, profiler |
| `/analytics` | Metrics, dashboard, CSV export |
| `/admin` | Tenant CRUD, runtime config |
| `/tenants/:id/memory` | Cross-session conversation memory |
| `/tenants/:id/kb` | Per-tenant knowledge base |
| `/tenants/:id/persona` | Persona assignment |
| `/tenants/:id/compliance-report` | Compliance metrics |
| `/voices` | Voice profiles + A/B tests |
| `/voiceprints` | Voice biometric enroll/identify |
| `/personas` | Agent persona library |
| `/templates` | Agent templates + marketplace |
| `/flows` | Conversation flow builder |
| `/translation` | Language detection + translation |
| `/intents` | Intent detection + routing config |
| `/routing` | Call routing rules + queue |
| `/ivr` | IVR menus + DTMF processing |
| `/playbooks` | Scripted response library |
| `/quality` | Voice quality scoring |
| `/language` | Language detection + template routing |
| `/supervisor` | Session monitoring + whisper injection |
| `/voice` | Webhook-triggered sessions |
| `WS /` | Voice WebSocket (browser clients) |
| `WS /supervisor` | Supervisor real-time stream |

---

## Performance

| Metric | Value |
|--------|-------|
| TTFB p50 | <200ms |
| TTFB p95 | <400ms (load test: 126.7ms @ 200 concurrent sessions) |
| Barge-in stop | <250ms |
| OPA policy eval | <1ms (WASM in-process) |
| Tenant registry lookup | <0.1ms (O(1) Map) |
| Intent detection | <1ms (keyword scoring, no I/O) |
| Language detection | <1ms (frequency scoring, no I/O) |
| Fire-and-forget ticket overhead | 0ms (evaluate() unblocked) |

---

## Quality

| Metric | Value |
|--------|-------|
| Server test suite | 3,930 tests, 0 failures |
| Test suites | 128 (unit + integration + performance + load) |
| Statement coverage | 92.77% (floor: 89%) |
| Branch coverage | 82.37% (floor: 79%) |
| Function coverage | 94.38% (floor: 90%) |
| Line coverage | 93.18% (floor: 90%) |
| React SDK tests | 79 (separate Vitest suite) |
| Coverage floor enforcement | jest.config.js `coverageThreshold` — CI fails on breach |
| Mutation testing baseline | Stryker (PolicyGate 72.0% ✅, AllowedClaimsRegistry 60.0% ✅, LaneArbitrator 65.1% ✅ — refreshed 2026-03-21) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- OpenAI API key

### Installation

```bash
npm install

cp .env.example .env
# Edit .env — add OPENAI_API_KEY

npm run dev
```

Starts:
- Client on http://localhost:5173
- Server on http://localhost:3000

### Docker

```bash
docker-compose up
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI Realtime API key |
| `ENABLE_OPA` | No | `false` | Enable OPA WASM policy engine |
| `OPA_BUNDLE_PATH` | No | — | Path to compiled OPA bundle |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | No | — | MCP ticketing integration |
| `GITHUB_OWNER` | No | — | GitHub org/user for issue creation |
| `GITHUB_REPO` | No | — | GitHub repo for issue creation |
| `VOICEPRINT_IDENTIFY_THRESHOLD` | No | `0.82` | Biometric match confidence threshold |
| `QUALITY_WEBHOOK_URL` | No | — | Webhook for low-quality call alerts |
| `FAULTLINE_API_URL` | No | — | Claim verification service URL |
| `FAULTLINE_API_KEY` | No | — | Claim verification API key |

---

## Development

### Testing

```bash
npm test                   # run all tests
npm run test:coverage      # with coverage report
```

### Linting

```bash
npm run lint
npm run format
```

### Project Structure

```
voice-jib-jab/
├── client/                    # React browser application
│   └── src/
│       ├── audio/             # Mic capture, playback, barge-in
│       ├── ui/                # Enterprise UI components
│       ├── state/             # State management
│       └── events/            # Event handling
├── server/                    # Node.js orchestrator
│   └── src/
│       ├── api/               # 22 HTTP routers
│       ├── orchestrator/      # SessionManager, EventBus, LaneArbitrator
│       ├── lanes/             # Lane A (reflex), Lane B (RAG), Lane C (policy)
│       ├── providers/         # OpenAI Realtime adapter, TTS, SIP
│       ├── services/          # 36 service modules
│       ├── insurance/         # PolicyGate, OPA, audit, claims
│       ├── retrieval/         # RAG pipeline, ChromaDB vector store
│       ├── middleware/        # Rate limiter, security headers
│       └── schemas/           # Event schemas
├── packages/
│   └── voice-agent-react/     # @nxtg/voice-agent-react SDK
├── knowledge/                 # NextGen AI knowledge pack (ChromaDB seed)
├── docs/                      # Architecture, API reference, research docs
├── scripts/                   # build-policy.sh, download-model.sh
└── .claude/                   # NXTG-Forge configuration
```

---

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
| N-09 | Unit Test Coverage (14% → 92%) | SHIPPED |
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

---

## Documentation

- [Project Spec](docs/PROJECT-SPEC.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Demo Guide](DEMO-GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Voice UX Principles](.claude/skills/domain/voice-ux.md)
- [Lane System Architecture](.claude/skills/domain/lane-system.md)
- [SIP Telephony Research](docs/sip-telephony-research.md)

---

## License

MIT
