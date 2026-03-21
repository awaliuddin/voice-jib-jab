/**
 * DemoPlayer — replays a scripted voice agent demo scenario.
 *
 * Drives a DemoScript turn-by-turn, emitting structured DemoPlaybackEvent
 * objects on the "playback_event" EventEmitter channel. Consumers (HTTP API,
 * CLI runner) subscribe to these events to render output.
 *
 * Speed is controlled by `speedMultiplier`:
 *   - 1.0 = real-time (uses actual delayMs values)
 *   - 2.0 = 2x faster (halves delays)
 *   - 0   = instant (skips all delays — intended for tests)
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { getDemoScript } from "./script.js";

// ── Public types ──────────────────────────────────────────────────────────

export interface DemoPlaybackEvent {
  type:
    | "turn"
    | "policy"
    | "sentiment"
    | "session_start"
    | "session_end"
    | "summary";
  turnIndex?: number;
  speaker?: "agent" | "user";
  text?: string;
  sentiment?: string;
  policyDecision?: string;
  reasonCodes?: string[];
  severity?: number;
  claimMatched?: string;
  sessionId: string;
  timestamp: string;
  /** Summary-only fields */
  totalTurns?: number;
  policyDecisions?: string[];
  escalated?: boolean;
  finalSentiment?: string;
}

export interface DemoPlayerConfig {
  /** 1.0 = realtime, 0 = instant (for tests), 2.0 = 2x speed */
  speedMultiplier?: number;
  scenarioId?: string;
}

// ── DemoPlayer ────────────────────────────────────────────────────────────

export class DemoPlayer extends EventEmitter {
  private readonly speedMultiplier: number;
  /** All events ever emitted, keyed by sessionId. */
  private _eventsBySession = new Map<string, DemoPlaybackEvent[]>();
  private _playing = false;
  private _sessionId: string | null = null;
  private _activeSessionId: string | null = null;

  constructor(config: DemoPlayerConfig = {}) {
    super();
    this.speedMultiplier = config.speedMultiplier ?? 1.0;
  }

  /**
   * Play a demo scenario by ID.
   *
   * Emits "playback_event" for each event in sequence. Resolves when the
   * session_end event has been emitted.
   *
   * Idempotent while playing: if called again before completion, returns
   * the existing sessionId without starting a second playback.
   *
   * @param scenarioId - "support" | "compliance" | "sales"
   * @returns The sessionId for this playback run
   */
  async play(scenarioId: string): Promise<string> {
    if (this._playing && this._activeSessionId !== null) {
      return this._activeSessionId;
    }

    const sessionId = uuidv4();
    this._sessionId = sessionId;
    this._activeSessionId = sessionId;
    this._playing = true;
    this._eventsBySession.set(sessionId, []);

    const script = getDemoScript(scenarioId);

    // Emit session_start
    this._emit({
      type: "session_start",
      sessionId,
      timestamp: new Date().toISOString(),
    });

    // Track summary state
    const policyDecisions: string[] = [];
    let lastSentiment: string | undefined;
    let escalated = false;

    for (let i = 0; i < script.turns.length; i++) {
      const turn = script.turns[i];

      // Apply delay before this turn (scaled by speedMultiplier).
      // _delay handles speedMultiplier=0 as a no-op.
      if (turn.delayMs > 0) {
        await this._delay(turn.delayMs);
      }

      // Emit turn event
      this._emit({
        type: "turn",
        turnIndex: i,
        speaker: turn.speaker,
        text: turn.text,
        sessionId,
        timestamp: new Date().toISOString(),
      });

      // After user turns, emit policy/sentiment events if defined
      if (turn.speaker === "user" && turn.events) {
        const ev = turn.events;

        if (ev.sentiment !== undefined) {
          lastSentiment = ev.sentiment;
          this._emit({
            type: "sentiment",
            sentiment: ev.sentiment,
            sessionId,
            timestamp: new Date().toISOString(),
          });
        }

        if (ev.policyDecision !== undefined) {
          policyDecisions.push(ev.policyDecision);
          if (ev.policyDecision === "escalate") {
            escalated = true;
          }

          const policyEvent: DemoPlaybackEvent = {
            type: "policy",
            policyDecision: ev.policyDecision,
            sessionId,
            timestamp: new Date().toISOString(),
          };
          if (ev.reasonCodes !== undefined) {
            policyEvent.reasonCodes = ev.reasonCodes;
          }
          if (ev.severity !== undefined) {
            policyEvent.severity = ev.severity;
          }
          if (ev.claimMatched !== undefined) {
            policyEvent.claimMatched = ev.claimMatched;
          }
          this._emit(policyEvent);
        }
      }
    }

    // Emit summary
    const summaryEvent: DemoPlaybackEvent = {
      type: "summary",
      sessionId,
      timestamp: new Date().toISOString(),
      totalTurns: script.turns.length,
      policyDecisions,
      escalated,
      finalSentiment: lastSentiment,
    };
    this._emit(summaryEvent);

    // Emit session_end
    this._emit({
      type: "session_end",
      sessionId,
      timestamp: new Date().toISOString(),
    });

    this._playing = false;
    this._activeSessionId = null;

    return sessionId;
  }

  /**
   * Return all events emitted during the session with the given sessionId.
   * Returns an empty array if no events have been emitted yet.
   *
   * @param sessionId - The session ID returned by play()
   */
  getEvents(sessionId: string): DemoPlaybackEvent[] {
    return this._eventsBySession.get(sessionId) ?? [];
  }

  /**
   * Returns true while a playback is in progress.
   */
  isPlaying(): boolean {
    return this._playing;
  }

  /**
   * Returns the sessionId of the most recent play() call, or null if play()
   * has never been called.
   */
  getSessionId(): string | null {
    return this._sessionId;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Store and emit a playback event.
   */
  private _emit(event: DemoPlaybackEvent): void {
    const bucket = this._eventsBySession.get(event.sessionId);
    if (bucket !== undefined) {
      bucket.push(event);
    }
    this.emit("playback_event", event);
  }

  /**
   * Return a Promise that resolves after `ms` milliseconds.
   * Scaled by speedMultiplier.
   */
  private _delay(ms: number): Promise<void> {
    if (this.speedMultiplier <= 0) {
      return Promise.resolve();
    }
    const scaled = ms / this.speedMultiplier;
    return new Promise((resolve) => setTimeout(resolve, scaled));
  }
}
