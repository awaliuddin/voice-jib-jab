Absolutely. Here are **three different README.md drafts**, one for each go-to-market path:

* **1) Runtime platform (procurement-safe name; open core)** - Sell the runtime to engineering teams (faster iteration, smaller contracts, more crowded)
* **2) Voice Insurance (governance layer you can bolt onto anything)** - Sell a packaged vertical rep (harder build, bigger contracts, clearer return on investment)
* **3) Vertical Rep Starter (packaged outcome, bigger contracts)** - Sell “Voice Insurance” as an add-on layer (partner-friendly, very differentiated)

---

# NxtG Voice Runtime (nxtg-voice)

Production-grade, low-latency voice agent runtime built on a three-lane orchestration system.`

NxtG Voice Runtime is a browser-first, speech-to-speech assistant framework designed to feel human in real time while staying governable in enterprise environments.

## Why this exists

Voice agents usually fail in two predictable ways:
1) Latency breaks the illusion of conversation.
2) Lack of governance blocks production rollout.

This runtime solves both with a lane-based architecture:
- **Lane A (Reflex):** instant backchannel audio and acknowledgements
- **Lane B (Reasoned):** streaming responses grounded with Retrieval-Augmented Generation (RAG)
- **Lane C (Control):** policy enforcement, claims control, audit trail, and hard cancellation

## Who this is for

- Platform and product teams building voice assistants that must ship to real users
- Enterprise teams that need an evidence trail, policy controls, and predictable behavior
- Developers who want a clean provider adapter layer (multi-provider friendly)

## Core features

### Real-time voice that feels responsive
- Time To First Byte (TTFB) targets and instrumentation from day one
- Barge-in support with strict stop latency goals
- Lane preemption rules to avoid overlapping audio output

### Retrieval-Augmented Generation, on purpose
- Compact “facts pack” retrieval
- Grounded answers by default, no hallucinated company claims
- Pluggable vector store and knowledge packs

### Built-in safety scaffolding
- PolicyGate stubs and hooks for production hardening
- Allowed claims registry support
- Audit trail and replayable session timeline

## Architecture

### Three-lane system

- **Lane A (Reflex):** instant fillers; never asserts facts
- **Lane B (Reasoned):** main response stream; Retrieval-Augmented Generation injection
- **Lane C (Control):** moderation, policy decisions, cancellation, and audit events

### Tech stack

- **Client:** React 18 + TypeScript + Vite
- **Server:** Node.js 20 + TypeScript + Express + WebSocket
- **Voice Provider:** OpenAI Realtime API (pluggable adapter interface)
- **Vector Store:** Chroma Database (default)
- **Real-time transport:** WebSocket

## Performance targets

- **Time To First Byte (TTFB) p50:** under 400 milliseconds (p95 under 900 milliseconds)
- **Barge-in stop p95:** under 250 milliseconds
- **Turn latency p95:** under 1200 milliseconds

## Getting started

### Prerequisites
- Node.js 20+
- npm 9+
- Voice provider key (OpenAI key supported out of the box)

### Install
```bash
npm install
cp .env.example .env
# Add your provider key to .env
npm run dev
````

This starts:

* Client: [http://localhost:5173](http://localhost:5173)
* Server: [http://localhost:3000](http://localhost:3000)

## Repository structure

```
nxtg-voice/
├── client/
│   └── src/
│       ├── audio/
│       ├── ui/
│       ├── state/
│       └── events/
├── server/
│   └── src/
│       ├── api/
│       ├── orchestrator/
│       ├── lanes/
│       ├── providers/
│       ├── retrieval/
│       ├── insurance/
│       └── schemas/
├── knowledge/
├── docs/
└── .claude/
```

## Roadmap

* Telephony integration (Session Initiation Protocol and Public Switched Telephone Network adapters)
* Multi-tenant governance and enterprise console
* Policy packs per industry (healthcare, financial services, logistics)
* Evaluation harness for voice quality, latency, and safety

## License

MIT

````

---

```md
# NxtG Voice Insurance (nxtg-voice-insurance)

Governance, safety, and audit controls for real-time voice agents.

NxtG Voice Insurance is a control-plane layer that plugs into any voice agent runtime to enforce policy, prevent risky claims, and produce a replayable evidence trail.

Think of it as: "make voice agents shippable to enterprise."

## What you get

### PolicyGate with real authority
- Allow, rewrite, refuse, escalate, cancel output
- Hard cancellation hooks for streaming audio output
- Safe fallback planning (clarify, refuse, switch to text, escalate to human)

### Allowed Claims Registry
- Approved claims and required disclaimers
- Disallowed phrases and topic constraints
- Evidence mapping for what was said and why it was allowed

### AuditTrail and observability
- Append-only session log (JavaScript Object Notation Lines by default)
- Replayable session timeline:
  - transcript deltas and finals
  - lane ownership changes
  - policy decisions and reason codes
  - retrieval snippets and tool calls
  - latency markers and budgets

### Privacy controls
- Personally Identifiable Information redaction (configurable)
- Audio storage off by default; timing and hashes optional
- Tenant isolation hooks (enterprise hardening path)

## Who this is for

- Voice agent teams blocked by compliance, legal, and risk
- Contact center teams that need governance before production rollout
- Platform teams that want a consistent control layer across providers

## Integrates with

- Any WebSocket streaming voice runtime
- Node.js and Express middleware style pipelines
- Provider adapters (OpenAI, others) as long as cancellation is supported

## Quick start

### Install
```bash
npm install nxtg-voice-insurance
````

### Use as a control layer

```ts
import { PolicyGate, AuditTrail, ClaimsRegistry, FallbackPlanner } from "nxtg-voice-insurance";

const audit = new AuditTrail({ store: "jsonl", path: "./audit" });
const claims = new ClaimsRegistry({ path: "./knowledge/allowed_claims.json" });

const policy = new PolicyGate({
  mode: "balanced",
  claimsRegistry: claims,
  auditTrail: audit,
  onDecision: (decision) => {
    // decision: allow | rewrite | refuse | escalate | cancel_output
  },
});
```

### Policy decisions

Insurance emits structured decisions you can wire into your runtime:

```json
{
  "type": "policy.decision",
  "payload": {
    "decision": "cancel_output",
    "reason_codes": ["CLAIMS_RISK", "REGULATED_TOPIC"],
    "required_disclaimer_id": "DISC-001",
    "severity": 3
  }
}
```

## Recommended deployment model

* Run Insurance inside your orchestrator process for lowest latency
* Store audit logs to a secure append-only sink
* Start with strict cancellation and claims control; add advanced policies later

## Roadmap

* Enterprise policy console (claims, disclaimers, policy templates)
* Industry policy packs
* Storage adapters (PostgreSQL, object storage, event streams)
* Tenant-level compliance reporting

## License

MIT

````

---

```md
# NxtG Voice Rep Starter (nxtg-voice-rep-starter)

A production-minded starter for building vertical, outcome-driven phone reps on top of NxtG Voice.

This repo is the “go ship a real rep” path. It packages:
- opinionated call flows
- domain knowledge packs
- safety and claims controls
- evaluation tests that mimic real customer calls

## What this is

A template to build a specific rep that does one job well, for example:
- Appointment scheduling rep
- Billing and payment rep
- Dispatch and reschedule rep
- Intake and qualification rep

It uses the three-lane system:
- **Lane A (Reflex):** keeps the caller engaged while the system routes and retrieves
- **Lane B (Reasoned):** streams the actual answer, grounded with Retrieval-Augmented Generation (RAG)
- **Lane C (Control):** governs output; cancels risky responses; logs evidence

## Who this is for

- Operators who want a rep that works, not a sandbox demo
- Teams replacing or reducing contact center volume
- Product teams that want a vertical wedge and bigger annual contract value

## What you ship with this starter

### 1) Proven conversation flows
- Greeting, intent capture, confirmation
- Clarification loops
- Escalation to human (stub)
- Transfer and handoff (telephony adapter planned)

### 2) Knowledge pack and claims controls
- Structured facts pack format
- Allowed claims registry and disclaimers
- Refusal patterns for regulated or risky topics

### 3) Evaluation harness
- Scripted call scenarios
- Latency budgets and success criteria per scenario
- Safety tests (prompt injection attempts, disallowed claims, personally identifiable information)

## Suggested first vertical: Appointment Scheduling Rep

This is usually the cleanest wedge:
- high volume
- clear success criteria
- measurable return on investment
- minimal regulatory foot-guns if scoped properly

Capabilities:
- schedule, reschedule, cancel
- confirm location and hours
- send confirmation (stub)
- escalate to staff when uncertain

## Getting started

### Prerequisites
- Node.js 20+
- npm 9+
- Voice provider key
- Optional: calendar integration key (future module)

### Install and run
```bash
npm install
cp .env.example .env
npm run dev
````

## Repository structure

```
nxtg-voice-rep-starter/
├── client/
├── server/
│   └── src/
│       ├── flows/            # call flow definitions
│       ├── lanes/            # A, B, C
│       ├── insurance/        # policy and audit wiring
│       ├── retrieval/        # knowledge pack and facts packs
│       └── adapters/         # telephony and provider adapters (planned)
├── knowledge/
│   ├── facts.jsonl
│   ├── disclaimers.json
│   ├── allowed_claims.json
│   └── disallowed_phrases.json
└── eval/
    ├── scenarios/
    └── reports/
```

## Roadmap

* Telephony adapter (Session Initiation Protocol and phone provider integration)
* Agent transfer and warm handoff patterns
* Operator console for monitoring calls and policy events
* Multi-tenant packaging for managed service delivery

## License

MIT

```

---

If you want, I can also generate the **matching repository names + module names** so your ecosystem stays consistent with nxtg-forge:

- `nxtg-voice` (runtime)
- `nxtg-voice-insurance` (control plane)
- `nxtg-voice-reps` or `nxtg-voice-rep-starter` (vertical templates)

Tell me which direction you want as the “hero” first… runtime, insurance, or reps… and I’ll tighten that README into something you can ship publicly (including crisp positioning, screenshots section, and a pricing narrative without overpromising).
::contentReference[oaicite:0]{index=0}
```
