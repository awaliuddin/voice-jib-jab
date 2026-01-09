# 🚀 Voice Jib-Jab Quick Start Guide

**Status:** ✅ Ready for Voice Conversations

---

## You're Ready to Test!

Your Voice Jib-Jab system is fully configured and ready for real-time voice conversations with AI.

### What's Working

✅ OpenAI Realtime API integration (complete implementation)
✅ Bidirectional audio streaming at 24kHz PCM16
✅ Server-side Voice Activity Detection (automatic turn-taking)
✅ Real-time transcription (Whisper)
✅ Natural conversation flow
✅ Barge-in support (interrupt the AI)
✅ WebSocket infrastructure
✅ Session management
✅ Error recovery and reconnection

---

## Start Testing NOW (3 Steps)

### Step 1: Start the Server

```bash
cd /home/axw/projects/voice-jib-jab/server
npm run dev
```

**Expected output:**
```
╔══════════════════════════════════════════════════════════╗
║  🎙️  Voice Jib-Jab Server                                ║
║  NextGen AI Voice Orchestrator                           ║
╚══════════════════════════════════════════════════════════╝

[Server] Listening on port 3000
[WebSocket] Server initialized
```

### Step 2: Start the Client (New Terminal)

```bash
cd /home/axw/projects/voice-jib-jab/client
npm run dev
```

**Expected output:**
```
VITE v5.0.0  ready in XXX ms

➜  Local:   http://localhost:5173/
```

### Step 3: Have a Conversation!

1. **Open browser:** http://localhost:5173
2. **Grant microphone permission** when prompted
3. **Press and hold** the circular Talk button
4. **Say something:** "Hello, can you introduce yourself?"
5. **Release the button**
6. **Listen** - The AI will respond with voice!

---

## What to Expect

### First Interaction

**You speak:** "Hello, can you introduce yourself?"

**Server console shows:**
```
[OpenAI] Connecting to Realtime API for session: xxx
[OpenAI] WebSocket connected for session: xxx
[OpenAI] Session configuration sent
[OpenAI] Session created successfully
[OpenAI] Sent audio chunk: 8192 bytes
[OpenAI] Speech detected - started
[OpenAI] Speech detected - stopped
[OpenAI] Audio buffer committed
[OpenAI] Response started
[OpenAI] Received message: response.audio.delta
[OpenAI] Audio response complete
[OpenAI] Response complete
```

**You hear:** AI responds with natural voice!

**Browser shows:**
- Button changes from "Hold to Talk" → "Listening..." (green pulsing)
- When AI responds, button shows "Assistant Speaking" (orange)
- Debug overlay shows real-time metrics
- Transcripts appear in console (if enabled)

### Natural Conversation Flow

1. **Press and hold** Talk button
2. **Speak naturally** - no need to say "over" or pause awkwardly
3. **Release** when done
4. **Server detects** silence automatically (500ms)
5. **AI responds** within 400-900ms (TTFB)
6. **You can interrupt** by pressing Talk button during AI speech (barge-in)

---

## Testing Checklist

### Basic Functionality
- [ ] Server starts without errors
- [ ] Client loads in browser
- [ ] Microphone permission granted
- [ ] Can press and hold Talk button
- [ ] Audio captured (watch server console for "Sent audio chunk")
- [ ] AI responds with voice
- [ ] Can hear AI clearly
- [ ] Button states change correctly

### Conversation Quality
- [ ] Natural back-and-forth dialogue
- [ ] AI responses are relevant
- [ ] Low latency (feels responsive)
- [ ] Clear audio quality
- [ ] Can interrupt AI (barge-in)
- [ ] Multiple turns work smoothly

### Debug Information
- [ ] Debug overlay shows metrics
- [ ] TTFB updates after AI responds
- [ ] Session state changes correctly
- [ ] No errors in browser console
- [ ] No errors in server console

---

## Sample Conversations to Try

### Test 1: Simple Greeting
**You:** "Hello, how are you today?"
**Expected:** Friendly greeting response

### Test 2: Complex Question
**You:** "Can you explain how voice recognition works in simple terms?"
**Expected:** Clear, concise explanation

### Test 3: Multi-Turn Dialogue
**You:** "Tell me a short story"
**AI:** *starts telling story*
**You:** *interrupt* "Make it about a robot"
**Expected:** AI adapts and continues with robot theme

### Test 4: Latency Check
**You:** "What's 2 plus 2?"
**Expected:** Quick response (<1 second)

### Test 5: Barge-in
**You:** "Tell me a long story about the ocean"
**AI:** *starts long response*
**You:** *press Talk button* "Actually, tell me about mountains instead"
**Expected:** AI stops and responds about mountains

---

## Troubleshooting

### Issue: "WebSocket connection failed"

**Solution:**
- Check server is running on port 3000
- Verify .env has correct VITE_WS_URL=ws://localhost:3000

### Issue: "OpenAI authentication failed"

**Solution:**
- Verify OPENAI_API_KEY in .env is correct
- Check you have access to Realtime API (requires special access)
- Try visiting OpenAI platform to verify key is active

### Issue: "No audio playback"

**Possible causes:**
- Check browser volume isn't muted
- Check system volume settings
- Look for "[OpenAI] Audio response complete" in server logs
- If not seeing audio chunks, API might not be responding

### Issue: "Microphone not working"

**Solution:**
- Check browser permissions (click padlock in address bar)
- Try different browser (Chrome/Edge recommended)
- Check system microphone is working (test in other apps)

### Issue: "High latency / slow responses"

**Possible causes:**
- Slow internet connection
- OpenAI API congestion
- Check Debug overlay for TTFB metrics
- Try during off-peak hours

---

## Configuration Options

### Change AI Voice

Edit `.env`:
```env
# Options: alloy, echo, fable, onyx, nova, shimmer
OPENAI_VOICE=alloy
```

Then restart server.

### Adjust Turn Detection Sensitivity

Edit `server/src/providers/OpenAIRealtimeAdapter.ts` line 156:
```typescript
silence_duration_ms: 500  // Lower = faster turn-taking, Higher = less interruption
```

### Enable More Verbose Logging

All OpenAI messages are logged to server console with `[OpenAI]` prefix.

---

## Performance Targets

Your system is targeting these latencies:

- **TTFB (Time to First Byte):** <400ms (p50), <900ms (p95)
- **Barge-in Stop:** <250ms (p95)
- **Turn Latency:** <1200ms (p95)

Watch the Debug Overlay to see your actual performance!

---

## Next Steps After Basic Testing

Once you confirm voice conversations work:

1. **Measure Performance:**
   - Have 5-10 conversations
   - Note TTFB in Debug Overlay
   - Test barge-in responsiveness
   - Check for any errors

2. **Test Edge Cases:**
   - Long conversations (5+ minutes)
   - Background noise
   - Rapid back-and-forth
   - Network interruption (disconnect/reconnect)

3. **Implement Advanced Features:**
   - Lane Arbitration (Lane A/B/C system)
   - RAG Integration (NextGen AI knowledge)
   - Policy Gate (content filtering)
   - Audit Trail (session recording)

4. **Deploy:**
   - Set up production environment
   - Add HTTPS/WSS
   - Configure monitoring
   - Add rate limiting

---

## Architecture Overview

```
Browser (You)
    ↓ [Microphone captures speech]
WebSocket Client
    ↓ [Streams PCM16 audio]
Server (Voice Jib-Jab)
    ↓ [Forwards to OpenAI]
OpenAI Realtime API
    ↓ [Processes speech → generates response]
Server (Voice Jib-Jab)
    ↓ [Receives audio chunks]
WebSocket Client
    ↓ [Plays audio]
Browser Speakers (You hear AI)
```

### Key Components

- **Client:** React app with Web Audio API
- **Server:** Express + WebSocket
- **OpenAI Adapter:** WebSocket to OpenAI Realtime API
- **Session Manager:** Tracks conversation state
- **Event Bus:** Coordinates between components

---

## Status Check Commands

### Check Server Health
```bash
curl http://localhost:3000/health
```

### Check Active Sessions
```bash
curl http://localhost:3000/status
```

### Watch Server Logs
Server logs show all OpenAI interactions with `[OpenAI]` prefix.

---

## Important Notes

- **OpenAI API Costs:** Realtime API is billed per audio minute (~$0.06/minute input, ~$0.24/minute output)
- **Rate Limits:** Check OpenAI console for your limits
- **Model:** Uses `gpt-realtime`
- **Browser:** Chrome/Edge recommended (best WebRTC support)
- **Network:** Requires stable internet (WebSocket streaming)

---

## Success Indicators

✅ **You're successful if:**
- You can speak and hear AI responses
- Latency feels natural (<1 second)
- Conversations flow smoothly
- Barge-in works reliably
- No frequent disconnections
- Audio quality is clear

---

## Getting Help

**Documentation:**
- Full technical docs: `IMPLEMENTATION.md`
- Detailed testing: `TESTING.md`
- UAT procedures: `docs/UAT-Guide.md`
- Architecture spec: `docs/PROJECT-SPEC.md`

**Logs:**
- Server: Check terminal where `npm run dev` is running
- Client: Browser Developer Tools → Console (F12)
- Network: Browser Dev Tools → Network → WS (WebSocket messages)

---

## You're All Set! 🎉

The system is fully implemented and ready. Start the server and client, then click that Talk button and have a conversation with AI!

**Quick command recap:**
```bash
# Terminal 1
cd /home/axw/projects/voice-jib-jab/server && npm run dev

# Terminal 2
cd /home/axw/projects/voice-jib-jab/client && npm run dev

# Browser
# Open http://localhost:5173 and start talking!
```

**Happy testing!** 🎙️ ✨
