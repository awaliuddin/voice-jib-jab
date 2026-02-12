/**
 * Lane C - Control Engine
 *
 * Emits policy decisions and validates required disclaimers.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../orchestrator/EventBus.js";
import { PolicyDecisionPayload, PolicyEvent } from "../schemas/events.js";
import { lookupDisclaimer } from "../retrieval/DisclaimerLookup.js";

export class LaneC extends EventEmitter {
  private sessionId: string;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  /**
   * Emit a policy decision event.
   * If a required disclaimer is missing, it is dropped with a warning.
   */
  emitPolicyDecision(payload: PolicyDecisionPayload): void {
    const sanitizedPayload: PolicyDecisionPayload = { ...payload };

    if (sanitizedPayload.required_disclaimer_id) {
      const text = lookupDisclaimer(sanitizedPayload.required_disclaimer_id);
      if (!text) {
        console.warn(
          `[LaneC] Missing disclaimer id: ${sanitizedPayload.required_disclaimer_id}`,
        );
        sanitizedPayload.required_disclaimer_id = undefined;
      }
    }

    const event: PolicyEvent = {
      event_id: uuidv4(),
      session_id: this.sessionId,
      t_ms: Date.now(),
      source: "laneC",
      type: "policy.decision",
      payload: sanitizedPayload,
    };

    eventBus.emit(event);
    this.emit("policy.decision", event);
  }
}
