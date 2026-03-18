# voice-jib-jab — System Architecture

**Project**: P-07 (Voice & Media vertical)
**Last Updated**: 2026-03-18
**Status**: Production

---

## 1. System Overview

Client audio streams over WebSocket to an Express/Node server. The server runs three parallel lanes and routes output through OpenAI's Realtime API. All lane decisions pass through the EventBus; ChromaDB provides cross-session memory for RAG; OPA WASM governs moderation thresholds.

```mermaid
graph TB
    subgraph Client["Browser Client"]
        MIC[Microphone\nWeb Audio API]
        SPK[Speaker\nPlayback]
        UI[React UI\nHold-to-Talk]
    end

    subgraph Server["Node.js Server  (Express + ws)"]
        WS[WebSocket Handler]
        EB[EventBus\nglobal pub/sub]

        subgraph Lanes["Three-Lane Runtime"]
            LA[Lane A\nReflex\n< 50 ms]
            LB[Lane B\nReasoning\n< 400 ms TTFB]
            LC[Lane C\nPolicy / Governance\nasync]
        end

        ARB[LaneArbitrator\nState Machine]

        subgraph Governance["Governance Layer"]
            PG[PolicyGate]
            OPA[OPA WASM\nEvaluator]
            AUDIT[AuditTrail\nJSONL]
        end
    end

    subgraph External["External Services"]
        OPENAI[OpenAI\nRealtime API\ngpt-4o-realtime]
        CHROMA[ChromaDB\nPersistent Memory\ncross-session RAG]
    end

    MIC -->|PCM16 24 kHz chunks| WS
    WS -->|audio.commit| ARB
    ARB -->|play_reflex| LA
    ARB -->|play_lane_b| LB
    LA -->|filler audio| WS
    LB <-->|WebSocket| OPENAI
    LB -->|response audio| WS
    WS -->|PCM16 chunks| SPK
    WS -->|transcript events| EB
    LB -->|transcript / response events| EB
    EB -->|session events| LC
    LC -->|policy.decision| EB
    LC --> PG
    PG --> OPA
    LC --> AUDIT
    LB <-->|RAG queries| CHROMA
    ARB -->|lane.owner_changed| EB
    EB -->|policy.decision cancel_output| ARB
```

---

## 2. Three-Lane Architecture

All three lanes start concurrently the moment the user stops speaking. Lane A covers perceived latency; Lane B delivers the actual response; Lane C enforces governance without blocking Lane B.

```mermaid
graph LR
    subgraph Input
        USER[User speech ended\naudio.commit]
    end

    subgraph LaneA["Lane A — Reflex  ≤ 50 ms"]
        A1[Select filler phrase\ne.g. 'Mm-hmm, let me check...']
        A2[Stream pre-recorded\naudio to client]
    end

    subgraph LaneB["Lane B — Reasoning  ≤ 400 ms TTFB"]
        B1[Commit audio buffer\nto OpenAI]
        B2[OpenAI Realtime API\nGPT-4o streaming]
        B3[RAG retrieval\nChromaDB]
        B4[Stream response\naudio + transcript]
    end

    subgraph LaneC["Lane C — Policy / Governance  async"]
        C1[Subscribe to\nEventBus session events]
        C2[PolicyGate\nevaluate pipeline]
        C3[OverrideController\ntranslate decision]
        C4[Emit policy.decision\nto EventBus]
        C5[Emit control.audit\ncontrol.metrics]
    end

    subgraph Arbitrator
        ARB[LaneArbitrator\naudio ownership\nstate machine]
    end

    USER -->|t=0ms| LaneA
    USER -->|t=0ms| LaneB
    USER -->|t=0ms| LaneC

    A1 --> A2 --> ARB
    B1 --> B2
    B2 <--> B3
    B2 --> B4 --> ARB

    C1 --> C2 --> C3 --> C4
    C3 --> C5

    ARB -->|cancel_output\nstop Lane B| LaneB
    ARB -->|B ready → stop Lane A\npreempt| LaneA

    style LaneA fill:#1e3a5f,color:#93c5fd
    style LaneB fill:#1a3a2a,color:#86efac
    style LaneC fill:#3b1f2b,color:#f9a8d4
```

---

## 3. Lane C PolicyGate Flow

Checks run sequentially in severity order. First check to produce a non-`allow` decision at the highest priority wins. OPA WASM overrides the TypeScript result when initialized. The OverrideController escalates `refuse`/`escalate` at severity ≥ 4 to `cancel_output`.

```mermaid
flowchart TD
    REQ([EvaluationContext\nrole / text / isFinal]) --> PII

    subgraph Pipeline["PolicyGate check pipeline  sequential"]
        PII["PIIRedactorCheck\nphone · email · SSN · CC\nregex scan of text + metadata"]
        MOD{OPA evaluator\nprovided?}
        OPAMOD["OpaModeratorCheck\ncategorized patterns\n+ OPA threshold logic"]
        PATMOD["Moderator\ncategorized regex patterns\nlegacy deny-list fallback"]
        CLAIMS{OPA evaluator\nprovided?}
        OPACLAIMS["OpaClaimsCheck\ntwo-tier: embedding score\n+ OPA threshold Rego rule"]
        CLAIMCK["ClaimsChecker\nTF-IDF cosine similarity\nAllowedClaimsRegistry"]
    end

    subgraph Outcomes["PolicyDecision  priority: allow < rewrite < refuse < escalate < cancel_output"]
        ALLOW([allow\nsev 0])
        REWRITE([rewrite\n+ safeRewrite text\nsev 1–3])
        REFUSE([refuse\nsev 2–3])
        ESCALATE([escalate → human handoff\nsev 3–4])
        CANCEL([cancel_output\nsev 4  critical])
    end

    subgraph Override["OverrideController"]
        OVR{severity ≥ 4\nAND refuse/escalate?}
        UPGRADE[Upgrade to\ncancel_output]
        EMIT[Emit policy.decision\nto EventBus]
        AUDIT2[Emit control.audit\ncontrol.metrics]
    end

    PII -->|PII found, mode=redact| REWRITE
    PII -->|clean| MOD
    MOD -->|yes| OPAMOD
    MOD -->|no| PATMOD
    OPAMOD --> CLAIMS
    PATMOD --> CLAIMS
    CLAIMS -->|yes| OPACLAIMS
    CLAIMS -->|no| CLAIMCK
    OPACLAIMS --> GR([GateResult])
    CLAIMCK --> GR
    GR --> OVR
    OVR -->|yes| UPGRADE --> EMIT
    OVR -->|no| EMIT
    EMIT --> AUDIT2

    GR -.-> ALLOW
    GR -.-> REWRITE
    GR -.-> REFUSE
    GR -.-> ESCALATE
    GR -.-> CANCEL

    CANCEL -->|LaneArbitrator\nonPolicyCancel| STOP[Stop Lane B\nplay fallback]
```

---

## 4. LaneArbitrator State Machine

Audio ownership is exclusive; only one lane may produce output at a time. Barge-in and policy cancel both force an immediate return to `LISTENING`.

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> LISTENING : session_start

    LISTENING --> B_RESPONDING : user_speech_ended\n(audio.commit received)

    B_RESPONDING --> A_PLAYING : reflex timer fires\n(+100 ms, Lane B not yet ready)
    B_RESPONDING --> B_PLAYING : b_first_audio_ready\n(Lane B beats the timer)

    A_PLAYING --> B_PLAYING : b_first_audio_ready\n(Lane B preempts Lane A\n+10 ms gap)
    A_PLAYING --> LISTENING : user_barge_in
    A_PLAYING --> FALLBACK_PLAYING : policy_cancel

    B_PLAYING --> LISTENING : response_done
    B_PLAYING --> LISTENING : user_barge_in
    B_PLAYING --> FALLBACK_PLAYING : policy_cancel

    B_RESPONDING --> FALLBACK_PLAYING : policy_cancel

    FALLBACK_PLAYING --> LISTENING : fallback_complete

    LISTENING --> ENDED : session_end
    B_PLAYING --> ENDED : session_end
    A_PLAYING --> ENDED : session_end
    FALLBACK_PLAYING --> ENDED : session_end
    B_RESPONDING --> ENDED : session_end

    ENDED --> [*]

    note right of A_PLAYING
        maxReflexDurationMs = 2000 ms
        auto-cancel if B never arrives
    end note

    note right of B_RESPONDING
        responseInProgress guard
        prevents overlapping cycles
    end note
```

---

## 5. Dense Embedding Pipeline (N-15)

`AllowedClaimsRegistry.initialize()` runs once at server startup (alongside OPA WASM load). At evaluation time, `OpaClaimsCheck` selects between dense embedding cosine similarity and TF-IDF fallback based on `isEmbeddingInitialized`.

```mermaid
flowchart TD
    subgraph Startup["Server startup  initialize()  called once"]
        direction LR
        OI[OpaEvaluator.initialize\nload moderation.wasm\nOPA WASM bundle]
        RI[AllowedClaimsRegistry.initialize\nload Xenova/all-MiniLM-L6-v2\nvia @huggingface/transformers]
        PE[Pre-compute embeddings\nfor every ApprovedClaim\npooling=mean · normalize=true]
        OI --> READY1[OPA ready\nisInitialized = true]
        RI --> PE --> READY2[Embeddings ready\nisEmbeddingInitialized = true]
    end

    subgraph Runtime["Runtime  OpaClaimsCheck.evaluate()  per utterance"]
        direction TB
        INPUT([EvaluationContext\nrole=assistant · text])
        DP[matchDisallowedPatterns\nfast string scan]
        CHK{isEmbeddingInitialized?}
        DENSE["getEmbeddingSimilarityScore()\nmodel inference on query text\ncosine similarity vs claim embeddings\nreturns top-1 score 0.0–1.0"]
        TFIDF["getSimilarityScore()\nVectorStore TF-IDF cosine\nno model required"]
        SCORE([similarityScore])
        OPA2{OPA initialized?}
        OPAEVAL["evaluator.evaluateClaimsCheck()\nRego rule: score ≥ threshold\nreturns allow / refuse + reasonCode"]
        DIRECT{score ≥ threshold?}
        ALLOW2([allow])
        REFUSE2([refuse\nCLAIMS_VIOLATION\nCLAIMS:UNVERIFIED])
        DISALLOW([refuse\nCLAIMS_VIOLATION\nCLAIMS:DISALLOWED_PATTERN])
    end

    Startup -.->|ready flags| Runtime

    INPUT --> DP
    DP -->|matched| DISALLOW
    DP -->|clean| CHK
    CHK -->|yes| DENSE
    CHK -->|no| TFIDF
    DENSE --> SCORE
    TFIDF --> SCORE
    SCORE --> OPA2
    OPA2 -->|yes| OPAEVAL
    OPA2 -->|no| DIRECT
    OPAEVAL -->|allow| ALLOW2
    OPAEVAL -->|refuse| REFUSE2
    DIRECT -->|yes| ALLOW2
    DIRECT -->|no| REFUSE2

    style Startup fill:#1a2744,color:#bfdbfe
    style Runtime fill:#1a2a1a,color:#bbf7d0
```

---

## Key Numbers

| Metric | Target | Source |
|---|---|---|
| Lane A latency | < 50 ms | CLAUDE.md architecture constraint |
| Lane B TTFB | < 400 ms | Measured ~350 ms |
| LaneArbitrator reflex delay | 100 ms | `minDelayBeforeReflexMs` default |
| Reflex max duration | 2000 ms | `maxReflexDurationMs` default |
| Lane A → B transition gap | 10 ms | `transitionGapMs` default |
| OPA cancel threshold severity | 4 (critical) | `cancelOutputThreshold` default |
| OpaClaimsCheck default threshold | 0.6 cosine | `opaClaimsThreshold` default |
| Embedding model | `Xenova/all-MiniLM-L6-v2` | `EMBEDDING_MODEL` env var |
| Test coverage floor | 88% stmt / 78% branch / 87% fn | `jest.config.js` |
