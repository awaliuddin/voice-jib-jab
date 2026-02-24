# CLAUDE.md — voice-jib-jab

## Project Overview

**voice-jib-jab** is a production voice agent runtime focused on eliminating the two things that kill enterprise voice deployments: bad latency and ungoverned output.

## Architecture

- **3-Lane System**: Lane A (reflex acknowledgements), Lane B (reasoning), Lane C (policy/governance)
- **OpenAI Realtime API** for voice loop (Mic → WebSocket → OpenAI → playback)
- **ChromaDB** for persistent cross-session memory
- **Enterprise UI** with electric blue design system (Tailwind-first)

## Key Constraints

- Do NOT remove the 3-lane architecture — this is a portfolio-level architectural decision
- Preserve sub-400ms latency achievement
- Fix CRITICAL UAT bugs (#1 audio feedback loop, #5 audit trail FK race) before any new feature work
- Test coverage target: 14.69% → 85%

## Development

```bash
npm test          # Run test suite
npm run dev       # Start development server
```

---

## ASIF Governance

This project is **P-07** in the ASIF portfolio (Voice & Media vertical). It is governed by the ASIF Chief of Staff.

**On every session**:
1. Read `.asif/NEXUS.md` — check the `## CoS Directives` section at the bottom
2. Execute any **PENDING** directives before other work (unless Asif explicitly overrides)
3. Write your response inline under each directive's `**Response**` section
4. Update initiative statuses in NEXUS if your work changes them
5. If you have questions for the CoS, add them under `## Team Questions` in NEXUS

## Execution Strategy
For any directive that touches 3+ files or requires architectural decisions:
1. USE PLAN MODE — think before you code. Outline your approach first.
2. USE AGENT TEAMS — break complex work into parallel sub-tasks. You have sub-agents. Use them.
3. Test everything. Test counts never decrease.
Do NOT skip planning on complex directives. Plan mode and agent teams are your super-powers.

**Escalation via Team Questions**: When you hit a blocker, need an architecture review, or have a portfolio-level question, add it under `## Team Questions` in your `.asif/NEXUS.md`. Your CoS checks these 3x daily during scheduled enrichment cycles and will respond inline or issue follow-up directives.
