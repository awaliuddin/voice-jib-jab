# Stryker Related-Test Discovery — File-Scoped vs Transitive Coverage

**Project:** voice-jib-jab (P-07)
**Date:** 2026-03-20
**Status:** Research — informs future Stryker baseline interpretation

---

## Finding

Stryker classifies mutants as "No coverage" when no **directly related** test file covers the
mutated code. "Related" is determined by Stryker's test discovery: it instruments the file,
runs only the tests that import it transitively, and marks remaining mutants as uncovered.

**Key insight:** Stryker's related-test discovery is often file-scoped, not transitive.

### Example: AllowedClaimsRegistry (2026-03-16 baseline)

The `initialize()`, `getEmbeddingSimilarityScore()`, and `loadClaimsCatalog()` paths had 130
"no coverage" mutants. But these paths DID have real test coverage — via:
- `ControlEngine.test.ts` → `ControlEngine` → `OpaClaimsCheck` → `AllowedClaimsRegistry`
- `OpaClaimsCheck.test.ts` → `OpaClaimsCheck` → `AllowedClaimsRegistry`
- `FullPipelineE2E.test.ts` → full pipeline

Stryker identified these integration/higher-layer tests as related tests for their *direct*
imports but not for the deeply-nested `AllowedClaimsRegistry` dependency.

## Mutation Score vs Coverage Reality

| Stryker label | Meaning | Action |
|--|--|--|
| **Killed** | Mutation caught by test failure | ✅ Healthy |
| **Survived** | Mutation not caught — hollow assertion | ⚠️ Strengthen test |
| **No coverage** | No related test found by Stryker | Investigate — may be real gap OR scope artifact |
| **Timeout** | Test took too long with mutation | Review mutation scope |

## Distinguishing Gaps from Artifacts

1. Run `npm test -- --coverage` and check the actual coverage percentage for the file.
   If coverage is high (>80%) but Stryker shows many "no coverage" mutants, it's a
   scope artifact.

2. Check whether the uncovered lines are tested indirectly (grep for the function name
   in integration tests). If found, Stryker's scope detection missed them.

3. The fix for scope artifacts is always **direct unit tests** — Stryker can find them.
   The fix for genuinely uncovered code is the same.

## Impact on Mutation Score

Adding direct unit tests converts "no coverage" mutants into "killed" or "survived."
This **raises** the mutation score (more mutants are now tested) but may also **reveal**
previously hidden survivors that weren't visible in the no-coverage classification.

### Expected score changes after 2026-03-20 gap-fill:

| File | Before | Expected after | Threshold |
|--|--|--|--|
| `LaneArbitrator.ts` | 53.95% | ~65%+ | 60% |
| `AllowedClaimsRegistry.ts` | 36.29% | ~55%+ | 40% |
| `policy_gate.ts` | 70.48% | stable | 60% |

## Recommendation

When reading a Stryker report, always correlate "no coverage" counts against actual
Jest coverage output. High coverage + high no-coverage count = scope detection issue.
Run the targeted Stryker scope (specific files) with their direct test files to get
meaningful mutation scores.
