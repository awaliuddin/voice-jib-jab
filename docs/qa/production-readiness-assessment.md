# Voice Jib-Jab: Production Readiness Assessment & Test Plan

**Date:** 2026-01-10
**Status:** CRITICAL GAPS IDENTIFIED - NOT PRODUCTION READY
**Current Test Coverage:** 14.69% (Target: 85%)

## Executive Summary

Voice Jib-Jab has undergone critical architectural fixes to resolve race conditions and state machine issues. However, **the codebase is NOT production-ready** due to severe testing gaps:

- **Current Coverage:** 14.69% overall (70% threshold requirement not met)
- **Critical Components:** 0% coverage on OpenAIRealtimeAdapter, LaneB, WebSocket handler
- **P0 Blockers:** No tests for buffer management, confirmation protocol, or guard clauses
- **Recent Fixes:** Buffer state tracking, confirmation protocol, state machine transitions - ALL UNTESTED

### Critical Risk Assessment

| Component | Current Coverage | Risk Level | Impact |
|-----------|-----------------|------------|---------|
| OpenAIRealtimeAdapter | 0% | CRITICAL | Production outages, API errors, race conditions |
| LaneB | 0% | CRITICAL | Response failures, audio sync issues |
| WebSocket Handler | 0% | HIGH | Connection failures, session management bugs |
| LaneArbitrator | 72% | MEDIUM | Enhanced state transitions untested |
| Buffer Management | 0% | CRITICAL | Race condition regressions |

## Part 1: Gap Analysis & Assessment

### 1.1 Current Test Coverage (Generated: 2026-01-10)

```
Coverage Summary:
---------------------------|---------|----------|---------|---------|
File                       | % Stmts | % Branch | % Funcs | % Lines |
---------------------------|---------|----------|---------|---------|
All files                  |   14.69 |    10.42 |   16.81 |   14.67 |
OpenAIRealtimeAdapter.ts   |       0 |        0 |       0 |       0 | CRITICAL
LaneB.ts                   |       0 |        0 |       0 |       0 | CRITICAL
websocket.ts               |       0 |        0 |       0 |       0 | HIGH
LaneArbitrator.ts          |   71.96 |    56.75 |      90 |   71.96 | MEDIUM
LatencyBudget.ts           |   97.95 |     87.5 |     100 |     100 | GOOD
EventBus.ts                |   83.87 |    85.71 |      70 |   83.87 | GOOD
---------------------------|---------|----------|---------|---------|
```

### 1.2 Critical Untested Code Paths

#### OpenAIRealtimeAdapter (0% coverage) - PRODUCTION BLOCKER

**Recent Fixes (ALL UNTESTED):**
1. **Buffer State Tracking** (`BufferState` interface, lines 51-56)
   - `localBytes` tracking
   - `lastAppendTime` timestamps
   - `speechDetected` VAD confirmation
   - `pendingCommit` flag

2. **getBufferDurationMs()** (lines 297-299)
   - Converts bytes to milliseconds
   - Critical for minimum duration checks
   - Formula: `(bytes / 48000) * 1000`

3. **commitAudio() Guards** (lines 377-442)
   - Guard 1: Minimum duration check (100ms)
   - Guard 2: Safety window (50ms delay)
   - Guard 3: VAD confirmation preference
   - Confirmation protocol (wait for committed event)

4. **resetBufferState()** (lines 305-313)
   - Resets all buffer tracking
   - Called on commit, errors, and session end

5. **handleMessage() - Confirmation Protocol** (lines 579-597)
   - `input_audio_buffer.committed` handler
   - Only triggers `response.create` after confirmation
   - Prevents race condition regression

6. **Error Handling**
   - API error responses (lines 545-553)
   - WebSocket connection errors
   - Reconnection logic

#### LaneB (0% coverage) - PRODUCTION BLOCKER

**Untested Critical Flows:**
1. Response lifecycle management
2. First audio detection and signaling
3. Conversation context injection
4. Adapter event forwarding
5. Error propagation

#### WebSocket Handler (0% coverage) - HIGH RISK

**Untested Critical Flows:**
1. Session initialization
2. Audio chunk routing
3. Commit audio flow
4. Error handling
5. Connection lifecycle

#### LaneArbitrator (72% coverage) - MEDIUM RISK

**Gaps in Enhanced State Machine:**
- Lines 131-134: Uncovered transition paths
- Lines 166-169: Edge case handling
- Lines 260-325: Complex state machine logic
- **Missing:** Tests for the 4 new cases in `onLaneBDone()` from recent fixes

### 1.3 Test Infrastructure Assessment

**Existing Tests (50 passing):**
- ✅ LaneArbitrator basic state machine (26 tests)
- ✅ EventBus pub/sub (11 tests)
- ✅ LatencyBudget metrics (13 tests)

**Testing Framework:**
- ✅ Jest configured with ts-jest
- ✅ ESM support enabled
- ✅ Coverage thresholds defined (70%)
- ❌ No integration test setup
- ❌ No E2E test framework
- ❌ No WebSocket mocking utilities
- ❌ No performance test harness

## Part 2: Prioritized Test Plan

### Priority Levels

- **P0 (CRITICAL):** Must have before production - blocks deployment
- **P1 (IMPORTANT):** Should have within 1 week of launch
- **P2 (NICE TO HAVE):** Can be added post-launch

---

## P0 Tests (Production Blockers)

### P0.1: OpenAIRealtimeAdapter Unit Tests

**File:** `server/src/__tests__/OpenAIRealtimeAdapter.test.ts`
**Target Coverage:** 85%+
**Estimated Effort:** 6-8 hours

#### Test Groups:

**1. Buffer Duration Calculation**
```typescript
describe('getBufferDurationMs', () => {
  it('should calculate duration correctly for 48000 bytes (1 second)', () => {
    // 24kHz * 2 bytes * 1 sec = 48000 bytes
    expect(duration).toBe(1000);
  });

  it('should return 0 for empty buffer', () => {
    expect(duration).toBe(0);
  });

  it('should handle partial seconds correctly', () => {
    // 24000 bytes = 500ms
    expect(duration).toBe(500);
  });
});
```

**2. commitAudio() Guard Clauses**
```typescript
describe('commitAudio - Guard Clauses', () => {
  it('should reject commit if buffer < 100ms', async () => {
    // Send 50ms of audio (2400 bytes)
    const committed = await adapter.commitAudio();
    expect(committed).toBe(false);
    expect(resetBufferState).toHaveBeenCalled();
  });

  it('should wait for safety window (50ms)', async () => {
    // Send audio, commit immediately
    const start = Date.now();
    await adapter.commitAudio();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it('should warn when committing without VAD confirmation', async () => {
    // Send 150ms without speech_started event
    const spy = jest.spyOn(console, 'log');
    await adapter.commitAudio();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('without VAD confirmation')
    );
  });

  it('should commit successfully with valid buffer', async () => {
    // Send 200ms of audio
    const committed = await adapter.commitAudio();
    expect(committed).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'input_audio_buffer.commit'
    });
  });
});
```

**3. Confirmation Protocol**
```typescript
describe('Confirmation Protocol', () => {
  it('should wait for committed event before response.create', async () => {
    await adapter.commitAudio();

    // Should NOT send response.create yet
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response.create' })
    );

    // Simulate committed event
    adapter.handleMessage({ type: 'input_audio_buffer.committed' });

    // NOW response.create should be sent
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'response.create' })
    );
  });

  it('should reset buffer state after commit confirmation', () => {
    adapter.handleMessage({ type: 'input_audio_buffer.committed' });
    expect(bufferState.localBytes).toBe(0);
    expect(bufferState.pendingCommit).toBe(false);
  });
});
```

**4. Buffer State Tracking**
```typescript
describe('Buffer State Tracking', () => {
  it('should increment localBytes on audio append', async () => {
    await adapter.sendAudio({ data: Buffer.alloc(4096), format: 'pcm' });
    expect(bufferState.localBytes).toBe(4096);

    await adapter.sendAudio({ data: Buffer.alloc(4096), format: 'pcm' });
    expect(bufferState.localBytes).toBe(8192);
  });

  it('should update lastAppendTime on audio append', async () => {
    const before = Date.now();
    await adapter.sendAudio({ data: Buffer.alloc(4096), format: 'pcm' });
    expect(bufferState.lastAppendTime).toBeGreaterThanOrEqual(before);
  });

  it('should set speechDetected on VAD event', () => {
    adapter.handleMessage({ type: 'input_audio_buffer.speech_started' });
    expect(bufferState.speechDetected).toBe(true);
  });

  it('should reset speech detection on commit', () => {
    adapter.handleMessage({ type: 'input_audio_buffer.committed' });
    expect(bufferState.speechDetected).toBe(false);
  });
});
```

**5. Error Handling**
```typescript
describe('Error Handling', () => {
  it('should handle input_audio_buffer_commit_empty error', () => {
    const errorMessage = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        code: 'input_audio_buffer_commit_empty',
        message: 'buffer too small'
      }
    };

    expect(() => adapter.handleMessage(errorMessage)).toThrow();
    expect(errorEmitted).toBe(true);
  });

  it('should reset buffer state on commit error', async () => {
    // Force commit to fail
    mockWebSocket.send = jest.fn(() => { throw new Error('Network error'); });

    const committed = await adapter.commitAudio();
    expect(committed).toBe(false);
    expect(bufferState.localBytes).toBe(0);
  });
});
```

**6. Message Handling**
```typescript
describe('handleMessage', () => {
  it('should handle session.created', () => {
    adapter.handleMessage({ type: 'session.created' });
    expect(adapter.isSessionCreated()).toBe(true);
  });

  it('should handle response.created', () => {
    const listener = jest.fn();
    adapter.on('response_start', listener);

    adapter.handleMessage({ type: 'response.created' });
    expect(listener).toHaveBeenCalled();
  });

  it('should emit audio on response.audio.delta', () => {
    const listener = jest.fn();
    adapter.on('audio', listener);

    adapter.handleMessage({
      type: 'response.audio.delta',
      delta: 'base64audiodata'
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'pcm' })
    );
  });
});
```

**Mocking Strategy:**
```typescript
// Mock WebSocket
jest.mock('ws', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1 // OPEN
    }))
  };
});
```

---

### P0.2: Enhanced LaneArbitrator Tests

**File:** `server/src/__tests__/LaneArbitrator.enhanced.test.ts`
**Target:** Test the 4 new state transition cases in `onLaneBDone()`
**Estimated Effort:** 2-3 hours

```typescript
describe('LaneArbitrator - Enhanced State Machine', () => {
  describe('onLaneBDone from different states', () => {
    it('should handle B_PLAYING -> LISTENING transition', () => {
      arbitrator.startSession();
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      expect(arbitrator.getState()).toBe('B_PLAYING');

      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe('LISTENING');
      expect(arbitrator.getCurrentOwner()).toBe('none');
    });

    it('should handle B_RESPONDING -> LISTENING transition', () => {
      arbitrator.startSession();
      arbitrator.onUserSpeechEnded();

      expect(arbitrator.getState()).toBe('B_RESPONDING');

      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe('LISTENING');
    });

    it('should warn on unexpected B_done in LISTENING state', () => {
      const spy = jest.spyOn(console, 'log');

      arbitrator.startSession();
      expect(arbitrator.getState()).toBe('LISTENING');

      arbitrator.onLaneBDone();

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected B done in state: LISTENING')
      );
    });

    it('should reset responseInProgress flag on B_done', () => {
      arbitrator.startSession();
      arbitrator.onUserSpeechEnded();
      arbitrator.onLaneBReady();

      // responseInProgress should be true

      arbitrator.onLaneBDone();

      // Should be reset to false
      expect(arbitrator['responseInProgress']).toBe(false);
    });
  });
});
```

---

### P0.3: Integration Tests - Voice Pipeline

**File:** `server/src/__tests__/integration/voice-pipeline.test.ts`
**Target:** End-to-end audio flow
**Estimated Effort:** 4-6 hours

```typescript
describe('Voice Pipeline Integration', () => {
  let sessionManager: SessionManager;
  let mockWebSocket: MockWebSocket;

  beforeEach(() => {
    // Setup full stack with mocked OpenAI
    mockWebSocket = new MockWebSocket();
    sessionManager = new SessionManager('test-session');
  });

  it('should handle complete voice interaction cycle', async () => {
    // 1. Start session
    await sessionManager.startSession();
    expect(sessionManager.getState()).toBe('LISTENING');

    // 2. Send audio chunks
    for (let i = 0; i < 10; i++) {
      await sessionManager.sendAudio(createAudioChunk(4096));
    }

    // 3. Simulate VAD speech detection
    mockWebSocket.emit('message', {
      type: 'input_audio_buffer.speech_started'
    });

    // 4. Commit audio
    await sessionManager.commitAudio();

    // 5. Verify commit was sent
    expect(mockWebSocket.sentMessages).toContainEqual(
      expect.objectContaining({ type: 'input_audio_buffer.commit' })
    );

    // 6. Simulate commit confirmation
    mockWebSocket.emit('message', {
      type: 'input_audio_buffer.committed'
    });

    // 7. Verify response.create was sent AFTER confirmation
    expect(mockWebSocket.sentMessages).toContainEqual(
      expect.objectContaining({ type: 'response.create' })
    );

    // 8. Simulate response
    mockWebSocket.emit('message', { type: 'response.created' });
    mockWebSocket.emit('message', {
      type: 'response.audio.delta',
      delta: 'base64audio'
    });

    // 9. Verify audio is emitted
    const audioReceived = await waitForEvent(sessionManager, 'audio');
    expect(audioReceived).toBeDefined();
  });

  it('should prevent race condition with small buffer', async () => {
    await sessionManager.startSession();

    // Send only 50ms of audio (too small)
    await sessionManager.sendAudio(createAudioChunk(2400));

    // Try to commit
    const committed = await sessionManager.commitAudio();

    // Should be rejected
    expect(committed).toBe(false);

    // Should NOT send commit message
    expect(mockWebSocket.sentMessages).not.toContainEqual(
      expect.objectContaining({ type: 'input_audio_buffer.commit' })
    );
  });

  it('should handle commit error gracefully', async () => {
    await sessionManager.startSession();

    // Send valid audio
    await sessionManager.sendAudio(createAudioChunk(10000));

    // Commit
    await sessionManager.commitAudio();

    // Simulate error response
    mockWebSocket.emit('message', {
      type: 'error',
      error: {
        code: 'input_audio_buffer_commit_empty',
        message: 'buffer too small'
      }
    });

    // Should NOT have sent response.create
    expect(mockWebSocket.sentMessages).not.toContainEqual(
      expect.objectContaining({ type: 'response.create' })
    );

    // Buffer should be reset
    expect(sessionManager['adapter']['bufferState'].localBytes).toBe(0);
  });
});
```

---

### P0.4: LaneB Unit Tests

**File:** `server/src/__tests__/LaneB.test.ts`
**Target Coverage:** 85%+
**Estimated Effort:** 3-4 hours

```typescript
describe('LaneB', () => {
  let laneB: LaneB;
  let mockAdapter: MockOpenAIRealtimeAdapter;

  beforeEach(() => {
    mockAdapter = new MockOpenAIRealtimeAdapter();
    laneB = new LaneB('test-session', { providerConfig: {} });
    laneB['adapter'] = mockAdapter; // Inject mock
  });

  describe('first audio detection', () => {
    it('should emit first_audio_ready on first audio chunk', () => {
      const listener = jest.fn();
      laneB.on('first_audio_ready', listener);

      // Trigger response start
      mockAdapter.emit('response_start');

      // Send first audio
      mockAdapter.emit('audio', { data: Buffer.alloc(4096), format: 'pcm' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ latencyMs: expect.any(Number) })
      );
    });

    it('should only emit first_audio_ready once per response', () => {
      const listener = jest.fn();
      laneB.on('first_audio_ready', listener);

      mockAdapter.emit('response_start');
      mockAdapter.emit('audio', { data: Buffer.alloc(4096), format: 'pcm' });
      mockAdapter.emit('audio', { data: Buffer.alloc(4096), format: 'pcm' });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('conversation context', () => {
    it('should inject context into adapter', () => {
      const context = 'Previous conversation summary';
      laneB.setConversationContext(context);

      expect(mockAdapter.setConversationContext).toHaveBeenCalledWith(context);
    });
  });
});
```

---

## P1 Tests (Important - Within 1 Week)

### P1.1: Performance Tests

**File:** `server/src/__tests__/performance/latency.test.ts`
**Estimated Effort:** 4-5 hours

```typescript
describe('Performance - Latency Targets', () => {
  it('should achieve TTFB < 400ms (p50)', async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      await triggerResponse();
      const firstAudio = await waitForFirstAudio();
      latencies.push(Date.now() - start);
    }

    const p50 = calculatePercentile(latencies, 50);
    expect(p50).toBeLessThan(400);
  });

  it('should achieve TTFB < 900ms (p95)', async () => {
    const latencies = await runLatencyTest(100);
    const p95 = calculatePercentile(latencies, 95);
    expect(p95).toBeLessThan(900);
  });

  it('should achieve barge-in < 250ms (p95)', async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      await startResponse();
      const start = Date.now();
      await triggerBargeIn();
      latencies.push(Date.now() - start);
    }

    const p95 = calculatePercentile(latencies, 95);
    expect(p95).toBeLessThan(250);
  });
});
```

### P1.2: WebSocket Handler Tests

**File:** `server/src/__tests__/api/websocket.test.ts`
**Estimated Effort:** 4-5 hours

```typescript
describe('WebSocket Handler', () => {
  it('should initialize session on connection', async () => {
    const ws = await connectWebSocket();

    expect(ws).toReceiveMessage({
      type: 'session.ready',
      sessionId: expect.any(String)
    });
  });

  it('should route audio to correct session', async () => {
    const ws = await connectWebSocket();

    ws.send({
      type: 'audio.chunk',
      data: base64Audio
    });

    // Verify audio was forwarded to OpenAI
    expect(mockOpenAI.sentMessages).toContainEqual(
      expect.objectContaining({ type: 'input_audio_buffer.append' })
    );
  });

  it('should handle concurrent sessions independently', async () => {
    const ws1 = await connectWebSocket();
    const ws2 = await connectWebSocket();

    // Send audio to both
    ws1.send({ type: 'audio.chunk', data: audio1 });
    ws2.send({ type: 'audio.chunk', data: audio2 });

    // Verify isolation
    expect(session1Audio).not.toBe(session2Audio);
  });
});
```

### P1.3: Load Tests

**File:** `server/src/__tests__/load/concurrent-sessions.test.ts`
**Estimated Effort:** 3-4 hours

```typescript
describe('Load Testing', () => {
  it('should handle 10 concurrent sessions', async () => {
    const sessions = await createSessions(10);

    // Run simultaneous voice interactions
    await Promise.all(sessions.map(s => runVoiceInteraction(s)));

    // All should succeed
    sessions.forEach(s => {
      expect(s.getState()).toBe('completed');
    });
  });

  it('should handle 100 concurrent sessions without degradation', async () => {
    const sessions = await createSessions(100);
    const latencies = await measureLatencies(sessions);

    const p95 = calculatePercentile(latencies, 95);
    expect(p95).toBeLessThan(1000); // Allow some degradation
  });
});
```

### P1.4: Security Tests

**File:** `server/src/__tests__/security/auth.test.ts`
**Estimated Effort:** 2-3 hours

```typescript
describe('Security', () => {
  it('should reject connections without API key', async () => {
    const ws = await connectWebSocket({ apiKey: null });

    await expect(ws).toReceiveMessage({
      type: 'error',
      code: 'unauthorized'
    });
  });

  it('should validate API key format', async () => {
    const ws = await connectWebSocket({ apiKey: 'invalid' });

    await expect(ws).toReceiveMessage({
      type: 'error',
      code: 'invalid_api_key'
    });
  });

  it('should enforce rate limits', async () => {
    const ws = await connectWebSocket();

    // Send 1000 messages rapidly
    for (let i = 0; i < 1000; i++) {
      ws.send({ type: 'audio.chunk', data: audio });
    }

    await expect(ws).toReceiveMessage({
      type: 'error',
      code: 'rate_limit_exceeded'
    });
  });
});
```

---

## P2 Tests (Nice to Have - Post-Launch)

### P2.1: React Component Tests

**File:** `client/src/__tests__/VoiceInterface.test.tsx`
**Estimated Effort:** 3-4 hours

```typescript
describe('VoiceInterface', () => {
  it('should render with correct initial state', () => {
    render(<VoiceInterface />);
    expect(screen.getByText('Start Talking')).toBeInTheDocument();
  });

  it('should transition to talking state on button press', async () => {
    render(<VoiceInterface />);

    const button = screen.getByText('Start Talking');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Stop Talking')).toBeInTheDocument();
    });
  });
});
```

### P2.2: Accessibility Tests

**File:** `client/src/__tests__/a11y/accessibility.test.tsx`
**Estimated Effort:** 2-3 hours

```typescript
describe('Accessibility', () => {
  it('should have no WCAG AA violations', async () => {
    const { container } = render(<App />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should support keyboard navigation', () => {
    render(<VoiceInterface />);

    // Tab to button
    userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();

    // Press Enter to activate
    userEvent.keyboard('{Enter}');
    expect(screen.getByText('Stop Talking')).toBeInTheDocument();
  });
});
```

---

## Part 3: Implementation Guide

### Test File Structure

```
server/src/__tests__/
├── unit/
│   ├── OpenAIRealtimeAdapter.test.ts       (P0.1)
│   ├── LaneB.test.ts                       (P0.4)
│   ├── LaneArbitrator.enhanced.test.ts     (P0.2)
│   ├── EventBus.test.ts                    (EXISTS)
│   └── LatencyBudget.test.ts               (EXISTS)
├── integration/
│   ├── voice-pipeline.test.ts              (P0.3)
│   └── session-lifecycle.test.ts           (P1)
├── performance/
│   ├── latency.test.ts                     (P1.1)
│   └── throughput.test.ts                  (P1)
├── load/
│   └── concurrent-sessions.test.ts         (P1.3)
├── security/
│   └── auth.test.ts                        (P1.4)
└── api/
    └── websocket.test.ts                   (P1.2)

client/src/__tests__/
├── components/
│   ├── VoiceInterface.test.tsx             (P2.1)
│   └── PerformanceShowcase.test.tsx        (P2)
└── a11y/
    └── accessibility.test.tsx              (P2.2)
```

### Mocking Utilities

**Create:** `server/src/__tests__/mocks/MockWebSocket.ts`

```typescript
export class MockWebSocket extends EventEmitter {
  public sentMessages: any[] = [];
  public readyState = 1; // OPEN

  send(data: string) {
    const message = JSON.parse(data);
    this.sentMessages.push(message);
  }

  close(code: number, reason: string) {
    this.readyState = 3; // CLOSED
    this.emit('close', code, Buffer.from(reason));
  }

  // Simulate receiving message from OpenAI
  receiveMessage(message: any) {
    this.emit('message', JSON.stringify(message));
  }
}
```

**Create:** `server/src/__tests__/mocks/MockOpenAIRealtimeAdapter.ts`

```typescript
export class MockOpenAIRealtimeAdapter extends EventEmitter {
  public connected = false;
  public sessionCreated = false;
  public sentMessages: any[] = [];

  async connect() {
    this.connected = true;
    this.sessionCreated = true;
  }

  async sendAudio(chunk: AudioChunk) {
    this.sentMessages.push({ type: 'audio', data: chunk });
  }

  async commitAudio(): Promise<boolean> {
    this.sentMessages.push({ type: 'commit' });
    return true;
  }

  // Helper to simulate responses
  simulateResponse(audioChunks: Buffer[]) {
    this.emit('response_start');
    audioChunks.forEach(chunk => {
      this.emit('audio', { data: chunk, format: 'pcm' });
    });
    this.emit('response_end');
  }
}
```

### Test Helpers

**Create:** `server/src/__tests__/helpers/audio.ts`

```typescript
/**
 * Create synthetic PCM16 audio chunk
 * @param bytes - Size in bytes (24kHz PCM16)
 */
export function createAudioChunk(bytes: number): AudioChunk {
  return {
    data: Buffer.alloc(bytes),
    format: 'pcm',
    sample_rate: 24000
  };
}

/**
 * Create audio for specific duration
 * @param durationMs - Duration in milliseconds
 */
export function createAudioForDuration(durationMs: number): AudioChunk {
  const bytes = Math.floor((24000 * 2 * durationMs) / 1000);
  return createAudioChunk(bytes);
}
```

**Create:** `server/src/__tests__/helpers/wait.ts`

```typescript
/**
 * Wait for event with timeout
 */
export function waitForEvent<T>(
  emitter: EventEmitter,
  event: string,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeoutMs);

    emitter.once(event, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}
```

### Coverage Targets

| Component | Current | Target | Priority |
|-----------|---------|--------|----------|
| OpenAIRealtimeAdapter | 0% | 85% | P0 |
| LaneB | 0% | 85% | P0 |
| LaneArbitrator | 72% | 90% | P0 |
| WebSocket Handler | 0% | 80% | P1 |
| EventBus | 84% | 85% | P2 |
| LatencyBudget | 98% | 100% | P2 |
| **Overall** | **15%** | **85%** | **P0** |

---

## Part 4: Quality Gates

### Pre-Production Checklist

- [ ] **Unit Test Coverage >= 85%**
  - OpenAIRealtimeAdapter >= 85%
  - LaneB >= 85%
  - LaneArbitrator >= 90%
  - WebSocket Handler >= 80%

- [ ] **Critical Path Coverage = 100%**
  - Buffer management functions
  - Confirmation protocol flow
  - Guard clauses (all 3)
  - State machine transitions (all paths)
  - Error handling (all critical errors)

- [ ] **All Tests Passing**
  - 0 failing tests
  - 0 flaky tests
  - CI/CD green

- [ ] **Performance Benchmarks Met**
  - TTFB p50 < 400ms
  - TTFB p95 < 900ms
  - Barge-in p95 < 250ms

- [ ] **Load Testing Passed**
  - 100 concurrent sessions stable
  - 1-hour soak test passed
  - No memory leaks detected

- [ ] **Security Audit Clean**
  - API key validation working
  - Rate limiting implemented
  - Input sanitization verified
  - CORS configured correctly

- [ ] **Code Quality**
  - 0 ESLint errors
  - 0 TypeScript errors
  - All deprecation warnings resolved

---

## Part 5: CI/CD Integration

### GitHub Actions Workflow

**Create:** `.github/workflows/test.yml`

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-server:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run server tests
        run: cd server && npm test

      - name: Generate coverage report
        run: cd server && npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./server/coverage/lcov.info
          flags: server

      - name: Check coverage thresholds
        run: |
          if [ $(cat server/coverage/coverage-summary.json | jq '.total.lines.pct') -lt 85 ]; then
            echo "Coverage below 85%"
            exit 1
          fi

  test-client:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run client tests
        run: cd client && npm test

      - name: Generate coverage report
        run: cd client && npm run test:coverage

  lint:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Check TypeScript
        run: |
          cd server && npx tsc --noEmit
          cd ../client && npx tsc --noEmit
```

### Pre-commit Hook

**Create:** `.husky/pre-commit`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run tests before commit
npm run test

# Run linter
npm run lint

echo "✅ Pre-commit checks passed"
```

---

## Part 6: Monitoring & Observability

### Production Monitoring Setup

**Recommended Stack:**
- **Error Tracking:** Sentry
- **Performance Monitoring:** Datadog / New Relic
- **Logging:** Winston + CloudWatch / ELK Stack
- **Metrics:** Prometheus + Grafana

### Key Metrics to Track

#### Application Metrics
```typescript
// Latency metrics
latency.ttfb.p50
latency.ttfb.p95
latency.ttfb.p99
latency.bargein.p50
latency.bargein.p95

// Error rates
errors.rate
errors.openai_api.rate
errors.websocket.rate
errors.buffer_commit.rate

// Throughput
sessions.active_count
sessions.total_count
audio.chunks_per_second
responses.per_minute
```

#### Infrastructure Metrics
```typescript
// System
cpu.usage
memory.usage
memory.heap_used
memory.heap_total

// Network
websocket.connections
websocket.messages_per_second
http.requests_per_second
http.response_time
```

### Health Check Endpoints

**Enhance:** `server/src/index.ts`

```typescript
// Basic health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// Detailed status
app.get('/status', (req, res) => {
  const stats = latencyBudget.getAggregateStats();

  res.json({
    status: 'operational',
    timestamp: Date.now(),
    uptime: process.uptime(),
    metrics: {
      ttfb_p50: stats.ttfb.p50,
      ttfb_p95: stats.ttfb.p95,
      active_sessions: sessionManager.getActiveSessionCount(),
      total_responses: stats.turnLatency.count
    },
    thresholds: {
      ttfb_p50_target: 400,
      ttfb_p95_target: 900,
      ttfb_p50_met: stats.ttfb.p50 < 400,
      ttfb_p95_met: stats.ttfb.p95 < 900
    }
  });
});

// Readiness check (for load balancers)
app.get('/ready', (req, res) => {
  const ready =
    sessionManager.isReady() &&
    latencyBudget.getAggregateStats().ttfb.p95 < 1000;

  res.status(ready ? 200 : 503).json({
    ready,
    timestamp: Date.now()
  });
});
```

### Alerting Thresholds

```yaml
# Example Datadog / Prometheus alerts

- alert: HighTTFB
  expr: latency_ttfb_p95 > 900
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "TTFB p95 above target ({{ $value }}ms > 900ms)"

- alert: HighErrorRate
  expr: rate(errors_total[5m]) > 0.05
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Error rate above 5% ({{ $value }})"

- alert: BufferCommitFailures
  expr: rate(errors_buffer_commit[5m]) > 0.01
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "Buffer commit errors detected ({{ $value }})"

- alert: WebSocketDisconnections
  expr: rate(websocket_disconnections[5m]) > 10
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High WebSocket disconnection rate ({{ $value }}/min)"
```

---

## Part 7: Implementation Timeline

### Week 1: P0 Tests (Production Blockers)

**Days 1-2:** OpenAIRealtimeAdapter Unit Tests (P0.1)
- Set up test file and mocking infrastructure
- Implement buffer duration tests
- Implement guard clause tests
- Implement confirmation protocol tests
- **Target:** 85% coverage on OpenAIRealtimeAdapter

**Days 3-4:** Integration & LaneB Tests (P0.3, P0.4)
- Create integration test harness
- Implement voice pipeline tests
- Implement LaneB unit tests
- **Target:** 85% coverage on LaneB

**Day 5:** Enhanced LaneArbitrator & Coverage (P0.2)
- Add missing state machine tests
- Run full coverage report
- Fix any gaps < 85%
- **Target:** Overall coverage >= 85%

### Week 2: P1 Tests (Important)

**Days 1-2:** Performance & Load Tests (P1.1, P1.3)
- Set up performance test framework
- Implement latency benchmarks
- Implement load tests
- **Target:** All performance benchmarks met

**Days 3-4:** WebSocket & Security Tests (P1.2, P1.4)
- WebSocket handler tests
- Security audit tests
- Rate limiting tests
- **Target:** 80% coverage on WebSocket handler

**Day 5:** CI/CD Integration
- Create GitHub Actions workflow
- Set up pre-commit hooks
- Configure coverage reporting
- **Target:** Automated test pipeline working

### Week 3+: P2 Tests (Nice to Have)

**As time permits:**
- React component tests
- Accessibility tests
- Additional edge case coverage

---

## Part 8: Risk Mitigation

### Critical Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Race condition regression | HIGH | CRITICAL | P0 tests for confirmation protocol |
| Buffer management bugs | MEDIUM | CRITICAL | P0 tests for all guard clauses |
| State machine edge cases | MEDIUM | HIGH | Enhanced LaneArbitrator tests |
| Performance degradation | LOW | HIGH | P1 performance benchmarks |
| Production incidents | HIGH | CRITICAL | Full test coverage + monitoring |

### Known Issues to Test

From `z_errors.txt` analysis:

1. **RESOLVED but UNTESTED:** `input_audio_buffer_commit_empty` error
   - Fixed with guard clauses
   - **MUST TEST:** All 3 guards working correctly

2. **RESOLVED but UNTESTED:** "Unexpected B done in LISTENING" warning
   - Fixed with enhanced state machine
   - **MUST TEST:** All 4 onLaneBDone() cases

3. **PARTIALLY TESTED:** Buffer state synchronization
   - Fixed with BufferState tracking
   - **MUST TEST:** All state transitions

---

## Part 9: Success Criteria

### Definition of Production-Ready

The system is **production-ready** when ALL of the following are true:

#### Code Coverage
- ✅ Overall coverage >= 85%
- ✅ OpenAIRealtimeAdapter >= 85%
- ✅ LaneB >= 85%
- ✅ LaneArbitrator >= 90%
- ✅ WebSocket Handler >= 80%
- ✅ Critical paths = 100%

#### Test Quality
- ✅ All 150+ tests passing
- ✅ 0 flaky tests
- ✅ All race conditions tested
- ✅ All error paths tested
- ✅ Integration tests passing

#### Performance
- ✅ TTFB p50 < 400ms (verified by tests)
- ✅ TTFB p95 < 900ms (verified by tests)
- ✅ Barge-in p95 < 250ms (verified by tests)
- ✅ 100 concurrent sessions stable

#### Quality
- ✅ 0 ESLint errors
- ✅ 0 TypeScript errors
- ✅ All security tests passing
- ✅ CI/CD pipeline green
- ✅ Load tests passing

#### Observability
- ✅ Health endpoints working
- ✅ Monitoring dashboards created
- ✅ Alerts configured
- ✅ Error tracking enabled

---

## Appendix A: Test Statistics

### Current State (2026-01-10)

```
Total Test Files: 3
Total Tests: 50
Passing Tests: 50
Failing Tests: 0
Coverage: 14.69%

Critical Components Untested: 5
  - OpenAIRealtimeAdapter (0%)
  - LaneB (0%)
  - WebSocket Handler (0%)
  - SessionManager (0%)
  - Database (0%)
```

### Target State (Production Ready)

```
Total Test Files: 15+
Total Tests: 150+
Passing Tests: 150+
Failing Tests: 0
Coverage: 85%+

All Critical Components Tested:
  - OpenAIRealtimeAdapter (85%)
  - LaneB (85%)
  - LaneArbitrator (90%)
  - WebSocket Handler (80%)
  - All integration paths (100%)
```

---

## Appendix B: Quick Start Guide

### Running Tests Locally

```bash
# Install dependencies
npm ci

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- OpenAIRealtimeAdapter.test.ts

# Run in watch mode
npm test -- --watch

# Run with verbose output
npm test -- --verbose
```

### Writing a New Test

```typescript
// 1. Create test file: src/__tests__/MyComponent.test.ts

import { MyComponent } from '../MyComponent.js';

describe('MyComponent', () => {
  let component: MyComponent;

  beforeEach(() => {
    component = new MyComponent();
  });

  it('should do something', () => {
    const result = component.doSomething();
    expect(result).toBe(expected);
  });
});

// 2. Run the test
// npm test -- MyComponent.test.ts

// 3. Check coverage
// npm run test:coverage
```

---

## Appendix C: Resources

### Documentation
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [WebSocket Testing](https://github.com/websockets/ws#usage-examples)

### Tools
- **Coverage Reporting:** Istanbul/NYC
- **Mocking:** Jest mocks + custom helpers
- **Performance:** clinic.js, autocannon
- **Load Testing:** k6, Artillery

### References
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime
- Voice Jib-Jab Architecture: `docs/architecture/`
- Session History: `docs/session/last-session.md`

---

## Document Control

**Version:** 1.0.0
**Author:** QA Sentinel
**Date:** 2026-01-10
**Status:** DRAFT - AWAITING IMPLEMENTATION
**Next Review:** After P0 tests implementation

**Change Log:**
- 2026-01-10: Initial assessment and test plan created
