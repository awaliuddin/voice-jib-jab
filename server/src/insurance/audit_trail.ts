/**
 * AuditTrail - append-only audit logging for control and session events.
 *
 * Persists selected events to both SQLite (if available) and append-only JSONL
 * files per session. Supports replaying timelines for transcripts, decisions,
 * and tool calls.
 */

import { eventBus } from "../orchestrator/EventBus.js";
import { getDatabase } from "../storage/Database.js";
import { Event } from "../schemas/events.js";
import { appendFile, mkdir } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { dirname, resolve, join } from "path";
import { createInterface } from "readline";

const BASE_EVENT_TYPES = new Set<string>([
  "control.audit",
  "control.override",
  "control.metrics",
  "policy.decision",
  "fallback.started",
  "fallback.completed",
  "tool.call",
  "tool.result",
  "rag.query",
  "rag.result",
]);

const TRANSCRIPT_EVENT_TYPES = new Set<string>([
  "transcript",
  "user_transcript",
  "transcript.final",
  "transcript.delta",
]);

const AUDIO_EVENT_TYPES = new Set<string>([
  "audio.chunk",
  "audio.start",
  "audio.end",
]);

const SESSION_EVENT_TYPES = new Set<string>([
  "session.start",
  "session.end",
  "session.error",
]);

const DEFAULT_TIMELINE_TYPES = new Set<string>([
  "transcript",
  "user_transcript",
  "transcript.final",
  "policy.decision",
  "control.override",
  "control.audit",
  "fallback.started",
  "fallback.completed",
  "tool.call",
  "tool.result",
]);

let defaultAuditDir: string | null = null;

export interface AuditTrailConfig {
  enabled: boolean;
  databasePath: string;
  walMode?: boolean;
  jsonlDir?: string;
  includeTranscripts?: boolean;
  includeTranscriptDeltas?: boolean;
  includeAudio?: boolean;
  includeSessionEvents?: boolean;
  includeResponseMetadata?: boolean;
}

export interface AuditTimelineOptions {
  jsonlDir?: string;
  types?: string[];
}

export interface AuditReplayOptions extends AuditTimelineOptions {
  emit?: boolean;
  emitDelayMs?: number;
}

function resolveAuditDir(config?: { jsonlDir?: string; databasePath?: string }): string {
  if (config?.jsonlDir) {
    return config.jsonlDir;
  }

  if (config?.databasePath) {
    return resolve(dirname(config.databasePath), "audit");
  }

  if (defaultAuditDir) {
    return defaultAuditDir;
  }

  return resolve(process.cwd(), "data", "audit");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AuditTrail {
  private started = false;
  private insertStmt:
    | (ReturnType<typeof getDatabase>["prepare"] extends (
        sql: string,
      ) => infer R
        ? R
        : never)
    | null = null;
  private useConsoleFallback = false;
  private jsonlDir: string | null = null;
  private includeTranscripts = true;
  private includeTranscriptDeltas = false;
  private includeAudio = false;
  private includeSessionEvents = true;
  private includeResponseMetadata = true;
  private writeQueues: Map<string, Promise<void>> = new Map();
  private subscribedTypes: string[] = [];

  start(config: AuditTrailConfig): void {
    if (this.started || !config.enabled) {
      return;
    }

    this.includeTranscripts = config.includeTranscripts ?? true;
    this.includeTranscriptDeltas = config.includeTranscriptDeltas ?? false;
    this.includeAudio = config.includeAudio ?? false;
    this.includeSessionEvents = config.includeSessionEvents ?? true;
    this.includeResponseMetadata = config.includeResponseMetadata ?? true;

    this.jsonlDir = resolveAuditDir(config);
    defaultAuditDir = this.jsonlDir;

    if (this.jsonlDir) {
      void mkdir(this.jsonlDir, { recursive: true }).catch((error) => {
        console.error("[AuditTrail] Failed to create audit directory:", error);
      });
    }

    try {
      const db = getDatabase({
        path: config.databasePath,
        walMode: config.walMode ?? true,
      });

      this.insertStmt = db.prepare(`
        INSERT INTO audit_events (event_id, session_id, event_type, source, payload, timestamp_ms)
        VALUES (@eventId, @sessionId, @eventType, @source, @payload, @timestampMs)
      `);
    } catch (error) {
      this.useConsoleFallback = true;
      console.error("[AuditTrail] Failed to initialize database:", error);
    }

    this.subscribedTypes = this.getSubscribedTypes();
    for (const type of this.subscribedTypes) {
      eventBus.on(type, this.handleEvent);
    }

    this.started = true;
  }

  private getSubscribedTypes(): string[] {
    const types = new Set<string>();
    BASE_EVENT_TYPES.forEach((type) => types.add(type));

    if (this.includeTranscripts) {
      TRANSCRIPT_EVENT_TYPES.forEach((type) => {
        if (type === "transcript.delta" && !this.includeTranscriptDeltas) {
          return;
        }
        types.add(type);
      });
    }

    if (this.includeAudio) {
      AUDIO_EVENT_TYPES.forEach((type) => types.add(type));
    }

    if (this.includeSessionEvents) {
      SESSION_EVENT_TYPES.forEach((type) => types.add(type));
    }

    if (this.includeResponseMetadata) {
      types.add("response.metadata");
    }

    return Array.from(types);
  }

  private handleEvent = (event: Event): void => {
    if (!this.started) return;

    if (event.type === "policy.decision" && event.source !== "laneC") {
      return;
    }

    if (event.type.startsWith("control.") && event.source !== "laneC") {
      return;
    }

    const sanitized = this.sanitizeEvent(event);

    if (this.insertStmt) {
      try {
        this.insertStmt.run({
          eventId: sanitized.event_id,
          sessionId: sanitized.session_id,
          eventType: sanitized.type,
          source: sanitized.source,
          payload: JSON.stringify(sanitized.payload ?? {}),
          timestampMs: sanitized.t_ms,
        });
      } catch (error) {
        console.error("[AuditTrail] Failed to persist audit event:", error);
      }
    }

    if (this.jsonlDir) {
      this.appendJsonl(sanitized);
    } else if (this.useConsoleFallback) {
      console.log("[AuditTrail] audit", {
        event_id: sanitized.event_id,
        session_id: sanitized.session_id,
        type: sanitized.type,
        source: sanitized.source,
        payload: sanitized.payload,
        t_ms: sanitized.t_ms,
      });
    }
  };

  private sanitizeEvent(event: Event): Event {
    if (!this.includeTranscripts && event.type === "control.audit") {
      const payload = event.payload as { textSnippet?: string };
      return {
        ...event,
        payload: {
          ...payload,
          textSnippet: "[REDACTED]",
        },
      } as Event;
    }

    if (this.includeAudio && event.type.startsWith("audio.")) {
      const payload = { ...(event.payload as Record<string, unknown>) };
      if (payload.data && Buffer.isBuffer(payload.data)) {
        payload.data = (payload.data as Buffer).toString("base64");
        payload.data_encoding = "base64";
      }
      if (payload.chunk && Buffer.isBuffer(payload.chunk)) {
        payload.chunk = (payload.chunk as Buffer).toString("base64");
        payload.chunk_encoding = "base64";
      }
      return { ...event, payload } as Event;
    }

    return event;
  }

  private appendJsonl(event: Event): void {
    if (!this.jsonlDir) return;

    const filePath = join(this.jsonlDir, `${event.session_id}.jsonl`);
    const line = `${JSON.stringify(event)}\n`;
    const pending = this.writeQueues.get(event.session_id) ?? Promise.resolve();
    const nextWrite = pending
      .then(() => appendFile(filePath, line))
      .catch((error) => {
        console.error("[AuditTrail] Failed to append JSONL event:", error);
      });

    this.writeQueues.set(event.session_id, nextWrite);
  }

  log(event: Event): void {
    this.handleEvent(event);
  }
}

let auditTrailInstance: AuditTrail | null = null;

export function initializeAuditTrail(config: AuditTrailConfig): AuditTrail | null {
  if (!config.enabled) {
    return null;
  }

  if (!auditTrailInstance) {
    auditTrailInstance = new AuditTrail();
    auditTrailInstance.start(config);
  }

  return auditTrailInstance;
}

export async function loadSessionTimeline(
  sessionId: string,
  options: AuditTimelineOptions = {},
): Promise<Event[]> {
  const jsonlDir = resolveAuditDir(options);
  const filePath = join(jsonlDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) {
    return [];
  }

  const typeFilter = new Set<string>(options.types ?? Array.from(DEFAULT_TIMELINE_TYPES));
  const events: Event[] = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as Event;
      if (event.session_id !== sessionId) {
        continue;
      }
      if (!typeFilter.has(event.type)) {
        continue;
      }
      events.push(event);
    } catch (error) {
      console.warn("[AuditTrail] Failed to parse JSONL line:", error);
    }
  }

  return events.sort((a, b) => a.t_ms - b.t_ms);
}

export async function replaySessionTimeline(
  sessionId: string,
  options: AuditReplayOptions = {},
): Promise<Event[]> {
  const events = await loadSessionTimeline(sessionId, options);
  if (options.emit === false) {
    return events;
  }

  const delay = options.emitDelayMs ?? 0;
  for (const event of events) {
    eventBus.emit(event);
    if (delay > 0) {
      await sleep(delay);
    }
  }

  return events;
}
