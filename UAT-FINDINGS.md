# UAT Findings — 2026-02-11
> Human tester: Asif (founder)
> Method: Manual DX walkthrough after forge-orca 17-task completion

## Finding 1: Audio Feedback Loop (CRITICAL)
**What happened:** Said "Hello", AI responded "Hey welcome back, how are you today?" Then AI kept going — responding to ambient noise or its own audio output. Said "hmm" endlessly, generating infinite responses.
**Expected:** AI should stop talking when user stops talking. VAD (voice activity detection) should not pick up the AI's own audio output.
**Related components:** Server-side audio handling, OpenAI Realtime API integration, mic capture, echo cancellation.
**Server evidence:** `input_audio_buffer.append` continues indefinitely, buffer exceeds max size (243456 bytes), cleared oldest data, keeps going.

## Finding 2: Stop Button Unresponsive (HIGH)
**What happened:** Clicked the talk/stop button to stop the conversation. Nothing happened. Had to press 3 times before it actually stopped.
**Expected:** Single click should immediately stop mic capture AND send `input_audio_buffer.clear` to OpenAI.
**Related components:** Client-side button handler, mic capture stop, WebSocket "stop" event.

## Finding 3: Server Keeps Streaming After Client Stop (HIGH)
**What happened:** After UI showed "stopped", server logs continued showing `input_audio_buffer.append` with 4096-byte chunks. Server didn't receive or process the stop signal.
**Expected:** Client sends explicit stop event → server stops forwarding audio immediately.
**Server evidence:** Continued for 30+ seconds after UI stop. Only stopped on Ctrl+C (SIGINT).

## Finding 4: Voice Response Latency (POSITIVE)
**What happened:** First response was near-instant. "Hey welcome back, how are you today?" came within ~500ms of "Hello."
**Note:** This is excellent. Preserve this in any fixes.

## Pre-existing: SessionManager Test Timeout (LOW)
**What happened:** `npm test` shows 40/41 pass, 1 timeout in SessionManager.initialize() — tries to connect to ws://localhost:3000 which isn't running during test.
**Note:** Pre-existing issue, not caused by forge agents. Needs mock server in test setup.

Absolutely — and I’ll keep the same **layout + style** you locked in.

After reviewing your logs, there is **one major issue** that absolutely belongs in your UAT Findings list, and it’s not a small one. It’s a **database integrity failure** happening on every new WebSocket connection.

Here is the entry in your format.

---

# UAT Findings — Additional Issue from Server Logs  
> Human tester: Asif (founder)  
> Method: Log inspection during `npm run dev` startup and first client connection

## Finding 5: Audit Trail Foreign Key Failure (CRITICAL)  
**What happened:**  
Immediately after the first WebSocket client connected, the server attempted to persist an audit event. SQLite threw a `FOREIGN KEY constraint failed` error. This means the audit event references a session or entity that does **not exist** at the time of insertion.

**Expected:**  
Audit events should only be written after the parent session record exists and is committed. No audit write should ever violate referential integrity.

**Related components:**  
AuditTrail handler, EventBus ordering, SessionManager.createSession(), SQLite schema (foreign key constraints), transaction boundaries.

**Server evidence:**  
```
[AuditTrail] Failed to persist audit event: SqliteError: FOREIGN KEY constraint failed
...
code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
```

**Notes:**  
This is a **hard failure** — not a warning. It means your audit system is currently **dropping events** and potentially leaving the system in an inconsistent state. It also suggests a race condition: the audit event is emitted before the session row exists.

