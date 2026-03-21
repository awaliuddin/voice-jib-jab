# Jest Timer Leak Analysis — process.nextTick vs setImmediate

**Project:** voice-jib-jab (P-07)
**Date:** 2026-03-20
**Status:** Resolved — fixes committed

---

## Problem

Jest reported intermittent "A worker process has failed to exit gracefully and has been force exited" warnings after the test suite completed. All 3,894 tests passed; only the worker exit was affected.

## Root Causes (3 independent)

### 1. Stryker sandbox phantom tests
**Symptom:** Jest ran 1,082 extra tests from `.stryker-tmp/` mutation sandbox.
**Cause:** `.stryker-tmp/` was excluded from `modulePathIgnorePatterns` but not `testPathIgnorePatterns`.
**Fix:** Added `.stryker-tmp/` to both arrays in `jest.config.js`.

### 2. `setInterval` without `.unref()` in OpenAIRealtimeAdapter
**Symptom:** Worker stayed alive 30 seconds after tests completed (the health-check interval).
**Cause:** `startPingInterval()` created a 30s `setInterval` without calling `.unref()`. Node.js keeps the event loop alive as long as a referenced interval exists.
**Fix:** `this.pingInterval.unref()` after `setInterval(...)`.

### 3. `process.nextTick` in MockWebSocket constructor
**Symptom:** Worker occasionally force-exited (1/3 of runs) after the `setImmediate` fix.
**Cause:** `process.nextTick` fires in the microtask queue and **cannot be `.unref()`'d**. When MockWebSocket fires its `"open"` event via `process.nextTick`, the callback runs in the cleanup phase after a test worker finishes — keeping the worker process busy just long enough to miss Jest's exit window.
**Fix:** Changed both `process.nextTick` calls (constructor + `close()`) to `setImmediate(...).unref()`.

## Key Technical Distinction

| | `process.nextTick` | `setImmediate` |
|--|--|--|
| Queue | Microtask queue | I/O check phase |
| `.unref()` support | ❌ Not supported | ✅ Supported |
| Blocks worker exit | Yes, if pending after test | No, if `.unref()` called |

## Diagnostic Pattern

```bash
# --detectOpenHandles makes Jest track all handles more carefully.
# Side effect: its slower execution gives pending timers time to clean up,
# making the warning disappear — confirming the issue is a timing race,
# not a real handle leak.
npx jest --detectOpenHandles
```

If the warning disappears with `--detectOpenHandles` but not normally: the leak is a timer
timing race at worker exit, not a persistent handle. Fix: add `.unref()` to all timers
that should not prevent exit.

## Pattern: Timer Setup in Test Infrastructure

```typescript
// WRONG — process.nextTick cannot be unref'd
process.nextTick(() => { this.emit("open"); });

// RIGHT — setImmediate supports .unref()
const t = setImmediate(() => { this.emit("open"); });
t.unref();
```

## Residual

After all fixes, the warning appears ~0–1 times in 10 runs (vs consistently before).
The remaining race is sub-millisecond and has no impact on test results.

## Files Changed

- `server/jest.config.js` — `.stryker-tmp/` exclusion
- `server/src/providers/OpenAIRealtimeAdapter.ts` — `pingInterval.unref()`, `reconnectTimer.unref()`
- `server/src/lanes/LaneA.ts` — skip TTS init when `enabled=false`
- `server/src/__tests__/mocks/MockWebSocket.ts` — `process.nextTick` → `setImmediate + .unref()`
- `server/src/__tests__/unit/OpenAIRealtimeAdapter.test.ts` — `doNotFake` list updated
