# Test Pattern: Arithmetic Assertions with jest.setSystemTime()

**Project:** voice-jib-jab (P-07)
**Date:** 2026-03-20
**Status:** Pattern established — applied in LaneArbitrator tests

---

## Problem: Hollow Elapsed-Time Assertions

Functions that compute `end - start` elapsed times are commonly tested with:

```typescript
expect(metrics.latencyMs).toBeGreaterThan(0);
```

This assertion is **mutation-blind**. All of the following implementations pass it:

```typescript
// Correct implementation
latencyMs = bReadyTime - speechEndTime;  // ✅ passes toBeGreaterThan(0)

// Wrong implementations that also pass
latencyMs = bReadyTime + speechEndTime;  // ✅ still > 0 (both positive timestamps)
latencyMs = speechEndTime - bReadyTime;  // ❌ negative — but only if bReadyTime > speechEndTime
latencyMs = Math.abs(bReadyTime - speechEndTime); // ✅ always > 0
```

The `toBeGreaterThan(0)` assertion confirms the value is positive but says nothing about the
arithmetic being correct. Stryker's arithmetic operator mutation (`-` → `+`) survives.

## Solution: `jest.setSystemTime()` + Exact Value Assertion

Pin exact timestamps using fake timers, then assert the precise result:

```typescript
describe("latencyMs arithmetic", () => {
  it("is bReadyTime MINUS speechEndTime (not plus)", () => {
    // jest.useFakeTimers() must already be active (file-level or describe-level)

    const T1 = 1700000000000; // any large timestamp
    jest.setSystemTime(T1);
    arbitrator.onUserSpeechEnded(); // sets speechEndTime = Date.now() = T1

    jest.setSystemTime(T1 + 350);
    arbitrator.onLaneBReady(); // sets bReadyTime = Date.now() = T1 + 350

    const metrics = arbitrator.getMetrics();
    expect(metrics.latencyMs).toBe(350); // exactly 350, not 3400000000350
  });
});
```

This kills:
- `bReadyTime + speechEndTime` (result: 3,400,000,000,350 ≠ 350)
- `speechEndTime - bReadyTime` (result: -350 ≠ 350)
- `bReadyTime * 2` or any other mutation (result: ≠ 350)

## Prerequisites

1. `jest.useFakeTimers()` must be active (file-level or describe block)
2. `jest.useFakeTimers()` fakes `Date` by default in Jest 27+ (`@sinonjs/fake-timers`)
3. **Important:** `doNotFake` lists must NOT include `Date` if you need `setSystemTime`
4. Numeric separators (`1_700_000_000_000`) parse correctly in TypeScript but may fail
   in the Babel transform used by `ts-jest`. Use plain numbers in test files.

## Application

This pattern applies to any function that returns a computed duration:

```typescript
// Latency measurements
latencyMs = endTime - startTime;

// Age/expiry calculations
ageSeconds = Math.floor((Date.now() - createdAt) / 1000);

// Rate calculations
requestsPerSecond = count / ((Date.now() - windowStart) / 1000);
```

In each case: set `Date.now()` to a known value before the start event, advance to a known
value before the end event, assert the exact computed result.

## Caveat: When NOT to Use This Pattern

For functions where the exact duration value is irrelevant and only the sign/ordering matters
(e.g., "event B happened after event A"), `toBeGreaterThan(0)` remains appropriate. The
`setSystemTime` pattern is specifically for arithmetic correctness tests.
