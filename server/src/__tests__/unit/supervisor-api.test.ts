/**
 * Unit tests for supervisor API — HTTP router + SupervisorWebSocketServer.
 *
 * REST tests use an Express app served over a plain Node http.Server (no
 * supertest) following the same pattern as health-api.test.ts and
 * validate-api.test.ts.
 *
 * WebSocket tests mock the `ws` module entirely so that no real sockets are
 * opened. A fake WebSocketServer records event handlers registered by the
 * implementation and lets tests invoke them directly.
 */

// ── ws mock (must appear before any import that touches "ws") ──────────────

// Constants mirroring ws.WebSocket.OPEN / .CLOSED
const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Fake WebSocket — records event handlers and captures sent payloads. */
function makeMockWs(readyState: number = WS_OPEN) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    readyState,
    send: jest.fn(),
    close: jest.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    },
    /** Test helper — fire a registered event listener. */
    emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
  };
}

type MockWs = ReturnType<typeof makeMockWs>;

/** Fake WebSocketServer — captures connection/upgrade handlers. */
class FakeWebSocketServer {
  clients: Set<MockWs> = new Set();
  private eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  handleUpgrade = jest.fn(
    (
      _req: unknown,
      _socket: unknown,
      _head: unknown,
      cb: (ws: MockWs) => void,
    ) => {
      const ws = makeMockWs();
      this.clients.add(ws);
      cb(ws);
    },
  );
  close = jest.fn((cb?: (err?: Error) => void) => {
    cb?.();
  });
  emit(event: string, ...args: unknown[]) {
    (this.eventHandlers[event] ?? []).forEach((h) => h(...args));
  }
  on(event: string, handler: (...args: unknown[]) => void) {
    this.eventHandlers[event] = this.eventHandlers[event] ?? [];
    this.eventHandlers[event].push(handler);
  }
}

let fakeWss: FakeWebSocketServer;

// Capture the constructor call so tests can reach fakeWss.
const MockWebSocketServer = jest.fn().mockImplementation(() => {
  fakeWss = new FakeWebSocketServer();
  return fakeWss;
});

// The static OPEN constant used by supervisor.ts's send() method.
const MockWebSocket = { OPEN: WS_OPEN } as unknown;

jest.mock("ws", () => ({
  WebSocketServer: MockWebSocketServer,
  WebSocket: MockWebSocket,
}));

// ── Imports (after mock registration) ─────────────────────────────────────

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import {
  createSupervisorRouter,
  SupervisorWebSocketServer,
} from "../../api/supervisor.js";
import type { SupervisorRegistry } from "../../services/SupervisorRegistry.js";
import type { SessionManager } from "../../orchestrator/SessionManager.js";

// ── Mock factories ─────────────────────────────────────────────────────────

function makeMockRegistry() {
  return {
    addSupervisor: jest.fn().mockReturnValue({
      supervisorId: "sup-uuid-1234",
      ws: null,
      watchingSessionId: null,
      connectedAt: new Date().toISOString(),
    }),
    removeSupervisor: jest.fn(),
    watch: jest.fn(),
    unwatch: jest.fn(),
    getWatcherCount: jest.fn().mockReturnValue(0),
    dispatchWhisper: jest.fn().mockReturnValue(false),
  };
}

function makeMockSessionManager(sessions: { id: string; state: string; createdAt: number }[] = []) {
  return {
    getActiveSessions: jest.fn().mockReturnValue(sessions),
  };
}

function makeSession(id: string, state = "idle") {
  return { id, state, createdAt: Date.now() - 5000 };
}

// ── HTTP helper (GET) ──────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpGet(server: Server, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    import("http").then(({ default: http }) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: addr.port, path, method: "GET" },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            resolve({
              status: res.statusCode ?? 0,
              body: rawBody,
              json: () => JSON.parse(rawBody),
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

// ── REST Router tests ──────────────────────────────────────────────────────

describe("createSupervisorRouter() — GET /supervisor/sessions", () => {
  let server: Server;
  let registry: ReturnType<typeof makeMockRegistry>;
  let sessionManager: ReturnType<typeof makeMockSessionManager>;

  function buildApp(
    reg: ReturnType<typeof makeMockRegistry>,
    sm: ReturnType<typeof makeMockSessionManager>,
  ): Express {
    const app = express();
    app.use(express.json());
    app.use(
      "/",
      createSupervisorRouter(
        reg as unknown as SupervisorRegistry,
        sm as unknown as SessionManager,
      ),
    );
    return app;
  }

  beforeAll((done) => {
    registry = makeMockRegistry();
    sessionManager = makeMockSessionManager();
    server = createServer(buildApp(registry, sessionManager));
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200", async () => {
    sessionManager.getActiveSessions.mockReturnValue([]);
    const res = await httpGet(server, "/supervisor/sessions");
    expect(res.status).toBe(200);
  });

  it("returns an array", async () => {
    sessionManager.getActiveSessions.mockReturnValue([]);
    const res = await httpGet(server, "/supervisor/sessions");
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns empty array when no active sessions", async () => {
    sessionManager.getActiveSessions.mockReturnValue([]);
    const res = await httpGet(server, "/supervisor/sessions");
    expect(res.json()).toEqual([]);
  });

  it("calls sessionManager.getActiveSessions()", async () => {
    sessionManager.getActiveSessions.mockReturnValue([]);
    await httpGet(server, "/supervisor/sessions");
    expect(sessionManager.getActiveSessions).toHaveBeenCalledTimes(1);
  });

  it("returns session objects with sessionId, state, uptimeMs, watcherCount", async () => {
    const session = makeSession("sess-abc", "listening");
    sessionManager.getActiveSessions.mockReturnValue([session]);
    registry.getWatcherCount.mockReturnValue(2);

    const res = await httpGet(server, "/supervisor/sessions");
    const data = res.json() as Record<string, unknown>[];

    expect(data).toHaveLength(1);
    expect(data[0].sessionId).toBe("sess-abc");
    expect(data[0].state).toBe("listening");
    expect(typeof data[0].uptimeMs).toBe("number");
    expect(data[0].watcherCount).toBe(2);
  });

  it("calls registry.getWatcherCount() for each session", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    sessionManager.getActiveSessions.mockReturnValue(sessions);
    registry.getWatcherCount.mockReturnValue(0);

    await httpGet(server, "/supervisor/sessions");

    expect(registry.getWatcherCount).toHaveBeenCalledTimes(2);
    expect(registry.getWatcherCount).toHaveBeenCalledWith("s1");
    expect(registry.getWatcherCount).toHaveBeenCalledWith("s2");
  });

  it("uptimeMs is a non-negative number", async () => {
    const session = makeSession("sess-xyz");
    sessionManager.getActiveSessions.mockReturnValue([session]);
    registry.getWatcherCount.mockReturnValue(0);

    const res = await httpGet(server, "/supervisor/sessions");
    const data = res.json() as Record<string, unknown>[];

    expect((data[0].uptimeMs as number)).toBeGreaterThanOrEqual(0);
  });
});

// ── SupervisorWebSocketServer tests ───────────────────────────────────────

describe("SupervisorWebSocketServer", () => {
  let registry: ReturnType<typeof makeMockRegistry>;
  let sessionManager: ReturnType<typeof makeMockSessionManager>;
  let svr: SupervisorWebSocketServer;

  /** Trigger the 'connection' event on fakeWss and return the ws mock. */
  function connect(ws?: MockWs): MockWs {
    const sock = ws ?? makeMockWs();
    fakeWss.emit("connection", sock);
    return sock;
  }

  /** Parse the most recent ws.send() call as JSON. */
  function lastSent(ws: MockWs): Record<string, unknown> {
    const calls = (ws.send as jest.Mock).mock.calls;
    return JSON.parse(calls[calls.length - 1][0] as string) as Record<string, unknown>;
  }

  beforeEach(() => {
    MockWebSocketServer.mockClear();
    registry = makeMockRegistry();
    sessionManager = makeMockSessionManager();
    svr = new SupervisorWebSocketServer(
      registry as unknown as SupervisorRegistry,
      sessionManager as unknown as SessionManager,
    );
  });

  // -- Constructor -----------------------------------------------------------

  it("creates WebSocketServer with { noServer: true }", () => {
    expect(MockWebSocketServer).toHaveBeenCalledWith({ noServer: true });
  });

  // -- handleConnection ------------------------------------------------------

  it("handleConnection() calls registry.addSupervisor(ws)", () => {
    const ws = connect();
    expect(registry.addSupervisor).toHaveBeenCalledWith(ws);
  });

  it("handleConnection() sends supervisor.connected with supervisorId", () => {
    registry.addSupervisor.mockReturnValue({
      supervisorId: "id-abc",
      ws: null,
      watchingSessionId: null,
      connectedAt: new Date().toISOString(),
    });
    const ws = connect();
    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.connected");
    expect(msg.supervisorId).toBe("id-abc");
  });

  it("handleConnection() registers 'message' listener on ws", () => {
    // After connect, trigger a valid message to confirm the listener fires.
    const ws = connect();
    ws.emit("message", JSON.stringify({ type: "supervisor.list_sessions" }));
    expect(sessionManager.getActiveSessions).toHaveBeenCalled();
  });

  it("handleConnection() registers 'close' listener that calls registry.removeSupervisor(ws)", () => {
    const ws = connect();
    ws.emit("close");
    expect(registry.removeSupervisor).toHaveBeenCalledWith(ws);
  });

  // -- handleMessage() routing -----------------------------------------------

  it("supervisor.list_sessions → calls getActiveSessions and sends supervisor.sessions", () => {
    sessionManager.getActiveSessions.mockReturnValue([]);
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit("message", JSON.stringify({ type: "supervisor.list_sessions" }));

    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.sessions");
    expect(Array.isArray(msg.sessions)).toBe(true);
  });

  it("supervisor.join → calls registry.watch and sends supervisor.joined", () => {
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit("message", JSON.stringify({ type: "supervisor.join", sessionId: "sess-1" }));

    expect(registry.watch).toHaveBeenCalledWith(ws, "sess-1");
    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.joined");
    expect(msg.sessionId).toBe("sess-1");
  });

  it("supervisor.leave → calls registry.unwatch and sends supervisor.left", () => {
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit("message", JSON.stringify({ type: "supervisor.leave" }));

    expect(registry.unwatch).toHaveBeenCalledWith(ws);
    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.left");
  });

  it("supervisor.whisper → calls registry.dispatchWhisper and sends supervisor.whisper_sent", () => {
    registry.dispatchWhisper.mockReturnValue(true);
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit(
      "message",
      JSON.stringify({ type: "supervisor.whisper", sessionId: "sess-2", message: "help now" }),
    );

    expect(registry.dispatchWhisper).toHaveBeenCalledWith("sess-2", "help now");
    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.whisper_sent");
    expect(msg.delivered).toBe(true);
    expect(msg.sessionId).toBe("sess-2");
  });

  it("supervisor.whisper with delivered=false is forwarded correctly", () => {
    registry.dispatchWhisper.mockReturnValue(false);
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit(
      "message",
      JSON.stringify({ type: "supervisor.whisper", sessionId: "s3", message: "ping" }),
    );

    const msg = lastSent(ws);
    expect(msg.delivered).toBe(false);
  });

  it("unknown message type → sends supervisor.error with 'Unknown message type'", () => {
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit("message", JSON.stringify({ type: "supervisor.unknown_type" }));

    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.error");
    expect(msg.error).toBe("Unknown message type");
  });

  it("invalid JSON → sends supervisor.error with 'Invalid JSON'", () => {
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit("message", "{ not valid json !!!}");

    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.error");
    expect(msg.error).toBe("Invalid JSON");
  });

  it("Buffer message is parsed correctly (same as string)", () => {
    sessionManager.getActiveSessions.mockReturnValue([]);
    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    // Buffer.from produces a Buffer — real ws delivers raw as Buffer.
    ws.emit("message", Buffer.from(JSON.stringify({ type: "supervisor.list_sessions" })));

    const msg = lastSent(ws);
    expect(msg.type).toBe("supervisor.sessions");
  });

  // -- send() guard ----------------------------------------------------------

  it("send() does NOT call ws.send when readyState is CLOSED", () => {
    const closedWs = makeMockWs(WS_CLOSED);
    // Directly trigger a connection with a closed socket.
    fakeWss.emit("connection", closedWs);

    // The supervisor.connected message should NOT have been sent.
    expect(closedWs.send).not.toHaveBeenCalled();
  });

  // -- handleListSessions() payload detail -----------------------------------

  it("handleListSessions() includes session fields in sessions array", () => {
    const session = makeSession("sess-detail", "responding");
    sessionManager.getActiveSessions.mockReturnValue([session]);
    registry.getWatcherCount.mockReturnValue(3);

    const ws = connect();
    (ws.send as jest.Mock).mockClear();

    ws.emit("message", JSON.stringify({ type: "supervisor.list_sessions" }));

    const msg = lastSent(ws) as { type: string; sessions: Record<string, unknown>[] };
    expect(msg.sessions).toHaveLength(1);
    expect(msg.sessions[0].sessionId).toBe("sess-detail");
    expect(msg.sessions[0].state).toBe("responding");
    expect(msg.sessions[0].watcherCount).toBe(3);
    expect(typeof msg.sessions[0].uptimeMs).toBe("number");
  });

  // -- close() ---------------------------------------------------------------

  it("close() calls close() on each connected client", () => {
    const ws = makeMockWs();
    fakeWss.clients.add(ws);

    svr.close();

    expect(ws.close).toHaveBeenCalledWith(1001, "Server shutting down");
  });

  it("close() calls wss.close()", () => {
    svr.close();
    expect(fakeWss.close).toHaveBeenCalled();
  });

  it("close() forwards callback to wss.close()", () => {
    const cb = jest.fn();
    svr.close(cb);
    // FakeWebSocketServer immediately invokes the callback.
    expect(cb).toHaveBeenCalled();
  });

  // -- handleUpgrade() -------------------------------------------------------

  it("handleUpgrade() delegates to wss.handleUpgrade", () => {
    const req = {};
    const socket = {};
    const head = {};

    svr.handleUpgrade(req, socket, head);

    expect(fakeWss.handleUpgrade).toHaveBeenCalledWith(req, socket, head, expect.any(Function));
  });

  it("handleUpgrade() emits 'connection' on wss with the upgraded ws", () => {
    const emitSpy = jest.spyOn(fakeWss, "emit");

    svr.handleUpgrade({}, {}, {});

    expect(emitSpy).toHaveBeenCalledWith("connection", expect.anything());
  });
});
