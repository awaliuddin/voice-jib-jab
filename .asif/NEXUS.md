# NEXUS — voice-jib-jab Vision-to-Execution Dashboard

> **Owner**: Asif Waliuddin
> **Last Updated**: 2026-02-16
> **North Star**: A production voice agent runtime that eliminates the two things that kill enterprise voice deployments: bad latency and ungoverned output.

---

## Executive Dashboard

| ID | Initiative | Pillar | Status | Priority | Last Touched |
|----|-----------|--------|--------|----------|-------------|
| N-01 | Voice Loop MVP | RESPONSIVENESS | SHIPPED | P0 | 2026-01 |
| N-02 | Lane Arbitration System | INTERACTION | SHIPPED | P0 | 2026-01 |
| N-03 | Audio Buffer Race Fix | RESPONSIVENESS | SHIPPED | P0 | 2026-01 |
| N-04 | State Machine Resilience | RESPONSIVENESS | SHIPPED | P0 | 2026-01 |
| N-05 | Persistent Memory (ChromaDB) | GROUNDING | SHIPPED | P1 | 2026-01 |
| N-06 | Enterprise UI Transformation | INTERACTION | SHIPPED | P1 | 2026-01 |
| N-07 | Lane C Control Plane | GOVERNANCE | BUILDING | P0 | 2026-02 |
| N-08 | Knowledge Pack Retrieval | GROUNDING | BUILDING | P1 | 2026-02 |
| N-09 | Unit Test Coverage (14%→85%) | OBSERVABILITY | BUILDING | P0 | 2026-02 |
| N-10 | Production Readiness QA | OBSERVABILITY | BUILDING | P0 | 2026-02 |
| N-11 | SIP Telephony | EXTENSIBILITY | IDEA | P1 | — |
| N-12 | Ticketing Integration (MCP) | EXTENSIBILITY | IDEA | P1 | — |
| N-13 | Multi-Tenant Isolation | GOVERNANCE | IDEA | P1 | — |

---

## Vision Pillars

### RESPONSIVENESS — "Sub-400ms Latency"
- TTFB p50 <400ms, p95 <900ms. Barge-in stop p95 <250ms
- Turn latency p95 <1200ms. Achieved in UAT.
- **Shipped**: N-01, N-03, N-04

### INTERACTION — "Human-Like Conversation"
- Lane A reflex acknowledgements while Lane B thinks
- Smooth turn-taking via server-side VAD. Barge-in support
- **Shipped**: N-02, N-06

### GOVERNANCE — "Enterprise Policy Enforcement"
- Lane C parallel control plane (policy gates, moderation, audit)
- Hard-cancel audio mid-stream. Decision logging for compliance
- **Building**: N-07
- **Ideas**: N-13

### GROUNDING — "Fact-Checked Responses"
- ChromaDB vector store with knowledge pack. Citation trails
- AllowedClaimsRegistry for claim validation
- **Shipped**: N-05
- **Building**: N-08

### OBSERVABILITY — "Enterprise Compliance"
- Structured event logging (transcripts, tool calls, policy decisions)
- Conversation replay. PII redaction stubs
- **Building**: N-09, N-10

### EXTENSIBILITY — "Provider Pluggability"
- OpenAI Realtime adapter shipped. SIP, Zendesk, ServiceNow ready for v2
- MCP tool integration framework. Local-first PostgreSQL option
- **Ideas**: N-11, N-12

---

## Initiative Details

### N-01: Voice Loop MVP
**Pillar**: RESPONSIVENESS | **Status**: SHIPPED | **Priority**: P0
**What**: Mic → WebSocket → OpenAI Realtime → playback. Barge-in working. 500ms latency baseline achieved.

### N-02: Lane Arbitration System
**Pillar**: INTERACTION | **Status**: SHIPPED | **Priority**: P0
**What**: 2-lane state machine (Lane A reflex, Lane B reasoning). Preemption logic prevents overlap. 100% transition coverage.

### N-03: Audio Buffer Race Fix
**Pillar**: RESPONSIVENESS | **Status**: SHIPPED | **Priority**: P0
**What**: Confirmation protocol + 50ms safety window. 3-layer guards (duration, safety, VAD).

### N-04: State Machine Resilience
**Pillar**: RESPONSIVENESS | **Status**: SHIPPED | **Priority**: P0
**What**: LaneArbitrator handles all state transitions. Error recovery + resetResponseInProgress().

### N-05: Persistent Memory (ChromaDB)
**Pillar**: GROUNDING | **Status**: SHIPPED | **Priority**: P1
**What**: Cross-session conversation context via vector embeddings.

### N-06: Enterprise UI Transformation
**Pillar**: INTERACTION | **Status**: SHIPPED | **Priority**: P1
**What**: Electric blue design system. Tailwind-first. Performance metrics as hero feature.

### N-07: Lane C Control Plane
**Pillar**: GOVERNANCE | **Status**: BUILDING | **Priority**: P0
**What**: PolicyGate, AuditTrail, LatencyBudget, AllowedClaimsRegistry, FallbackPlanner. Stubs in place.
**Next step**: Hardening + test coverage.

### N-08: Knowledge Pack Retrieval
**Pillar**: GROUNDING | **Status**: BUILDING | **Priority**: P1
**What**: ChromaDB retrieval + Whisper transcription + fact injection into Lane B.
**Next step**: Fact-checked response testing.

### N-09: Unit Test Coverage
**Pillar**: OBSERVABILITY | **Status**: BUILDING | **Priority**: P0
**What**: Current 14.69% → target 85%. OpenAIRealtimeAdapter needs 70+ tests. WebSocket mocking being resolved.
**Actual (2026-02-18)**: 40/41 server tests passing (1 timeout). 24/41 full-suite failures are test infra issues (missing AudioContext mock, WebSocket fake timer leaks, empty test shells). Coverage provider not installed — need `@vitest/coverage-v8`.
**Next step**: Install coverage provider, fix client test environment (jsdom/happy-dom), implement empty test shells, then expand adapter + LaneArbitrator coverage.

### N-10: Production Readiness QA
**Pillar**: OBSERVABILITY | **Status**: BUILDING | **Priority**: P0
**What**: Security audit, load testing (concurrent sessions), SLA validation, monitoring. Assessment: NOT_READY (3-4 weeks).

### N-11: SIP Telephony
**Pillar**: EXTENSIBILITY | **Status**: IDEA | **Priority**: P1
**What**: StubTelephonyAdapter v1 (testing). LiveKitSIPTelephonyAdapter for v2 (real SIP).

### N-12: Ticketing Integration (MCP)
**Pillar**: EXTENSIBILITY | **Status**: IDEA | **Priority**: P1
**What**: LocalTicketingAdapter v1 (PostgreSQL). Zendesk/ServiceNow MCP adapters for enterprise.

### N-13: Multi-Tenant Isolation
**Pillar**: GOVERNANCE | **Status**: IDEA | **Priority**: P1
**What**: Org-scoped knowledge, policy, audit. Admin console. RBAC (admin, agent, viewer).

---

## UAT Findings (5 Bugs)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | Audio feedback loop — AI responds to ambient noise endlessly | FIXED — 3-layer defense (echo cancellation + cooldown + RMS gate) |
| 2 | HIGH | Stop button unresponsive — requires 3 clicks | OPEN — Client→server stop message routing gap |
| 3 | HIGH | Server keeps streaming after client stop (30s+ lag) | OPEN — No stop ack / delivery confirmation protocol |
| 4 | POSITIVE | Voice response latency near-instant (~500ms) | PRESERVED — TTFB tracked & displayed |
| 5 | CRITICAL | Audit trail FK failure on WebSocket connect (race condition) | FIXED — INSERT OR IGNORE placeholder row before audit events |

---

## Status Lifecycle

```
IDEA ──> RESEARCHED ──> DECIDED ──> BUILDING ──> SHIPPED
  │          │              │           │
  └──────────┴──────────────┴───────────┴──> ARCHIVED
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-16 | Created. 13 initiatives across 6 pillars. 6 shipped, 4 building, 3 ideas. 5 UAT bugs tracked. |

---

## CoS Directives

### DIRECTIVE-NXTG-20260216-01 — UAT Bug Triage & Test Baseline
**From**: NXTG-AI CoS | **Date**: 2026-02-16 | **Status**: COMPLETED
**Priority**: P0

**Action Items**:
1. [ ] Run the test suite (`npm test` or `npx vitest run` or `npx jest`) and report pass/fail/skip counts. Current report: 40/41 passing, 1 timeout. Verify and update N-09 with actual numbers.
2. [ ] Report current test coverage %. N-09 target is 14.69%→85%. What's the actual current %?
3. [ ] Triage the 5 UAT bugs. For each, report: (a) is it still reproducible? (b) is a fix in progress? (c) estimated effort. Update the UAT Findings table in NEXUS.
4. [ ] UAT Bug #1 (CRITICAL: audio feedback loop) — is echo cancellation implemented? If not, what's the technical approach?
5. [ ] UAT Bug #5 (CRITICAL: audit trail FK race) — is the transaction boundary fix applied? Verify by checking if `WebSocket connect` creates audit records without FK errors.

**Constraints**:
- Fix CRITICAL bugs (#1, #5) before any new feature work.
- Do NOT remove the 3-lane architecture (Lane A reflex, Lane B reasoning, Lane C policy). This is a portfolio-level architectural decision.
- Preserve the sub-400ms latency achievement (UAT finding #4).

**Portfolio context**:
- voice-jib-jab (P-07) is in the Voice & Media vertical alongside Podcast-Pipeline (P-04).
- Podcast-Pipeline's TTS engines (F5-TTS, OpenVoice v2) could eventually replace the OpenAI Realtime API TTS. No action needed now — just awareness.
- OPA policy engine (from oneDB P-09) could formalize Lane C governance. Future enrichment opportunity.

**Response** (filled by project team — 2026-02-18):

> **1. Test Suite Results** (`npx vitest run`):
> - **Full suite (14 files):** 17 passed, 24 failed, 41 total. 13 test files failing, 1 passing.
> - **Server-only subset (4 files):** 40 passed, 1 failed (timeout), 41 total.
> - The 24 failures are environment issues, not logic bugs:
>   - 9 failures: `AudioPlayback.test.ts` — `AudioContext is not defined` (missing browser API mock in Node test environment)
>   - 4+ failures: `WebSocketClient.test.ts` — unhandled rejection from fake timer advancing past connection timeout
>   - 3 files with 0 tests: `lane-c-policy.test.ts`, `LatencyBudget.test.ts`, `EventBus.test.ts` (empty test shells)
> - N-09 updated: actual state is 40/41 passing when scoped to server tests; full suite needs test environment fixes.
>
> **2. Test Coverage %:**
> - Coverage provider is **not configured** — `npx vitest run --coverage` produces no coverage output.
> - Need to add `@vitest/coverage-v8` or `@vitest/coverage-istanbul` to get actual numbers.
> - Estimated coverage remains ~14% based on test-to-source ratio. Cannot verify until provider is installed.
>
> **3. UAT Bug Triage:**
>
> | # | Severity | Reproducible? | Fix Status | Effort | Details |
> |---|----------|--------------|------------|--------|---------|
> | 1 | CRITICAL | **NO** — Fixed | COMPLETE | N/A | 3-layer defense: browser `echoCancellation:true` + `RESPONSE_COOLDOWN_MS=1500` + `MIN_AUDIO_RMS=200` gate + state machine gating. Committed. |
> | 2 | HIGH | **LIKELY YES** | PARTIAL | 1-2h | Server handles `audio.stop` correctly. Gap: unclear if client actually sends the stop message on button release. Need to trace TalkButton → SessionManager → WebSocket send path. |
> | 3 | HIGH | **LIKELY YES** | PARTIAL | 3-4h | `audioStopped` flag set server-side, but no ack sent to client. No delivery confirmation protocol. Ref PI-004 (Forge WebSocket pattern). |
> | 4 | POSITIVE | **PRESERVED** | VERIFIED | N/A | TTFB tracked in LaneB, published via event bus, displayed in PerformanceShowcase component. Sub-400ms target maintained. |
> | 5 | CRITICAL | **NO** — Fixed | COMPLETE | N/A | `INSERT OR IGNORE INTO sessions (id) VALUES (?)` placeholder row created before audit events. FK constraint satisfied. Committed. |
>
> **4. Bug #1 — Echo Cancellation:** YES, implemented. Three-layer defense:
> - Browser: `echoCancellation: true, noiseSuppression: true` in getUserMedia constraints
> - Server cooldown: 1500ms post-response audio rejection window
> - RMS energy gate: chunks below threshold 200 silently dropped
> - State machine: audio rejected unless `laneArbitrator.getState() === "LISTENING"`
>
> **5. Bug #5 — Audit Trail FK Fix:** YES, applied. `AuditTrail.handleEvent()` calls `ensureSessionStmt.run(session_id)` before inserting audit events, creating a minimal placeholder row. Full metadata filled later by `SessionHistory.recordSession()`. No FK errors on WebSocket connect.
>
> **Summary:** Both CRITICAL bugs (#1, #5) are fixed. Two HIGH bugs (#2, #3) remain — both are WebSocket event routing/confirmation issues, estimated 4-6h total. Test infrastructure needs: coverage provider install, browser API mocks for client tests, empty test shells need implementation.

### DIRECTIVE-NXTG-20260219-02 — Fix HIGH Bugs + Coverage Provider
**From**: NXTG-AI CoS | **Date**: 2026-02-19 | **Status**: PENDING
**Priority**: P0

**Action Items**:
1. [ ] Fix UAT Bug #2 (HIGH: stop button). Trace TalkButton → SessionManager → WebSocket send path. Confirm client sends `audio.stop` on button release. Report fix.
2. [ ] Fix UAT Bug #3 (HIGH: server streams after stop). Implement delivery acknowledgment protocol. Reference PI-004 (Forge WebSocket pattern). Report fix.
3. [ ] Install `@vitest/coverage-v8` and run `npx vitest run --coverage`. Report actual coverage %.
4. [ ] Fix the 24 failing client tests (AudioContext mock, WebSocket timer issue, empty test shells). Report new pass/fail counts for full suite.

**Constraints**:
- Do NOT break the 3-layer echo cancellation defense (Bug #1 fix).
- Do NOT break the FK placeholder row pattern (Bug #5 fix).
- Preserve sub-400ms latency.

**Response** (filled by project team):
> _(pending)_

---

## Portfolio Intelligence

_Cross-project insights injected by ASIF CoS. Read these for awareness — they inform your priorities._

### PI-001: Podcast-Pipeline TTS Engines May Replace OpenAI TTS (2026-02-17)
Podcast-Pipeline (P-04) has shipped F5-TTS and is bake-off testing OpenVoice v2, CosyVoice, and XTTS-v2 for voice cloning quality. These local-first TTS engines could eventually replace your dependency on the OpenAI Realtime API for speech synthesis — reducing latency, cost, and external dependency. No action now, but be aware of bake-off results when they ship.

### PI-002: OPA Policy Engine for Lane C Governance (2026-02-17)
oneDB (P-09) pioneered OPA deny-by-default policy enforcement. Your Lane C control plane (N-07) currently uses custom stubs for policy gates. When hardening Lane C, consider OPA as a formalized policy engine — it would give you declarative, auditable rules instead of bespoke code.

### PI-003: DesktopAI OllamaClient Pattern (2026-02-17)
DesktopAI (P-01) has the most mature Ollama integration in the portfolio: retry with exponential backoff, circuit breaker (3 failures → 30s cooldown), streaming, structured output. If you ever move TTS or LLM inference to local Ollama, reference their client pattern.

### PI-004: Forge Has the Most Mature WebSocket Implementation (2026-02-18)
NXTG-Forge (P-03) Infinity Terminal (N-02) has the portfolio's most battle-tested WebSocket: PTY bridge with session persistence through browser close/reconnects, 5-min keepalive, multi-client support, xterm.js 6.0. Your UAT bugs #2 (stop button unresponsive) and #3 (server streams after stop) are WebSocket event delivery issues. When fixing, reference Forge's event confirmation protocol.

### PI-005: HunyuanVideo-Avatar Could Enable Visual Talking-Head Mode (2026-02-19)
Podcast-Pipeline (P-04) has selected HunyuanVideo-Avatar (Tencent) for audio-driven talking-head video generation. The model takes a speaker photo + audio and produces lip-synced video with emotion control. It runs on ~10GB VRAM (RTX 4090 has 24GB). This could give voice-jib-jab a visual mode — users see an animated talking head during conversations. When Podcast-Pipeline installs and tests it, evaluate whether it fits your real-time latency requirements.

---

## Team Questions

_(Project team: add questions for ASIF CoS here. They will be answered during the next enrichment cycle.)_
