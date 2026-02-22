# UAT Guide — voice-jib-jab

> For Asif to test the human experience: voice quality, latency feel, WebSocket responsiveness, and conversation flow.

## Prerequisites

1. **OpenAI API key** in `.env` (`OPENAI_API_KEY=sk-...`)
2. **Node.js 22+** installed
3. **Microphone** + speakers/headphones (headphones recommended to avoid echo)
4. **Chrome or Edge** (WebSocket + AudioContext support)

## Quick Start

```bash
# Terminal 1 — Start the server
cd server && npm run dev

# Terminal 2 — Start the client
cd client && npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Test Scenarios

### 1. First Connection (Cold Start)

**What to test**: Does the session initialize cleanly?

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the app in browser | See the voice interface with "Hold to Talk" button |
| 2 | Click the microphone button | Browser asks for mic permission |
| 3 | Grant mic permission | Status shows "Connecting..." then "Ready" |
| 4 | Check server terminal | Should see `[WebSocket] New client connected` and `provider.ready` |

**Pass criteria**: Session is ready within 3 seconds of granting mic permission.

---

### 2. Voice Quality — First Impression

**What to test**: Does the AI voice sound natural and clear?

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Hold the Talk button | Recording indicator appears |
| 2 | Say "Hello, how are you today?" | Release the button |
| 3 | Listen to the AI response | Voice should be clear, natural, no robotic artifacts |
| 4 | Note the voice quality | Rate 1-5: 1=robotic, 3=acceptable, 5=human-like |

**Pass criteria**: Voice quality >= 3/5. No audio glitches, clipping, or distortion.

**Red flags**:
- Robotic/metallic sound
- Audio cutting out mid-sentence
- Garbled words
- Echo of your own voice playing back

---

### 3. Latency Feel — Response Speed

**What to test**: Does the response feel instant or sluggish?

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ask a simple question: "What's 2 plus 2?" | Response should feel near-instant |
| 2 | Watch the TTFB metric on screen | Should be < 500ms (target: p50 < 400ms) |
| 3 | Ask a complex question: "Tell me about the history of jazz" | May take slightly longer but should start within 1 second |
| 4 | Ask 3 questions in rapid succession | Each response should start before you feel impatient |

**Pass criteria**: No response takes more than 2 seconds to start. The "feel" is conversational, not like waiting for a chatbot.

**Latency reference**:
- < 400ms: Feels instant (target)
- 400-800ms: Feels quick
- 800-1200ms: Noticeable pause (acceptable)
- > 1200ms: Feels slow (SLA violation)

---

### 4. WebSocket Responsiveness — Barge-In

**What to test**: Can you interrupt the AI mid-sentence?

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ask a question that produces a long answer: "Tell me everything about climate change" | AI starts responding |
| 2 | While AI is still speaking, press the Talk button | AI should STOP immediately |
| 3 | Say "Actually, just tell me the temperature today" | AI responds to new question |
| 4 | Repeat barge-in 3 times | Should work reliably every time |

**Pass criteria**: AI stops within 250ms of barge-in. No leftover audio from the previous response plays after interruption.

**Red flags**:
- AI keeps talking after you press Talk
- Hearing fragments of old response mixed with new
- Button becomes unresponsive (requires multiple clicks)
- Server keeps streaming audio after cancel (check server logs for `audioStopped` messages)

---

### 5. Conversation Flow — Multi-Turn

**What to test**: Does the conversation feel natural across multiple turns?

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Say "My name is Asif" | AI acknowledges your name |
| 2 | Ask "What's my name?" | AI should remember "Asif" from context |
| 3 | Ask a follow-up: "How do you spell that?" | AI should reference the name from earlier |
| 4 | Have a 5-turn conversation on any topic | Conversation should feel coherent, not disjointed |

**Pass criteria**: AI maintains context for at least 5 turns. No "I don't know what you're referring to" on follow-up questions.

---

### 6. Push-to-Talk vs Open Mic

**What to test**: Both input modes work correctly.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start in Push-to-Talk mode (default) | Hold button to talk, release to send |
| 2 | Switch to Open Mic mode (if UI allows) | AI listens continuously, responds at natural pauses |
| 3 | In Open Mic: speak normally, then pause | AI should detect pause and respond |
| 4 | In Open Mic: speak without pausing | AI should wait until you stop |

**Pass criteria**: Push-to-Talk is reliable. Open Mic detects speech boundaries correctly.

---

### 7. Error Recovery

**What to test**: Does the system handle edge cases gracefully?

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Tap the Talk button very briefly (< 0.5s) | Should see "buffer too small" or similar, no crash |
| 2 | Stay silent for 30 seconds | Session should remain alive (no timeout) |
| 3 | Close the browser tab, reopen | Should reconnect cleanly |
| 4 | Speak very quietly (almost whispering) | May be ignored (RMS gate) — not a bug, it's echo protection |

**Pass criteria**: No crashes, no hanging states. Error messages are user-friendly.

---

### 8. Audio Feedback Loop (Regression)

**What to test**: AI should NOT respond to its own voice.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Use speakers (NOT headphones) | Play AI audio through speakers |
| 2 | Ask a question, let AI respond | AI response plays through speakers |
| 3 | When AI finishes, stay silent | AI should NOT start responding again |
| 4 | Wait 5 seconds | Silence. No unprompted AI speech. |

**Pass criteria**: Zero instances of the AI talking to itself. The 3-layer defense (echo cancellation + cooldown + RMS gate) should prevent any feedback loop.

---

## Scoring Rubric

| Category | Weight | 1 (Fail) | 3 (Acceptable) | 5 (Excellent) |
|----------|--------|----------|-----------------|---------------|
| Voice Quality | 25% | Robotic, glitchy | Clear but not natural | Indistinguishable from human |
| Latency Feel | 25% | > 2s delays | Noticeable but tolerable | Feels like talking to a person |
| Barge-In | 20% | Doesn't work | Works but sometimes delayed | Instant, every time |
| Conversation Flow | 20% | Loses context after 2 turns | Mostly coherent | Natural multi-turn dialogue |
| Error Recovery | 10% | Crashes or hangs | Recovers with manual refresh | Graceful, automatic recovery |

**Overall Pass**: Score >= 3.0 weighted average.

---

## Reporting

After testing, fill in:

```
Date: ___________
Tester: ___________
Browser: ___________
Audio Setup: Headphones / Speakers

Voice Quality:  ___/5
Latency Feel:   ___/5
Barge-In:       ___/5
Conversation:   ___/5
Error Recovery: ___/5

Weighted Score: ___/5

Issues Found:
1. ___
2. ___
3. ___

Overall Verdict: PASS / FAIL / CONDITIONAL PASS
```
