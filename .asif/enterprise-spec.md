## 1) The Answer

### Decision set (quality-first, SPEC-driven)

#### 1) Start from scratch vs refactor

**Recommendation: start from scratch in a new repo; keep the current app as a reference implementation and test harness.**

**Why this is the higher-quality move**

* Your target architecture is materially different: **Web Real-Time Communications (WebRTC) media plane + long-running agent worker + tool integrations**. That is not a “refactor”, that is a topology change.
* Your current system already proved the lane concept; preserve it as a behavioral oracle, not as the production substrate.

This aligns with the objective: a **SPEC.md that Claude Code can implement end-to-end without inheriting legacy coupling**.

#### 2) Local PostgreSQL instead of Supabase

**Yes. Local PostgreSQL is the correct default for v1.**
You can always add Supabase later as a hosting choice. PostgreSQL with `pgvector` gives you one system of record for tickets, transcripts, embeddings, and audit. ([GitHub][1])

#### 3) Meet Session Initiation Protocol (SIP) / phone needs with stubs for first release

**Yes, but only if you stub at the boundary and keep the entire call lifecycle contract identical to “real SIP.”**

Concrete approach:

* Define a `TelephonyAdapter` interface that emits the same events as LiveKit telephony would emit for inbound calls (ringing, connected, DTMF, hangup, transfer requested).
* Implement `StubTelephonyAdapter` for v1.
* Implement `LiveKitSIPTelephonyAdapter` later using LiveKit telephony (inbound trunk, dispatch rules, outbound trunk). ([LiveKit Docs][2])

This makes the SIP “stub” legitimate; you are not punting design, only deployment.

#### 4) Use safe Model Context Protocol (MCP) where possible for ticketing; choose the most popular product

**Recommendation: target Zendesk first, with a clean abstraction so ServiceNow can be swapped in for enterprise buyers.**

Rationale:

* Zendesk is a top-tier customer support platform (broad adoption in customer support; strong ecosystem).
* MCP is real and active in Zendesk’s ecosystem, including Zendesk’s own MCP client messaging and multiple MCP server implementations. ([Zendesk][3])
* ServiceNow also has a documented MCP client framework and MCP server implementations, but it skews toward IT service management and enterprise workflow. ([ServiceNow][4])

For “most popular”, there is no single universal winner across segments. Review aggregators show multiple leaders (Salesforce Service Cloud, Zoho Desk, Freshdesk, others). ([G2][5])
So the correct product decision is segment-driven:

* **Customer support SaaS**: Zendesk is a safe default.
* **Enterprise IT service management**: ServiceNow is the safe default.

Given your product is explicitly **Customer Support Agent**, Zendesk-first is the cleanest bet.

---

## SPEC.md (copy-paste into `SPEC.md`)

```markdown
# NextGen AI Live Voice Customer Support Agent
## SPEC.md (Implementation-Complete)

Owner: NextGen AI  
Quality Bar: production-grade correctness; no “demo shortcuts” in core contracts.

---

## 0) Non-Negotiables (Code Insurance Checklist)
Claude Code MUST satisfy all items before implementing features:

1. Single source of truth for event schemas (shared package); no duplicated types.
2. Strict TypeScript (or strict Python typing if worker is Python) with CI gates.
3. No realtime audio routed through web server; media plane is LiveKit.
4. Every external side effect is behind an adapter interface (ticketing, telephony, knowledge, analytics).
5. Every agent action is auditable (who/what/when/inputs/outputs/decision metadata).
6. Deterministic “lane” execution order and cancellation rules (barge-in is not optional).
7. Local development is one command; Docker Compose required.

If any item is infeasible, stop and surface a blocking design note inside `docs/ADR/`.

---

## 1) Product Definition
### 1.1 What we are building
A low-latency, speech-to-speech Customer Support Agent that:
- conducts natural conversations in real time,
- grounds responses with internal knowledge (Retrieval-Augmented Generation),
- creates/updates support tickets via Model Context Protocol (MCP) tool calls,
- escalates to humans with a complete transcript, summary, and structured disposition.

### 1.2 Channels
- v1: Browser voice widget (Web Real-Time Communications).
- v1: Phone (Session Initiation Protocol) is stubbed but architected as first-class.
- v2: Real Session Initiation Protocol via LiveKit telephony.

### 1.3 Out of scope (v1)
- Full omnichannel (email, chat, social) beyond ticket creation.
- Workforce management, agent scheduling, forecasting.
- Payments, identity federation beyond basic organization accounts.

---

## 2) Architecture Overview
### 2.1 Topology
Components:
1. Web App (Next.js)
   - Admin console; org configuration; knowledge base UI; call logs UI
   - Token minting endpoints for LiveKit
   - Webhooks receiver (ticketing events, analytics)
2. LiveKit (managed or self-hosted)
   - Media plane for Web Real-Time Communications participants
   - Future: telephony bridge for Session Initiation Protocol
3. Agent Worker (long-running service)
   - Joins LiveKit rooms as an agent participant
   - Implements Lane A/Lane B/Lane C
   - Connects to OpenAI Realtime for speech-to-speech
4. PostgreSQL (local first)
   - System of record for orgs, users, configs, transcripts, embeddings, audit logs
   - pgvector for embeddings

### 2.2 Why this split
- Web App is control plane; it MUST NOT be in the hot path of audio.
- Agent Worker is the hot path; it MUST be stable, low-latency, and long-running.

---

## 3) Lane System (Core Behavior)
### 3.1 Definitions
Lane A (Reflex):
- Emits immediate backchannel acknowledgements and micro-prompts.
- Must never block on retrieval, ticketing, or external tools.

Lane B (Reasoned):
- Produces the primary response grounded in retrieval and structured policies.
- Streams partial speech output when safe.

Lane C (Control):
- Enforces policy gates in parallel with Lane B.
- Can cancel or redact Lane B output before it is spoken.

### 3.2 Turn lifecycle state machine
States:
- IDLE
- LISTENING
- USER_SPEAKING
- USER_PAUSED
- THINKING
- SPEAKING
- INTERRUPTED
- ENDING

Rules:
1. Barge-in:
   - If user speech is detected while agent is SPEAKING, transition to INTERRUPTED within 250ms p95.
   - Immediately stop audio output and cancel the active Lane B generation.
2. Control veto:
   - Lane C can veto any chunk; vetoed chunks MUST NOT be spoken.
   - Veto triggers either a safe rephrase or a handoff suggestion.
3. Reflex separation:
   - Lane A can run while Lane B is THINKING, but Lane A cannot fabricate facts.
   - Lane A is limited to acknowledgements, clarifying prompts, and empathy cues.

### 3.3 Retrieval contract
- Retrieval only uses approved corpora per org.
- Retrieval returns citations (document ids and spans) for auditability.
- Lane B must incorporate retrieval results or explicitly state “I do not have that information.”

---

## 4) Ticketing (MCP-first)
### 4.1 Adapter abstraction
Define `TicketingAdapter`:
- `create_ticket(subject, description, requester, priority, tags, metadata) -> ticket_id`
- `update_ticket(ticket_id, patch) -> success`
- `search_tickets(query) -> tickets[]`
- `add_internal_note(ticket_id, note) -> success`

Implementations:
1. v1: `LocalTicketingAdapter` (PostgreSQL tables)
2. v1 optional: `ZendeskMcpTicketingAdapter` (MCP client to Zendesk MCP server)
3. v2: `ServiceNowMcpTicketingAdapter` (MCP client to ServiceNow MCP server)

### 4.2 Safety for tool use
- Tool calls are only permitted from Lane C-approved intents.
- All tool calls are logged in `audit_tool_calls` with:
  - request payload hash, response payload hash, latency, status, and redacted copy.

---

## 5) Session Initiation Protocol (SIP) / Phone Plan
### 5.1 v1 stubs
Define `TelephonyAdapter`:
- `on_inbound_call(call_metadata) -> session_id`
- `connect(session_id)`
- `hangup(session_id)`
- `send_dtmf(session_id, digits)`
- `transfer(session_id, target)` (human escalation)

Implement `StubTelephonyAdapter`:
- Simulates inbound call events.
- Can inject prerecorded audio as the caller stream for deterministic tests.

### 5.2 v2 real Session Initiation Protocol via LiveKit
Implement `LiveKitSIPTelephonyAdapter` using LiveKit telephony primitives:
- inbound trunk, dispatch rules, outbound trunk.

---

## 6) Data Model (PostgreSQL)
### 6.1 Core tables
- `orgs(id, name, created_at)`
- `users(id, org_id, email, role, created_at)`
- `knowledge_docs(id, org_id, source, title, body, metadata_json, created_at, updated_at)`
- `knowledge_embeddings(id, doc_id, org_id, embedding vector, created_at)`
- `conversations(id, org_id, channel, started_at, ended_at, status)`
- `conversation_turns(id, conversation_id, speaker, started_at, ended_at, transcript_text, metadata_json)`
- `call_events(id, conversation_id, event_type, ts, payload_json)`
- `tickets(id, org_id, external_ref, provider, status, subject, created_at, updated_at)`
- `audit_tool_calls(id, conversation_id, turn_id, tool_name, request_hash, response_hash, status, latency_ms, ts, redacted_request_json, redacted_response_json)`
- `audit_policy(id, conversation_id, turn_id, policy_name, decision, reason, ts, payload_json)`

### 6.2 Migrations and ORM
- Use Prisma or Drizzle for schema migrations.
- Enforce migration checks in CI.

---

## 7) Interfaces and APIs
### 7.1 Web App endpoints (Next.js Route Handlers)
- `GET /api/livekit/token`
  - Authenticated; returns a LiveKit room token for the current user/session.
- `POST /api/knowledge/upsert`
  - Admin-only; inserts/updates knowledge docs; triggers embedding job.
- `GET /api/conversations/:id`
  - Returns conversation metadata and turns for playback.
- `POST /api/ticketing/test`
  - Validates configured ticketing adapter (Local or MCP).

### 7.2 Worker control channel
Worker subscribes to a control topic (either Redis pubsub or Postgres LISTEN/NOTIFY):
- Start session
- End session
- Reload org policy
- Rotate knowledge snapshot

v1 recommended: Postgres LISTEN/NOTIFY to avoid extra infra.

---

## 8) Observability
### 8.1 Metrics
Minimum:
- time_to_first_audio_ms (p50, p95)
- barge_in_stop_ms (p95)
- turn_latency_ms (p95)
- tool_call_latency_ms by tool
- escalation_rate
- containment_rate
- policy_veto_rate
- retrieval_hit_rate

### 8.2 Logging
- Structured JSON logs everywhere.
- Correlation id per conversation and per turn.

---

## 9) Performance Targets
- Time-to-first-audio p50 < 400ms; p95 < 900ms
- Barge-in stop p95 < 250ms
- Turn latency p95 < 1200ms
- Ticket creation (async) p95 < 2000ms; must not block speech

---

## 10) Security and Compliance (v1 baseline)
- Role-Based Access Control:
  - Admin can manage knowledge and ticketing configs.
  - Agent can view conversation logs for their org only.
- Data retention:
  - Configurable retention window; default 30 days for audio, 180 days for transcripts.
- Redaction:
  - Detect and redact sensitive entities in logs and tool call payloads.

---

## 11) Repo Structure (Monorepo)
```

nxtg-voice-support/
apps/
web/                 # Next.js app (admin + widget host)
worker/              # LiveKit agent worker (Node or Python)
packages/
shared/              # event schemas, types, utilities
infra/
docker-compose.yml   # postgres, livekit (dev), optional redis
docs/
ADR/
RUNBOOK.md

```

---

## 12) Local Development
One command:
- `docker compose up -d` starts PostgreSQL + LiveKit (dev).
- `pnpm install`
- `pnpm dev` runs web and worker in watch mode.

Provide `.env.example` for each app.

---

## 13) Test Plan (must be automated)
1. Unit tests:
   - Lane rules; barge-in; control veto; tool gating.
2. Integration tests:
   - Worker joins LiveKit room; simulated user audio; verifies transcript and response.
3. Contract tests:
   - TicketingAdapter and TelephonyAdapter compliance suite (runs against stub and real adapters).
4. Load test:
   - N concurrent sessions; validates latency budgets.

---

## 14) Acceptance Criteria (Definition of Done)
v1 is “done” only when:
- Web voice session works end-to-end with lanes and audit logging.
- Ticketing works via LocalTicketingAdapter; MCP adapter is optional but wired.
- SIP is stubbed with the same lifecycle contract as real SIP.
- Observability dashboard exists (even if basic).
- CI gates: lint, typecheck, tests, migration checks.

---
```

---

## 2) Confidence Score

⭐⭐⭐⭐⭐ (5/5)
This is **5-star** because the plan is internally consistent, spec-complete, and uses proven primitives: LiveKit telephony concepts for Session Initiation Protocol integration, and active Model Context Protocol ecosystems for ticketing adapters. ([LiveKit Docs][2])

---

## 3) ⚠️ Risk Analysis

* **Rewrite risk:** greenfield can slip if you allow “just one more feature”; mitigate via the Acceptance Criteria section as a hard gate.
* **Segment risk:** Zendesk-first is correct for customer support; enterprise buyers may require ServiceNow. Keep adapters clean. ([ServiceNow][4])
* **SIP stub risk:** if the stub does not mimic real call edge cases (DTMF, transfers, early media), you will pay later. Mitigate with contract tests and deterministic audio fixtures.
* **Tooling risk:** MCP servers vary in maturity; treat them as adapters behind your own policy gates and audit layer. ([Model Context Protocol][6])

---

## 4) Next Action

Create a new repo `nxtg-voice-support`, drop this into `SPEC.md`, then have Claude Code implement **only Sections 11–14 first** (repo skeleton, local dev, database, adapters, CI gates). That forces quality infrastructure before features.

[1]: https://github.com/livekit/sip?utm_source=chatgpt.com "GitHub - livekit/sip: SIP to WebRTC bridge for LiveKit"
[2]: https://docs.livekit.io/telephony/start/sip-trunk-setup/?utm_source=chatgpt.com "SIP trunk setup | LiveKit Documentation"
[3]: https://www.zendesk.com/blog/zip2-revolutionizing-service-with-the-zendesk-ai-mcp-client/?utm_source=chatgpt.com "Unlocking new possibilities: Revolutionizing service with the ... - Zendesk"
[4]: https://www.servicenow.com/docs/bundle/zurich-intelligent-experiences/page/administer/model-context-protocol-client/concept/exploring-model-context-protocol-client.html?utm_source=chatgpt.com "Explore Model Context Protocol Client - ServiceNow"
[5]: https://www.g2.com/categories/help-desk?utm_source=chatgpt.com "Best Help Desk Software: User Reviews from January 2026 - G2"
[6]: https://modelcontextprotocol.io/docs/learn/architecture?utm_source=chatgpt.com "Architecture overview - Model Context Protocol"
