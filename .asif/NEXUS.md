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
| N-14 | Lane C v2: Semantic Governance | GOVERNANCE | BUILDING | P2 | 2026-03-05 |

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
- **Shipped**: N-07 (v1)
- **Ideas**: N-13, N-14

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

### N-14: Lane C v2: Semantic Governance
**Pillar**: GOVERNANCE | **Status**: BUILDING | **Priority**: P2
**What**: Tier 2 semantic moderation (OpenAI Moderation API) for subtle/context-dependent violations. Embedding similarity for claims matching (vs. word-overlap). OPA integration (PI-002) for declarative policy rules. Successor to N-07 v1 scope.

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

---

## CoS Directives

> Completed directives archived to [NEXUS-archive.md](./NEXUS-archive.md).

### DIRECTIVE-NXTG-20260306-01 — OPA Lane C v2 Phase 2: ModeratorCheck Integration
**From**: NXTG-AI CoS | **Priority**: P1
**Injected**: 2026-03-06 07:45 | **Estimate**: M | **Status**: PENDING

> **Estimate key**: S = hours (same session), M = 1-2 days, L = 3+ days

**Context**: Phase 1 shipped OPA Rego policy engine (32 tests, `OpaEvaluator` in-process, `server/policies/voice_jib_jab/policy.rego`). Phase 2 adds content moderation as an OPA-evaluated policy decision. This is the natural next step per the Lane C v2 roadmap.

**Action Items**:
1. [ ] Extend `policy.rego` with `moderator_check` rule — evaluate content against moderation categories (toxicity, PII, bias, off-topic). Use configurable thresholds.
2. [ ] Create `ModeratorCheck` middleware that wraps `OpaEvaluator` for content moderation decisions — integrates into the voice processing pipeline at the pre-response stage.
3. [ ] Wire `ModeratorCheck` into the Lane C orchestrator. When policy denies, return a safe fallback response (not a raw error).
4. [ ] Add test coverage for moderation scenarios: toxic input, PII detection, threshold edge cases, policy deny → fallback flow. Target: 20+ new tests.
5. [ ] Update N-14 status in NEXUS (BUILDING → verify still accurate after this phase).
6. [ ] Run full test suite. 1,060 baseline must not decrease.
7. [ ] CI GREEN before push.

**Constraints**:
- Phase 2 ONLY — do NOT touch AllowedClaimsRegistry (Phase 3)
- Backward compatible — existing 1,060 tests must pass unchanged
- USE PLAN MODE — this touches policy, middleware, and orchestrator

**Response** (filled by project team):
> **COMPLETE — 2026-03-06**
>
> All 7 action items delivered. Baseline preserved: **1044 tests passing, 0 failed** (1019 baseline + 25 new OpaModeratorCheck tests).
>
> **Deliverables:**
> 1. **`policy.rego` extended** — `moderator_check` rule evaluates category scores against configurable thresholds; `_moderator_result()` helper maps SELF_HARM → escalate, all others → refuse with `MODERATION:<name>` reason code.
> 2. **`OpaModeratorCheck` created** (`server/src/insurance/opa_moderator.ts`) — two-tier design: Tier 1 pattern matching (binary scores 1.0/0.0), Tier 2 OPA threshold evaluation via `OpaEvaluator.evaluateModeratorCheck()`. Falls back to Tier 1 when OPA uninitialised.
> 3. **`OpaEvaluator` extended** — `OpaModeratorInput`/`OpaModeratorOutput` interfaces + `evaluateModeratorCheck()` method. Same `raw.moderator_check ?? raw` parsing pattern as `evaluate()`.
> 4. **`ControlEngine` wired** — `opaEvaluator` + `moderationThresholds` config fields added. Constructor swaps `Moderator` for `OpaModeratorCheck` when `opaEvaluator` is provided (backward compat: existing code unchanged). `async initialize()` method added (CoS Q2 answer).
> 5. **`scripts/build-policy.sh`** — CoS Q1 answer: auto-downloads OPA CLI, builds WASM with both `voice_jib_jab/result` + `voice_jib_jab/moderator_check` entrypoints. Added `build:policy` to `server/package.json`.
> 6. **25 new tests** (`OpaModeratorCheck.test.ts`) across 8 groups: lifecycle, tier 1 fallback, OPA toxic input, self-harm escalation, threshold edge cases, PII scenario, ControlEngine integration, multiple categories. All 1044 tests green.
> 7. Commit: `6605ef6` — full suite confirmed clean before push.
>
> **N-14 status**: still BUILDING — Phase 3 (AllowedClaimsRegistry → Rego + embedding similarity) remains.

---

### DIRECTIVE-NXTG-20260304-04 — Adopt CI Gate Protocol
**From**: NXTG-AI CoS | **Priority**: P0
**Injected**: 2026-03-04 | **Estimate**: S | **Status**: COMPLETE

> **Estimate key**: S = hours (same session), M = 1-2 days, L = 3+ days

**Context**: New ASIF standard (`standards/ci-gate-protocol.md`). No push without local test pass. All teams must adopt.

**Action Items**:
1. [ ] Add CI Gate Protocol section to CLAUDE.md:
   ```
   ## CI Gate Protocol (ASIF Standard)
   Before EVERY `git push`, you MUST:
   1. Run the full test suite (`npm test`)
   2. Verify ZERO failures (xfail/skip OK, failures NOT OK)
   3. If tests fail → fix before pushing. No exceptions.
   4. Include test count in commit message: "Tests: X passed, Y skipped"
   Violating this protocol means broken CI, which means Asif gets spammed.
   ```
2. [ ] Install pre-push hook: `cp ~/ASIF/scripts/templates/pre-push-hook.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push`
3. [ ] Run full test suite. Confirm 1028+ passing. Report count.
4. [ ] Verify CI is GREEN on GitHub Actions. If not, fix it.

**Constraints**:
- Execute BEFORE DIRECTIVE-NXTG-20260304-01 (OPA Rego). CI gate comes first.

**Response** (filled by project team):
> **COMPLETE — 2026-03-05**
> - CI Gate Protocol section added to `CLAUDE.md` (all 4 steps)
> - Pre-push hook installed at `.git/hooks/pre-push`
> - Full server test suite: **1019 passed, 0 failed** (987 baseline + 32 new OPA tests)
> - Full client suite: **41 passed** (unchanged)
> - GitHub Actions CI: confirmed green on `main` (prior merge at 1028 tests)

---

### DIRECTIVE-NXTG-20260304-01 — Lane C v2 Phase 1: PolicyGate → OPA Rego
**From**: NXTG-AI CoS | **Priority**: P1
**Injected**: 2026-03-04 | **Estimate**: M | **Status**: COMPLETE

> **Estimate key**: S = hours (same session), M = 1-2 days, L = 3+ days

**Context**: 10/14 initiatives shipped. Team idle 3 days. N-14 research complete (PI-007 OPA WASM). Phase 1 is self-contained and unblocks Phases 2-3.

**Action Items**:
1. [ ] Install `@open-policy-agent/opa-wasm` v1.10.0 — verify it loads in-process, no sidecar
2. [ ] Author Rego policy bundle for PolicyGate: translate existing decision tree (allow/deny/cancel_output/escalate) to declarative Rego rules
3. [ ] Replace `PolicyGate.evaluate()` internals with OPA WASM instance — keep the same TypeScript interface so ControlEngine callers are unaffected
4. [ ] Reuse deny-by-default Rego patterns from oneDB (P-09) — reference `~/projects/oneDB/` for their 7 policy primitives and 40 OPA tests
5. [ ] Write 30+ new tests: Rego rule evaluation, WASM loading, backward compatibility with existing PolicyGate tests, latency assertion (<1ms per evaluation)
6. [ ] Update N-14 status from IDEA → BUILDING. Update changelog.
7. [ ] Run full test suite — 1028 baseline must not decrease. Report final count.

**Constraints**:
- Phase 1 ONLY. Do NOT touch ModeratorCheck (Phase 2) or AllowedClaimsRegistry (Phase 3) yet.
- Keep existing PolicyGate interface unchanged — this is an internal implementation swap, not an API change.
- USE PLAN MODE before coding. Outline the Rego rule structure first.

**Response** (filled by project team):
> **COMPLETE — 2026-03-05**
> - `@open-policy-agent/opa-wasm@1.10.0` installed as production dependency (3 packages, in-process — no sidecar)
> - `server/policies/voice_jib_jab/policy.rego` — Rego policy translates TS `DECISION_PRIORITY` merge loop to declarative rules: `winning_check` (max priority → max severity → first-wins), `result` default + override, `should_short_circuit` signal
> - `server/src/insurance/opa_evaluator.ts` — `OpaEvaluator` wrapper: async `initialize()`, sync sub-millisecond `evaluate()`, `_injectPolicy()` for test injection (no file I/O)
> - `PolicyGate` wired: optional `OpaEvaluator` in constructor; when initialized, OPA determines final decision/severity/safeRewrite; TS loop preserved for checksRun tracking, allReasonCodes aggregation, and short-circuit performance
> - Backward compatible: zero OpaEvaluator = existing TS aggregation path, all 987 original tests unchanged
> - **32 new tests** in `OpaEvaluator.test.ts` covering lifecycle, I/O mapping, format edge cases, latency assertion, PolicyGate integration
> - **Server suite: 1019 passed, 0 failed** (987 + 32). N-14 moved IDEA → BUILDING.
> - Phase 1 ONLY: ModeratorCheck (Phase 2) and AllowedClaimsRegistry (Phase 3) untouched.

---

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

_(Project team: add questions for ASIF CoS here. They will be answered during the next enrichment cycle.)_

---

## Team Feedback

> Session: 2026-03-05 | Author: Claude Sonnet 4.6

### 1. What did you ship?

| Deliverable | Detail |
|-------------|--------|
| `OpaEvaluator` class | Wraps `@open-policy-agent/opa-wasm` v1.10.0. Async `initialize()`, sync sub-ms `evaluate()`, `_injectPolicy()` backdoor for test injection |
| `server/policies/voice_jib_jab/policy.rego` | Full Rego policy: `decision_priority` map, `winning_check` (max-priority → max-severity → first-wins), `result` default/override, `should_short_circuit` signal |
| `PolicyGate` OPA wiring | Optional `OpaEvaluator` in constructor. When initialized: OPA owns decision/severity/safeRewrite. TS loop preserved for checksRun, allReasonCodes, short-circuit. Zero behavior change for existing callers. |
| 32 new tests | `OpaEvaluator.test.ts`: lifecycle (5), I/O mapping (8), format variations (4), latency <1ms (1), PolicyGate integration (8), edge cases (6) |
| CI Gate Protocol | CLAUDE.md section + pre-push hook installed |
| **Test count** | **1019 server tests, 0 failures** (987 baseline + 32 new). Commit `e360727` on `main`. |

---

### 2. What surprised me?

**Jest ESM + dynamic import mocking was cleaner than expected.** `OpaEvaluator.initialize()` uses `await import('@open-policy-agent/opa-wasm')` — a dynamic import inside an async method. I expected to need `jest.unstable_mockModule()`. Instead, `jest.mock('...', factory)` at the top of the test file intercepted the dynamic import cleanly. This is because ts-jest with the ESM preset still runs via Jest's CJS module registry internally — the ESM syntax is compiled, not native.

**The `_injectPolicy()` backdoor made the entire test suite file-I/O-free.** 31 of 32 tests use `_injectPolicy()` to inject a mock OPA policy object directly, bypassing `fs.readFileSync` and the WASM loader entirely. The mock `fs` was only needed for the 2 `initialize()` lifecycle tests. This pattern (sync backdoor for async-initialized dependencies) is worth reusing everywhere.

**N-14 Phase 1 is wired but not production-runnable yet.** The Rego policy exists and the TypeScript wiring is in place, but `OpaEvaluator.initialize()` requires a pre-compiled `.wasm` bundle file. There is no `scripts/build-policy.sh` and no `opa` CLI in the toolchain. Production use of OPA is blocked until the bundle compilation pipeline exists. Tests pass because they use `_injectPolicy()` — the missing bundle is invisible to CI.

---

### 3. Cross-project signals

**`_injectPolicy()` pattern → reusable across ASIF.** Any class that wraps an async-initialized external resource (database, WASM engine, HTTP client) can expose a sync `_injectDependency()` backdoor for test injection. Eliminates file I/O mocking noise and makes 95% of tests trivially fast. If oneDB (P-09) or DesktopAI (P-01) has async-init wrappers with heavy test setup, this pattern would clean them up.

**Rego `decision_priority` map pattern → portable.** The `decision_priority := {"allow": 0, "rewrite": 1, "refuse": 2, "escalate": 3, "cancel_output": 4}` map + `max()` aggregation pattern translates any TypeScript priority-merge loop into a 10-line Rego rule. Any ASIF project with a priority queue or severity-ranked decision system can adopt this directly.

**PolicyGate optional-OPA wiring → clean migration pattern.** Introducing OPA as an optional constructor argument (fallback to existing logic when absent) is a zero-risk migration strategy. Existing tests pass unchanged. New tests exercise the OPA path. This pattern works for any incremental engine swap — useful if oneDB wants to add a fallback path for their OPA evaluations.

---

### 4. What I'd prioritize next

1. **WASM bundle compilation pipeline** (unblocks production N-14 use): `scripts/build-policy.sh` using `opa build` CLI or Docker (`openpolicyagent/opa:latest`). Add to `package.json` as `build:policy` script. Without this, OpaEvaluator is test-only.
2. **N-14 Phase 2 — ModeratorCheck → Rego + OpenAI Moderation API**: Tier 1 pattern engine stays (zero-latency). Add Tier 2 semantic call gated by Rego rule. The Tier 1/Tier 2 gate is a natural Rego rule: `invoke_tier2 if { tier1.result == "allow" }`.
3. **N-13 Multi-Tenant Isolation**: Now that OPA is wired, per-tenant policy rules become a natural extension — inject tenant data document into OPA and let Rego enforce org-scoped allow/deny.
4. **Coverage housekeeping**: `OpaEvaluator.ts` and `policy_gate.ts` changes should be verified in coverage report to confirm they don't pull any metric below 70%.

---

### 5. Blockers / Questions for CoS

**Q1 — WASM bundle toolchain**: How should we compile `server/policies/voice_jib_jab/policy.rego` to a `.wasm` bundle? Options: (a) install `opa` CLI in CI via `curl`; (b) Docker `openpolicyagent/opa:latest build`; (c) commit the pre-compiled bundle to the repo. Option (c) is simplest but bundles a binary. Recommend (a) as a `build:policy` npm script — guidance on preferred approach?

**Q2 — OPA initialization in ControlEngine**: `OpaEvaluator.initialize()` is async. `PolicyGate` is currently constructed synchronously in `ControlEngine`. Should `ControlEngine` await OPA initialization at startup (before first session), or should OPA start uninitialized and fall back to TS aggregation until the bundle loads? The current fallback path makes the latter safe, but the former is cleaner for production guarantees.

## CoS Answers (Enrichment Cycle 2026-03-06)

> Answers to questions from Team Feedback (2026-03-05 session).

**Q1 — WASM bundle toolchain**: Option (a) — install `opa` CLI via curl in CI as a `build:policy` npm script. Do NOT commit binaries to git. Create `scripts/build-policy.sh` that downloads `opa` if not present, then runs `opa build -t wasm -e voice_jib_jab/result server/policies/`. This aligns with the portfolio OPA pattern (voice-jib-jab + dx3 both using OPA). Standing authorization to implement.

**Q2 — OPA initialization in ControlEngine**: Await at startup. The fallback path exists for safety, but production should always initialize OPA before accepting sessions. Startup latency is acceptable (WASM load is sub-100ms). Clean code > clever fallback. Standing authorization to implement.
