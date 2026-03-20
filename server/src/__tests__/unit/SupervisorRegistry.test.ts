/**
 * Unit tests for SupervisorRegistry
 */

jest.unmock("ws");

import { WebSocket } from "ws";
import {
  SupervisorRegistry,
  supervisorRegistry,
} from "../../services/SupervisorRegistry.js";

// -- Mock WebSocket helper --------------------------------------------------

const WS_OPEN = 1;

function makeMockWs(readyState: number = WS_OPEN): WebSocket {
  return { readyState, send: jest.fn() } as unknown as WebSocket;
}

// -- Tests ------------------------------------------------------------------

describe("SupervisorRegistry", () => {
  let registry: SupervisorRegistry;

  beforeEach(() => {
    registry = new SupervisorRegistry();
  });

  // -- addSupervisor --------------------------------------------------------

  it("addSupervisor() creates SupervisorInfo with uuid and watchingSessionId=null", () => {
    const ws = makeMockWs();
    const info = registry.addSupervisor(ws);

    expect(info.ws).toBe(ws);
    expect(info.supervisorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(info.watchingSessionId).toBeNull();
    expect(info.connectedAt).toBeDefined();
  });

  it("addSupervisor() called twice creates two distinct supervisors", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    registry.addSupervisor(ws1);
    registry.addSupervisor(ws2);

    expect(registry.listSupervisors()).toHaveLength(2);
  });

  // -- removeSupervisor -----------------------------------------------------

  it("removeSupervisor() removes from internal map", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.removeSupervisor(ws);

    expect(registry.getSupervisor(ws)).toBeUndefined();
    expect(registry.listSupervisors()).toHaveLength(0);
  });

  it("removeSupervisor() cleans up session watcher set if was watching", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-1");
    expect(registry.getWatcherCount("session-1")).toBe(1);

    registry.removeSupervisor(ws);
    expect(registry.getWatcherCount("session-1")).toBe(0);
  });

  // -- getSupervisor --------------------------------------------------------

  it("getSupervisor() returns correct info for known ws", () => {
    const ws = makeMockWs();
    const info = registry.addSupervisor(ws);

    expect(registry.getSupervisor(ws)).toBe(info);
  });

  it("getSupervisor() returns undefined for unknown ws", () => {
    const ws = makeMockWs();
    expect(registry.getSupervisor(ws)).toBeUndefined();
  });

  // -- watch ----------------------------------------------------------------

  it("watch() sets watchingSessionId on supervisor info", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-42");

    expect(registry.getSupervisor(ws)!.watchingSessionId).toBe("session-42");
  });

  it("watch() adds ws to sessionWatchers map", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-42");

    expect(registry.getWatcherCount("session-42")).toBe(1);
  });

  it("watch() twice with different sessions only watches the latest", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-1");
    registry.watch(ws, "session-2");

    expect(registry.getSupervisor(ws)!.watchingSessionId).toBe("session-2");
    expect(registry.getWatcherCount("session-1")).toBe(0);
    expect(registry.getWatcherCount("session-2")).toBe(1);
  });

  // -- unwatch --------------------------------------------------------------

  it("unwatch() sets watchingSessionId back to null", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-1");
    registry.unwatch(ws);

    expect(registry.getSupervisor(ws)!.watchingSessionId).toBeNull();
  });

  // -- getWatcherCount ------------------------------------------------------

  it("getWatcherCount() returns 0 for session with no watchers", () => {
    expect(registry.getWatcherCount("nonexistent")).toBe(0);
  });

  it("getWatcherCount() returns correct count with multiple watchers", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    registry.addSupervisor(ws1);
    registry.addSupervisor(ws2);
    registry.watch(ws1, "session-1");
    registry.watch(ws2, "session-1");

    expect(registry.getWatcherCount("session-1")).toBe(2);
  });

  // -- broadcast ------------------------------------------------------------

  it("broadcast() sends JSON payload to supervisor watching the session", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-1");

    const payload = { type: "event", data: "test" };
    registry.broadcast("session-1", payload);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it("broadcast() does NOT send to supervisor watching a different session", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws);
    registry.watch(ws, "session-2");

    registry.broadcast("session-1", { type: "event" });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("broadcast() skips closed ws (readyState !== OPEN)", () => {
    const ws = makeMockWs(3 /* CLOSED */);
    registry.addSupervisor(ws);
    registry.watch(ws, "session-1");

    registry.broadcast("session-1", { type: "event" });

    expect(ws.send).not.toHaveBeenCalled();
  });

  // -- whisper --------------------------------------------------------------

  it("setWhisperHandler() + dispatchWhisper() calls handler and returns its result", () => {
    const handler = jest.fn().mockReturnValue(true);
    registry.setWhisperHandler(handler);

    const result = registry.dispatchWhisper("session-1", "help the user");

    expect(handler).toHaveBeenCalledWith("session-1", "help the user");
    expect(result).toBe(true);
  });

  it("dispatchWhisper() returns false when no handler is registered", () => {
    const result = registry.dispatchWhisper("session-1", "hello");
    expect(result).toBe(false);
  });

  // -- listSupervisors ------------------------------------------------------

  it("listSupervisors() returns all connected supervisors", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    const ws3 = makeMockWs();
    const info1 = registry.addSupervisor(ws1);
    const info2 = registry.addSupervisor(ws2);
    const info3 = registry.addSupervisor(ws3);

    const list = registry.listSupervisors();
    expect(list).toHaveLength(3);
    expect(list).toContain(info1);
    expect(list).toContain(info2);
    expect(list).toContain(info3);
  });

  // -- Early-return branch coverage -----------------------------------------

  it("removeSupervisor() with unknown ws is a no-op", () => {
    const unknown = makeMockWs();
    expect(() => registry.removeSupervisor(unknown)).not.toThrow();
  });

  it("watch() with unknown ws is a no-op", () => {
    const unknown = makeMockWs();
    expect(() => registry.watch(unknown, "session-x")).not.toThrow();
  });

  it("unwatch() when supervisor is not watching any session is a no-op", () => {
    const ws = makeMockWs();
    registry.addSupervisor(ws); // watchingSessionId starts as null
    expect(() => registry.unwatch(ws)).not.toThrow();
  });

  it("unwatch() with unknown ws is a no-op", () => {
    const unknown = makeMockWs();
    expect(() => registry.unwatch(unknown)).not.toThrow();
  });

  // -- Module singleton -----------------------------------------------------

  it("module-level supervisorRegistry export is a SupervisorRegistry instance", () => {
    expect(supervisorRegistry).toBeInstanceOf(SupervisorRegistry);
  });
});
