/**
 * Voice Pipeline Integration Tests (P1 - High Priority)
 *
 * Tests the complete voice interaction pipeline:
 * - LaneB + OpenAIRealtimeAdapter
 * - LaneArbitrator + LaneB coordination
 * - Complete user utterance → AI response flows
 * - Error handling across component boundaries
 * - State synchronization
 *
 * Target Coverage: 20%+ integration coverage
 */

import { LaneB } from "../../lanes/LaneB.js";
import { LaneArbitrator } from "../../orchestrator/LaneArbitrator.js";
import { ProviderConfig } from "../../providers/ProviderAdapter.js";
import { createAudioForDuration } from "../helpers/audio.js";
import { MockWebSocket } from "../mocks/MockWebSocket.js";

// Mock WebSocket
jest.mock("ws");

describe("Voice Pipeline Integration", () => {
  let laneB: LaneB;
  let arbitrator: LaneArbitrator;
  let mockWs: MockWebSocket;
  const sessionId = "integration-test-session";
  const config: ProviderConfig = {
    apiKey: "test-api-key",
    model: "gpt-4o-realtime-preview-2024-12-17",
  };

  beforeEach(async () => {
    // Reset WebSocket mock
    const WebSocketMock = jest.requireMock("ws").default;
    WebSocketMock.resetMock();

    // Create Lane B
    laneB = new LaneB(sessionId, { providerConfig: config });

    // Create Arbitrator
    arbitrator = new LaneArbitrator(sessionId, {
      laneAEnabled: true,
      minDelayBeforeReflexMs: 100,
      maxReflexDurationMs: 2000,
    });

    // Connect Lane B (this creates WebSocket)
    const connectPromise = laneB.connect();

    // Get mock WebSocket instance
    mockWs = WebSocketMock.getMockInstance();

    // Wait for connection
    await new Promise((resolve) => process.nextTick(resolve));

    // Simulate session.created
    mockWs.receiveMessage({ type: "session.created" });

    await connectPromise;

    // Clear connection messages
    mockWs.clearMessages();

    // Start arbitrator session
    arbitrator.startSession();
  });

  afterEach(async () => {
    if (laneB.isConnected()) {
      await laneB.disconnect();
      await new Promise((resolve) => process.nextTick(resolve));
    }
  });

  describe("Complete Voice Interaction Flow", () => {
    it("should handle full user utterance → AI response cycle", async () => {
      const events: string[] = [];

      // Track events
      arbitrator.on("play_lane_b", () => events.push("play_lane_b"));
      arbitrator.on("response_complete", () => events.push("response_complete"));
      laneB.on("first_audio_ready", () => events.push("first_audio_ready"));
      laneB.on("audio", () => events.push("audio_chunk"));
      laneB.on("transcript", () => events.push("transcript"));

      // 1. User speaks
      await laneB.sendAudio(createAudioForDuration(100));
      await laneB.sendAudio(createAudioForDuration(100));
      await laneB.sendAudio(createAudioForDuration(100));

      // 2. VAD detects speech
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      // 3. User finishes speaking
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      // 4. Commit audio
      const committed = await laneB.commitAudio();
      expect(committed).toBe(true);

      // 5. OpenAI confirms commit
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Verify response.create was sent
      expect(mockWs.hasSentMessage("response.create")).toBe(true);

      // 6. OpenAI starts responding
      mockWs.receiveMessage({ type: "response.created" });

      // 7. First audio chunk arrives
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("audio data").toString("base64"),
      });

      // Lane B should emit first_audio_ready
      expect(events).toContain("first_audio_ready");

      // Arbitrator should transition to B_PLAYING
      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");

      // 8. More audio arrives
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("more audio").toString("base64"),
      });

      // 9. Transcript arrives
      mockWs.receiveMessage({
        type: "response.audio_transcript.delta",
        delta: "Hello, how can I help you?",
      });

      // 10. Response completes
      mockWs.receiveMessage({ type: "response.done" });

      // Lane B should emit response_end
      arbitrator.onLaneBDone();

      // Arbitrator should transition back to LISTENING
      expect(arbitrator.getState()).toBe("LISTENING");
      expect(events).toContain("response_complete");

      // Verify event sequence
      // Note: play_lane_b fires when onLaneBReady() is called (line 123),
      // which happens after first audio but before second audio
      expect(events).toEqual([
        "first_audio_ready",
        "audio_chunk",
        "play_lane_b",
        "audio_chunk",
        "transcript",
        "response_complete",
      ]);
    });

    it("should handle fast Lane B (no Lane A trigger)", async () => {
      const playReflexSpy = jest.fn();
      const playLaneBSpy = jest.fn();

      arbitrator.on("play_reflex", playReflexSpy);
      arbitrator.on("play_lane_b", playLaneBSpy);

      // User speaks
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      // User finishes
      arbitrator.onUserSpeechEnded();

      // Commit
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Fast response - Lane B ready before Lane A timer (< 100ms)
      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("fast response").toString("base64"),
      });

      arbitrator.onLaneBReady();

      // Wait past Lane A delay to verify it doesn't trigger
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Lane A should NOT have triggered
      expect(playReflexSpy).not.toHaveBeenCalled();
      expect(playLaneBSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("B_PLAYING");
    });

    it("should handle Lane A → Lane B preemption", async () => {
      const playReflexSpy = jest.fn();
      const stopReflexSpy = jest.fn();
      const playLaneBSpy = jest.fn();

      arbitrator.on("play_reflex", playReflexSpy);
      arbitrator.on("stop_reflex", stopReflexSpy);
      arbitrator.on("play_lane_b", playLaneBSpy);

      // User speaks
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      // User finishes
      arbitrator.onUserSpeechEnded();

      // Commit
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Wait for Lane A to trigger (100ms delay)
      await new Promise((resolve) => setTimeout(resolve, 110));

      expect(playReflexSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("A_PLAYING");

      // Lane B becomes ready - should preempt A
      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("ai response").toString("base64"),
      });

      arbitrator.onLaneBReady();

      // Wait for transition gap
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(stopReflexSpy).toHaveBeenCalled();
      expect(playLaneBSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("B_PLAYING");
    });
  });

  describe("Error Handling Integration", () => {
    it("should handle commit failure gracefully", async () => {
      const completeSpy = jest.fn();
      arbitrator.on("response_complete", completeSpy);

      // User speaks too little (< 100ms)
      await laneB.sendAudio(createAudioForDuration(50));

      // User finishes
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      // Commit fails (buffer too small)
      const committed = await laneB.commitAudio();
      expect(committed).toBe(false);

      // Reset arbitrator state
      arbitrator.resetResponseInProgress();
      expect(arbitrator.getState()).toBe("LISTENING");

      // System should be ready for next utterance
      expect((arbitrator as any).responseInProgress).toBe(false);
    });

    it("should handle OpenAI error during response", async () => {
      const errorSpy = jest.fn();
      laneB.on("error", errorSpy);

      // Start normal flow
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("partial").toString("base64"),
      });

      arbitrator.onLaneBReady();

      // Error occurs mid-response
      mockWs.receiveMessage({
        type: "error",
        error: {
          type: "server_error",
          message: "Internal server error",
        },
      });

      expect(errorSpy).toHaveBeenCalled();

      // Response still completes (graceful degradation)
      mockWs.receiveMessage({ type: "response.done" });
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should handle OpenAI buffer commit error", async () => {
      const errorSpy = jest.fn();
      laneB.on("error", errorSpy);

      // User speaks
      await laneB.sendAudio(createAudioForDuration(200));

      arbitrator.onUserSpeechEnded();

      // Commit
      await laneB.commitAudio();

      // OpenAI rejects commit
      mockWs.receiveMessage({
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "input_audio_buffer_commit_empty",
          message: "buffer too small",
        },
      });

      expect(errorSpy).toHaveBeenCalled();

      // State should reset
      arbitrator.resetResponseInProgress();
      expect(arbitrator.getState()).toBe("LISTENING");
    });
  });

  describe("User Barge-In Integration", () => {
    it("should handle barge-in during Lane B playback", async () => {
      const stopLaneBSpy = jest.fn();
      arbitrator.on("stop_lane_b", stopLaneBSpy);

      // Complete flow to B_PLAYING
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("ai speaking").toString("base64"),
      });

      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");

      // User interrupts
      arbitrator.onUserBargeIn();
      await laneB.cancel();

      expect(stopLaneBSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("LISTENING");
      expect(mockWs.hasSentMessage("response.cancel")).toBe(true);
    });

    it("should handle barge-in during Lane A reflex", async () => {
      const stopReflexSpy = jest.fn();
      arbitrator.on("stop_reflex", stopReflexSpy);

      // Start flow
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();

      // Commit
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Wait for Lane A
      await new Promise((resolve) => setTimeout(resolve, 110));
      expect(arbitrator.getState()).toBe("A_PLAYING");

      // User interrupts
      arbitrator.onUserBargeIn();

      expect(stopReflexSpy).toHaveBeenCalled();
      expect(arbitrator.getState()).toBe("LISTENING");
    });
  });

  describe("State Synchronization", () => {
    it("should keep Lane B and Arbitrator states synchronized", async () => {
      // Start responding
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");

      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Response starts
      mockWs.receiveMessage({ type: "response.created" });
      expect(laneB.getIsResponding()).toBe(true);

      // First audio
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("audio").toString("base64"),
      });

      arbitrator.onLaneBReady();
      expect(arbitrator.getState()).toBe("B_PLAYING");
      expect(laneB.hasFirstAudioEmitted()).toBe(true);

      // Response ends
      mockWs.receiveMessage({ type: "response.done" });
      expect(laneB.getIsResponding()).toBe(false);

      arbitrator.onLaneBDone();
      expect(arbitrator.getState()).toBe("LISTENING");
    });

    it("should handle response in progress guard correctly", async () => {
      // Start first utterance
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();
      expect((arbitrator as any).responseInProgress).toBe(true);

      // Try to start second utterance (should be blocked)
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING"); // Unchanged

      // Complete first response
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });
      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("response").toString("base64"),
      });

      arbitrator.onLaneBReady();
      mockWs.receiveMessage({ type: "response.done" });
      arbitrator.onLaneBDone();

      // Now second utterance should work
      expect((arbitrator as any).responseInProgress).toBe(false);

      await laneB.sendAudio(createAudioForDuration(200));
      arbitrator.onUserSpeechEnded();
      expect(arbitrator.getState()).toBe("B_RESPONDING");
    });
  });

  describe("Conversation Context Integration", () => {
    it("should inject conversation context into session", async () => {
      const context = "User previously asked about TypeScript";

      // Disconnect and set context
      await laneB.disconnect();
      await new Promise((resolve) => process.nextTick(resolve));

      laneB.setConversationContext(context);

      // Reconnect
      const WebSocketMock = jest.requireMock("ws").default;
      WebSocketMock.resetMock();

      const connectPromise = laneB.connect();
      mockWs = WebSocketMock.getMockInstance();

      await new Promise((resolve) => process.nextTick(resolve));
      mockWs.receiveMessage({ type: "session.created" });
      await connectPromise;

      // Verify context was sent in session.update
      const sessionUpdate = mockWs.getMessagesByType("session.update")[0];
      expect(sessionUpdate.session.instructions).toContain(context);
    });
  });

  describe("Voice Mode Integration", () => {
    it("should support switching voice modes", async () => {
      mockWs.clearMessages();

      // Switch to open-mic
      laneB.setVoiceMode("open-mic");

      // Verify session.update was sent
      const messages = mockWs.getMessagesByType("session.update");
      expect(messages.length).toBeGreaterThan(0);
      expect(laneB.getVoiceMode()).toBe("open-mic");

      // Switch back to push-to-talk
      laneB.setVoiceMode("push-to-talk");
      expect(laneB.getVoiceMode()).toBe("push-to-talk");
    });
  });

  describe("Timing and Performance", () => {
    it("should track time-to-first-byte (TTFB)", async () => {
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();

      // Commit
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Simulate delay before response
      await new Promise((resolve) => setTimeout(resolve, 50));

      mockWs.receiveMessage({ type: "response.created" });

      // Simulate realistic TTFB delay between response start and first audio
      await new Promise((resolve) => setTimeout(resolve, 50));

      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("audio").toString("base64"),
      });

      const ttfb = laneB.getTTFB();
      expect(ttfb).not.toBeNull();
      expect(ttfb).toBeGreaterThanOrEqual(0);

      // Verify arbitrator metrics
      arbitrator.onLaneBReady();
      const metrics = arbitrator.getMetrics();
      expect(metrics.latencyMs).toBeGreaterThan(0);
    });

    it("should handle rapid consecutive interactions", async () => {
      // First interaction
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });
      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });
      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("first").toString("base64"),
      });
      arbitrator.onLaneBReady();
      mockWs.receiveMessage({ type: "response.done" });
      arbitrator.onLaneBDone();

      // Second interaction (immediate)
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });
      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });
      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("second").toString("base64"),
      });
      arbitrator.onLaneBReady();
      mockWs.receiveMessage({ type: "response.done" });
      arbitrator.onLaneBDone();

      expect(arbitrator.getState()).toBe("LISTENING");
    });
  });

  describe("Edge Cases and Recovery", () => {
    it("should recover from WebSocket reconnection", async () => {
      const errorSpy = jest.fn();
      laneB.on("error", errorSpy);

      // Simulate connection loss (error + close)
      mockWs.simulateError(new Error("Connection lost"));
      mockWs.close(1006, "Connection lost"); // Abnormal closure

      // Wait for error to propagate
      await new Promise((resolve) => process.nextTick(resolve));

      // System should handle gracefully
      expect(errorSpy).toHaveBeenCalled();
      expect(laneB.isConnected()).toBe(false);
    });

    it("should handle session end during active response", async () => {
      // Start response
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("interrupted").toString("base64"),
      });

      arbitrator.onLaneBReady();

      // End session mid-response
      arbitrator.endSession();

      expect(arbitrator.getState()).toBe("ENDED");

      // Timers should be cleared
      expect(jest.getTimerCount()).toBe(0);
    });

    it("should handle multiple errors gracefully", async () => {
      const errorSpy = jest.fn();
      laneB.on("error", errorSpy);

      // Error 1: Commit failure
      await laneB.sendAudio(createAudioForDuration(50));
      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio(); // Fails
      arbitrator.resetResponseInProgress();

      // Error 2: OpenAI error
      await laneB.sendAudio(createAudioForDuration(200));
      arbitrator.onUserSpeechEnded();
      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      mockWs.receiveMessage({
        type: "error",
        error: { message: "Rate limit exceeded" },
      });

      expect(errorSpy).toHaveBeenCalled();

      // System should still be operational
      expect(arbitrator.getState()).toBe("B_RESPONDING");
      arbitrator.resetResponseInProgress();
      expect(arbitrator.getState()).toBe("LISTENING");
    });
  });
});
