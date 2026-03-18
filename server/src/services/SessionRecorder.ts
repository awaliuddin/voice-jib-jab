/**
 * SessionRecorder — captures session events in memory during a session,
 * then flushes to disk on session end for post-hoc replay and analysis.
 *
 * Subscribes to the global EventBus using onSession() for per-session
 * filtering. Audio chunk payloads are excluded from the timeline by default
 * (only counted in the summary) unless storeRawAudio is enabled.
 */

import { eventBus } from "../orchestrator/EventBus.js";
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import type { Event, PolicyDecisionPayload, UserTranscriptPayload } from "../schemas/events.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecordingEntry {
  t_ms: number;
  type: string;
  payload?: Record<string, unknown>;
}

export interface SessionRecording {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  tenantId: string | null;
  timeline: RecordingEntry[];
  summary: {
    turnCount: number;
    policyDecisions: Record<string, number>;
    audioInputChunks: number;
    audioOutputChunks: number;
  };
}

export interface SessionRecorderConfig {
  recordingsDir: string;
  storeRawAudio?: boolean;
  retentionDays?: number;
}

// ---------------------------------------------------------------------------
// Internal buffer state for an in-progress recording
// ---------------------------------------------------------------------------

interface RecordingBuffer {
  startMs: number;
  startedAt: string;
  tenantId: string | null;
  entries: RecordingEntry[];
  turnCount: number;
  policyDecisions: Record<string, number>;
  audioInputChunks: number;
  audioOutputChunks: number;
}

// ---------------------------------------------------------------------------
// Event types we record in the timeline
// ---------------------------------------------------------------------------

const TIMELINE_EVENT_TYPES = new Set<string>([
  "policy.decision",
  "transcript",
  "user_transcript",
  "transcript.final",
  "session.start",
  "session.end",
  "control.audit",
  "control.override",
]);

// ---------------------------------------------------------------------------
// SessionRecorder
// ---------------------------------------------------------------------------

export class SessionRecorder {
  private sessions = new Map<string, RecordingBuffer>();
  private readonly storeRawAudio: boolean;
  private readonly retentionDays: number;
  private readonly _recordingsDir: string;

  constructor(config: SessionRecorderConfig) {
    this._recordingsDir = config.recordingsDir;
    this.storeRawAudio = config.storeRawAudio ?? false;
    this.retentionDays = config.retentionDays ?? 7;
  }

  /**
   * Get the recordings directory path.
   */
  get recordingsDir(): string {
    return this._recordingsDir;
  }

  /**
   * Start recording a session. Subscribes to eventBus for the given sessionId.
   * Idempotent — calling twice for the same sessionId is a no-op.
   */
  startRecording(sessionId: string, tenantId?: string): void {
    if (this.sessions.has(sessionId)) {
      return;
    }

    const now = Date.now();
    const buffer: RecordingBuffer = {
      startMs: now,
      startedAt: new Date(now).toISOString(),
      tenantId: tenantId ?? null,
      entries: [],
      turnCount: 0,
      policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
      audioInputChunks: 0,
      audioOutputChunks: 0,
    };

    this.sessions.set(sessionId, buffer);

    eventBus.onSession(sessionId, (event: Event) => {
      this.handleEvent(sessionId, event);
    });
  }

  /**
   * Manually stop recording (e.g. on WS close without session.end).
   * Flushes the current state to disk and unsubscribes.
   */
  async stopRecording(sessionId: string): Promise<void> {
    const buffer = this.sessions.get(sessionId);
    if (!buffer) {
      return;
    }

    this.flushToDisk(sessionId, buffer);
    this.sessions.delete(sessionId);
    eventBus.offSession(sessionId);
  }

  /**
   * Load a recording from disk. Returns null if not found.
   */
  loadRecording(sessionId: string): SessionRecording | null {
    const filePath = join(this._recordingsDir, `${sessionId}.json`);
    try {
      const data = readFileSync(filePath, "utf-8");
      const recording = JSON.parse(data) as SessionRecording;
      // Ensure timeline is sorted by t_ms
      recording.timeline.sort((a, b) => a.t_ms - b.t_ms);
      return recording;
    } catch {
      return null;
    }
  }

  /**
   * List all recording metadata (without full timeline) sorted by startedAt desc.
   */
  listRecordings(): Array<Omit<SessionRecording, "timeline">> {
    if (!existsSync(this._recordingsDir)) {
      return [];
    }

    const files = readdirSync(this._recordingsDir).filter((f) => f.endsWith(".json"));
    const results: Array<Omit<SessionRecording, "timeline">> = [];

    for (const file of files) {
      try {
        const data = readFileSync(join(this._recordingsDir, file), "utf-8");
        const recording = JSON.parse(data) as SessionRecording;
        // Strip timeline for performance
        const { timeline: _timeline, ...metadata } = recording;
        results.push(metadata);
      } catch {
        // Skip corrupted files
      }
    }

    // Sort by startedAt descending
    results.sort((a, b) => {
      const dateA = new Date(a.startedAt).getTime();
      const dateB = new Date(b.startedAt).getTime();
      return dateB - dateA;
    });

    return results;
  }

  /**
   * Delete recordings older than retentionDays. Returns count of deleted files.
   */
  pruneOldRecordings(): number {
    if (!existsSync(this._recordingsDir)) {
      return 0;
    }

    const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(this._recordingsDir).filter((f) => f.endsWith(".json"));
    let deleted = 0;

    for (const file of files) {
      try {
        const data = readFileSync(join(this._recordingsDir, file), "utf-8");
        const recording = JSON.parse(data) as SessionRecording;
        const startedAtMs = new Date(recording.startedAt).getTime();

        if (startedAtMs < cutoffMs) {
          unlinkSync(join(this._recordingsDir, file));
          deleted++;
        }
      } catch {
        // Skip files that can't be read/parsed
      }
    }

    return deleted;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private handleEvent(sessionId: string, event: Event): void {
    const buffer = this.sessions.get(sessionId);
    if (!buffer) {
      return;
    }

    const relativeMs = event.t_ms - buffer.startMs;

    // Count audio chunks in summary regardless of storeRawAudio
    if (event.type === "audio.chunk") {
      this.countAudioChunk(buffer, event);
      if (!this.storeRawAudio) {
        return; // Don't add to timeline
      }
    }

    // Only record event types we care about (plus audio.chunk when storeRawAudio)
    if (!TIMELINE_EVENT_TYPES.has(event.type) && event.type !== "audio.chunk") {
      return;
    }

    // Track turn count from user transcript finals
    if (event.type === "user_transcript" || event.type === "transcript") {
      const payload = event.payload as UserTranscriptPayload;
      if (payload?.isFinal) {
        buffer.turnCount++;
      }
    }

    // Track policy decisions
    if (event.type === "policy.decision") {
      const payload = event.payload as PolicyDecisionPayload;
      const decision = payload?.decision;
      if (decision && decision in buffer.policyDecisions) {
        buffer.policyDecisions[decision]++;
      }
    }

    // Build entry with selective payload (no raw audio buffers)
    const entry: RecordingEntry = {
      t_ms: relativeMs,
      type: event.type,
    };

    if (event.payload != null) {
      const sanitized = this.sanitizePayload(event);
      if (sanitized !== undefined) {
        entry.payload = sanitized;
      }
    }

    buffer.entries.push(entry);

    // Auto-flush on session.end
    if (event.type === "session.end") {
      void this.stopRecording(sessionId);
    }
  }

  private countAudioChunk(buffer: RecordingBuffer, event: Event): void {
    const source = event.source;
    if (source === "client") {
      buffer.audioInputChunks++;
    } else {
      buffer.audioOutputChunks++;
    }
  }

  private sanitizePayload(event: Event): Record<string, unknown> | undefined {
    const payload = event.payload as Record<string, unknown> | null | undefined;
    if (!payload) {
      return undefined;
    }

    // For audio chunks, strip binary data unless storeRawAudio is on
    if (event.type === "audio.chunk" && this.storeRawAudio) {
      const cleaned: Record<string, unknown> = { ...payload };
      if (cleaned.data && Buffer.isBuffer(cleaned.data)) {
        cleaned.data = (cleaned.data as Buffer).toString("base64");
        cleaned.data_encoding = "base64";
      }
      if (cleaned.chunk && Buffer.isBuffer(cleaned.chunk)) {
        cleaned.chunk = (cleaned.chunk as Buffer).toString("base64");
        cleaned.chunk_encoding = "base64";
      }
      return cleaned;
    }

    return payload as Record<string, unknown>;
  }

  private flushToDisk(sessionId: string, buffer: RecordingBuffer): void {
    const endedAt = new Date().toISOString();
    const endedAtMs = new Date(endedAt).getTime();
    const startedAtMs = new Date(buffer.startedAt).getTime();

    const recording: SessionRecording = {
      sessionId,
      startedAt: buffer.startedAt,
      endedAt,
      durationMs: endedAtMs - startedAtMs,
      tenantId: buffer.tenantId,
      timeline: buffer.entries,
      summary: {
        turnCount: buffer.turnCount,
        policyDecisions: { ...buffer.policyDecisions },
        audioInputChunks: buffer.audioInputChunks,
        audioOutputChunks: buffer.audioOutputChunks,
      },
    };

    // Ensure directory exists
    if (!existsSync(this._recordingsDir)) {
      mkdirSync(this._recordingsDir, { recursive: true });
    }

    const filePath = join(this._recordingsDir, `${sessionId}.json`);
    writeFileSync(filePath, JSON.stringify(recording, null, 2), "utf-8");
  }
}
