/**
 * SupervisorRegistry — Manages supervisor WebSocket connections and their
 * session watch subscriptions.
 *
 * Supervisors can watch a single voice session at a time, receiving
 * broadcast events for that session. They can also dispatch whisper
 * messages into active sessions via a registered handler.
 */

import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

// -- Types ------------------------------------------------------------------

/** Metadata for a connected supervisor including their active watch subscription. */
export interface SupervisorInfo {
  ws: WebSocket;
  supervisorId: string;
  watchingSessionId: string | null;
  connectedAt: string;
}

/** Callback that injects a whisper message into an active voice session. */
export type WhisperHandler = (sessionId: string, message: string) => boolean;

// -- SupervisorRegistry -----------------------------------------------------

/** Manages supervisor WebSocket connections and session watch subscriptions. */
export class SupervisorRegistry {
  private supervisors = new Map<WebSocket, SupervisorInfo>();
  private sessionWatchers = new Map<string, Set<WebSocket>>();
  private whisperHandler: WhisperHandler | null = null;

  /** Register a new supervisor connection and return its info. */
  addSupervisor(ws: WebSocket): SupervisorInfo {
    const info: SupervisorInfo = {
      ws,
      supervisorId: uuidv4(),
      watchingSessionId: null,
      connectedAt: new Date().toISOString(),
    };
    this.supervisors.set(ws, info);
    return info;
  }

  /** Remove a supervisor on disconnect, cleaning up any watch subscription. */
  removeSupervisor(ws: WebSocket): void {
    const info = this.supervisors.get(ws);
    if (!info) return;

    if (info.watchingSessionId) {
      this.removeFromWatcherSet(info.watchingSessionId, ws);
    }
    this.supervisors.delete(ws);
  }

  /** Subscribe a supervisor to a session's event stream. */
  watch(supervisorWs: WebSocket, sessionId: string): void {
    const info = this.supervisors.get(supervisorWs);
    if (!info) return;

    // Unwatch previous session if already watching one
    if (info.watchingSessionId) {
      this.removeFromWatcherSet(info.watchingSessionId, supervisorWs);
    }

    info.watchingSessionId = sessionId;
    this.getOrCreateWatcherSet(sessionId).add(supervisorWs);
  }

  /** Unsubscribe a supervisor from its current session. */
  unwatch(supervisorWs: WebSocket): void {
    const info = this.supervisors.get(supervisorWs);
    if (!info || !info.watchingSessionId) return;

    this.removeFromWatcherSet(info.watchingSessionId, supervisorWs);
    info.watchingSessionId = null;
  }

  /** Get supervisor info for a WebSocket connection. */
  getSupervisor(ws: WebSocket): SupervisorInfo | undefined {
    return this.supervisors.get(ws);
  }

  /**
   * Broadcast a JSON payload to all supervisors watching a specific session.
   * Skips connections whose readyState is not OPEN.
   */
  broadcast(sessionId: string, payload: Record<string, unknown>): void {
    const watchers = this.sessionWatchers.get(sessionId);
    if (!watchers) return;

    const message = JSON.stringify(payload);
    for (const ws of watchers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /** Register the handler that injects whispers into voice sessions. */
  setWhisperHandler(handler: WhisperHandler): void {
    this.whisperHandler = handler;
  }

  /**
   * Dispatch a whisper via the registered handler.
   * Returns false if no handler is registered or the handler returns false.
   */
  dispatchWhisper(sessionId: string, message: string): boolean {
    if (!this.whisperHandler) return false;
    return this.whisperHandler(sessionId, message);
  }

  /** List all active supervisor infos. */
  listSupervisors(): SupervisorInfo[] {
    return Array.from(this.supervisors.values());
  }

  /** Get count of supervisors watching a specific session. */
  getWatcherCount(sessionId: string): number {
    const watchers = this.sessionWatchers.get(sessionId);
    return watchers ? watchers.size : 0;
  }

  // -- Private helpers ------------------------------------------------------

  private getOrCreateWatcherSet(sessionId: string): Set<WebSocket> {
    let set = this.sessionWatchers.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessionWatchers.set(sessionId, set);
    }
    return set;
  }

  private removeFromWatcherSet(sessionId: string, ws: WebSocket): void {
    const set = this.sessionWatchers.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.sessionWatchers.delete(sessionId);
    }
  }
}

/** Module-level singleton shared across the application. */
export const supervisorRegistry = new SupervisorRegistry();
