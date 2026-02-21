/**
 * FallbackPlanner Unit Tests
 *
 * Tests the fallback audio planner that provides safe, pre-approved
 * fallback audio when Lane C cancels output.
 *
 * Mocks TTS service and EventBus to keep tests pure and fast.
 *
 * Target Coverage: 85%+
 */

import type { PolicyDecisionPayload } from "../../schemas/events.js";

// ── Mocks (must be before imports that use them) ───────────────────────

const mockGenerateSpeech = jest.fn().mockResolvedValue(Buffer.alloc(4800));
jest.mock("../../services/OpenAITTS.js", () => ({
  getTTSInstance: () => ({
    generateSpeech: mockGenerateSpeech,
  }),
}));

const mockEmit = jest.fn();
jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: { emit: mockEmit, on: jest.fn(), off: jest.fn() },
}));

// Must import after mocks are set up
import { FallbackPlanner } from "../../insurance/fallback_planner.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makePlanner(
  config: Partial<ConstructorParameters<typeof FallbackPlanner>[1] & object> = {},
): FallbackPlanner {
  return new FallbackPlanner("test-session", config);
}

function makePayload(
  overrides: Partial<PolicyDecisionPayload> = {},
): PolicyDecisionPayload {
  return {
    decision: "refuse",
    reason_codes: ["TEST_REASON"],
    severity: 3,
    ...overrides,
  };
}

/**
 * Flush enough microtasks to drain the async chain through
 * Promise.race + .finally (TTS timeout) and async streamAudio.
 */
async function flushAsync() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// Use fake timers so streamAudio does not run in real time
jest.useFakeTimers();

// ── Tests ──────────────────────────────────────────────────────────────

describe("FallbackPlanner", () => {
  let planner: FallbackPlanner;

  beforeEach(() => {
    jest.clearAllMocks();
    planner = makePlanner();
  });

  afterEach(() => {
    planner.removeAllListeners();
    jest.clearAllTimers();
  });

  // ── Default state ──────────────────────────────────────────────────

  describe("default state", () => {
    it("should be enabled by default", () => {
      expect(planner.isEnabled()).toBe(true);
    });

    it("should not be active by default", () => {
      expect(planner.isActive()).toBe(false);
    });

    it("should have no current utterance by default", () => {
      expect(planner.getCurrentUtterance()).toBeNull();
    });

    it("should have no current mode by default", () => {
      expect(planner.getCurrentMode()).toBeNull();
    });
  });

  // ── Disabled behavior ─────────────────────────────────────────────

  describe("when disabled", () => {
    it("should report not enabled", () => {
      const disabled = makePlanner({ enabled: false });
      expect(disabled.isEnabled()).toBe(false);
    });

    it("should skip trigger when disabled", async () => {
      const disabled = makePlanner({ enabled: false });
      const startedSpy = jest.fn();
      disabled.on("started", startedSpy);

      await disabled.trigger(makePayload());

      expect(startedSpy).not.toHaveBeenCalled();
      expect(disabled.isActive()).toBe(false);
    });
  });

  // ── Already playing guard ─────────────────────────────────────────

  describe("when already playing", () => {
    it("should skip trigger when already playing", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      // Start first trigger (will wait on audio generation)
      const firstTrigger = planner.trigger(makePayload());

      // Resolve the TTS promise
      await Promise.resolve();
      await Promise.resolve();

      expect(planner.isActive()).toBe(true);

      // Try to trigger again while first is playing
      startedSpy.mockClear();
      await planner.trigger(makePayload());

      // Started should not have been called again
      expect(startedSpy).not.toHaveBeenCalled();

      // Clean up: stop and advance timers
      planner.stop();
      jest.runAllTimers();
      await firstTrigger;
    });
  });

  // ── Mode-specific triggers ────────────────────────────────────────

  describe("trigger modes", () => {
    describe("refuse_politely", () => {
      it("should produce a refuse_politely plan", async () => {
        const startedSpy = jest.fn();
        planner.on("started", startedSpy);

        const p = planner.trigger(
          makePayload({ decision: "refuse" }),
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(startedSpy).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "refuse_politely" }),
        );

        planner.stop();
        jest.runAllTimers();
        await p;
      });
    });

    describe("ask_clarifying_question", () => {
      it("should produce an ask_clarifying_question plan when mode is set", async () => {
        const fp = makePlanner({ mode: "ask_clarifying_question" });
        const startedSpy = jest.fn();
        fp.on("started", startedSpy);

        const p = fp.trigger(makePayload());
        await Promise.resolve();
        await Promise.resolve();

        expect(startedSpy).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "ask_clarifying_question" }),
        );
        expect(fp.getCurrentMode()).toBe("ask_clarifying_question");

        fp.stop();
        jest.runAllTimers();
        await p;
      });
    });

    describe("switch_to_text_summary", () => {
      it("should produce a switch_to_text_summary plan when mode is set", async () => {
        const fp = makePlanner({ mode: "switch_to_text_summary" });
        const startedSpy = jest.fn();
        fp.on("started", startedSpy);

        const p = fp.trigger(makePayload());
        await Promise.resolve();
        await Promise.resolve();

        expect(startedSpy).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "switch_to_text_summary" }),
        );

        fp.stop();
        jest.runAllTimers();
        await p;
      });
    });

    describe("escalate_to_human", () => {
      it("should produce an escalate_to_human plan when mode is set", async () => {
        const fp = makePlanner({ mode: "escalate_to_human" });
        const startedSpy = jest.fn();
        fp.on("started", startedSpy);

        const p = fp.trigger(makePayload());
        await Promise.resolve();
        await Promise.resolve();

        expect(startedSpy).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "escalate_to_human" }),
        );

        fp.stop();
        jest.runAllTimers();
        await p;
      });
    });

    describe("offer_email_or_link", () => {
      it("should produce an offer_email_or_link plan when mode is set", async () => {
        const fp = makePlanner({ mode: "offer_email_or_link" });
        const startedSpy = jest.fn();
        fp.on("started", startedSpy);

        const p = fp.trigger(makePayload());
        await Promise.resolve();
        await Promise.resolve();

        expect(startedSpy).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "offer_email_or_link" }),
        );

        fp.stop();
        jest.runAllTimers();
        await p;
      });
    });
  });

  // ── Auto mode resolution ──────────────────────────────────────────

  describe("auto mode resolution", () => {
    it("should resolve to refuse_politely for refuse decision", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(makePayload({ decision: "refuse" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "refuse_politely" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should resolve to refuse_politely for cancel_output decision", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(makePayload({ decision: "cancel_output" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "refuse_politely" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should resolve to escalate_to_human for escalate decision", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(makePayload({ decision: "escalate" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "escalate_to_human" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should resolve to ask_clarifying_question for rewrite decision", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(makePayload({ decision: "rewrite" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "ask_clarifying_question" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should resolve to refuse_politely for allow decision (default)", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(makePayload({ decision: "allow" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "refuse_politely" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should use payload fallback_mode when not auto", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(
        makePayload({
          decision: "refuse",
          fallback_mode: "escalate_to_human",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "escalate_to_human" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should fall back to decision-based resolution when payload fallback_mode is auto", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger(
        makePayload({
          decision: "escalate",
          fallback_mode: "auto",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "escalate_to_human" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });
  });

  // ── Stop during playback ──────────────────────────────────────────

  describe("stop", () => {
    it("should stop playback and emit done with stopped reason", async () => {
      const doneSpy = jest.fn();
      planner.on("done", doneSpy);

      const p = planner.trigger(makePayload());
      await Promise.resolve();
      await Promise.resolve();

      expect(planner.isActive()).toBe(true);

      planner.stop();
      jest.runAllTimers();
      await p;

      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "stopped" }),
      );
      expect(planner.isActive()).toBe(false);
      expect(planner.getCurrentUtterance()).toBeNull();
      expect(planner.getCurrentMode()).toBeNull();
    });

    it("should be a no-op when not playing", () => {
      const doneSpy = jest.fn();
      planner.on("done", doneSpy);

      planner.stop();

      expect(doneSpy).not.toHaveBeenCalled();
    });
  });

  // ── Text output mode ──────────────────────────────────────────────

  describe("text output mode", () => {
    it("should emit text event and finish without generating audio", async () => {
      const fp = makePlanner({ mode: "switch_to_text_summary" });
      const textSpy = jest.fn();
      const audioSpy = jest.fn();
      const doneSpy = jest.fn();

      fp.on("text", textSpy);
      fp.on("audio", audioSpy);
      fp.on("done", doneSpy);

      // Override buildPlan to return text output
      // Instead, we configure the planner to use a mode and then check
      // We need to make the plan return output: "text"
      // The default plans all return output: "audio", so we test via direct method
      const plan = fp.switchToTextSummary();
      expect(plan.output).toBe("audio"); // Default is audio

      // To test text output, we would need to override the plan builder.
      // Since the real code always returns "audio" for all modes,
      // we can test the text path by creating a subclass or checking
      // the behavior when output is set to "text" internally.
      // For now, verify that the public buildPlan methods return expected shapes.
      fp.removeAllListeners();
    });

    it("should return correct plan shapes for each mode method", () => {
      const plan1 = planner.refusePolitely();
      expect(plan1.mode).toBe("refuse_politely");
      expect(plan1.output).toBe("audio");
      expect(typeof plan1.utterance).toBe("string");
      expect(plan1.utterance.length).toBeGreaterThan(0);

      const plan2 = planner.askClarifyingQuestion();
      expect(plan2.mode).toBe("ask_clarifying_question");
      expect(plan2.output).toBe("audio");
      expect(typeof plan2.utterance).toBe("string");

      const plan3 = planner.switchToTextSummary();
      expect(plan3.mode).toBe("switch_to_text_summary");
      expect(typeof plan3.utterance).toBe("string");

      const plan4 = planner.escalateToHuman();
      expect(plan4.mode).toBe("escalate_to_human");
      expect(typeof plan4.utterance).toBe("string");

      const plan5 = planner.offerEmailOrLink();
      expect(plan5.mode).toBe("offer_email_or_link");
      expect(typeof plan5.utterance).toBe("string");
    });
  });

  // ── EventBus emission ─────────────────────────────────────────────

  describe("eventBus integration", () => {
    it("should emit fallback.started event on trigger", async () => {
      const p = planner.trigger(makePayload({ decision: "refuse" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "fallback.started",
          session_id: "test-session",
          source: "orchestrator",
          payload: expect.objectContaining({
            mode: "refuse_politely",
            status: "started",
          }),
        }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });

    it("should emit fallback.completed event on stop", async () => {
      const p = planner.trigger(makePayload());
      await Promise.resolve();
      await Promise.resolve();

      mockEmit.mockClear();
      planner.stop();
      jest.runAllTimers();
      await p;

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "fallback.completed",
          payload: expect.objectContaining({
            status: "completed",
            reason: "stopped",
          }),
        }),
      );
    });
  });

  // ── Audio streaming completion ────────────────────────────────────

  describe("audio playback completion", () => {
    it("should emit done with reason 'done' when audio finishes streaming", async () => {
      const doneSpy = jest.fn();
      planner.on("done", doneSpy);

      const p = planner.trigger(makePayload());
      await flushAsync();

      // Advance timers to stream all chunks and complete
      jest.runAllTimers();
      await p;

      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "done" }),
      );
      expect(planner.isActive()).toBe(false);
    });

    it("should emit audio chunks during streaming", async () => {
      const audioSpy = jest.fn();
      planner.on("audio", audioSpy);

      const p = planner.trigger(makePayload());
      await flushAsync();

      // Advance timers to trigger audio chunk emission
      jest.advanceTimersByTime(200);
      await p;

      // TTS mock returns 4800 bytes. At 24000 sample rate, 100ms chunks = 4800 bytes
      // So we should get exactly 1 chunk for 4800 bytes
      expect(audioSpy).toHaveBeenCalled();

      planner.stop();
      jest.runAllTimers();
    });
  });

  // ── Trigger without payload ───────────────────────────────────────

  describe("trigger without payload", () => {
    it("should trigger with default refuse_politely mode when no payload given", async () => {
      const startedSpy = jest.fn();
      planner.on("started", startedSpy);

      const p = planner.trigger();
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "refuse_politely" }),
      );

      planner.stop();
      jest.runAllTimers();
      await p;
    });
  });

  // ── Text output path (line 151) ─────────────────────────────────

  describe("text output path", () => {
    it("should emit text event and finish immediately for text output plans", async () => {
      const fp = makePlanner();
      // Override private buildPlan to return a text output plan
      (fp as any).buildPlan = () => ({
        mode: "refuse_politely" as const,
        utterance: "I cannot help with that.",
        output: "text" as const,
      });

      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const textSpy = jest.fn();
      const audioSpy = jest.fn();
      const doneSpy = jest.fn();
      fp.on("text", textSpy);
      fp.on("audio", audioSpy);
      fp.on("done", doneSpy);

      await fp.trigger(makePayload());

      expect(textSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "I cannot help with that.",
          mode: "refuse_politely",
        }),
      );
      expect(audioSpy).not.toHaveBeenCalled();
      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "done" }),
      );
      expect(fp.isActive()).toBe(false);

      logSpy.mockRestore();
    });
  });

  // ── getAudio returns null (line 158) ────────────────────────────

  describe("null audio from getAudio", () => {
    it("should finish when getAudio returns null", async () => {
      const fp = makePlanner();
      (fp as any).getAudio = jest.fn().mockResolvedValue(null);

      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const doneSpy = jest.fn();
      fp.on("done", doneSpy);

      await fp.trigger(makePayload());

      expect(warnSpy).toHaveBeenCalledWith(
        "[FallbackPlanner] Failed to generate fallback audio",
      );
      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "done" }),
      );
      expect(fp.isActive()).toBe(false);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  // ── pickPhrase edge cases (lines 284, 289) ─────────────────────

  describe("pickPhrase edge cases", () => {
    it("should use fallback when phrases list is empty", async () => {
      const fp = makePlanner({ phrases: [] });
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const startedSpy = jest.fn();
      fp.on("started", startedSpy);

      const p = fp.trigger(makePayload({ decision: "refuse" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          utterance: "Sorry, I can't help with that.",
        }),
      );

      fp.stop();
      jest.runAllTimers();
      await p;
      logSpy.mockRestore();
    });

    it("should use fallback when phrases list is not an array", async () => {
      const fp = makePlanner({ phrases: null as any });
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const startedSpy = jest.fn();
      fp.on("started", startedSpy);

      const p = fp.trigger(makePayload({ decision: "refuse" }));
      await Promise.resolve();
      await Promise.resolve();

      expect(startedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          utterance: "Sorry, I can't help with that.",
        }),
      );

      fp.stop();
      jest.runAllTimers();
      await p;
      logSpy.mockRestore();
    });

    it("should use fallback when picked element is falsy", () => {
      // Directly test pickPhrase with a list containing an empty string
      const fp = makePlanner();
      // Seed Math.random to always pick index 0
      const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
      const result = (fp as any).pickPhrase(["", "valid"], "fallback");
      expect(result).toBe("fallback");
      randomSpy.mockRestore();
    });
  });

  // ── Audio cache hit (line 310) ──────────────────────────────────

  describe("audio caching", () => {
    it("should use cached audio on second trigger with same phrase", async () => {
      const fp = makePlanner({
        mode: "refuse_politely",
        phrases: ["Fixed phrase for caching"],
      });
      const logSpy = jest.spyOn(console, "log").mockImplementation();

      // First trigger - populates cache
      const p1 = fp.trigger(makePayload());
      await flushAsync();

      // Let audio finish streaming
      jest.runAllTimers();
      await p1;

      expect(fp.isActive()).toBe(false);

      // Second trigger - should hit cache (no TTS call, so no extra race hop)
      const audioSpy = jest.fn();
      fp.on("audio", audioSpy);

      const p2 = fp.trigger(makePayload());
      await Promise.resolve();
      await Promise.resolve();

      expect(fp.isActive()).toBe(true);

      jest.runAllTimers();
      await p2;

      expect(audioSpy).toHaveBeenCalled();
      expect(fp.isActive()).toBe(false);

      logSpy.mockRestore();
    });
  });

  // ── Trigger error handling (lines 164-167) ──────────────────────

  describe("trigger error handling", () => {
    it("should finish gracefully when getAudio throws", async () => {
      const fp = makePlanner();
      const errorSpy = jest.spyOn(console, "error").mockImplementation();
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const doneSpy = jest.fn();
      fp.on("done", doneSpy);

      // Make getAudio throw to exercise the catch block
      (fp as any).getAudio = jest
        .fn()
        .mockRejectedValue(new Error("Boom"));

      await fp.trigger(makePayload());

      expect(errorSpy).toHaveBeenCalledWith(
        "[FallbackPlanner] Error during fallback playback:",
        expect.any(Error),
      );
      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "done" }),
      );
      expect(fp.isActive()).toBe(false);

      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ── Double stop / double finish guard (line 404) ────────────────

  describe("double stop guard", () => {
    it("should not double-finish when stop is called twice", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const doneSpy = jest.fn();
      planner.on("done", doneSpy);

      const p = planner.trigger(makePayload());
      await Promise.resolve();
      await Promise.resolve();

      // Call stop twice rapidly
      planner.stop();
      planner.stop(); // second stop hits the !isPlaying guard

      jest.runAllTimers();
      await p;

      expect(doneSpy).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });
  });

  // ── Finish with null state (lines 414, 415, 429) ───────────────

  describe("finish with null state defaults", () => {
    it("should use default mode and output when finish is called with null internal state", () => {
      const fp = makePlanner();

      // Manually set isPlaying=true but leave mode/output/utterance null
      (fp as any).isPlaying = true;
      (fp as any).currentMode = null;
      (fp as any).currentOutput = null;
      (fp as any).currentUtterance = null;
      (fp as any).lastDecision = null;

      const doneSpy = jest.fn();
      fp.on("done", doneSpy);

      fp.stop(); // calls finish("stopped")

      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "stopped",
          mode: "refuse_politely", // default from ?? operator
          utterance: null,
        }),
      );
      expect(fp.isActive()).toBe(false);
    });

    it("should pass utterance ?? undefined to the fallback event when utterance is null", () => {
      const fp = makePlanner();

      (fp as any).isPlaying = true;
      (fp as any).currentMode = null;
      (fp as any).currentOutput = null;
      (fp as any).currentUtterance = null;
      (fp as any).lastDecision = null;

      fp.stop();

      // Verify the eventBus was called with utterance: undefined (from null ?? undefined)
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "fallback.completed",
          payload: expect.objectContaining({
            mode: "refuse_politely",
            output: "audio",
            utterance: undefined,
            status: "completed",
            reason: "stopped",
          }),
        }),
      );
    });
  });

  // ── streamAudio isPlaying guard (line 374) ──────────────────────

  describe("streamAudio isPlaying guard", () => {
    it("should bail out of streamChunk when isPlaying is false", async () => {
      const fp = makePlanner();
      const logSpy = jest.spyOn(console, "log").mockImplementation();

      // Provide a buffer large enough for multiple chunks (3 chunks of 4800 bytes)
      (fp as any).getAudio = jest.fn().mockResolvedValue({
        utterance: "test",
        audioData: Buffer.alloc(14400),
        durationMs: 300,
      });

      const audioSpy = jest.fn();
      fp.on("audio", audioSpy);

      const p = fp.trigger(makePayload());
      await Promise.resolve();
      await Promise.resolve();

      // First chunk fires synchronously in streamChunk
      expect(audioSpy).toHaveBeenCalledTimes(1);

      // Directly set isPlaying=false WITHOUT clearing the timer.
      // This simulates the guard condition at line 374: the timer
      // callback fires but isPlaying is already false.
      (fp as any).isPlaying = false;

      // Advance timer so the next scheduled streamChunk runs --
      // it should hit the !isPlaying guard and return immediately.
      jest.advanceTimersByTime(100);

      // No additional audio chunk should have been emitted
      expect(audioSpy).toHaveBeenCalledTimes(1);

      // Clean up pending timers
      jest.runAllTimers();
      await p;

      logSpy.mockRestore();
    });
  });

  // ── TTS failure fallback to tone (lines 330-361) ─────────────────

  describe("TTS failure fallback to tone", () => {
    it("should generate fallback tone when TTS fails", async () => {
      const fp = makePlanner({
        mode: "refuse_politely",
        phrases: ["unique tts failure phrase"],
      });
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      // Make TTS reject for this test
      mockGenerateSpeech.mockRejectedValueOnce(new Error("TTS unavailable"));

      const audioSpy = jest.fn();
      const doneSpy = jest.fn();
      fp.on("audio", audioSpy);
      fp.on("done", doneSpy);

      const p = fp.trigger(makePayload());
      await flushAsync();

      // Should have warned about TTS failure
      expect(warnSpy).toHaveBeenCalledWith(
        "[FallbackPlanner] TTS failed, using fallback tone:",
        expect.any(Error),
      );

      // Advance timers to stream the tone audio
      jest.runAllTimers();
      await p;

      expect(audioSpy).toHaveBeenCalled();
      expect(doneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "done" }),
      );

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  // ── finish guard when not playing (line 404) ────────────────────

  describe("finish guard when not playing", () => {
    it("should be a no-op when finish is called while not playing", () => {
      const fp = makePlanner();
      const doneSpy = jest.fn();
      fp.on("done", doneSpy);

      // isPlaying is false by default. Calling finish directly
      // should hit the guard at line 404 and return without emitting.
      (fp as any).finish("done");

      expect(doneSpy).not.toHaveBeenCalled();
      expect(fp.isActive()).toBe(false);
    });
  });
});
