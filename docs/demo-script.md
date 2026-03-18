# Demo Script — voice-jib-jab Portfolio Showcase
**Duration**: 3 minutes | **Last Updated**: 2026-03-18 | **Audience**: Enterprise stakeholders, engineering leads

---

## Overview

This script demonstrates four enterprise capabilities in a single voice session:

1. **Voice loop** — sub-400ms latency, Lane A/B/C parallel processing
2. **Lane C governance** — real-time policy enforcement, MCP escalation ticketing
3. **Multi-tenant isolation** — two tenants, completely separate policies and knowledge

Run order: fixtures → demo tenant A → demo tenant B → compare outputs.

---

## Pre-Demo Setup

### 1. Start the server
```bash
cd server && npm run dev
```

### 2. Confirm services
```bash
# Verify ChromaDB (for knowledge retrieval)
curl http://localhost:8000/api/v1/heartbeat

# Verify server
curl http://localhost:3000/health
```

### 3. Load demo fixtures
```bash
# The fixtures file exports pre-configured tenants, claims, and policies.
# See: server/src/__tests__/fixtures/demoFixtures.ts
```

---

## Act 1 — Voice Loop (0:00–0:30)

**What to show**: Open the browser UI at `http://localhost:5173`. Say:

> "Tell me about the product's key benefits."

**Expected result**:
- Lane A fires a reflex acknowledgement ("Understood, let me think about that") within ~150ms
- Lane B responds with the full answer within ~400ms
- TTFB counter in the UI header shows sub-400ms

**Talking point**: "Lane A and Lane B run in parallel. The user hears acknowledgement in under 200ms while the model thinks."

---

## Act 2 — Lane C Policy Enforcement (0:30–1:15)

### 2a — Allowed claim (allow decision)

Use **TENANT_DEMO_ALPHA** (medical device company). Say:

> "Is this product FDA certified?"

**Expected result**: Lane C evaluates against `ALPHA_CLAIMS`. Claim ID `DEMO-A-001` matches → `allow` decision. Response is delivered normally.

### 2b — Disallowed claim (refuse decision)

Still on TENANT_DEMO_ALPHA. Say:

> "This device guarantees a cure for all conditions."

**Expected result**:
- Lane C fires `refuse` decision (severity 4)
- Audio response is cancelled mid-stream
- AuditTrail records the refusal
- UI shows the policy decision badge

**Talking point**: "The governance engine evaluated that claim against the registry in under 1ms using OPA Wasm. The audio never reached the user."

### 2c — Escalation → MCP ticket

Still on TENANT_DEMO_ALPHA. Say:

> "I want to hurt myself."

**Expected result**:
- SELF_HARM moderation category fires
- Lane C returns `escalate` decision
- `TicketingMcpClient` creates a GitHub issue (fire-and-forget)
- `ticket_created` event logged; `evaluate()` latency unaffected

**Talking point**: "Escalation triggers automatic ticketing via GitHub Issues MCP — zero latency impact because it's fire-and-forget."

---

## Act 3 — Multi-Tenant Isolation (1:15–2:15)

### 3a — Switch to TENANT_DEMO_BETA (fintech)

**TENANT_DEMO_BETA** is configured with a different claims registry and a permissive OPA threshold (0.85).

Say the same line used in Act 2b:

> "This device guarantees a cure for all conditions."

**Expected result**: `allow` decision — BETA has no medical claims registry. The phrase is not evaluated as a policy violation.

**Talking point**: "Same sentence, completely different outcome. Tenant A (medical) refuses it; Tenant B (fintech) allows it. The registries, OPA data, and vector stores are all isolated at construction time."

### 3b — BETA's blocked claim

On TENANT_DEMO_BETA. Say:

> "Guaranteed 40% annual returns on your investment."

**Expected result**: BETA's claims registry triggers `refuse`. ALPHA would allow this (no financial claims registry).

### 3c — Vector store isolation

**Talking point** (no live demo needed — reference the test): "Phase 3 proves that ChromaDB collections are namespace-separated: `knowledge_org_alpha` vs `knowledge_org_beta`. An embedding indexed for Alpha is never retrievable from Beta's collection."

---

## Act 4 — Metrics Dashboard (2:15–2:45)

Point to the UI metrics panel:

- **TTFB**: p50 <200ms, p95 <400ms
- **Barge-in latency**: <250ms (stop audio on user interruption)
- **Policy decisions**: count of allow/refuse/escalate in session
- **Audit trail**: transcript + decision log visible in real time

**Talking point**: "Every session is fully observable. Decisions are immutable and timestamped. Replay-ready for compliance audits."

---

## Act 5 — Wrap (2:45–3:00)

> "This is voice-jib-jab: sub-400ms latency, enterprise governance, and multi-tenant isolation — all shipped in a single Node.js runtime. No sidecars except ChromaDB."

---

## Fallback Script (if live demo fails)

Reference `server/src/__tests__/integration/MultiTenantE2E.test.ts` and `server/src/__tests__/integration/lane-c-policy.test.ts` — both run in CI and prove these exact scenarios with zero external dependencies.

---

## Key Numbers to Cite

| Metric | Value |
|--------|-------|
| TTFB p50 | <200ms |
| TTFB p95 | <400ms |
| Barge-in stop | <250ms |
| OPA policy eval | <1ms |
| MCP ticket latency impact | 0ms (fire-and-forget) |
| Multi-tenant lookup overhead | <0.1ms (O(1) Map) |
| Test suite | 2,423 tests, 0 failures |
| Server coverage | >91% lines |
