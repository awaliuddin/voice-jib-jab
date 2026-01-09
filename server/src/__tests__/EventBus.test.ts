/**
 * EventBus Unit Tests
 */

import { EventBus } from "../orchestrator/EventBus.js";
import { SessionEvent, AudioEvent } from "../schemas/events.js";

describe("EventBus", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  const createSessionEvent = (sessionId: string): SessionEvent => ({
    event_id: "evt-1",
    session_id: sessionId,
    t_ms: Date.now(),
    source: "orchestrator",
    type: "session.start",
    payload: {},
  });

  const createAudioEvent = (sessionId: string): AudioEvent => ({
    event_id: "evt-2",
    session_id: sessionId,
    t_ms: Date.now(),
    source: "client",
    type: "audio.chunk",
    payload: {
      data: Buffer.from("test"),
      format: "pcm",
      sample_rate: 24000,
    },
  });

  describe("on/emit", () => {
    it("should call handler when event is emitted", () => {
      const handler = jest.fn();
      eventBus.on("session.start", handler);

      const event = createSessionEvent("test-session");
      eventBus.emit(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should call multiple handlers for same event type", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.on("session.start", handler1);
      eventBus.on("session.start", handler2);

      const event = createSessionEvent("test-session");
      eventBus.emit(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it("should not call handler for different event type", () => {
      const handler = jest.fn();
      eventBus.on("session.end", handler);

      const event = createSessionEvent("test-session");
      eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("off", () => {
    it("should remove handler", () => {
      const handler = jest.fn();
      eventBus.on("session.start", handler);
      eventBus.off("session.start", handler);

      const event = createSessionEvent("test-session");
      eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not affect other handlers", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.on("session.start", handler1);
      eventBus.on("session.start", handler2);
      eventBus.off("session.start", handler1);

      const event = createSessionEvent("test-session");
      eventBus.emit(event);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(event);
    });
  });

  describe("onSession", () => {
    it("should call handler only for matching session", () => {
      const handler = jest.fn();
      eventBus.onSession("session-1", handler);

      const event1 = createSessionEvent("session-1");
      const event2 = createSessionEvent("session-2");

      eventBus.emit(event1);
      eventBus.emit(event2);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event1);
    });
  });

  describe("getEventCount", () => {
    it("should return 0 when no handlers registered", () => {
      expect(eventBus.getEventCount("session.start")).toBe(0);
    });

    it("should return count of handlers for event type", () => {
      eventBus.on("session.start", jest.fn());
      eventBus.on("session.start", jest.fn());

      expect(eventBus.getEventCount("session.start")).toBe(2);
    });

    it("should return total count when no type specified", () => {
      eventBus.on("session.start", jest.fn());
      eventBus.on("session.end", jest.fn());

      expect(eventBus.getEventCount()).toBe(2);
    });
  });

  describe("event types", () => {
    it("should handle audio.chunk events", () => {
      const handler = jest.fn();
      eventBus.on("audio.chunk", handler);

      const event = createAudioEvent("test-session");
      eventBus.emit(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });
});
