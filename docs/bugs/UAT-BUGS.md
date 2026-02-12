# UAT Findings — 2026-02-11

## BUG-1: Audio Feedback Loop (CRITICAL)
AI output plays through speakers, mic captures it, sends back to OpenAI.
AI responds to itself endlessly ("hmm" → response → "hmm" → response).
Need: Echo cancellation OR server-side VAD that ignores AI's own audio.

## BUG-2: Stop Button Requires Multiple Presses
Click talk button to stop → nothing happens. Takes 3 presses.
Need: First click must immediately stop mic capture AND send input_audio_buffer.clear.

## BUG-3: Server Keeps Streaming After Client Stop
Server logs show input_audio_buffer.append continuing after UI shows stopped.
Need: Client must send explicit "stop" event, server must stop forwarding audio.


  Looking at the voice-jib-jab plan that was generated:                                                          
  ┌───────┬───────────┬────────┬─────────────────────────────────────┐
  │ Task  │   Type    │ Agent  │            What it does             │
  ├───────┼───────────┼────────┼─────────────────────────────────────┤
  │ T-001 │ design    │ claude │ Design Lane C                       │
  ├───────┼───────────┼────────┼─────────────────────────────────────┤
  │ T-002 │ implement │ codex  │ Implement Lane C                    │
  ├───────┼───────────┼────────┼─────────────────────────────────────┤
  │ T-008 │ test      │ gemini │ Test Lane C Control Flow            │
  ├───────┼───────────┼────────┼─────────────────────────────────────┤
  │ T-009 │ test      │ gemini │ Test Retrieval-Augmented Generation │
  └───────┴───────────┴────────┴─────────────────────────────────────┘


  ┌─────────────────────────────────────────────────────────┐
  │ PHASE 1: BUILD                    [████████████] 100%   │
  │ PHASE 2: VERIFY                   [██████░░░░░░]  50%   │
  │ PHASE 3: HUMAN UAT                [░░░░░░░░░░░░]   0%   │
  └─────────────────────────────────────────────────────────┘