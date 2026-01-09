## 1. The Answer

# NextGen AI Voice Orchestrator (Browser-First)

## Comprehensive Implementation Spec for Claude Code

### Document control

* **Version:** 0.1
* **Scope:** Browser voice proof of concept that scales into production; lanes A/B/C architecture; Retrieval-Augmented Generation injection; “insurance” scaffolding as stubs that can be hardened later.
* **Primary KPI:** Human-trust voice UX; measured by latency, interruption behavior, correctness, and safety.

---

## 0) BLUF

Build a **browser speech-to-speech voice assistant** with a **lane-based orchestrator**:

* **Lane A (Reflex):** instant backchannel audio and short acknowledgements.
* **Lane B (Reasoned):** streaming intelligent response; preempts Lane A immediately.
* **Lane C (Control):** parallel transcript, moderation, policy gating, audit, metrics; can cancel Lane B and force safe patterns.

Retrieval-Augmented Generation and system instruction injection live primarily in **Lane B**, while **Lane C** uses “control intelligence” for policy decisions and evidence.

---

## 1) Objectives and non-objectives

### Objectives

1. **Browser-first voice conversation** that feels responsive and natural.
2. **Lane arbitration** that prevents overlap; supports barge-in; supports preemption.
3. **Intelligence injection**

   * system instructions
   * Retrieval-Augmented Generation snippets
   * tool calls for retrieval and actions
4. **Insurance stubs** present from day one

   * PolicyGate, AuditTrail, LatencyBudget, AllowedClaimsRegistry, FallbackPlanner
5. **Observability** that makes the experience measurable immediately.

### Non-objectives (for this phase)

* Phone/SIP telephony integration (planned next).
* Full compliance certification. This phase builds the scaffold and evidence pipeline.
* Multi-agent long-running workflows. Keep it conversational and bounded.

---

## 2) User stories

### Primary user stories

* As a user, I click “Talk” and can speak naturally; the assistant responds fast and can be interrupted.
* As a user, I hear small acknowledgements while the system composes the real answer.
* As a user, I can ask about NextGen AI and get accurate, consistent answers grounded in approved facts.
* As an operator, I can see latency metrics and policy decisions for each session.

### Safety and trust stories

* As an operator, I can enforce “do not claim” rules and route risky queries to safe fallbacks.
* As an operator, I can replay a session timeline (without raw audio if disabled) with transcript, decisions, and tool calls.

---

## 3) System overview

### High-level architecture

**Client (Browser)**

* Captures microphone audio
* Streams audio to Orchestrator
* Plays synthesized audio
* Shows optional developer overlay (latency, state, policy flags)

**Orchestrator (Server)**

* Owns session state and lane arbitration
* Calls voice model provider (speech-to-speech)
* Runs Retrieval-Augmented Generation retrieval and tool calls
* Runs PolicyGate and Moderation on transcript stream
* Emits events to AuditTrail and metrics pipeline

**Knowledge services**

* Vector store for NextGen AI knowledge pack
* AllowedClaimsRegistry (approved claims and disclaimers)
* Tool endpoints (future)

---

## 4) Lanes and planes

### Plane 1: Experience plane (user-facing audio)

**Lane A: Reflex**

* Purpose: protect trust while Lane B works
* Output: short acknowledgements; neutral fillers; “one moment”; backchannel
* Constraints: must not assert facts; must not promise outcomes; must be cancelable instantly

**Lane B: Reasoned**

* Purpose: substantive response with Retrieval-Augmented Generation grounding and tool support
* Output: streaming audio response (text also optional)
* Constraint: must obey PolicyGate decisions; must be cancelable by Lane C

### Plane 2: Control plane (safety, governance, evidence)

**Lane C: Transcript + policy + audit**

* Inputs: streaming transcript (partial and final), session context, retrieved snippets, tool outputs
* Outputs:

  * policy decision events (allow, rewrite, refuse, escalate, cancel_output)
  * audit events
  * metrics
* Constraint: may not “answer the user”; it governs how Lane B is allowed to answer

### Where Retrieval-Augmented Generation belongs

* **Primary Retrieval-Augmented Generation:** Lane B
* **Control retrieval (optional):** Lane C can query AllowedClaimsRegistry or disclaimer templates, not generate user-facing content.

---

## 5) Lane arbitration contract

### Core invariants

1. **Single audio owner:** Only one lane can own audio output at a time.
2. **Preemption rules:**

   * Lane B preempts Lane A immediately when B has first audio chunk ready.
   * Lane C can cancel Lane B output at any time.
3. **Barge-in rules:**

   * User speech triggers “barge-in” and stops any assistant audio within a strict latency bound.
4. **Policy override:**

   * Lane C can force: rewrite, refuse, escalate, or fallback pattern.

### Arbitration state machine (minimum viable)

States:

* `IDLE`
* `LISTENING`
* `A_REFLEX_PLAYING`
* `B_RESPONDING`
* `B_PLAYING`
* `C_OVERRIDE`
* `FALLBACK_PLAYING`
* `ENDED`

Key transitions:

* `LISTENING -> A_REFLEX_PLAYING` on user_speech_detected (optional, minimal)
* `A_REFLEX_PLAYING -> B_PLAYING` on b_first_audio_ready
* `B_PLAYING -> LISTENING` on b_response_done
* `B_PLAYING -> C_OVERRIDE` on policy_cancel_output
* `C_OVERRIDE -> FALLBACK_PLAYING` on fallback_selected
* any `*_PLAYING -> LISTENING` on user_barge_in

---

## 6) Latency budget and performance targets

### Metrics you must collect from day one

* **TTFT (time to first transcript segment)** in milliseconds
* **TTFB (time to first audio byte)** for assistant audio
* **Barge-in stop latency** (time from speech start to assistant audio stop)
* **End-to-end turn latency** (speech end to assistant audio start)
* p50 / p95 / p99 for each metric

### Suggested targets (not externally verified; tune empirically)

* TTFB p50: under 400 ms; p95: under 900 ms
* Barge-in stop p95: under 250 ms
* Turn latency p95: under 1200 ms

---

## 7) Modules and responsibilities

### 7.1 Orchestrator core

* Session lifecycle: create, update, end
* Maintains authoritative state: lanes, policies, conversation history
* Routes events between lanes and provider streams

### 7.2 Voice provider adapter (pluggable)

Interface responsibilities:

* Start realtime session
* Stream audio input
* Stream audio output
* Optional: stream transcript events (partial/final)
* Support cancellation and barge-in stop

Adapters:

* `ProviderAdapterOpenAIRealtime` (initial)
* `ProviderAdapterClaude` or others (future)

### 7.3 Lane A module: ReflexEngine

Inputs:

* user speech detected
* lane B pending
* policy state
  Outputs:
* short audio fillers, never factual

Rules:

* Never generate claims
* Strict whitelist of utterances and prosody options
* Always cancelable

### 7.4 Lane B module: ReasoningEngine

Inputs:

* user intent (from transcript)
* Retrieval-Augmented Generation snippets
* tool outputs
* policy constraints
  Outputs:
* streaming response request to provider; audio out

Responsibilities:

* Builds “instruction set” for the session
* Calls Retrieval-Augmented Generation
* Handles tool calls
* Emits structured citations internally for audit (even if not spoken)

### 7.5 Lane C module: ControlEngine

Inputs:

* transcript segments
* current state
* proposed response metadata
* retrieved snippets (optional)
  Outputs:
* policy decisions and overrides
* audit events

Subcomponents:

* `Moderator` (policy classification; allow/refuse/escalate)
* `ClaimsChecker` (AllowedClaimsRegistry match; disallowed patterns)
* `PIIRedactor` (redact before tool calls or logging, per config)
* `OverrideController` (cancel output, trigger fallback)

### 7.6 Retrieval service

* Vector search against NextGen AI Knowledge Pack
* Returns compact “facts pack” snippets

Constraints:

* Hard cap on tokens/bytes returned
* Always includes source identifiers

### 7.7 AuditTrail

* Append-only event log per session
* Configurable storage (local JSONL for proof of concept; database later)
* Supports replay timeline

### 7.8 LatencyBudget

* Captures timestamps for event milestones
* Computes rolling p50/p95/p99 per session and aggregate

### 7.9 FallbackPlanner

Safe maneuvers:

* ask clarifying question
* refuse politely
* switch to “text summary”
* escalate to human (stub)
* offer to send email or link (stub)

---

## 8) Data contracts

### 8.1 Canonical events

Use a single event bus structure.

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "t_ms": 0,
  "source": "client|orchestrator|laneA|laneB|laneC|provider|retriever",
  "type": "string",
  "payload": {}
}
```

### 8.2 Transcript events

```json
{
  "type": "transcript.delta|transcript.final",
  "payload": {
    "text": "string",
    "confidence": 0.0,
    "is_final": false,
    "span_ms": { "start": 0, "end": 0 }
  }
}
```

### 8.3 Policy decisions

```json
{
  "type": "policy.decision",
  "payload": {
    "decision": "allow|rewrite|refuse|escalate|cancel_output",
    "reason_codes": ["CLAIMS_RISK", "PII", "REGULATED_TOPIC"],
    "safe_rewrite": "string|null",
    "required_disclaimer_id": "string|null",
    "severity": 0
  }
}
```

### 8.4 Lane arbitration events

```json
{
  "type": "lane.owner_changed",
  "payload": {
    "from": "none|A|B|fallback",
    "to": "none|A|B|fallback",
    "cause": "b_first_audio_ready|policy_cancel|user_barge_in|response_done"
  }
}
```

---

## 9) Intelligence injection spec

### 9.1 Instruction framework

Define a stable instruction template with slots:

* `IDENTITY`: NextGen AI voice assistant
* `STYLE`: conversational, concise, no overclaims
* `TRUTH_POLICY`: only use retrieved facts for company assertions; if missing, ask
* `SAFETY_POLICY`: do not provide restricted advice; use fallback
* `TOOLS_POLICY`: when to call retrieval and actions
* `LANE_POLICY`: Lane A cannot claim facts; Lane B must honor Lane C

### 9.2 Retrieval-Augmented Generation strategy

* Build `NextGenAI Knowledge Pack` as curated canonical facts.
* Retrieval query is derived from transcript final or stable partial.
* Return a “facts pack” structure, not raw pages.

Facts pack schema:

```json
{
  "topic": "string",
  "facts": [
    { "id": "NXTG-001", "text": "string", "source": "doc|url|internal", "timestamp": "YYYY-MM-DD" }
  ],
  "disclaimers": ["DISC-001"]
}
```

### 9.3 Tool calling

Define tools as functions with strict schemas.

Minimum tools:

* `retrieve_nxtg_facts(query: string) -> facts_pack`
* `lookup_disclaimer(disclaimer_id: string) -> text`
* `log_action(action: string, metadata: object) -> ok` (stub)

---

## 10) Security, privacy, and abuse considerations

### Required controls (proof of concept)

* Server controls session instructions; client cannot mutate system instructions directly.
* Rate limit sessions per client fingerprint.
* Redact sensitive data before storing transcript, unless explicitly enabled.
* Disable raw audio storage by default; store only hashes and timing unless opted in.

### Optional controls (production)

* Signed session tokens
* Origin allowlist
* Encryption at rest for audit store
* Tenant isolation if multi-customer later

---

## 11) Observability

### Required dashboards (minimal)

Per session timeline:

* transcript deltas and finals
* lane ownership changes
* policy decisions
* tool calls
* latency markers and computed metrics

Aggregate:

* p50/p95/p99 for TTFB, TTFT, barge-in stop
* policy decision rates
* fallback rates
* top intents and Retrieval-Augmented Generation hit rate

Logging strategy:

* JSON structured logs only
* Every event includes session_id and monotonic t_ms

---

## 12) Repository layout (recommended)

### Browser client (Next.js or Vite React)

* `/client`

  * `/src`

    * `/audio` (mic capture, playback, WebRTC)
    * `/ui` (talk button, debug overlay)
    * `/state` (session state)
    * `/events` (client event emitter)

### Orchestrator server (Node.js + TypeScript recommended for speed)

* `/server`

  * `/src`

    * `/api` (session endpoints)
    * `/orchestrator` (session manager, event bus)
    * `/lanes`

      * `laneA_reflex.ts`
      * `laneB_reasoning.ts`
      * `laneC_control.ts`
    * `/providers`

      * `provider_adapter.ts`
      * `provider_openai_realtime.ts` (initial)
    * `/retrieval`

      * `vector_store.ts`
      * `nxtg_knowledge_pack.ts`
    * `/insurance`

      * `policy_gate.ts`
      * `allowed_claims_registry.ts`
      * `audit_trail.ts`
      * `latency_budget.ts`
      * `fallback_planner.ts`
    * `/schemas` (event and tool JSON schemas)
    * `/config`

### Knowledge assets

* `/knowledge`

  * `nxtg_facts.jsonl`
  * `disclaimers.json`
  * `allowed_claims.json`
  * `disallowed_phrases.json`

---

## 13) Build plan with acceptance criteria

### Milestone 1: Voice loop works (MVP)

Deliverables:

* Browser mic capture
* Provider adapter connected
* Streaming assistant audio playback
  Acceptance criteria:
* Can hold a 2-minute voice conversation
* Barge-in stops assistant reliably
* TTFB and barge-in metrics are recorded

### Milestone 2: Lane arbitration (A and B)

Deliverables:

* Lane A reflex sounds and acknowledgements
* Lane B preemption
  Acceptance criteria:
* Lane A never overlaps Lane B audio
* Lane B takes ownership within one chunk

### Milestone 3: Lane C control scaffold

Deliverables:

* transcript events collected
* basic Moderator stub (allow/refuse on simple patterns)
* audit timeline output
  Acceptance criteria:
* Policy cancel event stops Lane B audio and triggers fallback

### Milestone 4: Retrieval-Augmented Generation injection for NextGen AI

Deliverables:

* NextGen AI Knowledge Pack
* retrieval tool and facts pack injection
  Acceptance criteria:
* Responses about NextGen AI use retrieved facts consistently
* When facts missing, system asks clarifying questions instead of guessing

---

## 14) Test plan

### Functional tests

* lane ownership transitions
* barge-in interrupts in each state
* transcript arrival order variations
* policy cancel during streaming speech

### Performance tests

* sustained 10-minute session, no memory growth
* jitter simulation and packet loss simulation (client)
* p95 latency under defined targets in local and hosted env

### Safety tests

* prompt injection attempts through user speech
* disallowed claim attempts
* personal data recitation attempts

---

## 15) Configuration and knobs

* Reflex behavior density: off/low/medium
* Max Retrieval-Augmented Generation payload size
* Policy strictness: permissive/balanced/strict
* Transcript storage: off/redacted/full
* Audio storage: off/on
* Fallback mode: ask_clarify, refuse, switch_to_text

---

## 16) What Claude Code should implement first

Claude Code should start with the skeleton that proves architecture, not polish:

1. Event bus + schemas
2. Session manager + lane arbitration
3. Provider adapter stub with streaming interface
4. Lane A reflex whitelist
5. Lane C PolicyGate stub that can cancel audio
6. Knowledge Pack retrieval and injection into Lane B

---

## 2. Confidence Score

★★★★☆ (4/5)
The architecture and contracts are solid and implementable; specific latency targets are recommended starting points and must be validated in your environment.

---

## 3. ⚠️ Risk Analysis

* **Overbuilding Lane A:** too much filler will feel synthetic; keep it sparse and context-aware.
* **Lane C without authority:** if PolicyGate cannot cancel output, “insurance” becomes cosmetic.
* **Retrieval payload bloat:** oversized Retrieval-Augmented Generation snippets will degrade responsiveness fast.
* **Provider lock-in:** keep provider adapter clean; assume you will swap or multi-home providers.

---

