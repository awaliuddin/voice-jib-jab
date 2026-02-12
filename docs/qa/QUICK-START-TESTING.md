# Quick Start: Testing Voice Jib-Jab

**Last Updated:** 2026-01-10

A developer-friendly guide to running, writing, and debugging tests for Voice Jib-Jab.

---

## Quick Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- OpenAIRealtimeAdapter.test.ts

# Run in watch mode
npm test -- --watch

# Run with verbose output
npm test -- --verbose

# Run only failed tests
npm test -- --onlyFailures
```

---

## Current Test Status

```
Test Coverage: 14.69% (Target: 85%)

Passing Tests: 50/50
Test Suites: 3 passing

Coverage by Component:
  OpenAIRealtimeAdapter: 0%   ❌ CRITICAL GAP
  LaneB: 0%                   ❌ CRITICAL GAP
  WebSocket: 0%               ❌ HIGH RISK
  LaneArbitrator: 72%         ⚠️  NEEDS WORK
  LatencyBudget: 98%          ✅ GOOD
  EventBus: 84%               ✅ GOOD
```

---

## Test Files Location

```
server/src/__tests__/
├── unit/
│   ├── OpenAIRealtimeAdapter.test.ts    (NEW - 70+ tests)
│   ├── LaneArbitrator.enhanced.test.ts  (TODO)
│   └── LaneB.test.ts                    (TODO)
├── integration/
│   └── voice-pipeline.test.ts           (TODO)
├── helpers/
│   ├── audio.ts                         (NEW)
│   └── wait.ts                          (NEW)
├── mocks/
│   └── MockWebSocket.ts                 (NEW)
├── EventBus.test.ts                     (EXISTS - 11 tests)
├── LatencyBudget.test.ts                (EXISTS - 13 tests)
└── LaneArbitrator.test.ts               (EXISTS - 26 tests)
```

---

## Writing a New Test

### 1. Create Test File

```typescript
// server/src/__tests__/unit/MyComponent.test.ts

import { MyComponent } from "../../path/to/MyComponent.js";

describe("MyComponent", () => {
  let component: MyComponent;

  beforeEach(() => {
    // Setup before each test
    component = new MyComponent();
  });

  afterEach(() => {
    // Cleanup after each test
    jest.clearAllMocks();
  });

  describe("myMethod", () => {
    it("should do something", () => {
      const result = component.myMethod();
      expect(result).toBe(expected);
    });

    it("should handle errors", () => {
      expect(() => component.myMethod()).toThrow("Error message");
    });
  });
});
```

### 2. Run Your Test

```bash
# Run just your test
npm test -- MyComponent.test.ts

# Run with coverage
npm test -- MyComponent.test.ts --coverage
```

---

## Common Testing Patterns

### Testing Async Functions

```typescript
it("should handle async operation", async () => {
  const result = await adapter.connect("session-id");
  expect(result).toBeDefined();
});
```

### Testing Events

```typescript
import { waitForEvent } from "../helpers/wait.js";

it("should emit event", async () => {
  const eventPromise = waitForEvent(emitter, "my-event");

  triggerSomething();

  const eventData = await eventPromise;
  expect(eventData).toEqual({ foo: "bar" });
});
```

### Testing with Mocks

```typescript
// Mock a module
jest.mock("ws");

// Mock a function
const mockFn = jest.fn().mockReturnValue("mocked value");

// Verify mock was called
expect(mockFn).toHaveBeenCalledWith(expectedArg);
expect(mockFn).toHaveBeenCalledTimes(2);
```

### Creating Test Audio

```typescript
import { createAudioForDuration } from "../helpers/audio.js";

it("should process audio", async () => {
  // Create 200ms of audio
  const audio = createAudioForDuration(200);

  await adapter.sendAudio(audio);

  expect(somethingHappened).toBe(true);
});
```

---

## Debugging Tests

### Enable Verbose Logging

```typescript
describe("MyComponent", () => {
  beforeAll(() => {
    // Silence console in tests
    jest.spyOn(console, "log").mockImplementation();
  });

  afterAll(() => {
    // Restore console
    jest.restoreAllMocks();
  });

  it("should log something", () => {
    const spy = jest.spyOn(console, "log");

    myComponent.doSomething();

    expect(spy).toHaveBeenCalledWith("expected log message");
  });
});
```

### Debug a Failing Test

```bash
# Run only the failing test
npm test -- MyComponent.test.ts --testNamePattern="should do something"

# Run with Node debugger
node --inspect-brk node_modules/.bin/jest MyComponent.test.ts

# Add breakpoints in your test
it("should debug this", () => {
  debugger; // <-- execution will pause here
  myComponent.doSomething();
});
```

### Common Issues

**Issue:** Test timeout
```typescript
// Increase timeout for slow tests
it("slow test", async () => {
  // test code
}, 10000); // 10 second timeout
```

**Issue:** Mock not working
```typescript
// Ensure mock is called before importing module
jest.mock("ws");
import { MyClass } from "./MyClass.js"; // Import AFTER mock
```

**Issue:** Flaky tests
```typescript
// Use waitForCondition instead of setTimeout
await waitForCondition(() => someValue === expected, 5000);
```

---

## Test Helpers Reference

### Audio Helpers (`helpers/audio.ts`)

```typescript
// Create audio chunk
createAudioChunk(4096); // 4096 bytes

// Create audio for specific duration
createAudioForDuration(500); // 500ms

// Create multiple chunks
createAudioChunks(1000, 4096); // 1 second, 4096 byte chunks

// Calculate duration
calculateDuration(48000); // Returns 1000ms
```

### Async Helpers (`helpers/wait.ts`)

```typescript
// Wait for event
await waitForEvent(emitter, "event-name", 5000);

// Wait for multiple events
await waitForEvents(emitter, ["event1", "event2"]);

// Wait for condition
await waitForCondition(() => value === true, 5000);

// Sleep
await sleep(100); // Wait 100ms

// Wait for next tick
await nextTick();
```

### Mock WebSocket (`mocks/MockWebSocket.ts`)

```typescript
// Create mock
const mockWs = new MockWebSocket();

// Simulate receiving message
mockWs.receiveMessage({ type: "session.created" });

// Check sent messages
expect(mockWs.hasSentMessage("commit")).toBe(true);

// Get messages by type
const commits = mockWs.getMessagesByType("commit");

// Clear message history
mockWs.clearMessages();
```

---

## Coverage Goals

### Minimum Requirements

- **Overall:** 85%
- **Critical Components:**
  - OpenAIRealtimeAdapter: 85%
  - LaneB: 85%
  - LaneArbitrator: 90%
  - WebSocket Handler: 80%

### How to Check Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html

# Check coverage for specific file
npm test -- OpenAIRealtimeAdapter.test.ts --coverage --collectCoverageFrom="src/providers/OpenAIRealtimeAdapter.ts"
```

### Coverage Thresholds

Configured in `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70,
  },
}
```

---

## Testing Checklist

Before committing code:

- [ ] All tests pass (`npm test`)
- [ ] Coverage thresholds met (`npm run test:coverage`)
- [ ] No console errors or warnings
- [ ] TypeScript compilation succeeds (`tsc --noEmit`)
- [ ] ESLint passes (`npm run lint`)

Before merging PR:

- [ ] All CI/CD checks green
- [ ] Code review completed
- [ ] New functionality has tests
- [ ] Coverage didn't decrease

Before production:

- [ ] Overall coverage >= 85%
- [ ] All P0 tests passing
- [ ] Performance benchmarks met
- [ ] Load tests passed
- [ ] Security audit clean

---

## P0 Test Priorities

**MUST complete before production:**

1. **OpenAIRealtimeAdapter Tests** (Est: 6-8h)
   - Buffer duration calculation
   - Guard clauses (all 3)
   - Confirmation protocol
   - Error handling

2. **Enhanced LaneArbitrator Tests** (Est: 2-3h)
   - New state transitions
   - Response in progress flag
   - Edge case handling

3. **Voice Pipeline Integration** (Est: 4-6h)
   - End-to-end audio flow
   - Race condition prevention
   - Error recovery

4. **LaneB Unit Tests** (Est: 3-4h)
   - First audio detection
   - Response lifecycle
   - Context injection

**Total Estimated Effort:** 15-21 hours

---

## Continuous Integration

### GitHub Actions Workflow

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests

### Pre-commit Hooks

Configured via Husky:
```bash
# Runs before each commit
npm test
npm run lint
```

To skip (use sparingly):
```bash
git commit --no-verify
```

---

## Troubleshooting

### Tests Won't Run

```bash
# Clear Jest cache
npm test -- --clearCache

# Reinstall dependencies
rm -rf node_modules
npm ci
```

### TypeScript Errors in Tests

```bash
# Check TypeScript config
cat jest.config.js

# Verify tsconfig
cat tsconfig.json
```

### Mocks Not Working

```typescript
// Ensure jest.mock is called BEFORE imports
jest.mock("module-name");
import { MyClass } from "module-name"; // Import AFTER

// Clear mocks between tests
afterEach(() => {
  jest.clearAllMocks();
});
```

### Flaky Tests

```typescript
// Use helpers instead of setTimeout
await waitForCondition(() => ready === true);

// Increase timeout for slow operations
it("slow test", async () => {
  // ...
}, 10000);

// Ensure proper cleanup
afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});
```

---

## Resources

### Documentation
- [Jest Docs](https://jestjs.io/docs/getting-started)
- [Production Readiness Assessment](./production-readiness-assessment.md)
- [Deliverable Summary](./DELIVERABLE-SUMMARY.md)

### Example Tests
- `server/src/__tests__/LaneArbitrator.test.ts` - Good state machine testing
- `server/src/__tests__/LatencyBudget.test.ts` - Good metrics testing
- `server/src/__tests__/EventBus.test.ts` - Good event testing

### Getting Help
1. Check existing tests for patterns
2. Review production readiness assessment
3. Check Jest documentation
4. Ask in team chat

---

## Quick Reference Card

```bash
# Essential Commands
npm test                           # Run all tests
npm test -- --watch                # Watch mode
npm run test:coverage              # Coverage report
npm test -- MyTest.test.ts         # Specific test

# Debugging
npm test -- --verbose              # Verbose output
npm test -- --testNamePattern=foo  # Specific test name
node --inspect-brk jest MyTest     # Node debugger

# Coverage
open coverage/lcov-report/index.html  # View HTML report

# Quality Checks
npm run lint                       # ESLint
tsc --noEmit                       # TypeScript check
```

---

**Last Updated:** 2026-01-10
**Maintainer:** Development Team
**Status:** Active Development
