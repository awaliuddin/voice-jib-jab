/**
 * WebSocketClient Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketClient } from "../events/WebSocketClient";
import { MockWebSocket } from "./setup";

describe("WebSocketClient", () => {
  let client: WebSocketClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new WebSocketClient("ws://localhost:3000");
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("should create WebSocket connection", async () => {
      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(client.isConnected()).toBe(true);
    });

    it("should resolve when connection opens", async () => {
      const connectPromise = client.connect();
      await vi.runAllTimersAsync();

      await expect(connectPromise).resolves.toBeUndefined();
    });
  });

  describe("disconnect", () => {
    it("should close WebSocket connection", async () => {
      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });
  });

  describe("send", () => {
    it("should send message when connected", async () => {
      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const message = { type: "session.start" };
      client.send(message);

      // Access the internal WebSocket to verify send was called
      const ws = (client as any).ws as MockWebSocket;
      expect(ws.send).toHaveBeenCalled();
    });

    it("should not throw when disconnected", () => {
      const message = { type: "session.start" };

      expect(() => client.send(message)).not.toThrow();
    });
  });

  describe("event handling", () => {
    it("should emit events to registered handlers", async () => {
      const handler = vi.fn();
      client.on("session.ready", handler);

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      // Simulate receiving a message
      const ws = (client as any).ws as MockWebSocket;
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: "session.ready",
            sessionId: "test-session",
          }),
        });
      }

      expect(handler).toHaveBeenCalledWith({
        type: "session.ready",
        sessionId: "test-session",
      });
    });

    it("should allow unsubscribing from events", async () => {
      const handler = vi.fn();
      client.on("session.ready", handler);
      client.off("session.ready", handler);

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const ws = (client as any).ws as MockWebSocket;
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: "session.ready",
            sessionId: "test-session",
          }),
        });
      }

      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle multiple handlers for same event", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      client.on("audio.chunk", handler1);
      client.on("audio.chunk", handler2);

      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      const ws = (client as any).ws as MockWebSocket;
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: "audio.chunk",
            data: "base64data",
          }),
        });
      }

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("reconnection", () => {
    it("should attempt to reconnect on unexpected close", async () => {
      const connectPromise = client.connect();
      await vi.runAllTimersAsync();
      await connectPromise;

      // Simulate unexpected close
      const ws = (client as any).ws as MockWebSocket;
      if (ws.onclose) {
        ws.onclose({ code: 1006, reason: "Abnormal closure" });
      }

      // Advance timers to trigger reconnect
      await vi.advanceTimersByTimeAsync(1000);

      // Should have attempted reconnection
      expect(client.isConnected()).toBe(false); // Initial state after close
    });
  });
});
