/**
 * Supervisor API — HTTP + WebSocket endpoints for supervisor dashboard.
 *
 * Supervisors connect via WebSocket at /supervisor to watch live voice
 * sessions, receive broadcast events, and send whisper messages to agents.
 * An HTTP router provides a REST endpoint for listing active sessions.
 */

import { WebSocketServer, WebSocket } from "ws";
import { Router } from "express";
import type { SupervisorRegistry } from "../services/SupervisorRegistry.js";
import type { SessionManager } from "../orchestrator/SessionManager.js";

// -- HTTP Router ------------------------------------------------------------

/** Create an Express router for supervisor dashboard REST endpoints. */
export function createSupervisorRouter(
  registry: SupervisorRegistry,
  sessionManager: SessionManager,
): Router {
  const router = Router();

  /** GET /supervisor/sessions — list active sessions with watcher counts. */
  router.get("/supervisor/sessions", (_req, res) => {
    const sessions = sessionManager.getActiveSessions().map((s) => ({
      sessionId: s.id,
      state: s.state,
      uptimeMs: Date.now() - s.createdAt,
      watcherCount: registry.getWatcherCount(s.id),
    }));
    res.json(sessions);
  });

  return router;
}

// -- WebSocket Server -------------------------------------------------------

/** WebSocket server for supervisor real-time connections. */
export class SupervisorWebSocketServer {
  private wss: WebSocketServer;
  private registry: SupervisorRegistry;
  private sessionManager: SessionManager;

  constructor(registry: SupervisorRegistry, sessionManager: SessionManager) {
    this.registry = registry;
    this.sessionManager = sessionManager;
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (ws: WebSocket) => {
      this.handleConnection(ws);
    });
  }

  /** Close all supervisor WebSocket connections and shut down the server. */
  close(callback?: (err?: Error) => void): void {
    for (const client of this.wss.clients) {
      client.close(1001, "Server shutting down");
    }
    this.wss.close(callback);
  }

  /** Call from server 'upgrade' handler when path is '/supervisor'. */
  handleUpgrade(request: any, socket: any, head: any): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws);
    });
  }

  /** Handle a new supervisor WebSocket connection. */
  private handleConnection(ws: WebSocket): void {
    const info = this.registry.addSupervisor(ws);

    this.send(ws, {
      type: "supervisor.connected",
      supervisorId: info.supervisorId,
    });

    ws.on("message", (raw: Buffer | string) => {
      this.handleMessage(ws, raw);
    });

    ws.on("close", () => {
      this.registry.removeSupervisor(ws);
    });
  }

  /** Handle an incoming supervisor message. */
  private handleMessage(ws: WebSocket, raw: Buffer | string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      this.send(ws, { type: "supervisor.error", error: "Invalid JSON" });
      return;
    }

    switch (parsed.type) {
      case "supervisor.list_sessions":
        this.handleListSessions(ws);
        break;
      case "supervisor.join":
        this.handleJoin(ws, parsed.sessionId);
        break;
      case "supervisor.leave":
        this.handleLeave(ws);
        break;
      case "supervisor.whisper":
        this.handleWhisper(ws, parsed.sessionId, parsed.message);
        break;
      default:
        this.send(ws, {
          type: "supervisor.error",
          error: "Unknown message type",
        });
    }
  }

  private handleListSessions(ws: WebSocket): void {
    const sessions = this.sessionManager.getActiveSessions().map((s) => ({
      sessionId: s.id,
      state: s.state,
      uptimeMs: Date.now() - s.createdAt,
      watcherCount: this.registry.getWatcherCount(s.id),
    }));
    this.send(ws, { type: "supervisor.sessions", sessions });
  }

  private handleJoin(ws: WebSocket, sessionId: string): void {
    this.registry.watch(ws, sessionId);
    this.send(ws, { type: "supervisor.joined", sessionId });
  }

  private handleLeave(ws: WebSocket): void {
    this.registry.unwatch(ws);
    this.send(ws, { type: "supervisor.left" });
  }

  private handleWhisper(
    ws: WebSocket,
    sessionId: string,
    message: string,
  ): void {
    const delivered = this.registry.dispatchWhisper(sessionId, message);
    this.send(ws, {
      type: "supervisor.whisper_sent",
      sessionId,
      delivered,
    });
  }

  /** Send a JSON payload to a WebSocket connection. */
  private send(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
