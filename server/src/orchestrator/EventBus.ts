/**
 * Event Bus for coordinating events across lanes and modules
 */

import { Event } from "../schemas/events.js";
import { EventEmitter } from "events";

type EventHandler = (event: Event) => void | Promise<void>;

export class EventBus {
  private emitter: EventEmitter;
  private handlers: Map<string, Set<EventHandler>>;
  private sessionHandlers: Map<string, Set<EventHandler>>;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Support many concurrent sessions
    this.handlers = new Map();
    this.sessionHandlers = new Map();
  }

  /**
   * Subscribe to events by type
   */
  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    this.emitter.on(eventType, handler);
  }

  /**
   * Subscribe to events by type pattern (wildcard support)
   */
  onPattern(pattern: string, handler: EventHandler): void {
    const regex = new RegExp("^" + pattern.replace("*", ".*") + "$");

    this.emitter.on("*", (event: Event) => {
      if (regex.test(event.type)) {
        handler(event);
      }
    });
  }

  /**
   * Subscribe to all events for a session
   */
  onSession(sessionId: string, handler: EventHandler): void {
    const wrappedHandler = (event: Event) => {
      if (event.session_id === sessionId) {
        handler(event);
      }
    };

    if (!this.sessionHandlers.has(sessionId)) {
      this.sessionHandlers.set(sessionId, new Set());
    }
    this.sessionHandlers.get(sessionId)!.add(wrappedHandler);

    this.emitter.on("*", wrappedHandler);
  }

  /**
   * Emit an event
   */
  emit(event: Event): void {
    // Emit to type-specific handlers
    this.emitter.emit(event.type, event);

    // Emit to wildcard handlers
    this.emitter.emit("*", event);
  }

  /**
   * Remove handler
   */
  off(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      this.emitter.off(eventType, handler);
    }
  }

  /**
   * Remove all handlers for a session
   */
  offSession(sessionId: string): void {
    const handlers = this.sessionHandlers.get(sessionId);
    if (handlers) {
      for (const handler of handlers) {
        this.emitter.off("*", handler);
      }
      this.sessionHandlers.delete(sessionId);
    }
  }

  /**
   * Get event count for monitoring
   */
  getEventCount(eventType?: string): number {
    if (eventType) {
      const handlers = this.handlers.get(eventType);
      return handlers ? handlers.size : 0;
    }
    let total = 0;
    for (const handlers of this.handlers.values()) {
      total += handlers.size;
    }
    return total;
  }
}

// Singleton instance
export const eventBus = new EventBus();
