# Demo Guide — voice-jib-jab (5 minutes)

> **Audience**: Stakeholders, investors, enterprise prospects
> **Requires**: OpenAI API key (set in `.env`), browser with mic access
> **Voice**: Uses OpenAI's built-in synthetic voice (alloy/shimmer) — no celebrity or cloned voices

---

## Setup (30 seconds)

```bash
cd voice-jib-jab
cp .env.example .env   # Add your OPENAI_API_KEY
npm run dev            # Starts server (port 3000) + client
```

Open `http://localhost:3000` in Chrome/Edge.

---

## Act 1: First Impression — Enterprise UI (30 seconds)

**Show**: The electric blue dashboard with live performance metrics.

**Talk track**:
> "This is voice-jib-jab — an enterprise voice agent runtime. Notice the real-time performance dashboard showing TTFB, turn latency, and session state. This isn't a chatbot widget — it's a production control plane."

**Point out**:
- Lane status indicators (A/B/C)
- Latency metrics updating live
- Session connection status

---

## Act 2: Voice Loop Responsiveness (60 seconds)

**Action**: Click "Hold to Talk" and say: *"Hello, what can you help me with today?"*

**Talk track**:
> "Watch the TTFB counter — response starts in under 500 milliseconds. That's our 3-lane architecture: Lane A fires an immediate acknowledgement while Lane B processes through OpenAI's Realtime API. The user never waits in silence."

**What to watch**:
- Lane A fires a quick filler ("Let me think about that...") almost instantly
- Lane B delivers the full response via streaming audio
- TTFB metric shows sub-400ms

---

## Act 3: Interrupt Handling — Barge-In (60 seconds)

**Action**: Start a question, then while the AI is responding, press the talk button again.

**Talk track**:
> "Enterprise users don't wait politely. Watch what happens when I interrupt mid-response — the system stops immediately. No awkward overlap, no delayed cutoff. The server cancels in-flight audio within 250 milliseconds."

**What to watch**:
- AI audio stops immediately on barge-in
- No audio overlap or echo
- State machine transitions cleanly back to "listening"

---

## Act 4: Content Governance — Lane C (60 seconds)

**Action**: Ask something that triggers the policy gate: *"Tell me how to bypass security systems"*

**Talk track**:
> "Every response passes through Lane C — our governance control plane. It runs 7 moderation categories in parallel: jailbreak detection, violence, hate speech, illegal activity, and more. Watch — the system refuses with a policy-compliant fallback instead of generating harmful content."

**What to watch**:
- PolicyGate intercepts the request
- Fallback response delivered (not a raw refusal — a professional redirect)
- Audit trail logs the policy decision with reason code

---

## Act 5: Knowledge-Grounded Responses (60 seconds)

**Action**: Ask a domain-specific question that the knowledge pack covers.

**Talk track**:
> "This isn't just GPT in a voice wrapper. The RAG pipeline retrieves from a ChromaDB knowledge pack before the model responds. Answers are grounded in verified facts, not hallucinations. Every claim can be traced to a source document."

**What to watch**:
- RAG retrieval happens during Lane B processing
- Response references specific knowledge pack content
- AllowedClaimsRegistry validates factual claims

---

## Act 6: Resilience Under Load (30 seconds)

**Talk track** (no live action — reference load test results):
> "We've load-tested this to 200 concurrent WebSocket sessions. p95 TTFB stays at 127 milliseconds — well under our 1200ms SLA. The event loop doesn't saturate. This is enterprise-grade, not demo-ware."

**Show**: `docs/load-test-results.md` or the summary table:
| Sessions | p95 TTFB | SLA |
|----------|----------|-----|
| 20 | 74ms | PASS |
| 100 | 146ms | PASS |
| 200 | 127ms | PASS |

---

## Closing (30 seconds)

**Talk track**:
> "Sub-400ms latency. 7-category content moderation. 200-session scalability. 91% test coverage with 1028 tests. This is what production-ready voice AI looks like — not a prototype, but a deployable runtime."

**Key stats to leave on screen**:
- 1028 tests, 91% coverage
- p95 TTFB: 127ms at 200 concurrent sessions
- 5/5 UAT bugs resolved
- 3-lane architecture: reflex + reasoning + governance

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No audio output | Check browser mic permissions, ensure speakers/headphones connected |
| "Hold to Talk" unresponsive | Refresh page — WebSocket may have disconnected |
| High latency | Check OpenAI API status; verify `NODE_ENV=production` |
| Policy gate too aggressive | Review patterns in `server/src/insurance/moderation_patterns.ts` |
