# NEXUS — voice-jib-jab Vision-to-Execution Dashboard

> **Owner**: Asif Waliuddin
> **Last Updated**: 2026-02-28
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
| N-07 | Lane C Control Plane v1 | GOVERNANCE | SHIPPED | P0 | 2026-02 |
| N-08 | Knowledge Pack Retrieval | GROUNDING | SHIPPED | P1 | 2026-02 |
| N-09 | Unit Test Coverage (14%→85%) | OBSERVABILITY | SHIPPED | P0 | 2026-02 |
| N-10 | Production Readiness QA | OBSERVABILITY | SHIPPED | P0 | 2026-02 |
| N-11 | SIP Telephony | EXTENSIBILITY | IDEA | P1 | — |
| N-12 | Ticketing Integration (MCP) | EXTENSIBILITY | IDEA | P1 | — |
| N-13 | Multi-Tenant Isolation | GOVERNANCE | IDEA | P1 | — |
| N-14 | Lane C v2: Semantic Governance | GOVERNANCE | SHIPPED | P2 | 2026-03-07 |
| N-15 | Dense Embedding Similarity for Claims | GOVERNANCE | IDEA | P2 | — |

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
- **Shipped**: N-07 (v1), N-14 (v2: OPA + embedding similarity)
- **Ideas**: N-13

### GROUNDING — "Fact-Checked Responses"
- ChromaDB vector store with knowledge pack. Citation trails
- AllowedClaimsRegistry for claim validation
- **Shipped**: N-05, N-08

### OBSERVABILITY — "Enterprise Compliance"
- Structured event logging (transcripts, tool calls, policy decisions)
- Conversation replay. PII redaction stubs
- **Shipped**: N-09, N-10

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

### N-07: Lane C Control Plane v1
**Pillar**: GOVERNANCE | **Status**: SHIPPED | **Priority**: P0
**What**: PolicyGate, AuditTrail, LatencyBudget, AllowedClaimsRegistry, FallbackPlanner. Stubs in place.
**Actual (2026-02-20 NIGHT)**: Production hardening — fixed 3 resource leaks and added 2 reliability improvements:
- **EventBus session listener leak**: `onSession()` now tracks wrapped handlers per session; `offSession()` properly removes them (was no-op before). `ControlEngine.destroy()` calls `offSession()`.
- **AuditTrail writeQueues leak**: Write queue `Map` entries now cleaned up on `session.end` events.
- **PolicyGate short-circuit**: Evaluation now breaks early on `cancel_output` or critical-severity `refuse`/`escalate` — avoids wasted downstream checks.
- **FallbackPlanner TTS timeout**: `getAudio()` wraps TTS call in `Promise.race` with 5s timeout; prevents indefinite hang.
- **FallbackPlanner cache limit**: Audio cache capped at 50 entries with FIFO eviction.
**Actual (2026-02-21)**: Content moderation system — ModeratorCheck upgraded from empty stub to production-ready categorized pattern engine:
- **7 moderation categories**: JAILBREAK (prompt injection), SELF_HARM (escalate to human), VIOLENCE_THREATS, HATE_SPEECH, ILLEGAL_ACTIVITY, EXPLICIT_CONTENT, HARASSMENT.
- **Category-aware matching**: Each category has its own decision type (refuse vs escalate), severity, and reason codes (`MODERATION:<CATEGORY_NAME>`).
- **Self-harm escalation**: SELF_HARM triggers `escalate` (human handoff) instead of `refuse`, with priority ordering (checked before VIOLENCE to correctly handle "i want to kill myself").
- **Zero false-positive design**: Patterns use word boundaries, person-object requirements on violence verbs, negative lookaheads to exclude self-harm from violence. 20+ enterprise text scenarios verified clean.
- **Backward-compatible**: `ModeratorCheck` still accepts `RegExp[]` for legacy use; categories are the new default via `ControlEngineConfig.moderationCategories`.
- **134 new tests**: Category structure validation, per-category positive/negative cases, category-aware reason codes, legacy mode, regex lastIndex safety, enterprise false-positive suite.
**Shipped scope**: PolicyGate (short-circuit on critical decisions), AuditTrail (session cleanup), LatencyBudget, AllowedClaimsRegistry, FallbackPlanner (TTS 5s timeout, 50-entry FIFO cache), ModeratorCheck (7-category production engine with 134 tests). 3 resource leaks fixed. v2 scope moved to N-14.

### N-08: Knowledge Pack Retrieval
**Pillar**: GROUNDING | **Status**: SHIPPED | **Priority**: P1
**What**: ChromaDB retrieval + Whisper transcription + fact injection into Lane B.
**Shipped scope**: RAGPipeline (138 LOC), RetrievalService (301 LOC), KnowledgePack (64 LOC), VectorStore (199 LOC), DisclaimerLookup (164 LOC). Integrated into Lane B with `retrievalService.retrieveFactsPack()`. 363 LOC tests across 3 test suites. Integration testing with real knowledge packs deferred to production usage.

### N-09: Unit Test Coverage
**Pillar**: OBSERVABILITY | **Status**: SHIPPED | **Priority**: P0
**What**: Current 14.69% → target 85%. OpenAIRealtimeAdapter needs 70+ tests. WebSocket mocking being resolved.
**Actual (2026-02-18)**: 40/41 server tests passing (1 timeout). 24/41 full-suite failures are test infra issues (missing AudioContext mock, WebSocket fake timer leaks, empty test shells). Coverage provider not installed — need `@vitest/coverage-v8`.
**Actual (2026-02-19)**: 232/232 total tests passing (41 client + 191 server). Coverage provider installed. Client 35.37%, Server 37.54%. All test infra issues resolved (mock setup, fake timer interleaving, TypeScript errors).
**Actual (2026-02-20)**: 558/558 total tests passing (41 client + 517 server). Server coverage 67.7% stmts (was 38.74%). 11 new test suites covering storage (Database 94%, SessionHistory 96%, TranscriptStore 93%), insurance (PolicyGate 96.59%, AllowedClaimsRegistry 89%, AuditTrail 72%, FallbackPlanner 82%), lanes (LaneA 85%, LaneC 100%, ControlEngine 69%), and config (reflexWhitelist 95%). Two TS errors fixed (allowed_claims_registry TS2532, fallback_planner TS2322).
**Actual (2026-02-20 PM)**: 713/713 total tests passing (41 client + 672 server). Server coverage clears 70% CI gate: Stmts 78.84%, Branches 70.00%, Functions 81.29%, Lines 78.99%. +155 new tests across 7 suites: ConfigLoader (31), OpenAITTS (24), SessionManager (35), DisclaimerLookup (42), KnowledgePack (10), RAGPipeline (10), RetrievalIndex (3). Branch coverage boosted from 59.45%→70% via targeted tests on ControlEngine handleEvent switch, AuditTrail timeline loading, FallbackPlanner edge cases, LatencyBudget marker paths, EventBus onPattern, and retrieval modules.
**Actual (2026-02-20 EVE)**: 885/885 total tests passing (41 client + 844 server). Server coverage EXCEEDS 85% target: Stmts 90.87%, Branches 81.19%, Functions 89.68%, Lines 91.20%. +131 new tests across 2 suites: WebSocketServer (62), WebSocketMessages (69). websocket.ts went from 0% to 97% (Stmts 96.98%, Branches 93.63%, Functions 97.22%). The largest untested file is now fully covered.
**Status**: SHIPPED. Server coverage: Stmts 90.87%, Branches 81.19%, Functions 89.68%, Lines 91.20%. 890 total tests (849 server + 41 client). CI gate at 70% passing. Remaining gaps: OpenAIRealtimeAdapter (73.8%), client components — diminishing returns; coverage exceeds target on 3/4 metrics.

### N-10: Production Readiness QA
**Pillar**: OBSERVABILITY | **Status**: SHIPPED | **Priority**: P0
**What**: Security audit, load testing (concurrent sessions), SLA validation, monitoring.
**Shipped scope**: Load test (200 concurrent WS sessions, p95 TTFB 126.7ms vs 1200ms SLA), SLA baseline, security audit (0 production vulns, 36 devDeps-only), secrets review (clean), production runbook (`RUNBOOK.md`), UAT guide (`UAT-Guide.md`). Monitoring/alerting deferred to production deployment (requires Prometheus/Grafana infrastructure).

### N-11: SIP Telephony
**Pillar**: EXTENSIBILITY | **Status**: IDEA | **Priority**: P1
**What**: StubTelephonyAdapter v1 (testing). LiveKitSIPTelephonyAdapter for v2 (real SIP).

### N-12: Ticketing Integration (MCP)
**Pillar**: EXTENSIBILITY | **Status**: IDEA | **Priority**: P1
**What**: LocalTicketingAdapter v1 (PostgreSQL). Zendesk/ServiceNow MCP adapters for enterprise.

### N-13: Multi-Tenant Isolation
**Pillar**: GOVERNANCE | **Status**: IDEA | **Priority**: P1
**What**: Org-scoped knowledge, policy, audit. Admin console. RBAC (admin, agent, viewer).

### N-15: Dense Embedding Similarity for Claims
**Pillar**: GOVERNANCE | **Status**: IDEA | **Priority**: P2
**What**: Replace `AllowedClaimsRegistry.getSimilarityScore()` TF-IDF internals with `all-MiniLM-L6-v2` ONNX (22MB, in-process, offline). Handles paraphrasing that TF-IDF misses ("response is instant" ≈ "latency is near zero"). `OpaClaimsCheck` interface unchanged — swap is internal to `getSimilarityScore()`. Must work offline (no OpenAI embeddings API — policy engine must be local-first).

### N-14: Lane C v2: Semantic Governance
**Pillar**: GOVERNANCE | **Status**: BUILDING | **Priority**: P2
**What**: Tier 2 semantic moderation (OpenAI Moderation API) for subtle/context-dependent violations. Embedding similarity for claims matching (vs. word-overlap). OPA integration (PI-002) for declarative policy rules. Successor to N-07 v1 scope.

**Phase 3 SHIPPED (2026-03-07)**:
- `AllowedClaimsRegistry.getSimilarityScore()` — TF-IDF cosine via `VectorStore`, independent of `matchText()` (backward compat preserved)
- `OpaEvaluator.evaluateClaimsCheck()` — `OpaClaimsInput`/`OpaClaimsOutput` + `claims_check` Rego rule (score >= threshold → allow, else → refuse)
- `OpaClaimsCheck` (`opa_claims.ts`) — two-tier: cosine score → OPA threshold → `CheckResult`; fallback to direct compare when OPA uninitialised
- `ControlEngine` wired: `opaClaimsThreshold` config field; `OpaClaimsCheck` replaces `ClaimsChecker` when `opaEvaluator` provided
- `build-policy.sh` updated: third entrypoint `voice_jib_jab/policy/claims_check`
- 18 new tests (`OpaClaimsCheck.test.ts`). 1062 total, 0 failed. N-14 → SHIPPED.

**Phase 1 SHIPPED (2026-03-05)**:
- `OpaEvaluator` class: wraps `@open-policy-agent/opa-wasm` v1.10.0; async `initialize()`, sync `evaluate()`, `_injectPolicy()` for testing
- `server/policies/voice_jib_jab/policy.rego`: Rego policy mirrors TS `DECISION_PRIORITY` logic; `winning_check`, `should_short_circuit`, default `result` rule
- `PolicyGate` wired: accepts optional `OpaEvaluator` in constructor; when initialized, OPA decides decision/severity/safeRewrite; TS loop still tracks checksRun/allReasonCodes/short-circuit
- 32 new tests: lifecycle, input/output mapping, format variations, latency (<1ms/eval), PolicyGate integration, edge cases. Zero regressions (1019 server tests).

**Implementation Notes (PI-007 OPA WASM Research — 2026-02-28)**:
- **Latency**: OPA compiled to WebAssembly delivers **sub-10 microsecond** policy evaluation — negligible against sub-400ms SLA.
- **Package**: `@open-policy-agent/opa-wasm` v1.10.0 — TypeScript-typed, in-process (no sidecar, no network hop).
- **Migration path** (3 phases when N-14 activates):
  - **Phase 1** — PolicyGate → Rego: Current decision tree maps directly to Rego semantics. Declare `allow`/`deny`/`cancel_output` rules; replace `PolicyGate.evaluate()` with OPA WASM instance.
  - **Phase 2** — ModeratorCheck → Rego + OpenAI Moderation API: Keep pattern engine as Tier 1 (zero-latency). Add Tier 2 semantic moderation via `openai.moderations.create()` for context-dependent violations. Gate behind Rego rule: invoke Tier 2 only when Tier 1 returns `allow`.
  - **Phase 3** — AllowedClaimsRegistry → Rego + ChromaDB embedding similarity: Replace word-overlap with vector cosine similarity. Feed scores into Rego data document; rule decides allow/deny threshold.
- **Cross-project reuse**: oneDB (P-09) has 40/40 OPA tests across 7 policy primitives. Their deny-by-default Rego patterns are directly reusable for Lane C.
- **Estimated effort**: L (3-5 days — Rego authoring, WASM bundle, Tier 2 API integration, 50+ new tests).

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
| 2026-02-20 | N-09 target exceeded: 713→844 tests (+131). Server Stmts 90.87%, Branches 81.19%, Functions 89.68%, Lines 91.20%. websocket.ts 0%→97%. 2 new suites: WebSocketServer (62), WebSocketMessages (69). Stale dist/ removed. |
| 2026-02-20 | N-07 Lane C hardening: Fixed 3 resource leaks (EventBus session handlers, AuditTrail writeQueues, FallbackPlanner audio cache). Added PolicyGate short-circuit on critical decisions and FallbackPlanner TTS 5s timeout. +5 tests. N-09 moved to SHIPPED. |
| 2026-02-21 | N-07 content moderation: ModeratorCheck upgraded from stub to 7-category pattern engine (JAILBREAK, SELF_HARM, VIOLENCE, HATE_SPEECH, ILLEGAL, EXPLICIT, HARASSMENT). Category-aware reason codes, self-harm escalation, zero false-positive design. +134 tests. 1028 total (987 server + 41 client). |
| 2026-02-22 | N-10 load test + SLA baseline: Server handles 200 concurrent sessions with p95 TTFB 126.7ms (SLA: <1200ms). Created `tests/load/ws-load-test.ts` (mock OpenAI, concurrent client simulation), `docs/load-test-results.md`, `UAT-Guide.md`. Added `OPENAI_REALTIME_URL` env override for testability. 1028 tests, zero regressions. |
| 2026-02-22 | N-10 security audit: `npm audit fix` applied (39→36 vulns, all remaining in devDependencies). Secrets review clean — zero hardcoded keys. Production runbook created: `RUNBOOK.md` (deployment, scaling, incident response). |
| 2026-02-28 | CoS directive execution: N-07 BUILDING→SHIPPED (Lane C v1 complete — PolicyGate, AuditTrail, LatencyBudget, AllowedClaimsRegistry, FallbackPlanner, ModeratorCheck). N-08 BUILDING→SHIPPED (RAGPipeline + retrieval stack, 897 LOC + 363 LOC tests). N-10 BUILDING→SHIPPED (load test, SLA, security audit, runbook — monitoring deferred to prod infra). N-14 created as IDEA (Lane C v2: Semantic Governance — OPA, embedding similarity, OpenAI Moderation API). 10/13 initiatives now SHIPPED, 0 BUILDING, 3 IDEA. |
| 2026-02-22 | UAT bugs verified (all 5 fixed in prior directives). Demo guide created: `DEMO-GUIDE.md` (5-min stakeholder script, 6 acts, synthetic voices only). 1028/1028 tests passing. |
| 2026-02-28 | Post-sprint hardening (DIRECTIVE-NXTG-20260228-03): 1028/1028 tests confirmed passing. N-14 enriched with PI-007 OPA WASM implementation notes (sub-10μs latency, 3-phase migration path). 7 completed directives archived to NEXUS-archive.md. NEXUS trimmed to active directive only. |
| 2026-03-05 | DIRECTIVE-NXTG-20260304-04: CI Gate Protocol adopted — section added to CLAUDE.md, pre-push hook installed. 1019 server + 41 client tests confirmed passing. |
| 2026-03-05 | DIRECTIVE-NXTG-20260304-01: N-14 Phase 1 shipped — OpaEvaluator + Rego policy + PolicyGate wiring. @open-policy-agent/opa-wasm@1.10.0 installed. 32 new tests. 1019 server tests (zero regressions). N-14 IDEA→BUILDING. |
| 2026-03-06 | DIRECTIVE-NXTG-20260306-01: N-14 Phase 2 shipped — OpaModeratorCheck two-tier moderation (pattern + OPA threshold), moderator_check Rego rule, ControlEngine.initialize() (CoS Q2), scripts/build-policy.sh (CoS Q1). 25 new tests. 1044 total, 0 failed. |
| 2026-03-06 | Q3+Q4 fixes: build-policy.sh entrypoints corrected to voice_jib_jab/policy/result + voice_jib_jab/policy/moderator_check (Q3). OPA singleton wired end-to-end — async startServer(), initializeOpa(), config.opa section, VoiceWebSocketServer constructor threaded to ControlEngine (Q4). 1044 tests, 0 failed. |
| 2026-03-07 | DIRECTIVE-NXTG-20260307-02: Gate 8.3 mock justification (voice-pipeline.test.ts ws mock) + SessionManager flaky timer fix (jest.clearAllTimers() before useRealTimers()). 1044 tests, 0 failed. |
| 2026-03-07 | DIRECTIVE-NXTG-20260307-03: N-14 Phase 3 SHIPPED — OpaClaimsCheck (VectorStore TF-IDF cosine + Rego claims_check threshold rule). getSimilarityScore() independent of matchText() for backward compat. 18 new tests. 1062 total, 0 failed. N-14 → SHIPPED (11/14). |
| 2026-03-08 | DIRECTIVE-NXTG-20260308-04: Governance hygiene — 6 completed directives archived verbatim to NEXUS-archive.md (CoS Archive section). Initiative audit: all 15 statuses verified against git log, no changes required. |

---

## CoS Directives

> Completed directives archived to [NEXUS-archive.md](./NEXUS-archive.md). 6 directives archived 2026-03-08.

### DIRECTIVE-NXTG-20260308-04 — Governance Hygiene: Archive DONE Directives + Initiative Audit
**From**: NXTG-AI CoS | **Priority**: P2
**Injected**: 2026-03-08 09:55 | **Estimate**: S | **Status**: DONE

**Action Items**:
1. [x] Archive all DONE directives from this `## CoS Directives` section into `NEXUS-archive.md` (or create a `## CoS Archive` section at the bottom of NEXUS-archive.md if it doesn't have one). Move the full directive text (header, metadata, action items, response) — do not summarize.
2. [x] Leave only PENDING directives (if any) in the `## CoS Directives` section. Add an updated archive note with the count and date.
3. [x] Audit all initiative statuses in the Executive Dashboard section of NEXUS: verify each initiative marked IN PROGRESS is actually in progress (has recent commits or open work). Flag any that should be SHIPPED or DONE based on actual state.
4. [x] If any initiative status changes, update them in the Executive Dashboard and note the change in the response below.

**Constraints**:
- Do NOT modify directive content when archiving — preserve exactly as written (including team responses).
- Do NOT change initiative statuses without verifying actual project state (check git log, test results, etc.).

**Response** (filled by project team):
> **COMPLETE — 2026-03-08**
>
> 1. **6 DONE/COMPLETE directives archived** verbatim to `NEXUS-archive.md` (`## CoS Archive — 2026-03-08` section): DIRECTIVE-NXTG-20260304-04, DIRECTIVE-NXTG-20260304-01, DIRECTIVE-NXTG-20260306-01, DIRECTIVE-NXTG-20260306-02, DIRECTIVE-NXTG-20260307-02, DIRECTIVE-NXTG-20260307-03.
> 2. `## CoS Directives` section now contains only this directive. Archive note updated: "6 directives archived 2026-03-08."
> 3. **Initiative audit** — all 15 initiatives verified against git log and changelog:
>    - N-01 through N-10: SHIPPED ✓ (confirmed by changelog entries through 2026-03-07)
>    - N-11, N-12, N-13: IDEA ✓ (no active work — status correct)
>    - N-14: SHIPPED ✓ (Lane C v2 all 3 phases complete, last commit 2026-03-07)
>    - N-15: IDEA ✓ (deferred per CoS Q7 response)
> 4. No status changes — all initiative statuses are accurate.

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

### PI-007: Voice TTS SOTA March 2026 — Kokoro+RVC Pipeline Replaceable (2026-03-04)

Full brief: `~/ASIF/enrichment/2026-03-04-voice-tts-sota-brief.md`

**Key findings affecting P-07 (voice-jib-jab):**
1. **Fish Speech v1.5** (Apache 2.0, 4B) — TTS-Arena #1, zero-shot voice cloning from 10-30s reference audio. Could replace the entire Kokoro+RVC pipeline with a single-stage model. No per-celebrity training needed.
2. **Qwen3-TTS** (Apache 2.0, 0.6-1.7B) — **3-second** voice cloning. Voice design via natural language description. Aligns with portfolio Qwen standard.
3. **Chatterbox** (MIT, 5-second clone) — paralinguistic control: `[laugh]`, `[cough]`, `[sigh]`. Celebrity voice mimicry without training.
4. **Seed-VC** — zero-shot voice conversion. Direct replacement for RVC without per-speaker training. `github.com/Plachtaa/seed-vc`
5. **RVC** — aging. Zero-shot alternatives (Fish Speech, Qwen3-TTS, Seed-VC) eliminate the need for per-celebrity RVC training.
6. **Kokoro** — still best at 82M params. Rust port exists. Keep as lightweight fallback.

**Recommended P-07 actions** (from brief):
- Replace Kokoro+RVC with Fish Speech v1.5 or Qwen3-TTS (one-stage, no per-celebrity training)
- Add IndexTTS-2 for 8-dimension emotion vector control
- If real-time VC still needed, replace RVC with Seed-VC (zero-shot)

---

## Team Questions

**Q3 — Build script entrypoint naming** _(2026-03-06)_: `build-policy.sh` uses entrypoints `voice_jib_jab/result` and `voice_jib_jab/moderator_check` per the plan spec. But `package voice_jib_jab.policy` + rule `result` should map to entrypoint `voice_jib_jab/policy/result`. I believe the plan's entrypoints are incorrect and the script will error when actually run. Confirm: correct entrypoints `voice_jib_jab/policy/result` + `voice_jib_jab/policy/moderator_check`? If yes, standing auth to fix.

> **CoS Response (Wolf, 2026-03-06):**
> **CONFIRMED.** You are correct — OPA WASM entrypoints mirror the full package path with dots→slashes. The correct entrypoints are `voice_jib_jab/policy/result` and `voice_jib_jab/policy/moderator_check`. The plan spec was wrong. **Standing authorization to fix `build-policy.sh`.** Good catch — this was indeed a latent bug invisible to CI. **Status: Q3 ANSWERED. GO.**

> **Team Response (2026-03-06):** **FIXED.** `scripts/build-policy.sh` updated to use `-e voice_jib_jab/policy/result -e voice_jib_jab/policy/moderator_check`. 1044 tests green. Committed. **Status: Q3 RESOLVED.**

**Q4 — Production OpaEvaluator bootstrap** _(2026-03-06)_: `ControlEngine.initialize()` exists but no production code calls it. `LaneArbitrator` creates `ControlEngine` per-session. Should `OpaEvaluator` be (a) a singleton initialized once at server startup and injected into every `ControlEngine` via config, or (b) initialized per-session? Option (a) is correct for WASM. Where in the server bootstrap should `await opaEvaluator.initialize()` live?

> **CoS Response (Wolf, 2026-03-06):**
> **Option (a) — singleton at server startup.** WASM bundle loads once, shared across all sessions via JS event loop. Wire it in the server's `createServer()` / main bootstrap function: `const opaEvaluator = new OpaEvaluator(config); await opaEvaluator.initialize();` then pass it into `LaneArbitrator` constructor (or config object) so every `ControlEngine` receives the pre-initialized instance. Do NOT lazy-init per-session — that defeats the purpose of WASM pre-compilation. **Standing authorization to implement.** **Status: Q4 ANSWERED. GO.**

> **Team Response (2026-03-06):** **IMPLEMENTED.** OPA singleton wired end-to-end: `server/src/config/index.ts` gains `opa.enabled` (`ENABLE_OPA`, default `false`) + `opa.bundlePath` (`OPA_BUNDLE_PATH`). `server/src/index.ts` refactored to `async startServer()` with `initializeOpa()` helper — OPA initializes before `server.listen()`, so no session can start before the WASM bundle is loaded. `OpaEvaluator` passed into `VoiceWebSocketServer` constructor, threaded through to every per-session `ControlEngine` instance. 1044 tests green. Committed. **Status: Q4 RESOLVED.**

---

## CoS Answers (Enrichment Cycle 2026-03-06)

> Answers to questions from Team Feedback (2026-03-05 session).

**Q1 — WASM bundle toolchain**: Option (a) — install `opa` CLI via curl in CI as a `build:policy` npm script. Do NOT commit binaries to git. Create `scripts/build-policy.sh` that downloads `opa` if not present, then runs `opa build -t wasm -e voice_jib_jab/result server/policies/`. This aligns with the portfolio OPA pattern (voice-jib-jab + dx3 both using OPA). Standing authorization to implement.

**Q2 — OPA initialization in ControlEngine**: Await at startup. The fallback path exists for safety, but production should always initialize OPA before accepting sessions. Startup latency is acceptable (WASM load is sub-100ms). Clean code > clever fallback. Standing authorization to implement.

---

## Team Feedback

> Session: 2026-03-09 (check-in 33) | Author: Claude Sonnet 4.6

Nothing new. Sixth consecutive idle session. Q8 still open. Awaiting directive.

---

> Session: 2026-03-09 (check-in 32) | Author: Claude Sonnet 4.6

Nothing new. Fifth consecutive idle session. Q8 still open. Awaiting directive.

---

> Session: 2026-03-09 (check-in 31) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing. Fourth consecutive idle session. No directives since `8d62908` (2026-03-08). Q8 raised last session, awaiting CoS response.

---

### 2. What surprised me?

Nothing new to surface this session. Standing observation: the project is in a stable post-sprint holding pattern.

---

### 3. Cross-project signals

None new.

---

### 4. What would I prioritize next?

Unchanged from check-in 30: N-11 spike, N-15, or CI coverage floor — pending Q8 answer.

---

### 5. Blockers / questions for CoS?

Q8 still open (raised check-in 30). No new questions.

---

> Session: 2026-03-09 (check-in 30) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing new. No directives since check-in 28 (governance hygiene, `8d62908`). Project state unchanged: 11/15 SHIPPED, 1103 tests green.

---

### 2. What surprised me?

**Three consecutive idle check-ins is a pattern worth naming.** Check-ins 27, 29, 30 are all "nothing new." This isn't a problem — the prior sprint (Phases 1-3 of N-14) was dense and high-quality. But if the idle period extends past the next enrichment cycle, it's worth asking: is the CoS queue empty by design, or is there work that should be directed?

**The project has a real next step that isn't in the dashboard yet.** N-11 (SIP Telephony) is listed as IDEA with no architecture, no spike, no vendor evaluation. If the CoS wants to move voice-jib-jab toward enterprise deployment, this is the gap. It's not in the dashboard because no one has scoped it — that's the actual work.

---

### 3. Cross-project signals

Nothing new to surface. Prior signals still standing: local-first policy engines (ONNX), NEXUS file size as governance health metric.

---

### 4. What would I prioritize next?

Given it's a new day with no active directives, I'd propose a scoping spike:
- **N-11 architecture spike** — pick a SIP stack (FreeSWITCH vs Asterisk vs Twilio Media Streams), map the latency budget impact, and write an ADR. This converts N-11 from IDEA to a plannable directive.
- **N-15 dense embeddings** — small, self-contained, CoS previously deferred but no hard block. Could ship in one session.
- **Coverage floor CI gate** — add `coverageThreshold` to jest config to protect the 90%+ server coverage we've built.

---

### 5. Blockers / questions for CoS?

**Q8 — Is N-11 (SIP Telephony) on the near-term roadmap, or deliberately parked?** If it's near-term, I'd recommend a scoping spike as the next directive (S estimate). If it's parked, I'd shift focus to N-15 or coverage hardening. Flagging because three idle sessions suggests the directive queue may be empty and I want to make sure I'm not missing standing work.

---

> Session: 2026-03-08 (check-in 29) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing new this session. Check-in 28 (same date, prior session) covered governance hygiene — 6 directives archived, initiative audit complete, 1103 tests green. No code changes since commit `8d62908`.

---

### 2. What surprised me?

**Idle sessions are a signal, not a failure.** Two consecutive "nothing new" check-ins (27, 29) bracket a dense week of OPA Lane C v2 work (Phases 1-3, 75+ new tests, 3 commits). The cadence is: burst of directed work → brief idle → next directive cycle. This is healthy — it means the team isn't inventing scope.

---

### 3. Cross-project signals

Nothing new to report. Standing signals from check-in 28 still apply: NEXUS file size as a governance metric, local-first policy engines (ONNX over API).

---

### 4. What would I prioritize next?

Same as check-in 28:
- **N-11 (SIP Telephony)** — enterprise deployment blocker. No code foundation yet; would need architecture planning (PSTN gateway, SIP stack selection, latency budget reallocation).
- **N-15 (Dense Embedding Similarity)** — low effort, CoS deferred but not blocked.
- **CI coverage floor** — CRUCIBLE Gate 4 catches count drops but not coverage regression. A `--coverageThreshold` in jest config would add a second quality gate.

---

### 5. Blockers / questions for CoS?

None. Portfolio is healthy: 11/15 SHIPPED, 0 BUILDING, 4 IDEA. Awaiting next directive.

---

> Session: 2026-03-08 (check-in 28) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Governance hygiene only — no new feature code. Executed DIRECTIVE-NXTG-20260308-04:
- **6 DONE/COMPLETE directives archived** verbatim to `NEXUS-archive.md` (new `## CoS Archive — 2026-03-08` section)
- **`## CoS Directives` trimmed** to 1 directive (DIRECTIVE-NXTG-20260308-04, now DONE)
- **Initiative audit**: all 15 initiatives reviewed against git log and changelog — no status changes needed
- Tests: **1103 passed, 0 failed** (1062 server + 41 client). Commit: TBD.

---

### 2. What surprised me?

**NEXUS was 81KB.** Six directives with full responses (action items, deliverables, quotes) accumulate significant mass quickly. The archive pattern is working — `NEXUS.md` trimmed to under 40KB after this hygiene cycle, making it much faster to read at session start.

**Governance hygiene directives are zero-risk but high-value.** This took ~10 minutes and makes every future session cheaper (less reading, clearer signal). The pattern of archiving DONE directives rather than leaving them in NEXUS is a good habit to maintain proactively, not just when CoS directs it.

---

### 3. Cross-project signals

**NEXUS file size is a governance health metric.** If NEXUS.md exceeds ~50KB, it means completed directives are accumulating. Any ASIF project should watch for this and run a hygiene pass proactively. Consider a standing order: archive DONE directives at each session start before reading new ones.

---

### 4. What would I prioritize next?

Portfolio is in a strong position:
- **N-11 (SIP Telephony)** — most impactful next step for enterprise deployment. No existing foundation, but clear scope.
- **N-15 (Dense Embedding Similarity)** — deferred by CoS; would strengthen OpaClaimsCheck beyond TF-IDF. Low effort given VectorStore already ships.
- **Coverage monitoring** — 1062 tests passing but no coverage regression gate (only count gate via CRUCIBLE). Adding a coverage floor check to CI would catch silent regressions.

---

### 5. Blockers / questions for CoS?

None. Clean state. Awaiting next directive.

---

> Session: 2026-03-07 (check-in 27) | Author: Claude Sonnet 4.6

Nothing new. Awaiting directive.

---

> Session: 2026-03-07 (check-in 26) | Author: Claude Sonnet 4.6

### 1. What did you ship?

No new code. Q7 resolved by CoS. Created N-15 (Dense Embedding Similarity) as IDEA in dashboard. Dashboard now: **11/14 SHIPPED, 0 BUILDING, 4 IDEA** (N-11, N-12, N-13, N-15).

---

### 2. What surprised me?

**"Don't reopen shipped initiatives" is a clean governance principle.** The instinct when finding a gap in a shipped feature is to open a sub-ticket or Phase 4. CoS Wolf's decision to make it N-15 instead is cleaner: N-14 has a clear definition of done, N-15 has a separate one. Shipped means shipped. This also keeps NEXUS readable — initiative scope stays bounded.

**"Policy engines must work offline" is a useful constraint to encode explicitly.** The recommendation to use `all-MiniLM-L6-v2` ONNX instead of OpenAI embeddings wasn't obvious from the architecture. A policy/moderation engine should never have a runtime dependency on an external API — if the API is down, moderation fails open. Local-first is a safety property, not just a cost optimization.

---

### 3. Cross-project signals

**Local-first policy engines: ONNX over API.** Any ASIF project using OPA or a similar policy engine for moderation/claims should follow the same principle: embeddings computation must be local-first. `all-MiniLM-L6-v2` ONNX at 22MB is the portfolio recommendation. API-based embeddings (OpenAI, Cohere) are for retrieval/RAG where degraded behavior is acceptable; policy is not that context.

---

### 4. What I'd prioritize next

1. **N-11 SIP Telephony** or **N-13 Multi-Tenant Isolation** — both P1 IDEAS, both required for enterprise deployment. CoS direction needed on which comes first.
2. **N-15** when prioritized: swap `getSimilarityScore()` internals to ONNX. The `OpaClaimsCheck` interface is already clean for it — estimated S/M effort.

---

### 5. Blockers / Questions for CoS

No blockers. No new questions. Ready for next directive.

---

> Session: 2026-03-07 (check-in 25) | Author: Claude Sonnet 4.6

### 1. What did you ship?

| Deliverable | Detail |
|-------------|--------|
| N-14 Phase 3 — `OpaClaimsCheck` | Two-tier claims verification: `getSimilarityScore()` (TF-IDF cosine via `VectorStore`) → OPA `claims_check` threshold rule → `CheckResult`. |
| `AllowedClaimsRegistry.getSimilarityScore()` | New method using `VectorStore`. Independent of `matchText()` — backward compat preserved. Corpus indexed at construction. |
| `policy.rego` `claims_check` rule | `similarity_score >= threshold → allow`, else `→ refuse CLAIMS:UNVERIFIED`. Third WASM entrypoint. |
| `build-policy.sh` updated | Third entrypoint `voice_jib_jab/policy/claims_check` added. |
| `ControlEngine` wired | `opaClaimsThreshold` config field; `OpaClaimsCheck` replaces `ClaimsChecker` when `opaEvaluator` provided. |
| 18 new tests | `OpaClaimsCheck.test.ts`: lifecycle (4), disallowed patterns (2), OPA allow (3), OPA refuse (2), threshold edge cases (5), integration (2). |
| **N-14 → SHIPPED** | Dashboard: **11/14 SHIPPED, 0 BUILDING**. |
| **Test count** | **1062 passed, 0 failed**. Commits: `755e145` (feat), `036d245` (NEXUS). |

---

### 2. What surprised me?

**Changing `matchText()` to use VectorStore broke an existing test — and the failure was subtle.** The `ClaimsCheck` in `policy_gate.ts` uses `matchResult.matchType` to decide its return value. Swapping word-overlap for TF-IDF cosine changed which `matchType` was returned for the `FDA_CLAIM` test case. The test expected `"none"` (no match → `UNVERIFIED_CLAIM`), but TF-IDF on a small corpus (1 document) produced a score high enough to return `"partial"`. Fix: keep `matchText()` unchanged, add `getSimilarityScore()` as a new independent method. This is the right separation — `matchText()` serves the existing `ClaimsCheck` interface; `getSimilarityScore()` serves `OpaClaimsCheck`. Two consumers, two methods.

**TF-IDF cosine on a single-document corpus inflates scores.** With one document, all terms get IDF = 1.0 and the query's term overlap with that document is magnified. The word-overlap heuristic in `matchText()` didn't have this property because it's purely proportion-based. The lesson: VectorStore TF-IDF is designed for multi-document retrieval. When used as a single-document similarity check, scores behave differently than intuition suggests. For small corpora, the new `getSimilarityScore()` should be interpreted relative to the corpus size.

---

### 3. Cross-project signals

**"Two methods for two consumers" is the right API design when adding a new computation path to an existing class.** Instead of modifying `matchText()` and breaking downstream code, `getSimilarityScore()` is additive. Any ASIF project adding vector similarity to an existing text-matching class should follow this pattern: add a new method, don't change the existing one.

**TF-IDF VectorStore is not ChromaDB.** The CoS Q5/Q6 answers referenced "ChromaDB" and "existing VectorStore" somewhat interchangeably. The actual `VectorStore.ts` in this project is a pure in-memory TF-IDF implementation — no external dependency, no embeddings API, fully synchronous. It is NOT ChromaDB. For portfolio communication, these should be kept distinct: TF-IDF cosine (what we have) vs. embedding cosine (true semantic similarity). The difference matters for paraphrase handling.

---

### 4. What I'd prioritize next

With N-14 SHIPPED and 0 initiatives BUILDING, the portfolio enters a new phase. Three options:

1. **N-11 SIP Telephony** (P1, IDEA): LiveKit SIP adapter would add real phone-call support. Highest business value for enterprise deployment.
2. **N-13 Multi-Tenant Isolation** (P1, IDEA): Org-scoped policy, RBAC, admin console. Required before any multi-customer production deployment.
3. **True semantic embeddings upgrade for N-14**: The current `getSimilarityScore()` uses TF-IDF, not embedding cosine. Upgrading to OpenAI embeddings or a local model would handle paraphrasing properly (the original N-14 vision). Low risk — `OpaClaimsCheck` interface unchanged, only `getSimilarityScore()` internals change.

---

### 5. Blockers / Questions for CoS

**Q7 — True embedding similarity for claims**: The shipped `getSimilarityScore()` uses TF-IDF cosine, not dense vector embeddings. This handles keyword overlap but not paraphrasing ("response is instant" ≈ "latency is near zero"). The original N-14 vision mentioned embedding cosine. Is upgrading `getSimilarityScore()` to use OpenAI embeddings (or a local ONNX model) in scope for this sprint, or deferred? If deferred, should we document it as N-14 Phase 4 or a separate initiative?

> **CoS Response (Wolf, 2026-03-07):**
> **DEFERRED. Document as N-15 (not N-14 Phase 4).** N-14 is SHIPPED — don't reopen shipped initiatives. TF-IDF cosine is a good v1 (handles keyword overlap, zero external dependencies, sub-ms latency). True embedding similarity is a separate concern: it introduces either an external API dependency (OpenAI embeddings — violates local-first for a policy engine) or a local ONNX model (~100MB, startup cost). The right approach: create **N-15: Dense Embedding Similarity** as an IDEA. When prioritized, swap `getSimilarityScore()` internals — the `OpaClaimsCheck` interface is already clean for this. Recommendation: use `all-MiniLM-L6-v2` ONNX (22MB, runs in-process). NOT OpenAI — this is a policy engine, it must work offline. **Status: Q7 ANSWERED.**

---

> Session: 2026-03-07 (check-in 24) | Author: Claude Sonnet 4.6

Nothing new. Awaiting directive.

---

> Session: 2026-03-07 (check-in 23) | Author: Claude Sonnet 4.6

Nothing new since check-in 22. Awaiting N-14 Phase 3 directive.

---

> Session: 2026-03-07 (check-in 22) | Author: Claude Sonnet 4.6

### 1. What did you ship?

| Deliverable | Detail |
|-------------|--------|
| Gate 8.3 mock justification | `voice-pipeline.test.ts:21` — changed `// Mock WebSocket` to `// MOCK JUSTIFIED: WebSocket is infrastructure — real WS server not available in CI`. Satisfies CRUCIBLE Gate 8.3 documentation requirement. |
| SessionManager flaky timer fix | Added `jest.clearAllTimers()` before `jest.useRealTimers()` in `afterEach`. Eliminates the window where pending fake timers fire after clock restoration and race with the next test's setup. |
| **Test count** | **1044 passed, 0 failed**. Commits: `9a07bbc` (fix), `45b4e6a` (NEXUS). |

---

### 2. What surprised me?

**The flaky fix was one line.** "Fix race condition" sounds like surgery — it was `jest.clearAllTimers()`. The entire class of fake-timer flakiness in Jest collapses to this one pattern: `beforeEach` sets fake timers, test runs, but `afterEach` restores real timers without purging pending fakes first. Any pending `setTimeout` from the current test fires in real time during teardown, potentially interfering with the next test's `beforeEach`. Adding `clearAllTimers()` before `useRealTimers()` closes that window completely.

**Gate 8.3 is documentation-as-code.** The actual mock line was correct all along — `jest.mock("ws")` in an integration test is completely legitimate when the test exercises WebSocket message handling but not socket connectivity. Gate 8.3 just requires you to say so explicitly in the source. The discipline is useful: it forces the author to articulate *why* the mock is there, which is both self-documenting and prevents future "is this intentional?" confusion during audits.

---

### 3. Cross-project signals

**`jest.clearAllTimers()` before `jest.useRealTimers()` is a portfolio-wide pattern.** Any ASIF project using `jest.useFakeTimers()` in `beforeEach` + `jest.useRealTimers()` in `afterEach` should also call `jest.clearAllTimers()` in that same `afterEach`. The absence of it is a latent flakiness bug in every project that uses this pattern. dx3, oneDB, any project with timer-heavy tests should audit their `afterEach` blocks.

**CRUCIBLE Gate 8.3 mock justification comments should be standard practice.** For any test that mocks infrastructure (DB, WS, filesystem, network), a one-line `// MOCK JUSTIFIED: <reason>` comment above the mock prevents audit flags and communicates intent to the next developer. Low cost, high signal value.

---

### 4. What I'd prioritize next

**N-14 Phase 3 — AllowedClaimsRegistry → Rego + ChromaDB embedding similarity.** All design questions resolved (Q5, Q6), standing auth granted, architecture clear. This is the only remaining work to close N-14 → SHIPPED.

---

### 5. Blockers / Questions for CoS

No blockers. No questions. Ready for Phase 3 directive.

---

> Session: 2026-03-07 (check-in 21) | Author: Claude Sonnet 4.6

Nineteenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 20) | Author: Claude Sonnet 4.6

Eighteenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 19) | Author: Claude Sonnet 4.6

Seventeenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 18) | Author: Claude Sonnet 4.6

Sixteenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 17) | Author: Claude Sonnet 4.6

Fifteenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 16) | Author: Claude Sonnet 4.6

Fourteenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 15) | Author: Claude Sonnet 4.6

Thirteenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 14) | Author: Claude Sonnet 4.6

Twelfth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-07 (check-in 13) | Author: Claude Sonnet 4.6

Eleventh idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-06 (check-in 12) | Author: Claude Sonnet 4.6

Tenth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-06 (check-in 11) | Author: Claude Sonnet 4.6

Ninth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-06 (check-in 10) | Author: Claude Sonnet 4.6

Eighth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-06 (check-in 9) | Author: Claude Sonnet 4.6

Seventh idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-06 (check-in 8) | Author: Claude Sonnet 4.6

Sixth idle cycle. No new signal. Awaiting directive.

---

> Session: 2026-03-06 (check-in 7) | Author: Claude Sonnet 4.6

Nothing new to report. Fifth consecutive idle cycle. All prior analysis stands. Phase 3 ready to execute on directive. No blockers, no new questions.

---

> Session: 2026-03-06 (check-in 6) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing. Fourth consecutive idle check-in. Last code commit: `a8da29f` (2026-03-06, Q3+Q4 OPA fixes). Team is fully unblocked on Phase 3 but has no directive to execute.

---

### 2. What surprised me?

**Reflection cadence without work delta produces diminishing signal.** Check-ins 3–6 are structurally identical: nothing shipped, same Phase 3 priority, same no-blockers status. The ritual is valuable as a ship-log and cross-project signal mechanism — but at 4 consecutive idle cycles it's generating noise rather than signal. Worth flagging: if the CoS intends this as a keep-alive / context-refresh mechanism, it's working. If the intent is genuine feedback capture, the signal-to-noise degrades fast without intervening work.

---

### 3. Cross-project signals

None new. All prior signals (init chain pattern, Rego-as-decision-layer, batch-embed-at-startup) remain valid and are recorded in prior entries.

---

### 4. What I'd prioritize next

Same as check-in 5: **N-14 Phase 3**. Design complete, auth granted, team ready. Waiting on directive.

---

### 5. Blockers / Questions for CoS

No technical blockers. One process observation: four idle reflection cycles suggests either (a) Phase 3 directive is coming and the CoS is batching it intentionally, or (b) the reflection prompt is being issued without checking whether new work exists. If (b), consider issuing the Phase 3 directive directly — the team is ready.

---

> Session: 2026-03-06 (check-in 5) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing since check-in 4. Last code commit: `a8da29f`. No directives pending. Q6 answered by CoS within the same session.

---

### 2. What surprised me?

**Both Q5 and Q6 resolved in the same enrichment cycle they were raised.** Three idle check-ins in a row (3, 4, 5) where CoS answered questions faster than the team had work to execute. Phase 3 has been fully unblocked for some time — the design is complete, standing auth granted. The only gate is a directive.

---

### 3. Cross-project signals

**`startServer()` init chain is now the canonical bootstrap pattern for this project.** CoS confirmed: `initializeOpa()` then `initializeClaimsEmbeddings()` — sequential async init before `server.listen()`. Portfolio-wide: any server owning multiple pre-warmed resources should chain them in `startServer()`, not scatter `await` across constructors and lazy initializers.

---

### 4. What I'd prioritize next

**N-14 Phase 3 immediately.** All design questions answered:
- Batch-embed `AllowedClaimsRegistry` entries into ChromaDB at startup via `initializeClaimsEmbeddings()` in `startServer()`
- On claim evaluation: embed incoming claim, query `VectorStore` for cosine similarity against corpus
- Pass `similarity_score` into OPA as `data.similarity_score`; Rego threshold rule returns allow/deny/escalate
- Wire into `ControlEngine` alongside `OpaModeratorCheck`
- 20+ new tests → N-14 SHIPPED (11/14 SHIPPED, 0 BUILDING)

---

### 5. Blockers / Questions for CoS

No blockers. No questions. Phase 3 design fully resolved. Team ready to execute on directive.

---

> Session: 2026-03-06 (check-in 4) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing since check-in 3. Last code commit: `a8da29f` (Q3+Q4 fixes, OPA singleton bootstrap). Last NEXUS commit: `e0d8419` (check-in 3 Team Feedback). No directives were pending and no new work was assigned.

---

### 2. What surprised me?

**Q5 was answered within the same session.** CoS Wolf responded to both scope questions in the same enrichment cycle the question was raised. That's fast turnaround — the async Q&A loop via NEXUS Team Questions is working well when questions are concrete and binary. Vague questions get vague answers; precise questions ("threshold in Rego or similarity computation in Rego?") get actionable decisions immediately.

---

### 3. Cross-project signals

**The "Rego is a policy engine, not a compute engine" principle.** CoS confirmed: keep vector similarity computation in TS (ChromaDB cosine), only move the *threshold decision* to Rego. This is the right architecture boundary — Rego excels at `score >= threshold → action` logic, not at matrix math. Any ASIF project tempted to push computation into Rego rules should hold this line. Rego as a decision layer, not a compute layer.

---

### 4. What I'd prioritize next

**N-14 Phase 3 — AllowedClaimsRegistry → Rego + ChromaDB embedding similarity.** Q5 is answered, standing auth granted. Clear scope:
- Keep word-overlap TS scoring; replace with ChromaDB cosine similarity via existing `VectorStore`
- Rego receives `data.similarity_score`, applies configurable threshold, returns allow/deny/escalate
- Reuse N-05 ChromaDB infra — no new embedder
- Phase 3 completes N-14 → SHIPPED, takes the dashboard to 11/14 SHIPPED, 0 BUILDING

This is the next unambiguous directive target.

---

### 5. Blockers / Questions for CoS

No blockers. Q5 answered. Phase 3 is fully unblocked.

**Q6 — AllowedClaimsRegistry embedding strategy**: When Phase 3 embeds claim text against ChromaDB, should the allowed claims corpus be pre-embedded at startup (batch embed all entries in the registry on server boot) or lazy-embedded per-query (embed on first access, cache)? The corpus is likely small (<1000 entries), so startup batch is probably fine — but want to confirm before designing the initialization path.

> **CoS Response (Wolf, 2026-03-06):**
> **Batch at startup.** Same pattern as Q4 — OPA singleton at boot, embeddings at boot. <1000 entries is sub-second to embed. Put it in your `startServer()` init chain: `initializeOpa()` then `initializeClaimsEmbeddings()`. Lazy-per-query adds latency to the first request that hits each claim, which is unpredictable. Batch gives you a warm cache from request #1. **Standing authorization to implement.** **Status: Q6 ANSWERED. GO.**

---

> Session: 2026-03-06 (check-in 3) | Author: Claude Sonnet 4.6

### 1. What did you ship?

| Deliverable | Detail |
|-------------|--------|
| Q3 fix — `build-policy.sh` entrypoints | Corrected to `voice_jib_jab/policy/result` + `voice_jib_jab/policy/moderator_check`. Was `voice_jib_jab/result` / `voice_jib_jab/moderator_check` — wrong because the package is `voice_jib_jab.policy`, so the rule name appends after the full package path. |
| Q4 fix — OPA singleton bootstrap | `config/index.ts`: `opa.enabled` + `opa.bundlePath` fields. `index.ts`: refactored to `async startServer()` + `initializeOpa()` — WASM loads before `server.listen()`. `api/websocket.ts`: `OpaEvaluator` flows from startup into every per-session `ControlEngine`. |
| NEXUS Q3/Q4 resolved | Team responses recorded, changelog updated. |
| **Test count** | **1044 passed, 0 failed** (no change — pure wiring work, no new tests needed). Commit: `a8da29f`. |

---

### 2. What surprised me?

**Context carry-across sessions exposed the `index.ts` structure corruption pattern.** The previous session left `index.ts` in a broken state (missing closing brace, floating shutdown handlers) after multiple sequential Edit operations. The fix was a full-file Write. This highlights that incremental edits on deeply nested files accumulate structural drift that grep/read won't catch until you compile. Mitigation: after >3 edits to the same file, read it back and verify structure before committing.

**`async startServer()` is simpler than it looks, but easy to get wrong.** Top-level `await` at module scope requires ESM `"type": "module"`. Wrapping startup in `async function startServer()` called with `.catch()` is idiomatic CommonJS Node.js. Unsurprising once you're in it — but worth encoding because forgetting why you can't top-level `await` in CJS leads to workarounds that make the problem worse.

**`ENABLE_OPA=false` default is the right production safety posture.** If the WASM bundle doesn't exist (fresh clone, `build:policy` not yet run), the server boots on Tier 1 pattern matching with no error. Explicit opt-in for OPA. Fail-open at moderation, not fail-closed at startup. This is the correct default for any feature gated on a compiled artifact.

---

### 3. Cross-project signals

**`async startServer()` + resource pre-load before `listen()` is a portfolio pattern.** Applies to any ASIF server that needs to pre-load WASM, a DB connection pool, model weights, or crypto keys before accepting connections. If dx3 or oneDB do OPA/WASM loading, follow this exact shape.

**`ENABLE_OPA=false` + graceful degradation pattern.** `initializeOpa()` returns `undefined` on failure; server continues on the fallback path. Any feature gated on an external binary or compiled artifact should default to disabled + fallback. Avoids deploy failures on fresh-clone environments.

**Multi-edit structural drift risk.** Any project using sequential Edit calls on a large, deeply nested TS file can accumulate invisible structural errors. Safe mitigation: read the file back after >3 edits to the same file and verify structure before committing.

---

### 4. What I'd prioritize next

1. **N-14 Phase 3 — AllowedClaimsRegistry → Rego + embedding similarity**: OPA infrastructure is fully wired. Phase 3 is the last leg of N-14 and the only remaining `BUILDING` initiative. Would move the dashboard to 11/14 SHIPPED, 0 BUILDING.

2. **One real-WASM integration test**: All 1044 tests use `_injectPolicy()`. A single `OpaEvaluator.integration.test.ts` that compiles `policy.rego` and loads the real bundle validates the corrected entrypoints, Rego syntax, and WASM ABI end-to-end. Gate it behind `--testPathPattern` so CI skips it when the bundle doesn't exist.

3. **Run `build-policy.sh` manually once**: Q3 entrypoints are theoretically correct but haven't been validated against actual OPA CLI output. One real run would fully close the loop.

---

### 5. Blockers / Questions for CoS

**Q5 — N-14 Phase 3 scope clarification**: Phase 3 is "AllowedClaimsRegistry → Rego + ChromaDB embedding similarity." Current implementation uses exact-match and word-overlap scoring against a SQLite-backed registry. Two questions:
- (a) Should Phase 3 fully replace the TS scoring logic with Rego, or only move the *threshold decision* (allow/deny) to Rego while keeping similarity computation in TS?
- (b) Is ChromaDB cosine similarity the confirmed replacement for word-overlap, or still research? If confirmed, should embeddings use the existing `VectorStore` (ChromaDB) or a separate lightweight embedder?

> **CoS Response (Wolf, 2026-03-06):**
> **(a) Threshold decision only in Rego.** Keep similarity computation in TS — ChromaDB cosine similarity returns a score, Rego evaluates the threshold (allow/deny/escalate). Rego is a policy engine, not a compute engine. Don't force vector math into Rego.
> **(b) ChromaDB cosine similarity is CONFIRMED** as the word-overlap replacement — this has been the plan since N-14 was scoped. Use the **existing `VectorStore` (ChromaDB)** — do NOT add a separate embedder. You already have ChromaDB in N-05 (Persistent Memory). Reuse that infra: embed the claim text, query against the AllowedClaimsRegistry embeddings, get cosine score, pass score into Rego `data.similarity_score`. Standing authorization to implement Phase 3. **Status: Q5 ANSWERED. GO.**

No other blockers. Team is ready for new directives.

---

> Session: 2026-03-06 | Author: Claude Sonnet 4.6

### 1. What did you ship?

| Deliverable | Detail |
|-------------|--------|
| `policy.rego` extended | `moderator_check` rule + `_moderator_result` Rego function. SELF_HARM → escalate, all others → refuse with `MODERATION:<name>` reason_code. Configurable per-category thresholds via `object.get` with default fallback. |
| `OpaEvaluator` extended | `OpaModeratorInput` / `OpaModeratorOutput` interfaces + `evaluateModeratorCheck()` method. Same `raw.moderator_check ?? raw` unwrapping pattern as `evaluate()` for forward-compat with multi-entrypoint WASM. |
| `opa_moderator.ts` (new) | `OpaModeratorCheck` implements two-tier moderation: Tier 1 pattern matching produces binary scores (1.0 matched / 0.0 not); Tier 2 OPA evaluates thresholds. Falls back to Tier 1 when OPA uninitialised — zero latency impact on cold start. |
| `laneC_control.ts` wired | `opaEvaluator` + `moderationThresholds` config fields. Constructor swaps `Moderator` for `OpaModeratorCheck` when `opaEvaluator` provided. `async initialize()` added (CoS Q2 answer). All existing paths untouched. |
| `scripts/build-policy.sh` (new) | WASM build script (CoS Q1 answer). Auto-downloads `opa` CLI if absent, builds with both `voice_jib_jab/result` + `voice_jib_jab/moderator_check` entrypoints. `build:policy` npm script added. |
| 25 new tests | `OpaModeratorCheck.test.ts`: lifecycle (4), tier-1 fallback (3), OPA toxic input (4), self-harm escalation (2), threshold edge cases (5), PII scenario (2), ControlEngine integration (3), multiple categories (2). |
| **Test count** | **1044 passed, 0 failed** (1019 baseline + 25 new). Commits `6605ef6`, `00f602c`, `0588612` on `main`. |

---

### 2. What surprised me?

**The `fs` mock clobbered `existsSync` in DEFAULT_CONFIG's module-load-time singleton.** I copied the fs mock pattern from `OpaEvaluator.test.ts` into `OpaModeratorCheck.test.ts`. But `laneC_control.ts` defines `DEFAULT_CONFIG = { claimsRegistry: new AllowedClaimsRegistry(), ... }` at the module top level — so importing the module immediately runs `AllowedClaimsRegistry()`, which calls `existsSync`. My mock replaced `fs` with only `{ readFileSync: ... }`, making `existsSync` undefined. Fix: remove the `fs` mock entirely. `_injectPolicy()` bypasses all file I/O so the mock was never needed. Lesson: **mock fs only when you actually call `initialize()`**.

**Rego function overloading via mutually exclusive conditions is surprisingly clean.** TypeScript would use a switch or a ternary. In Rego you write two partial function definitions with complementary `if` guards (`name == "SELF_HARM"` / `name != "SELF_HARM"`). OPA picks the applicable body at eval time. The symmetry reads better than a conditional expression and is easier to extend with a third case.

**TypeScript labeled break (`outer: for ... break outer`) is the right tool for nested-loop early exit.** Used it in `OpaModeratorCheck.evaluate()` to exit both loops once the first matching category is found. Almost never see it in modern TS codebases, but it is cleaner here than a boolean flag or refactoring into a `find` helper.

**`build-policy.sh` entrypoint naming is likely wrong and tests will never catch it.** The plan specified entrypoints `voice_jib_jab/result` and `voice_jib_jab/moderator_check`. But OPA WASM entrypoint paths mirror the full package + rule path — dots become slashes. `package voice_jib_jab.policy` + rule `result` → correct entrypoint is `voice_jib_jab/policy/result`. The current script will probably error when run against real OPA. Tests are unaffected (all 1044 use `_injectPolicy()`), making this a silent latent bug. See Q3.

---

### 3. Cross-project signals

**Module-load-time singleton anti-pattern.** `DEFAULT_CONFIG` in `laneC_control.ts` creates `new AllowedClaimsRegistry()` immediately on import. Any project embedding live object construction in module-level constants has this same test isolation risk — a global mock can clobber the construction silently. Fix: lazy-initialize via a factory function or require the caller to always provide the dependency. If oneDB (P-09) or DesktopAI (P-01) has module-level singletons, they may have the same hidden fragility.

**Two-tier fast/declarative architecture pattern.** Tier 1 (regex, zero-latency) → binary 0/1 scores → Tier 2 (OPA threshold logic). The binary score model is the key insight: it makes the two tiers interoperable without Tier 1 knowing anything about Tier 2's internals. When Tier 2 graduates to real float scores (e.g. OpenAI Moderation API), only the score-building code changes. Reusable anywhere a fast synchronous fallback gates an async/WASM engine.

**OPA WASM entrypoint naming caveat for portfolio.** For any ASIF project using multi-entrypoint `opa build -t wasm -e <path>`: the path uses slashes as package-component separators (dots → slashes) and appends the rule name. `package a.b.c` + rule `my_rule` → entrypoint `a/b/c/my_rule`. This is not obvious from the OPA docs. Document at ASIF portfolio level so dx3 or any future project doesn't hit the same silent build failure.

---

### 4. What I'd prioritize next

1. **Fix `build-policy.sh` entrypoints** (immediate, 15 min): change to `voice_jib_jab/policy/result` and `voice_jib_jab/policy/moderator_check`, then run the script once against real OPA to confirm the bundle compiles. Blocks all production OPA use.

2. **Wire `ControlEngine.initialize()` into the server bootstrap** (N-14 production readiness): `initialize()` exists but nothing in the runtime calls it. The server startup or session factory needs to `await engine.initialize()` before the first WebSocket session. Without this, OPA never loads in production and the system silently runs on Tier 1 only.

3. **N-14 Phase 3 — AllowedClaimsRegistry → Rego + embedding similarity**: The OPA infrastructure is in place for Phase 1 (PolicyGate) and Phase 2 (ModeratorCheck). Phase 3 is the final leg of N-14 and the last `BUILDING` initiative.

4. **One integration test that loads real compiled WASM**: All 1044 tests mock the WASM loader. A single `OpaEvaluator.integration.test.ts` that actually compiles `policy.rego` and loads the bundle would catch entrypoint naming bugs, Rego syntax errors, and WASM ABI mismatches before they reach production. Can be `--testPathPattern` gated so CI only runs it when the bundle exists.

---

### 5. Blockers / Questions for CoS

**Q3 — Build script entrypoint naming**: I believe `voice_jib_jab/result` and `voice_jib_jab/moderator_check` in `build-policy.sh` are incorrect. The package is `voice_jib_jab.policy`, so OPA entrypoints should be `voice_jib_jab/policy/result` and `voice_jib_jab/policy/moderator_check`. I implemented what the plan specified but flag this as a likely bug. Confirm correct entrypoints and I'll fix in the next session. (All tests pass regardless because they use `_injectPolicy()` — the bug is invisible to CI.)

**Q4 — Production ControlEngine bootstrap**: `ControlEngine.initialize()` exists but no production code calls it. Current architecture creates a `ControlEngine` per-session in `LaneArbitrator`. Should the `OpaEvaluator` be: (a) a singleton initialized once at server startup and shared across all ControlEngine instances, or (b) initialized per-session? Option (a) is correct for WASM (one loaded bundle, shared across threads via the JS event loop). But it requires the server's `createServer()` or equivalent to own and pre-initialize the `OpaEvaluator` before creating any sessions. Guidance on where to wire this?

---

## Team Feedback

> Session: 2026-03-06 (check-in 2) | Author: Claude Sonnet 4.6

### 1. What did you ship?

Nothing since the previous check-in. Last code commit: `6605ef6` (Phase 2 OPA ModeratorCheck, 25 tests, 1044 total). Last NEXUS commit: `f5ea7e2` (Team Feedback 2026-03-06). No directives were pending and no new work was assigned.

---

### 2. What surprised me?

**Repeated reflection prompts with no intervening work surface a ritual/signal mismatch.** The reflection cadence is valuable, but when triggered with no new code between check-ins it creates pressure to pad or fabricate content. Worth flagging: the ritual is most useful when it captures a genuine delta. An empty check-in like this one is itself useful signal — it means the team is idle and ready for directives.

---

### 3. Cross-project signals

None new. Previous signals (module-load-time singleton anti-pattern, two-tier fast/declarative architecture, OPA entrypoint naming caveat) still stand and are recorded in the prior feedback entry.

---

### 4. What I'd prioritize next

Same as last check-in:
1. Fix `build-policy.sh` entrypoints (Q3 — likely latent bug, 15 min)
2. Wire `ControlEngine.initialize()` into server bootstrap (Q4 — nothing calls it in production)
3. N-14 Phase 3: AllowedClaimsRegistry → Rego + embedding similarity
4. One real-WASM integration test to validate the full OPA pipeline end-to-end

---

### 5. Blockers / Questions for CoS

Same as last check-in. Q3 and Q4 are unresolved pending CoS enrichment cycle. No new blockers.
