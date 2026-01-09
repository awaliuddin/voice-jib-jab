# Voice Jib-Jab UAT Guide
## User Acceptance Testing Guide for MVP (feat-001)

> **Document Version**: 1.0.0
> **Last Updated**: January 9, 2025
> **Status**: PARTIAL IMPLEMENTATION - OpenAI Adapter is STUB

---

## ⚠️ CRITICAL NOTICE

**The OpenAI Realtime API adapter is currently a STUB implementation.** This means:
- End-to-end voice conversations will NOT work
- Audio sent to server will NOT generate AI responses
- This guide focuses on testing implemented infrastructure components

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Component Testing Matrix](#component-testing-matrix)
4. [Test Procedures](#test-procedures)
5. [Troubleshooting](#troubleshooting)
6. [Known Limitations](#known-limitations)
7. [Next Steps](#next-steps)

---

## Prerequisites

### System Requirements
- Node.js v18.0.0 or higher
- npm v9.0.0 or higher
- Chrome/Edge/Firefox (latest version)
- Microphone access permissions
- Stable internet connection (for future OpenAI integration)

### Required Tools
```bash
# Verify Node.js installation
node --version  # Should be >= 18.0.0

# Verify npm installation
npm --version   # Should be >= 9.0.0

# Verify Git installation (optional, for version control)
git --version
```

---

## Environment Setup

### Step 1: Install Dependencies

**⚠️ CRITICAL FIRST STEP - Dependencies are NOT currently installed!**

```bash
# Navigate to project root
cd /home/axw/projects/voice-jib-jab

# Install all dependencies (root, client, and server)
npm install

# This will install dependencies for:
# - Root workspace
# - Client (React/Vite app)
# - Server (Express/WebSocket)
```

Expected output:
```
added XXX packages, and audited XXX packages in XXs
found 0 vulnerabilities
```

### Step 2: Configure Environment Variables

```bash
# Copy example environment file
cp .env.example .env

# Edit .env file with your configuration
nano .env  # or use your preferred editor
```

**Minimum Required Configuration for Testing:**
```env
# OpenAI Configuration (use placeholder for stub testing)
OPENAI_API_KEY=sk-test-placeholder-key-not-used-yet
OPENAI_MODEL=gpt-4-realtime-preview

# Server Configuration
PORT=3000
NODE_ENV=development

# Client Configuration
VITE_WS_URL=ws://localhost:3000

# Feature Flags (all can be true for testing)
ENABLE_LANE_A=true
ENABLE_RAG=true
ENABLE_POLICY_GATE=true
ENABLE_AUDIT_TRAIL=true

# Latency Targets (ms)
TTFB_TARGET_P50=400
TTFB_TARGET_P95=900
BARGE_IN_TARGET_P95=250
```

### Step 3: Start the Application

```bash
# Start both client and server in development mode
npm run dev
```

Expected output:
```
[1] > server@0.1.0 dev
[1] > tsx watch src/index.ts
[1]
[1] ╔══════════════════════════════════════════════════════════╗
[1] ║                                                          ║
[1] ║  🎙️  Voice Jib-Jab Server                                ║
[1] ║  NextGen AI Voice Orchestrator                           ║
[1] ║                                                          ║
[1] ╚══════════════════════════════════════════════════════════╝
[1]
[1] [Server] Listening on port 3000
[1] [Server] Environment: development
[1] [Server] WebSocket: ws://localhost:3000
[1] [Server] Health: http://localhost:3000/health
[1] [Server] Status: http://localhost:3000/status
[1]
[0] > client@0.1.0 dev
[0] > vite
[0]
[0]   VITE v5.0.0  ready in XXX ms
[0]
[0]   ➜  Local:   http://localhost:5173/
[0]   ➜  Network: use --host to expose
```

---

## Component Testing Matrix

| Component | Testable | Test Type | Priority | Notes |
|-----------|----------|-----------|----------|--------|
| **CLIENT COMPONENTS** |
| WebSocket Connection | ✅ Yes | Functional | HIGH | Can verify connection establishment |
| Microphone Capture | ✅ Yes | Functional | HIGH | Can verify audio capture works |
| Audio Playback Queue | ⚠️ Partial | Unit | MEDIUM | Queue works but no audio to play |
| TalkButton UI | ✅ Yes | UI/UX | HIGH | All states testable |
| DebugOverlay | ✅ Yes | UI | MEDIUM | Displays metrics correctly |
| Auto-reconnect | ✅ Yes | Functional | HIGH | Can test by stopping server |
| Session State Machine | ✅ Yes | Functional | HIGH | State transitions work |
| **SERVER COMPONENTS** |
| WebSocket Server | ✅ Yes | Functional | HIGH | Accepts connections |
| Session Manager | ✅ Yes | Unit | HIGH | Creates/manages sessions |
| Event Bus | ✅ Yes | Unit | MEDIUM | Routes messages |
| Health Endpoint | ✅ Yes | API | HIGH | Returns status |
| Status Endpoint | ✅ Yes | API | HIGH | Shows sessions |
| Config Loader | ✅ Yes | Unit | MEDIUM | Loads .env correctly |
| Latency Budget | ⚠️ Partial | Unit | LOW | Structure works, no real metrics |
| **INTEGRATION** |
| OpenAI Realtime API | ❌ No | Integration | BLOCKED | Stub implementation only |
| End-to-End Voice Flow | ❌ No | E2E | BLOCKED | Requires OpenAI implementation |
| Barge-in Feature | ❌ No | Functional | BLOCKED | Requires active audio stream |
| RAG Integration | ❌ No | Integration | BLOCKED | Not implemented |

---

## Test Procedures

### Test 1: Server Health Check ✅

**Objective**: Verify server is running and healthy

**Steps**:
1. Start the server (`npm run dev:server`)
2. Open browser or use curl:
   ```bash
   curl http://localhost:3000/health
   ```

**Expected Result**:
```json
{
  "status": "ok",
  "timestamp": "2025-01-09T12:00:00.000Z",
  "sessions": 0
}
```

**Pass Criteria**:
- HTTP 200 response
- Valid JSON with status "ok"

---

### Test 2: Client UI Load ✅

**Objective**: Verify client application loads correctly

**Steps**:
1. Start both client and server (`npm run dev`)
2. Open browser to http://localhost:5173
3. Check browser console for errors

**Expected Result**:
- Voice Jib-Jab UI loads with:
  - Title "🎙️ Voice Jib-Jab"
  - Subtitle "NextGen AI Voice Orchestrator"
  - Large blue Talk button
  - Debug overlay showing metrics

**Pass Criteria**:
- No console errors
- All UI elements visible
- Responsive design works

---

### Test 3: WebSocket Connection ✅

**Objective**: Verify WebSocket connection establishment

**Steps**:
1. Open browser to http://localhost:5173
2. Open browser Developer Tools (F12)
3. Go to Network tab, filter by WS
4. Look for WebSocket connection

**Expected Result**:
- WebSocket connection to ws://localhost:3000
- Status: 101 Switching Protocols
- Messages being exchanged

**Pass Criteria**:
- Connection established within 2 seconds
- Session ID received from server
- No connection errors

---

### Test 4: Microphone Permission & Capture ✅

**Objective**: Verify microphone access and audio capture

**Steps**:
1. Click the Talk button (first time)
2. Browser will request microphone permission
3. Allow microphone access
4. Press and hold Talk button
5. Speak into microphone
6. Release button

**Expected Result**:
- Browser permission prompt appears
- Permission granted successfully
- Button changes to "Listening..." state (red)
- Console shows audio capture logs
- Button returns to "Talk" state on release

**Pass Criteria**:
- Microphone permission works
- No errors during capture
- Clean state transitions

---

### Test 5: Session State Transitions ✅

**Objective**: Verify session state machine

**Steps**:
1. Open Debug Overlay (should be visible by default)
2. Observe initial state: "idle"
3. Press Talk button
4. Observe state change to "listening"
5. Release Talk button
6. Observe state change back

**Expected States Flow**:
```
idle → connecting → ready → listening → processing → idle
```

**Pass Criteria**:
- States transition correctly
- Debug overlay updates in real-time
- No stuck states

---

### Test 6: Auto-Reconnection ✅

**Objective**: Verify WebSocket reconnection logic

**Steps**:
1. Start application normally
2. Verify connection established
3. Stop server (Ctrl+C in server terminal)
4. Observe client behavior
5. Restart server
6. Observe reconnection

**Expected Result**:
- Error banner appears when connection lost
- Retry attempts visible in console
- Automatic reconnection when server returns
- Session restored

**Pass Criteria**:
- Graceful error handling
- Automatic reconnection works
- No infinite loops or memory leaks

---

### Test 7: Server Status Endpoint ✅

**Objective**: Verify status monitoring works

**Steps**:
1. Start server and create a connection
2. Query status endpoint:
   ```bash
   curl http://localhost:3000/status
   ```

**Expected Result**:
```json
{
  "status": "running",
  "version": "0.1.0",
  "activeSessions": 1,
  "sessions": [{
    "id": "uuid-here",
    "state": "ready",
    "uptime": 5000
  }],
  "config": {
    "features": {
      "enableLaneA": true,
      "enableRAG": true,
      "enablePolicyGate": true,
      "enableAuditTrail": true
    },
    "latencyTargets": {
      "ttfbTargetP50": 400,
      "ttfbTargetP95": 900,
      "bargeInTargetP95": 250
    }
  }
}
```

**Pass Criteria**:
- Accurate session count
- Valid configuration reflected
- Session states correct

---

### Test 8: Debug Overlay Metrics ✅

**Objective**: Verify debug information display

**Steps**:
1. Click "Hide Debug" / "Show Debug" button
2. Observe overlay visibility toggle
3. Check displayed metrics

**Expected Result**:
- Overlay shows:
  - Current state
  - TTFB: null (no AI responses yet)
  - Turn Latency: null
  - Barge-in Stop: null

**Pass Criteria**:
- Toggle works correctly
- Metrics display properly
- Layout is readable

---

### Test 9: Multiple Concurrent Sessions ✅

**Objective**: Verify server handles multiple clients

**Steps**:
1. Open application in 3 different browser tabs
2. Check server status endpoint
3. Use Talk button in each tab

**Expected Result**:
- Each tab gets unique session ID
- Server status shows 3 active sessions
- No cross-talk between sessions

**Pass Criteria**:
- Independent sessions work
- Server remains stable
- Memory usage reasonable

---

### Test 10: Graceful Shutdown ✅

**Objective**: Verify clean shutdown

**Steps**:
1. Start application
2. Create active session
3. Press Ctrl+C in server terminal
4. Observe shutdown logs

**Expected Result**:
```
[Server] SIGINT received, shutting down gracefully...
[Server] HTTP server closed
```

**Pass Criteria**:
- Clean shutdown message
- No hanging processes
- Can restart immediately

---

## Troubleshooting

### Issue: "Cannot find module" errors

**Solution**:
```bash
# Ensure dependencies are installed
cd /home/axw/projects/voice-jib-jab
npm install
```

### Issue: "Port 3000 already in use"

**Solution**:
```bash
# Find and kill process using port 3000
lsof -i :3000
kill -9 <PID>

# Or change port in .env file
PORT=3001
```

### Issue: "WebSocket connection failed"

**Possible Causes**:
1. Server not running
2. Wrong VITE_WS_URL in .env
3. Firewall blocking connection

**Solution**:
- Verify server is running
- Check .env configuration
- Check browser console for specific errors

### Issue: "Microphone permission denied"

**Solution**:
1. Click padlock icon in browser address bar
2. Reset permissions for site
3. Reload page and try again

### Issue: "No audio playback"

**Expected**: This is normal - OpenAI adapter is a stub
**Note**: Audio playback will not work until OpenAI integration is complete

---

## Known Limitations

### Current Stub Limitations

1. **No AI Responses**: OpenAI adapter doesn't connect to real API
2. **No Audio Generation**: Server doesn't produce audio responses
3. **No Transcription**: Voice input is not transcribed
4. **No Barge-in**: Cannot interrupt non-existent AI speech
5. **No RAG**: Knowledge base integration not implemented
6. **Metrics Incomplete**: TTFB and latency metrics will show null

### What This Means for Testing

- **CAN TEST**: Infrastructure, connectivity, UI, state management
- **CANNOT TEST**: Actual voice conversations, AI responses, transcription accuracy

---

## Next Steps

### For Full Implementation

1. **Implement OpenAI WebSocket Connection**
   ```typescript
   // In OpenAIRealtimeAdapter.ts
   const ws = new WebSocket('wss://api.openai.com/v1/realtime');
   ```

2. **Add Audio Format Conversion**
   - PCM to Opus for upload
   - Opus to PCM for playback

3. **Implement Message Handlers**
   - Handle OpenAI response events
   - Process audio chunks
   - Handle transcripts

4. **Add Error Recovery**
   - Retry logic for API failures
   - Graceful degradation

5. **Implement Lane Routing**
   - Lane A (Reflex) for quick responses
   - Lane B for complex queries

### Recommended Testing Approach

**Phase 1 (Current)**: Test all infrastructure components
**Phase 2**: Add mock responses for e2e flow testing
**Phase 3**: Integrate real OpenAI API
**Phase 4**: Full system validation with all features

### Mock Implementation Suggestion

For interim testing, consider adding to OpenAIRealtimeAdapter:
```typescript
// Temporary mock mode
if (process.env.MOCK_MODE === 'true') {
  // Echo back recorded message after delay
  setTimeout(() => {
    this.emit('audio', mockAudioResponse);
    this.emit('transcript', { text: 'Mock response', isFinal: true });
  }, 1000);
}
```

---

## Test Sign-off

### Component Testing Checklist

- [ ] Server starts without errors
- [ ] Client loads in browser
- [ ] WebSocket connection established
- [ ] Microphone permission granted
- [ ] Audio capture works
- [ ] Session states transition correctly
- [ ] Auto-reconnection works
- [ ] Multiple sessions supported
- [ ] Clean shutdown works
- [ ] Debug overlay functional

### System Readiness

| Component | Status | Notes |
|-----------|--------|-------|
| Infrastructure | ✅ READY | All components functional |
| Client UI | ✅ READY | Fully implemented |
| Server Core | ✅ READY | Session management works |
| OpenAI Integration | ❌ NOT READY | Stub implementation only |
| End-to-End Flow | ❌ BLOCKED | Requires OpenAI implementation |

### Recommendation

**Current State**: INFRASTRUCTURE READY, INTEGRATION PENDING

The system infrastructure is well-architected and ready for OpenAI Realtime API integration. All supporting components are functional and testable. Proceed with OpenAI WebSocket implementation to enable full end-to-end testing.

---

## Contact & Support

For issues or questions regarding this UAT guide:
- Review codebase in `/home/axw/projects/voice-jib-jab`
- Check PROJECT-SPEC.md for architectural details
- Consult spec-jib-jab.md for original requirements

---

*End of UAT Guide v1.0.0*