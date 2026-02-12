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
