/**
 * Session Manager - handles session lifecycle and state
 */

import { v4 as uuidv4 } from 'uuid';
import { eventBus } from './EventBus.js';
import { Event } from '../schemas/events.js';

export interface Session {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  state: 'idle' | 'listening' | 'responding' | 'ended';
  metadata: Record<string, unknown>;
}

export class SessionManager {
  private sessions: Map<string, Session>;
  private sessionTimeouts: Map<string, NodeJS.Timeout>;
  private readonly maxIdleTimeMs: number;

  constructor(maxIdleTimeMinutes: number = 30) {
    this.sessions = new Map();
    this.sessionTimeouts = new Map();
    this.maxIdleTimeMs = maxIdleTimeMinutes * 60 * 1000;
  }

  /**
   * Create a new session
   */
  createSession(metadata: Record<string, unknown> = {}): Session {
    const session: Session = {
      id: uuidv4(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      state: 'idle',
      metadata,
    };

    this.sessions.set(session.id, session);
    this.setupSessionTimeout(session.id);

    // Emit session start event
    const event: Event = {
      event_id: uuidv4(),
      session_id: session.id,
      t_ms: Date.now(),
      source: 'orchestrator',
      type: 'session.start',
      payload: { metadata },
    };
    eventBus.emit(event);

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session state
   */
  updateSessionState(sessionId: string, state: Session['state']): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.state = state;
    session.lastActivityAt = Date.now();

    // Reset timeout
    this.setupSessionTimeout(sessionId);
  }

  /**
   * Touch session to update last activity
   */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      this.setupSessionTimeout(sessionId);
    }
  }

  /**
   * End session
   */
  endSession(sessionId: string, reason: string = 'user_ended'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.state = 'ended';

    // Clear timeout
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    // Emit session end event
    const event: Event = {
      event_id: uuidv4(),
      session_id: sessionId,
      t_ms: Date.now(),
      source: 'orchestrator',
      type: 'session.end',
      payload: { reason, duration_ms: Date.now() - session.createdAt },
    };
    eventBus.emit(event);

    // Clean up event handlers
    eventBus.offSession(sessionId);

    // Remove session after delay to allow cleanup
    setTimeout(() => {
      this.sessions.delete(sessionId);
    }, 5000);
  }

  /**
   * Setup automatic session timeout
   */
  private setupSessionTimeout(sessionId: string): void {
    // Clear existing timeout
    const existing = this.sessionTimeouts.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      this.endSession(sessionId, 'timeout');
    }, this.maxIdleTimeMs);

    this.sessionTimeouts.set(sessionId, timeout);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.state !== 'ended'
    );
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
