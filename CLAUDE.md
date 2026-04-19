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
- UAT bugs #1 (audio feedback loop) and #5 (audit trail FK race) — RESOLVED 2026-02-20, verified 2026-03-12
- Test coverage: 91% (floor enforced via coverageThreshold in jest.config.js — stmt 88, branch 78, fn 87, lines 88)

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
6. **Re-read `## Team Questions`** — check for CoS responses to your previous questions. Responses are written inline under each question entry. Do NOT claim questions are unanswered without scrolling to the actual question entry and checking for a `> **CoS Response**` block.

## Execution Strategy
For any directive that touches 3+ files or requires architectural decisions:
1. USE PLAN MODE — think before you code. Outline your approach first.
2. USE AGENT TEAMS — break complex work into parallel sub-tasks. You have sub-agents. Use them.
3. Test everything. Test counts never decrease.
Do NOT skip planning on complex directives. Plan mode and agent teams are your super-powers.

**Escalation via Team Questions**: When you hit a blocker, need an architecture review, or have a portfolio-level question, add it under `## Team Questions` in your `.asif/NEXUS.md`. Your CoS checks these 3x daily during scheduled enrichment cycles and will respond inline or issue follow-up directives.

## Idle Time Protocol
When no directives are pending and no active work exists:
1. Run CRUCIBLE Gates 1-7 self-audit on your test suite
2. Document recent research in docs/research/
3. Review and strengthen hollow test assertions
4. Check Portfolio Intelligence section for reuse signals
5. Update stale documentation (README, badges, CHANGELOG)

Time limit: 30 minutes. Log actions in NEXUS ## Self-Improvement Log.
Do NOT make architecture changes or add new features during self-improvement.

## CI Gate Protocol (ASIF Standard)
Before EVERY `git push`, you MUST:
1. Run the full test suite (`npm test`)
2. Verify ZERO failures (xfail/skip OK, failures NOT OK)
3. If tests fail → fix before pushing. No exceptions.
4. Include test count in commit message: "Tests: X passed, Y skipped"
Violating this protocol means broken CI, which means Asif gets spammed.

## CRUCIBLE Protocol (Test Quality)
This project follows the CRUCIBLE Protocol (`~/ASIF/standards/crucible-protocol.md`).
Rules that apply to this project:
- Gate 4: Delta gate — test count decreases > 5 require justification in commit message
- Oracle tier: STANDARD — minimum 2 oracle types per feature

## Dx3 Brain Integration
On every session start, recall relevant context from Dx3 before starting work:
- Use recall() to check for prior decisions, lessons, and patterns related to your current task
- After shipping work, use remember() to store what you learned
- The brain at dx3-cognitive MCP has context from ALL projects — use it

This is how the portfolio compounds intelligence. Your work benefits from every other team's learning.

## Team Voice

Our voice is `am_echo`. Speak via:
  ~/ASIF/scripts/cos-speak-remote --voice am_echo "text"
Use on cycle exit, deliverable shipped, blocker, escalation.
