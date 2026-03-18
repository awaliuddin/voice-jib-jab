# Changelog

All notable changes to voice-jib-jab are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## Project Status

**15/15 initiatives SHIPPED** | **2,251 tests** | **94% coverage**

---

## [Unreleased]

---

## N-15 — Quality Hardening · OBSERVABILITY · 2026-03-18

### Added
- CRUCIBLE Gates 1–7 self-audit completed, zero regressions
- Filled hollow test assertions across governance and embedding paths
- Coverage lifted from 90% to 94% (stmt/branch/fn/lines all above floor)

### Stats
- Tests: **2,251** (up from 2,168)
- Coverage: **94%**

---

## N-15 Sprint 2 — Async PolicyCheck Interface · GOVERNANCE · 2026-03-17

### Added
- `PolicyCheck` interface converted to async (returns `Promise<PolicyResult>`)
- Dense embedding path wired into `OpaClaimsCheck` — similarity scores now fed into OPA decisions at runtime
- `getEmbeddingSimilarityScore` integrated end-to-end with policy evaluation pipeline

### Stats
- Tests: **2,168**

---

## N-15 Sprint 1 — Dense Embedding Similarity · GOVERNANCE · 2026-03-14

### Added
- `getEmbeddingSimilarityScore` function using `@xenova/transformers` (all-MiniLM-L6-v2)
- Cosine similarity scoring for claims against the `AllowedClaimsRegistry`
- Unit test suite covering embedding generation and similarity thresholds

---

## N-14 — Lane C v2: Semantic Governance · GOVERNANCE · 2026-03-07

### Added
- OPA Rego policy engine replacing the stub `PolicyGate` — hard-cancel decisions now evaluated server-side
- `VectorStore` with TF-IDF similarity for knowledge-grounded policy queries
- `AllowedClaimsRegistry` — curated allowlist with similarity-threshold enforcement
- `ModeratorCheck` OPA phase (Phase 2): content moderation via Rego rules
- CI Gate Protocol adopted: full test suite required before every push

### Changed
- `OpaClaimsCheck` replaces the empty `claims_check` stub
- Lane C control plane now runs synchronous Rego evaluation on every turn

---

## N-10 — Production Readiness QA · OBSERVABILITY · 2026-02-28

### Added
- Load test baseline: 200 concurrent sessions, p95 TTFB **126ms** (SLA target met)
- Security audit completed: 0 production vulnerabilities, secrets clean
- UAT bugs #1 (audio feedback loop) and #5 (audit trail FK race) verified fixed
- `RUNBOOK.md` and demo guide shipped
- Coverage floor CI gate (`coverageThreshold` in jest.config.js: stmt 88, branch 78, fn 87, lines 88)

### Stats
- Tests: **1,028**

---

## N-09 — Unit Test Coverage 14%→85% · OBSERVABILITY · 2026-02

### Added
- 11 new test suites covering previously untested server paths
- `websocket.ts` brought from 0% to 97% coverage
- CI GitHub Actions test gate (ADR-008 compliance) wired to main branch

### Changed
- Server statement coverage: 38% → 85%+
- Branches cleared 70% CI gate

### Stats
- Tests: **1,028** (up from ~713 at N-07 CI clearance; 14% baseline at initiative start)

---

## N-08 — Knowledge Pack Retrieval · GROUNDING · 2026-02

### Added
- `KnowledgePackService` — loads and indexes domain knowledge packs at startup
- Retrieval tool wired into Lane B: relevant facts injected into assistant context before each turn
- Disclaimer lookup tool for regulated-content guardrails
- Citation metadata attached to assistant responses for compliance trails

---

## N-07 — Lane C Control Plane v1 · GOVERNANCE · 2026-02

### Added
- Content moderation engine: 7-category pattern matching (replaces empty stub)
- `ControlEngine` scaffold with hard-cancel and fallback trigger support
- `AuditTrail` event logging for every Lane C decision
- `PIIRedactor` and `FallbackPlanner` stubs integrated into the control plane lifecycle
- 3 resource leak fixes and 2 reliability hardening patches in Lane C

### Stats
- Tests: **713** (at time of CI clearance)

---

## N-06 — Enterprise UI Transformation · INTERACTION · 2026-01

### Added
- Full UI redesign: electric blue design system (Tailwind-first)
- Talk/Stop toggle with real-time session state indicators
- End Call button wired to server-side session teardown
- Lane status display (A/B/C activity visible during conversation)

---

## N-05 — Persistent Memory (ChromaDB) · GROUNDING · 2026-01

### Added
- ChromaDB vector store for cross-session conversation memory
- Automatic embedding and retrieval of prior conversation context on session start
- Memory injection into Lane B system prompt

---

## N-04 — State Machine Resilience · RESPONSIVENESS · 2026-01

### Added
- Explicit session state machine (IDLE → CONNECTING → ACTIVE → STOPPING)
- Buffer and queue safeguards to prevent TTFB drift under load
- TTS phrase sync aligned to state transitions

---

## N-03 — Audio Buffer Race Fix · RESPONSIVENESS · 2026-01

### Added
- Audio commit issued when user releases Talk button (prevents dropped utterance)
- Lazy microphone initialization — no permission prompt until first interaction
- OpenAI Realtime API race condition eliminated on rapid connect/disconnect

---

## N-02 — Lane Arbitration System · INTERACTION · 2026-01

### Added
- 3-Lane arbitration: Lane A (reflex acknowledgements), Lane B (reasoning), Lane C (policy/governance)
- Barge-in support via server-side VAD — Lane B cancels cleanly when user interrupts
- Lane overlap prevention: natural reflex sounds replace awkward silence
- `feat-002` Lane Arbitration specification and architecture checkpoint committed

---

## N-01 — Voice Loop MVP · RESPONSIVENESS · 2026-01

### Added
- OpenAI Realtime API integration over WebSocket (Mic → WebSocket → OpenAI → playback)
- `response.create` trigger with full test suite
- Server-side session management and connection stability improvements
- Environment variable loading from project root
- Quick start guide for voice conversation testing

### Stats
- Initial working voice loop established; sub-400ms p50 TTFB target set
