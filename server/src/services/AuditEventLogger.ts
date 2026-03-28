import { EventEmitter } from "events";
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/** Categorized audit event types for SOC 2 compliance logging. */
export type AuditEventType =
  | "api_key_created"
  | "api_key_revoked"
  | "api_key_used"
  | "api_key_rejected"
  | "session_started"
  | "session_ended"
  | "policy_decision"
  | "rate_limit_exceeded"
  | "escalation_triggered";

/** Immutable audit event record with unique ID and ISO timestamp. */
export interface AuditEvent {
  eventId: string;
  timestamp: string;
  type: AuditEventType;
  tenantId?: string;
  sessionId?: string;
  detail: Record<string, unknown>;
}

/** Filter criteria for querying the audit event buffer. */
export interface AuditQueryFilters {
  tenantId?: string;
  type?: AuditEventType;
  from?: string; // ISO timestamp
  to?: string;   // ISO timestamp
  limit?: number;
}

const RING_BUFFER_MAX = 500;

/** File-backed ring-buffer audit logger with real-time SSE event emission. */
export class AuditEventLogger {
  private readonly filePath: string;
  private readonly emitter = new EventEmitter();
  private readonly buffer: AuditEvent[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.loadFromFile();
    this.emitter.setMaxListeners(100);
  }

  private loadFromFile(): void {
    try {
      const lines = readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          this.buffer.push(JSON.parse(line) as AuditEvent);
        } catch {
          // skip malformed lines
        }
      }
      // Keep only last RING_BUFFER_MAX from file
      if (this.buffer.length > RING_BUFFER_MAX) {
        this.buffer.splice(0, this.buffer.length - RING_BUFFER_MAX);
      }
    } catch {
      // File does not exist yet — start empty
    }
  }

  log(input: Omit<AuditEvent, "eventId" | "timestamp">): AuditEvent {
    const event: AuditEvent = {
      eventId: randomBytes(12).toString("hex"),
      timestamp: new Date().toISOString(),
      ...input,
    };
    // Append to file (JSON Lines format)
    try {
      appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
    } catch {
      // Degrade gracefully — continue in-memory only
    }
    // Ring buffer eviction
    this.buffer.push(event);
    if (this.buffer.length > RING_BUFFER_MAX) {
      this.buffer.shift();
    }
    // Notify SSE subscribers
    this.emitter.emit("event", event);
    return event;
  }

  query(filters: AuditQueryFilters = {}): AuditEvent[] {
    let results = [...this.buffer];
    if (filters.tenantId !== undefined) {
      results = results.filter((e) => e.tenantId === filters.tenantId);
    }
    if (filters.type !== undefined) {
      results = results.filter((e) => e.type === filters.type);
    }
    if (filters.from !== undefined) {
      const fromTs = new Date(filters.from).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= fromTs);
    }
    if (filters.to !== undefined) {
      const toTs = new Date(filters.to).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= toTs);
    }
    if (filters.limit !== undefined && filters.limit > 0) {
      results = results.slice(-filters.limit);
    }
    return results;
  }

  getRecent(n: number): AuditEvent[] {
    if (n <= 0) return [];
    return this.buffer.slice(-n);
  }

  on(event: "event", listener: (ev: AuditEvent) => void): void {
    this.emitter.on(event, listener);
  }

  off(event: "event", listener: (ev: AuditEvent) => void): void {
    this.emitter.off(event, listener);
  }
}
