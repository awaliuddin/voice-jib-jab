# Contributing to voice-jib-jab

This guide is for developers new to the project. It covers environment setup, project conventions, and the processes you need to follow before opening a pull request.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | Required for both client and server |
| npm | 9+ | Bundled with Node.js 20 |
| OpenAI API key | — | Required for the voice loop |
| OPA CLI | any | Optional — only needed for policy file development |

The OPA CLI (`opa`) is only required if you are modifying `.rego` policy files or building WASM bundles via `npm run build:policy`. Normal feature work does not need it.

---

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/axw/voice-jib-jab.git
cd voice-jib-jab

# 2. Install all dependencies (root workspace, client, and server)
npm install

# 3. Configure environment variables
cp .env.example .env
# Open .env and set OPENAI_API_KEY to your key

# 4. Start development servers
npm run dev
```

`npm run dev` starts two processes concurrently:
- Client (Vite) at `http://localhost:5173`
- Server (Express + WebSocket) at `http://localhost:3000`

---

## Architecture Overview

voice-jib-jab uses a **three-lane system** to keep latency low and output governed simultaneously.

| Lane | Role | Latency target |
|------|------|----------------|
| A — Reflex | Immediate backchannel audio ("mm-hmm", filler sounds) | < 100ms |
| B — Reasoning | Streaming GPT response via OpenAI Realtime API | < 400ms TTFB |
| C — Control | Parallel async policy enforcement — never blocks audio | non-blocking |

Lane C is the governance pipeline. It runs concurrently with Lane B and evaluates every transcript through a chain of `PolicyCheck` implementations (PII redaction, moderation, claims verification, OPA rules). It emits `policy.decision` events that the orchestrator acts on; it never generates user-facing content.

For a detailed breakdown see `docs/architecture/ARCHITECTURE.md` and the Lane C specifics in `docs/architecture/Lane-C-and-Retrieval-Service.md`.

**Do not remove or bypass the three-lane architecture.** It is a core design constraint of this project.

---

## Running Tests

All tests live under `server/src/__tests__/`. The server is the primary test target; client tests are co-located with their components under `client/src/`.

```bash
# Run the full test suite
cd server
npm test

# Run with a coverage report
npm run test:coverage

# Print a coverage summary only
npm run coverage:check
```

### Coverage floors

Coverage thresholds are enforced by Jest and will cause the CI run to fail if breached. The current floors (set ~3% below actual measurements) are:

| Metric | Floor |
|--------|-------|
| Statements | 91% |
| Branches | 83% |
| Functions | 88% |
| Lines | 91% |

If your change causes coverage to drop below any of these values, the test run will exit non-zero. Fix it before opening a PR — either by adding tests for new code or, in rare cases where a decrease is justified, updating the threshold with an explanation in your commit message.

---

## Adding a Policy Check

A `PolicyCheck` is the unit of governance in Lane C. Each check examines an `EvaluationContext` and returns a `CheckResult` indicating whether the content should be allowed, rewritten, refused, or escalated.

### 1. Implement the interface

The `PolicyCheck` interface is defined in `server/src/insurance/policy_gate.ts`:

```typescript
export interface PolicyCheck {
  readonly name: string;
  evaluate(ctx: EvaluationContext): Promise<CheckResult>;
}
```

`evaluate` must return a `Promise<CheckResult>` — synchronous checks should return `Promise.resolve(result)`. This allows expensive checks (embedding inference, external API calls) without architectural changes.

`CheckResult` fields:

```typescript
export interface CheckResult {
  decision: PolicyDecision;   // "allow" | "rewrite" | "refuse" | "escalate" | "cancel_output"
  reasonCodes: string[];      // machine-readable codes, e.g. ["PII_DETECTED:EMAIL"]
  severity: number;           // 0 (info) → 4 (critical)
  safeRewrite?: string;       // replacement text when decision === "rewrite"
  requiredDisclaimerId?: string;
}
```

A minimal example:

```typescript
import type { PolicyCheck, CheckResult, EvaluationContext } from "../insurance/policy_gate.js";

export class CompetitorMentionCheck implements PolicyCheck {
  readonly name = "competitor_mention";

  async evaluate(ctx: EvaluationContext): Promise<CheckResult> {
    if (/competitor-name/i.test(ctx.text)) {
      return { decision: "rewrite", reasonCodes: ["COMPETITOR_MENTION"], severity: 2 };
    }
    return { decision: "allow", reasonCodes: [], severity: 0 };
  }
}
```

### 2. Register in the ControlEngine pipeline

Open `server/src/lanes/laneC_control.ts`. The `PolicyGate` is instantiated with an ordered array of checks. Add your check to that array. Checks run in order; the first non-allow result at the highest severity wins. PII should remain first; moderation second — preserve that ordering unless you have a strong reason to change it.

### 3. Write tests

Every new `PolicyCheck` requires **at minimum two oracle types** per feature:

- **State oracle** — assert the returned `decision` and `reasonCodes` for a known input.
- **Behavior oracle** — assert that the check integrates correctly inside a `PolicyGate` (i.e., the gate's aggregated result reflects your check's contribution).

Additional oracle types to consider: exception/error paths, boundary inputs, and integration with `ControlEngine` events.

Place tests in `server/src/__tests__/unit/` as `YourCheckName.test.ts`. Follow the pattern in `PolicyGate.test.ts`: use a `makeCtx()` helper to build minimal `EvaluationContext` objects rather than repeating boilerplate inline.

---

## Adding Tests

### File locations

```
server/src/__tests__/
  unit/           # Isolated unit tests (one class or function per file)
  integration/    # Multi-component flows
```

Test files must match the pattern `**/__tests__/**/*.test.ts` or `**/*.test.ts`.

### Mock patterns

Jest is configured with `ts-jest` in ESM mode. Use standard Jest mocking:

```typescript
import { jest } from "@jest/globals";

// Spy on a method
const spy = jest.spyOn(someInstance, "evaluate").mockResolvedValue({
  decision: "allow",
  reasonCodes: [],
  severity: 0,
});
```

For `PolicyCheck` dependencies, inline stub classes are preferred over `jest.mock()` — they are explicit and type-safe:

```typescript
class AllowCheck implements PolicyCheck {
  readonly name = "stub_allow";
  async evaluate(_ctx: EvaluationContext): Promise<CheckResult> {
    return { decision: "allow", reasonCodes: [], severity: 0 };
  }
}
```

### Coverage requirements

New code must not reduce overall coverage below the floors listed above. Aim to cover both the happy path and at least one error or edge-case branch for every new function.

---

## Code Style

- **TypeScript strict mode** is enabled. No `any` without a comment explaining why.
- **ESM modules** — use `.js` extensions on relative imports (e.g., `import { Foo } from "./foo.js"`), even though the source files are `.ts`. This is required by the Node.js ESM loader.
- **Formatting** — run `npm run format` (Prettier) before committing. `npm run lint` (ESLint) is also enforced.
- Follow existing patterns in the file you are editing. If you see a pattern used consistently, use it rather than introducing a new one.

---

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]
```

Common types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.

For commits that add, remove, or significantly change tests, include the test count in the commit message body:

```
feat(lane-c): add CompetitorMentionCheck policy

Tests: 2247 passed, 3 skipped
```

If a commit reduces the total test count by more than 5, include a justification explaining which tests were removed and why.

---

## Pull Request Process

1. **Run the full test suite and verify zero failures before pushing.**

   ```bash
   cd server && npm test
   ```

   Skipped tests are acceptable. Failed tests are not. Fix failures before opening a PR — do not rely on CI to catch them.

2. **Check coverage.** Run `npm run test:coverage` and confirm all four coverage metrics remain above their floors. If your change causes a floor breach, add tests before submitting.

3. **Lint and format.**

   ```bash
   npm run lint
   npm run format
   ```

4. **Keep PRs focused.** One logical change per PR. If you are fixing a bug and also refactoring an unrelated module, split them.

5. **Describe what and why** in the PR description. Link to any relevant issue. For changes to Lane C or the policy pipeline, note which checks are affected and how decisions change.

6. CI will enforce coverage thresholds automatically. A PR that breaks a coverage floor will not merge.

---

## Questions and Blockers

If you hit an architectural question or need a design review, open an issue or start a discussion in the repository. For context on Lane C internals, `docs/architecture/ControlEngine.md` is the authoritative reference.
