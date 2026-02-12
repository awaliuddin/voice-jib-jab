/**
 * Lane Arbitrator - State machine for audio ownership
 *
 * Ensures only one lane owns audio output at a time.
 * Lane B (reasoning) preempts Lane A (reflex) immediately when ready.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "./EventBus.js";
import {
  Lane,
  LaneTransitionCause,
  LaneBReadyEvent,
  LaneOwnerChangedEvent,
  ArbitratorAuditEvent,
} from "../schemas/events.js";
import { AuditTrail } from "../insurance/audit_trail.js";

/**
 * Lane Arbitrator States
 */
export type ArbitratorState =
  | "IDLE" // No active audio
  | "LISTENING" // Receiving user input
  | "A_PLAYING" // Lane A reflex audio playing
  | "B_RESPONDING" // Lane B processing (no audio yet)
  | "B_PLAYING" // Lane B audio playing
  | "FALLBACK_PLAYING" // Fallback audio playing
  | "ENDED"; // Session ended

/**
 * State transition event
 */
export interface StateTransition {
  from: ArbitratorState;
  to: ArbitratorState;
  cause:
    | LaneTransitionCause
    | "session_start"
    | "session_end"
    | "user_speech_ended";
  timestamp: number;
}

/**
 * Lane Arbitrator configuration
 */
export interface LaneArbitratorConfig {
  laneAEnabled: boolean;
  minDelayBeforeReflexMs: number;
  maxReflexDurationMs: number;
  preemptThresholdMs: number;
  transitionGapMs: number;
  auditTrail?: AuditTrail;
}

const DEFAULT_CONFIG: LaneArbitratorConfig = {
  laneAEnabled: true,
  minDelayBeforeReflexMs: 100, // Min wait before triggering Lane A
  maxReflexDurationMs: 2000, // Max reflex duration before auto-cancel
  preemptThresholdMs: 300, // How quickly B must be ready to skip A
  transitionGapMs: 10, // Tiny gap between A stop and B start
};

export class LaneArbitrator extends EventEmitter {
  private sessionId: string;
  private state: ArbitratorState = "IDLE";
  private config: LaneArbitratorConfig;
  private stateHistory: StateTransition[] = [];
  private reflexTimer: NodeJS.Timeout | null = null;
  private reflexTimeoutTimer: NodeJS.Timeout | null = null;
  private speechEndTime: number | null = null;
  private bReadyTime: number | null = null;
  private responseInProgress: boolean = false; // Guards against overlapping response cycles
  private suppressLaneBDone: boolean = false; // Ignore next Lane B done after policy cancel
  private auditTrail?: AuditTrail;

  constructor(sessionId: string, config: Partial<LaneArbitratorConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.auditTrail = config.auditTrail;
  }

  /**
   * Get current state
   */
  getState(): ArbitratorState {
    return this.state;
  }

  /**
   * Get current audio owner
   */
  getCurrentOwner(): Lane {
    switch (this.state) {
      case "A_PLAYING":
        return "A";
      case "B_PLAYING":
        return "B";
      case "FALLBACK_PLAYING":
        return "fallback";
      default:
        return "none";
    }
  }

  /**
   * Check if Lane A is enabled
   */
  isLaneAEnabled(): boolean {
    return this.config.laneAEnabled;
  }

  /**
   * Start the session (transition to LISTENING)
   */
  startSession(): void {
    this.transition("LISTENING", "session_start");
    console.log(`[LaneArbitrator] Session started: ${this.sessionId}`);
  }

  /**
   * End the session
   */
  endSession(): void {
    this.clearTimers();
    this.responseInProgress = false;

    if (this.state === "FALLBACK_PLAYING") {
      this.emit("stop_fallback");
    }

    this.transition("ENDED", "session_end");
    console.log(`[LaneArbitrator] Session ended: ${this.sessionId}`);
  }

  /**
   * Handle user speech ended - triggers Lane A or waits for Lane B
   */
  onUserSpeechEnded(): void {
    // Guard against overlapping response cycles
    if (this.responseInProgress) {
      console.log(
        `[LaneArbitrator] Ignoring speech end: response already in progress`,
      );
      return;
    }

    if (this.state !== "LISTENING") {
      console.warn(
        `[LaneArbitrator] Unexpected speech end in state: ${this.state}`,
      );
      return;
    }

    // Mark response cycle as in progress
    this.responseInProgress = true;
    this.speechEndTime = Date.now();
    console.log(`[LaneArbitrator] User speech ended at ${this.speechEndTime}`);

    // Transition to B_RESPONDING - Lane B is now working
    this.transition("B_RESPONDING", "user_speech_ended");

    // If Lane A is enabled, schedule reflex after min delay
    if (this.config.laneAEnabled) {
      this.reflexTimer = setTimeout(() => {
        this.triggerLaneA();
      }, this.config.minDelayBeforeReflexMs);
    }
  }

  /**
   * Trigger Lane A reflex audio
   */
  private triggerLaneA(): void {
    // Only trigger if still waiting for B
    if (this.state !== "B_RESPONDING") {
      console.log(
        `[LaneArbitrator] Skipping Lane A: state is ${this.state}, not B_RESPONDING`,
      );
      return;
    }

    // Transition to A_PLAYING
    this.transitionLaneOwner(
      "none",
      "A",
      "user_speech_ended" as LaneTransitionCause,
    );
    this.transition("A_PLAYING", "user_speech_ended");

    // Emit event to trigger reflex audio
    this.emit("play_reflex");
    console.log(`[LaneArbitrator] Lane A reflex triggered`);

    // Set timeout to auto-cancel Lane A if B takes too long
    this.reflexTimeoutTimer = setTimeout(() => {
      if (this.state === "A_PLAYING") {
        console.log(`[LaneArbitrator] Lane A timeout - auto-canceling`);
        this.emit("stop_reflex");
      }
    }, this.config.maxReflexDurationMs);
  }

  /**
   * Handle Lane B first audio ready - preempts Lane A
   */
  onLaneBReady(): void {
    this.bReadyTime = Date.now();
    const latencyMs = this.speechEndTime
      ? this.bReadyTime - this.speechEndTime
      : 0;

    console.log(`[LaneArbitrator] Lane B ready after ${latencyMs}ms`);

    // Emit lane.b_ready event
    const readyEvent: LaneBReadyEvent = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneB",
      type: "lane.b_ready",
      payload: { latency_ms: latencyMs },
    };
    eventBus.emit(readyEvent);

    // Clear any pending reflex timers
    this.clearTimers();

    // If Lane A is playing, stop it immediately
    if (this.state === "A_PLAYING") {
      console.log(`[LaneArbitrator] Preempting Lane A with Lane B`);
      this.emit("stop_reflex");

      // Small gap to avoid audio click
      setTimeout(() => {
        this.transitionLaneOwner("A", "B", "b_first_audio_ready");
        this.transition("B_PLAYING", "b_first_audio_ready");
        this.emit("play_lane_b");
      }, this.config.transitionGapMs);
    } else if (this.state === "B_RESPONDING") {
      // Lane A wasn't triggered or skipped - go straight to B
      this.transitionLaneOwner("none", "B", "b_first_audio_ready");
      this.transition("B_PLAYING", "b_first_audio_ready");
      this.emit("play_lane_b");
    }
  }

  /**
   * Handle Lane B response complete
   * ENHANCED: Comprehensive case handling for all possible states
   */
  onLaneBDone(): void {
    console.log(
      `[LaneArbitrator] Lane B done signal received ` +
        `(state: ${this.state}, responseInProgress: ${this.responseInProgress})`,
    );

    if (this.suppressLaneBDone) {
      console.log(
        `[LaneArbitrator] Lane B done suppressed after policy cancel`,
      );
      this.suppressLaneBDone = false;
      return;
    }

    if (this.state === "FALLBACK_PLAYING") {
      console.log(
        `[LaneArbitrator] Lane B done during fallback playback - ignoring`,
      );
      return;
    }

    // Case 1: Expected happy path - response completed while playing
    if (this.state === "B_PLAYING") {
      console.log(`[LaneArbitrator] Lane B response complete (normal flow)`);
      this.transitionLaneOwner("B", "none", "response_done");
      this.transition("LISTENING", "response_done");
      this.responseInProgress = false;
      this.emit("response_complete");
      return;
    }

    // Case 2: Response completed before audio started playing
    // This happens when: buffer commit failed → no state transition →
    // but OpenAI sent response anyway (error recovery)
    if (this.state === "LISTENING" || this.state === "B_RESPONDING") {
      console.log(
        `[LaneArbitrator] Lane B done in ${this.state} ` +
          `(response completed without playback - likely commit failure or fast response)`,
      );

      // Ensure we're in LISTENING state
      if (this.state === "B_RESPONDING") {
        this.transition("LISTENING", "response_done");
      }

      // Clear response guard to allow next utterance
      this.responseInProgress = false;

      // Still emit completion for cleanup
      this.emit("response_complete");
      return;
    }

    // Case 3: Got done in A_PLAYING (B never took over)
    if (this.state === "A_PLAYING") {
      console.log(
        `[LaneArbitrator] Lane B done while A playing ` +
          `(B completed before preempting A - unusual but valid)`,
      );

      // Stop Lane A since B is done
      this.emit("stop_reflex");
      this.transitionLaneOwner("A", "none", "response_done");
      this.transition("LISTENING", "response_done");
      this.responseInProgress = false;
      this.emit("response_complete");
      return;
    }

    // Case 4: Unexpected states (defensive)
    console.warn(
      `[LaneArbitrator] Lane B done in unexpected state: ${this.state} ` +
        `(forcing reset to LISTENING)`,
    );

    // Force state to safe ground
    this.clearTimers();
    if (this.state !== "IDLE" && this.state !== "ENDED") {
      this.transition("LISTENING", "response_done");
    }
    this.responseInProgress = false;
    this.emit("response_complete");
  }

  /**
   * Reset response in progress guard (for error recovery)
   * Called when commit fails and response won't happen
   */
  resetResponseInProgress(): void {
    if (this.responseInProgress) {
      console.log(
        `[LaneArbitrator] Resetting response cycle guard ` +
          `(external trigger - commit likely failed)`,
      );
      this.responseInProgress = false;
      this.clearTimers();

      // Return to listening if not already there
      if (this.state === "B_RESPONDING") {
        this.transition("LISTENING", "user_speech_ended");
      }
    }
  }

  /**
   * Handle user barge-in - stops any playing audio
   */
  onUserBargeIn(): void {
    console.log(`[LaneArbitrator] User barge-in during ${this.state}`);

    this.clearTimers();

    if (this.state === "A_PLAYING") {
      this.emit("stop_reflex");
      this.transitionLaneOwner("A", "none", "user_barge_in");
    } else if (this.state === "B_PLAYING") {
      this.emit("stop_lane_b");
      this.transitionLaneOwner("B", "none", "user_barge_in");
    } else if (this.state === "FALLBACK_PLAYING") {
      this.emit("stop_fallback");
      this.transitionLaneOwner("fallback", "none", "user_barge_in");
    }

    // Clear the response cycle guard - barge-in cancels current cycle
    this.responseInProgress = false;

    // Return to listening
    if (this.state !== "IDLE" && this.state !== "ENDED") {
      this.transition("LISTENING", "user_barge_in");
    }
  }

  /**
   * Handle policy cancel - stops any playing audio and triggers fallback.
   */
  onPolicyCancel(): void {
    console.log(`[LaneArbitrator] Policy cancel during ${this.state}`);

    this.clearTimers();

    if (this.state === "FALLBACK_PLAYING") {
      console.log(
        `[LaneArbitrator] Policy cancel ignored - fallback already playing`,
      );
      this.suppressLaneBDone = true;
      this.emit("stop_lane_b");
      return;
    }

    const previousOwner = this.getCurrentOwner();

    if (this.state === "A_PLAYING") {
      this.emit("stop_reflex");
    }

    if (
      this.state === "B_PLAYING" ||
      this.state === "B_RESPONDING" ||
      this.state === "A_PLAYING"
    ) {
      this.suppressLaneBDone = true;
      this.emit("stop_lane_b");
    }

    // Move to fallback playback
    if (this.state !== "IDLE" && this.state !== "ENDED") {
      this.transitionLaneOwner(previousOwner, "fallback", "policy_cancel");
      this.transition("FALLBACK_PLAYING", "policy_cancel");
      this.responseInProgress = true;
      this.emit("play_fallback");
    }
  }

  /**
   * Handle fallback completion - return to listening state.
   */
  onFallbackComplete(): void {
    console.log(`[LaneArbitrator] Fallback playback complete`);

    if (this.getCurrentOwner() === "fallback") {
      this.transitionLaneOwner("fallback", "none", "response_done");
    }

    if (this.state !== "IDLE" && this.state !== "ENDED") {
      this.transition("LISTENING", "response_done");
    }

    this.responseInProgress = false;
    this.suppressLaneBDone = false;
    this.emit("response_complete");
  }

  /**
   * Transition to a new state
   */
  private transition(
    newState: ArbitratorState,
    cause:
      | LaneTransitionCause
      | "session_start"
      | "session_end"
      | "user_speech_ended",
  ): void {
    const oldState = this.state;
    this.state = newState;

    const transition: StateTransition = {
      from: oldState,
      to: newState,
      cause,
      timestamp: Date.now(),
    };

    this.stateHistory.push(transition);
    console.log(
      `[LaneArbitrator] ${oldState} -> ${newState} (cause: ${cause})`,
    );

    this.logAuditEvent("arbitration.state.transition", {
      from: oldState,
      to: newState,
      trigger: cause,
    });

    this.emit("state_change", transition);
  }

  /**
   * Emit lane ownership change event
   */
  private transitionLaneOwner(
    from: Lane,
    to: Lane,
    cause: LaneTransitionCause,
  ): void {
    const event: LaneOwnerChangedEvent = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "orchestrator",
      type: "lane.owner_changed",
      payload: { from, to, cause },
    };

    eventBus.emit(event);
    this.emit("owner_change", { from, to, cause });
    console.log(`[LaneArbitrator] Lane owner: ${from} -> ${to} (${cause})`);

    this.logAuditEvent("arbitration.owner.transition", {
      from,
      to,
      trigger: cause,
    });
  }

  private logAuditEvent(
    type: "arbitration.state.transition" | "arbitration.owner.transition",
    payload: { from: string; to: string; trigger: string },
  ) {
    if (!this.auditTrail) return;

    const event: ArbitratorAuditEvent = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "orchestrator",
      type,
      payload,
    };
    this.auditTrail.log(event);
  }

  /**
   * Clear all pending timers
   */
  private clearTimers(): void {
    if (this.reflexTimer) {
      clearTimeout(this.reflexTimer);
      this.reflexTimer = null;
    }
    if (this.reflexTimeoutTimer) {
      clearTimeout(this.reflexTimeoutTimer);
      this.reflexTimeoutTimer = null;
    }
  }

  /**
   * Get state history for debugging
   */
  getStateHistory(): StateTransition[] {
    return [...this.stateHistory];
  }

  /**
   * Get timing metrics
   */
  getMetrics(): {
    speechEndTime: number | null;
    bReadyTime: number | null;
    latencyMs: number | null;
  } {
    return {
      speechEndTime: this.speechEndTime,
      bReadyTime: this.bReadyTime,
      latencyMs:
        this.speechEndTime && this.bReadyTime
          ? this.bReadyTime - this.speechEndTime
          : null,
    };
  }
}
