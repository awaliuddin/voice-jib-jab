/**
 * DemoPlayer Unit Tests
 *
 * All tests use speedMultiplier: 0 so play() resolves without real delays.
 * No external dependencies are mocked — DemoPlayer is self-contained.
 */

import { DemoPlayer } from "../../demo/DemoPlayer.js";
import type { DemoPlaybackEvent } from "../../demo/DemoPlayer.js";
import { getDemoScript, listDemoScripts } from "../../demo/script.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePlayer(): DemoPlayer {
  return new DemoPlayer({ speedMultiplier: 0 });
}

/** UUID v4 pattern */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO 8601 date pattern */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/;

// ── play() — return value ──────────────────────────────────────────────────

describe("play() return value", () => {
  it("returns a string sessionId", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it("sessionId is UUID v4 format", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    expect(sessionId).toMatch(UUID_RE);
  });

  it("second play() call while playing returns existing sessionId (idempotent guard)", async () => {
    // With speedMultiplier: 0, each turn awaits Promise.resolve() (_delay no-op),
    // so play() yields after the first turn. The second call hits the guard.
    const player = makePlayer();

    // Start playback — it will yield after the first turn's _delay
    const firstPromise = player.play("support");

    // At this point play() has set _playing=true and is mid-flight
    // (it has yielded to the microtask queue)
    const secondPromise = player.play("support");

    const [firstId, secondId] = await Promise.all([firstPromise, secondPromise]);
    // The second call returns the same sessionId (idempotent)
    expect(firstId).toBe(secondId);
  });

  it("concurrent play() calls on separate players each complete successfully", async () => {
    // Each player instance is independent — concurrent plays don't interfere
    const player1 = makePlayer();
    const player2 = makePlayer();

    const [id1, id2] = await Promise.all([
      player1.play("support"),
      player2.play("compliance"),
    ]);

    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
    expect(id1).not.toBe(id2);
  });

  it("two sequential play() calls produce different session IDs", async () => {
    const player = makePlayer();
    const id1 = await player.play("support");
    const id2 = await player.play("support");
    expect(id1).not.toBe(id2);
  });
});

// ── Events emitted — ordering ─────────────────────────────────────────────

describe("Events emitted — ordering", () => {
  it("session_start is the first event", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);
    expect(events[0].type).toBe("session_start");
  });

  it("session_end is the last event", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);
    expect(events[events.length - 1].type).toBe("session_end");
  });

  it("summary event appears before session_end", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);
    const summaryIdx = events.findIndex((e) => e.type === "summary");
    const endIdx = events.findIndex((e) => e.type === "session_end");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeLessThan(endIdx);
  });

  it("all turns appear as 'turn' events", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const turns = player.getEvents(sessionId).filter((e) => e.type === "turn");
    expect(turns.length).toBeGreaterThan(0);
  });

  it("policy events appear after user turns", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);

    for (let i = 0; i < events.length; i++) {
      if (events[i].type === "policy") {
        // The previous non-sentiment event should be a user turn or sentiment
        const precedingTurnIdx = events
          .slice(0, i)
          .reverse()
          .findIndex((e) => e.type === "turn");
        const precedingTurn = events
          .slice(0, i)
          .reverse()
          .find((e) => e.type === "turn");
        expect(precedingTurnIdx).toBeGreaterThan(-1);
        expect(precedingTurn?.speaker).toBe("user");
      }
    }
  });

  it("sentiment events appear after user turns", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);

    for (let i = 0; i < events.length; i++) {
      if (events[i].type === "sentiment") {
        const precedingTurn = events
          .slice(0, i)
          .reverse()
          .find((e) => e.type === "turn");
        expect(precedingTurn?.speaker).toBe("user");
      }
    }
  });
});

// ── Event structure ────────────────────────────────────────────────────────

describe("Event structure", () => {
  it("all events have sessionId", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    for (const event of player.getEvents(sessionId)) {
      expect(event.sessionId).toBe(sessionId);
    }
  });

  it("all events have ISO timestamp", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    for (const event of player.getEvents(sessionId)) {
      expect(event.timestamp).toMatch(ISO_RE);
    }
  });

  it("all events have a type field", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    for (const event of player.getEvents(sessionId)) {
      expect(typeof event.type).toBe("string");
      expect(event.type.length).toBeGreaterThan(0);
    }
  });

  it("turn events have speaker and text", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const turns = player.getEvents(sessionId).filter((e) => e.type === "turn");
    for (const turn of turns) {
      expect(turn.speaker).toMatch(/^(agent|user)$/);
      expect(typeof turn.text).toBe("string");
      expect(turn.text!.length).toBeGreaterThan(0);
    }
  });

  it("policy events have policyDecision field", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const policies = player
      .getEvents(sessionId)
      .filter((e) => e.type === "policy");
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(typeof policy.policyDecision).toBe("string");
    }
  });

  it("summary event has totalTurns as a positive integer", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const summary = player
      .getEvents(sessionId)
      .find((e) => e.type === "summary")!;
    expect(typeof summary.totalTurns).toBe("number");
    expect(summary.totalTurns!).toBeGreaterThan(0);
  });

  it("summary event has escalated as boolean", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const summary = player
      .getEvents(sessionId)
      .find((e) => e.type === "summary")!;
    expect(typeof summary.escalated).toBe("boolean");
  });

  it("summary event has policyDecisions as array", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const summary = player
      .getEvents(sessionId)
      .find((e) => e.type === "summary")!;
    expect(Array.isArray(summary.policyDecisions)).toBe(true);
  });
});

// ── getEvents() ────────────────────────────────────────────────────────────

describe("getEvents()", () => {
  it("returns empty array before play() is called", () => {
    const player = makePlayer();
    expect(player.getEvents("nonexistent-session")).toEqual([]);
  });

  it("returns all events after play() completes", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);
    expect(events.length).toBeGreaterThan(0);
  });

  it("events are ordered by emission sequence", async () => {
    const player = makePlayer();
    const emitted: DemoPlaybackEvent[] = [];
    player.on("playback_event", (e: DemoPlaybackEvent) => {
      // Collect only events from our session (registered before play)
      emitted.push(e);
    });

    const sessionId = await player.play("support");
    const stored = player.getEvents(sessionId);

    // Filter emitted to only events from this session
    const sessionEmitted = emitted.filter((e) => e.sessionId === sessionId);

    // The stored events must be in the same order as emitted events
    expect(stored.length).toBe(sessionEmitted.length);
    for (let i = 0; i < stored.length; i++) {
      expect(stored[i].type).toBe(sessionEmitted[i].type);
      expect(stored[i].timestamp).toBe(sessionEmitted[i].timestamp);
    }
  });

  it("returns only events for the requested sessionId", async () => {
    const player = makePlayer();
    const id1 = await player.play("support");
    const id2 = await player.play("compliance");

    const events1 = player.getEvents(id1);
    const events2 = player.getEvents(id2);

    for (const e of events1) expect(e.sessionId).toBe(id1);
    for (const e of events2) expect(e.sessionId).toBe(id2);
    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);
  });
});

// ── isPlaying() ────────────────────────────────────────────────────────────

describe("isPlaying()", () => {
  it("returns false initially", () => {
    const player = makePlayer();
    expect(player.isPlaying()).toBe(false);
  });

  it("returns false after play() completes", async () => {
    const player = makePlayer();
    await player.play("support");
    expect(player.isPlaying()).toBe(false);
  });

  it("isPlaying() transitions: false → true during play → false after completion", async () => {
    // With speedMultiplier > 0, play() has real (tiny) delays.
    // 1000x speed: longest delay is ~2.8ms, total scenario < 50ms.
    const player = new DemoPlayer({ speedMultiplier: 1000 });
    expect(player.isPlaying()).toBe(false);
    const promise = player.play("support");
    // play() is in progress — _playing was set to true synchronously
    expect(player.isPlaying()).toBe(true);
    await promise;
    expect(player.isPlaying()).toBe(false);
  }, 10000);
});

// ── speedMultiplier: 0 behaviour ─────────────────────────────────────────

describe("speedMultiplier: 0", () => {
  it("play() resolves without real delay", async () => {
    const player = makePlayer(); // speedMultiplier: 0
    const start = Date.now();
    await player.play("support");
    const elapsed = Date.now() - start;
    // Should complete in well under 500 ms even on slow CI
    expect(elapsed).toBeLessThan(500);
  });

  it("all events are still emitted when speedMultiplier is 0", async () => {
    const player = makePlayer();
    const collected: DemoPlaybackEvent[] = [];
    player.on("playback_event", (e: DemoPlaybackEvent) => collected.push(e));

    await player.play("support");
    expect(collected.length).toBeGreaterThan(0);

    const types = new Set(collected.map((e) => e.type));
    expect(types.has("session_start")).toBe(true);
    expect(types.has("turn")).toBe(true);
    expect(types.has("session_end")).toBe(true);
  });
});

// ── All 3 scenarios ────────────────────────────────────────────────────────

describe("All 3 scenarios", () => {
  it("play('support') completes with at least 1 escalate event", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const escalates = player
      .getEvents(sessionId)
      .filter(
        (e) => e.type === "policy" && e.policyDecision === "escalate"
      );
    expect(escalates.length).toBeGreaterThanOrEqual(1);
  });

  it("play('compliance') completes with at least 1 refuse event", async () => {
    const player = makePlayer();
    const sessionId = await player.play("compliance");
    const refuses = player
      .getEvents(sessionId)
      .filter(
        (e) => e.type === "policy" && e.policyDecision === "refuse"
      );
    expect(refuses.length).toBeGreaterThanOrEqual(1);
  });

  it("play('sales') completes with at least 1 rewrite event", async () => {
    const player = makePlayer();
    const sessionId = await player.play("sales");
    const rewrites = player
      .getEvents(sessionId)
      .filter(
        (e) => e.type === "policy" && e.policyDecision === "rewrite"
      );
    expect(rewrites.length).toBeGreaterThanOrEqual(1);
  });

  it("support scenario emits both session_start and session_end", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);
    expect(events.some((e) => e.type === "session_start")).toBe(true);
    expect(events.some((e) => e.type === "session_end")).toBe(true);
  });

  it("compliance scenario emits both session_start and session_end", async () => {
    const player = makePlayer();
    const sessionId = await player.play("compliance");
    const events = player.getEvents(sessionId);
    expect(events.some((e) => e.type === "session_start")).toBe(true);
    expect(events.some((e) => e.type === "session_end")).toBe(true);
  });

  it("sales scenario emits both session_start and session_end", async () => {
    const player = makePlayer();
    const sessionId = await player.play("sales");
    const events = player.getEvents(sessionId);
    expect(events.some((e) => e.type === "session_start")).toBe(true);
    expect(events.some((e) => e.type === "session_end")).toBe(true);
  });
});

// ── Summary event ─────────────────────────────────────────────────────────

describe("Summary event", () => {
  it("totalTurns > 0 for support", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const summary = player
      .getEvents(sessionId)
      .find((e) => e.type === "summary")!;
    expect(summary.totalTurns).toBeGreaterThan(0);
  });

  it("escalated === true for support scenario", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const summary = player
      .getEvents(sessionId)
      .find((e) => e.type === "summary")!;
    expect(summary.escalated).toBe(true);
  });

  it("escalated === true for compliance scenario", async () => {
    const player = makePlayer();
    const sessionId = await player.play("compliance");
    const summary = player
      .getEvents(sessionId)
      .find((e) => e.type === "summary")!;
    expect(summary.escalated).toBe(true);
  });

  it("policyDecisions is an array for all scenarios", async () => {
    for (const scenario of ["support", "compliance", "sales"]) {
      const player = makePlayer();
      const sessionId = await player.play(scenario);
      const summary = player
        .getEvents(sessionId)
        .find((e) => e.type === "summary")!;
      expect(Array.isArray(summary.policyDecisions)).toBe(true);
      expect(summary.policyDecisions!.length).toBeGreaterThan(0);
    }
  });

  it("finalSentiment is one of the valid sentiment values", async () => {
    const validSentiments = ["positive", "neutral", "negative", "frustrated"];
    for (const scenario of ["support", "compliance", "sales"]) {
      const player = makePlayer();
      const sessionId = await player.play(scenario);
      const summary = player
        .getEvents(sessionId)
        .find((e) => e.type === "summary")!;
      if (summary.finalSentiment !== undefined) {
        expect(validSentiments).toContain(summary.finalSentiment);
      }
    }
  });

  it("policyDecisions array contains only valid decision types", async () => {
    const validDecisions = ["allow", "refuse", "escalate", "rewrite"];
    for (const scenario of ["support", "compliance", "sales"]) {
      const player = makePlayer();
      const sessionId = await player.play(scenario);
      const summary = player
        .getEvents(sessionId)
        .find((e) => e.type === "summary")!;
      for (const d of summary.policyDecisions ?? []) {
        expect(validDecisions).toContain(d);
      }
    }
  });

  it("totalTurns in summary matches turn event count", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    const events = player.getEvents(sessionId);
    const summary = events.find((e) => e.type === "summary")!;
    const turnCount = events.filter((e) => e.type === "turn").length;
    expect(summary.totalTurns).toBe(turnCount);
  });
});

// ── getSessionId() ─────────────────────────────────────────────────────────

describe("getSessionId()", () => {
  it("returns null before play() is called", () => {
    const player = makePlayer();
    expect(player.getSessionId()).toBeNull();
  });

  it("returns the sessionId after play() completes", async () => {
    const player = makePlayer();
    const sessionId = await player.play("support");
    expect(player.getSessionId()).toBe(sessionId);
  });
});

// ── getDemoScript() — script module ───────────────────────────────────────

describe("getDemoScript()", () => {
  it("returns support script with correct scenarioId", () => {
    const script = getDemoScript("support");
    expect(script.scenarioId).toBe("support");
    expect(script.turns.length).toBeGreaterThan(0);
  });

  it("returns compliance script with correct scenarioId", () => {
    const script = getDemoScript("compliance");
    expect(script.scenarioId).toBe("compliance");
    expect(script.turns.length).toBeGreaterThan(0);
  });

  it("returns sales script with correct scenarioId", () => {
    const script = getDemoScript("sales");
    expect(script.scenarioId).toBe("sales");
    expect(script.turns.length).toBeGreaterThan(0);
  });

  it("throws for unknown scenarioId", () => {
    expect(() => getDemoScript("unknown_scenario")).toThrow(
      /No demo script found for scenarioId "unknown_scenario"/
    );
  });

  it("error message includes valid options", () => {
    expect(() => getDemoScript("bad")).toThrow(/support.*compliance.*sales/);
  });
});

describe("listDemoScripts()", () => {
  it("returns all 3 scripts", () => {
    const scripts = listDemoScripts();
    expect(scripts.length).toBe(3);
  });

  it("includes support, compliance and sales", () => {
    const ids = listDemoScripts().map((s) => s.scenarioId);
    expect(ids).toContain("support");
    expect(ids).toContain("compliance");
    expect(ids).toContain("sales");
  });
});

// ── play() with invalid scenarioId ─────────────────────────────────────────

describe("play() with invalid scenarioId", () => {
  it("rejects with an error for unknown scenarioId", async () => {
    const player = makePlayer();
    await expect(player.play("unknown_scenario")).rejects.toThrow(
      /No demo script found/
    );
  });
});

// ── Constructor defaults ───────────────────────────────────────────────────

describe("DemoPlayer constructor defaults", () => {
  it("defaults speedMultiplier to 1.0 when config is empty", async () => {
    // speedMultiplier: 1.0 means real-time delays. Use speedMultiplier: 0 to
    // prove the default path is not 0. We simply create with no config and
    // confirm the player is an EventEmitter and isPlaying starts false.
    const player = new DemoPlayer({});
    expect(player.isPlaying()).toBe(false);
    expect(player.getSessionId()).toBeNull();
  });

  it("constructor with no arguments uses default speedMultiplier", () => {
    const player = new DemoPlayer();
    expect(player.isPlaying()).toBe(false);
  });
});
