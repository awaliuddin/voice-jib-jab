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
**Actual (2026-02-19)**: 232/232 total tests passing (41 client + 191 server). Coverage provider installed. Client 35.37%, Server 37.54%. All test infra issues resolved (mock setup, fake timer interleaving, TypeScript errors).
**Actual (2026-02-20)**: 558/558 total tests passing (41 client + 517 server). Server coverage 67.7% stmts (was 38.74%). 11 new test suites covering storage (Database 94%, SessionHistory 96%, TranscriptStore 93%), insurance (PolicyGate 96.59%, AllowedClaimsRegistry 89%, AuditTrail 72%, FallbackPlanner 82%), lanes (LaneA 85%, LaneC 100%, ControlEngine 69%), and config (reflexWhitelist 95%). Two TS errors fixed (allowed_claims_registry TS2532, fallback_planner TS2322).
**Actual (2026-02-20 PM)**: 713/713 total tests passing (41 client + 672 server). Server coverage clears 70% CI gate: Stmts 78.84%, Branches 70.00%, Functions 81.29%, Lines 78.99%. +155 new tests across 7 suites: ConfigLoader (31), OpenAITTS (24), SessionManager (35), DisclaimerLookup (42), KnowledgePack (10), RAGPipeline (10), RetrievalIndex (3). Branch coverage boosted from 59.45%→70% via targeted tests on ControlEngine handleEvent switch, AuditTrail timeline loading, FallbackPlanner edge cases, LatencyBudget marker paths, EventBus onPattern, and retrieval modules.
**Next step**: Push toward 85% target. Priority: websocket.ts (0%, 318 uncov stmts), OpenAIRealtimeAdapter (73.8%), RetrievalService (85%), client components.

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
| 2 | HIGH | Stop button unresponsive — requires 3 clicks | FIXED — response.end deferred while audio playing + audio-aware click handler |
| 3 | HIGH | Server keeps streaming after client stop (30s+ lag) | FIXED — audioStopped guard on output handlers + cancel/stop ack protocol |
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
| 2026-02-19 | Fixed UAT bugs #2 and #3 (all 5 bugs now resolved). Installed coverage provider. 232/232 tests passing. Coverage at ~36%. |
| 2026-02-20 | Added CI/CD workflow (ADR-008 compliance). GitHub Actions: checkout → Node 22 → npm ci → npm test. Triggers on push/PR to main. |
| 2026-02-20 | Test coverage push: 232→558 tests, server coverage 38.74%→67.7%. 11 new test suites. Fixed 2 TS errors. Storage/insurance/lane layers covered. |
| 2026-02-20 | Coverage CI gate cleared: 558→713 tests (+155). Server passes 70% threshold — Stmts 78.84%, Branches 70%, Functions 81.29%, Lines 78.99%. 7 new/updated suites: ConfigLoader, OpenAITTS, SessionManager, DisclaimerLookup, KnowledgePack, RAGPipeline, RetrievalIndex. |

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
**From**: NXTG-AI CoS | **Date**: 2026-02-19 | **Status**: COMPLETED
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

**Response** (filled by project team — 2026-02-19):

> **1. Bug #2 — Stop button (FIXED):**
> Root cause identified and fixed. The `response.end` handler in SessionManager was immediately transitioning from `listening` to `connected` even while audio was still playing through speakers. This made the button show "Hold to Talk" instead of the interrupt option, so clicking started a new recording instead of stopping playback.
>
> Fix (3 changes):
> - `SessionManager.ts`: `response.end` handler now checks `audioPlayback.isActive()` — stays in `listening` state if audio is still playing. The `playbackEnd` callback handles the transition once audio finishes.
> - `VoiceInterface.tsx`: Added fallback guard — if state is `connected` but `isAudioPlaying` is true, clicking triggers `onBargeIn()` (stop) instead of `onPress()` (talk).
> - `SessionManager.ts`: `audio.cancel.ack` handler now forces audio stop and state transition to `connected` — delivery confirmation from server guarantees cleanup.
>
> **2. Bug #3 — Server streams after stop (FIXED):**
> Root cause: Server's Lane B audio output handler didn't check the `audioStopped` flag, so in-flight audio chunks from OpenAI continued flowing to the client after cancel.
>
> Fix (delivery ack protocol):
> - `websocket.ts`: Added `audioStopped` guard to Lane B and FallbackPlanner audio output handlers — drops chunks after cancel.
> - `websocket.ts`: `audio.cancel` and `audio.stop` handlers now send `response.end` after ack, completing the delivery confirmation protocol. Client is guaranteed no more audio after receiving the ack.
> - PI-004 referenced: Forge's event confirmation pattern inspired the ack+response.end two-message protocol.
>
> **3. Coverage installed and measured:**
> - `@vitest/coverage-v8@1.2.2` installed in client
> - **Client coverage**: 35.37% statements, 69.84% branches, 60.49% functions, 35.37% lines
> - **Server coverage**: 37.54% statements, 27.8% branches, 38.52% functions, 37.79% lines
> - Combined effective coverage: ~36% (up from estimated 14%, but still below 85% target)
>
> **4. Test failures fixed:**
> - **Client (vitest)**: Fixed SessionManager timeout test by replacing `vi.runAllTimersAsync()` with iterative `vi.advanceTimersByTimeAsync(0)` to allow async fingerprint generation + WebSocket setTimeout to interleave properly. **41/41 passing** (was 40/41).
> - **Server (jest)**: Fixed `lane-c-policy.test.ts` TypeScript errors (jest.requireMock typing) and rewritten with proper mock setup using inline audit trail mock. Fixed `voice-pipeline.test.ts` TTFB test by adding realistic delay between response.created and response.audio.delta. **191/191 passing** (was 186/191).
>
> **Summary:**
> | Item | Status | Details |
> |------|--------|---------|
> | Bug #2 (stop button) | FIXED | Client-side state transition + audio-aware click logic |
> | Bug #3 (streaming after stop) | FIXED | audioStopped guard on output + delivery ack protocol |
> | Coverage provider | INSTALLED | @vitest/coverage-v8 working |
> | Coverage % | 35-37% | Client 35.37%, Server 37.54% — target 85% |
> | Client tests | 41/41 | 0 failures (was 1 timeout) |
> | Server tests | 191/191 | 0 failures (was 6 — 5 lane-c-policy + 1 TTFB) |
> | Total tests | 232/232 | 100% pass rate |

---

### DIRECTIVE-NXTG-20260220-01 — CI/CD Compliance (ADR-008)
**From**: NXTG-AI CoS | **Date**: 2026-02-20 | **Status**: COMPLETED
**Priority**: P1

**Context**: ADR-008 (CI/CD Health Monitoring Protocol) has been accepted as a portfolio-wide standard. Every project MUST have a GitHub Actions CI workflow with a test gate. You currently have NO CI workflow.

**Action Items**:
1. [ ] **Create `.github/workflows/ci.yml`** with a test gate. Minimum viable workflow: checkout → setup Node → `npm ci` → `npm test`. Your test suite is 232/232 passing — this should be straightforward.
2. [ ] Workflow MUST trigger on `push` to `main` and `pull_request` to `main`.
3. [ ] Use `actions/checkout@v4` and `actions/setup-node@v4`.
4. [ ] Push the workflow and confirm it passes. **Report**: green workflow run URL.

**Constraints**:
- Workflow MUST fail on non-zero test exit. No `continue-on-error: true`.
- Do NOT skip server or client tests — run the full suite.

**Reference**: `~/ASIF/decisions/ADR-008-cicd-health-monitoring.md`

**Response** (filled by project team — 2026-02-20):

> **1. CI workflow created:** `.github/workflows/ci.yml` committed.
> - Steps: `actions/checkout@v4` → `actions/setup-node@v4` (Node 22, npm cache) → `npm ci` → `npm test`
> - Triggers: `push` to `main` and `pull_request` to `main`
> - No `continue-on-error` — workflow fails on any non-zero exit
> - Runs full suite: client (vitest, 41 tests) + server (jest, 191 tests) = 232 total
>
> **2. Triggers configured:** `on: push: branches: [main]` and `on: pull_request: branches: [main]` ✓
>
> **3. Actions versions:** `actions/checkout@v4` and `actions/setup-node@v4` ✓
>
> **4. Push & verification:** ✓ GREEN — https://github.com/awaliuddin/voice-jib-jab/actions/runs/22247111890
> - All steps passed: checkout → setup-node → npm ci → npm test
> - Run completed in 1m9s. 232/232 tests passing in CI.

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
