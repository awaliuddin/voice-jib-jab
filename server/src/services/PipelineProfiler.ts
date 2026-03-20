/**
 * PipelineProfiler — in-memory per-stage timing profiler for voice sessions.
 *
 * Profiles are ephemeral: stored only in process memory, associated with
 * active sessions. No file persistence.
 *
 * Usage:
 *   import { pipelineProfiler, BOTTLENECK_THRESHOLD_MS } from "./PipelineProfiler.js";
 *   const record = pipelineProfiler.record(sessionId, "stt", startMs, endMs);
 *   const profile = pipelineProfiler.getProfile(sessionId);
 */

// ── Constants ──────────────────────────────────────────────────────────

/** Duration threshold (ms) above which a stage is flagged as a bottleneck. */
export const BOTTLENECK_THRESHOLD_MS = 200;

// ── Types ──────────────────────────────────────────────────────────────

export type PipelineStage =
  | "stt"          // Speech-to-text
  | "lane_a"       // Lane A reflex
  | "lane_b"       // Lane B reasoning
  | "lane_c"       // Lane C policy gate
  | "policy_gate"  // PolicyGate evaluation
  | "tts"          // Text-to-speech
  | "total";       // End-to-end roundtrip

export interface StageTimingRecord {
  stage: PipelineStage;
  startMs: number;
  endMs: number;
  durationMs: number;
  isBottleneck: boolean;
}

export interface PipelineProfile {
  sessionId: string;
  stages: StageTimingRecord[];
  totalDurationMs: number;
  bottlenecks: PipelineStage[];
  bottleneckAlert: boolean;
  recordCount: number;
  lastRecordedAt: string;
  createdAt: string;
}

// ── Valid stage set (for runtime validation) ───────────────────────────

export const VALID_PIPELINE_STAGES: ReadonlySet<string> = new Set<PipelineStage>([
  "stt",
  "lane_a",
  "lane_b",
  "lane_c",
  "policy_gate",
  "tts",
  "total",
]);

// ── PipelineProfiler ───────────────────────────────────────────────────

export class PipelineProfiler {
  /**
   * Raw records stored per session. The profile shape is computed on demand
   * from these records so callers always see an up-to-date view.
   */
  private records: Map<string, StageTimingRecord[]> = new Map();

  /**
   * ISO timestamp of the first record added for each session.
   * Stored separately so createdAt never changes as more records arrive.
   */
  private createdAt: Map<string, string> = new Map();

  /**
   * Record a completed stage timing.
   *
   * Creates a profile entry for the session if none exists yet, then appends
   * the new record. Returns the constructed StageTimingRecord.
   *
   * @param sessionId - Owning session identifier
   * @param stage     - Pipeline stage that was timed
   * @param startMs   - Date.now() value at stage start
   * @param endMs     - Date.now() value at stage end
   */
  record(
    sessionId: string,
    stage: PipelineStage,
    startMs: number,
    endMs: number,
  ): StageTimingRecord {
    const durationMs = endMs - startMs;
    const entry: StageTimingRecord = {
      stage,
      startMs,
      endMs,
      durationMs,
      isBottleneck: durationMs > BOTTLENECK_THRESHOLD_MS,
    };

    if (!this.records.has(sessionId)) {
      this.records.set(sessionId, []);
      this.createdAt.set(sessionId, new Date().toISOString());
    }

    this.records.get(sessionId)!.push(entry);
    return entry;
  }

  /**
   * Get the full profile for a session.
   *
   * Computes the aggregated PipelineProfile from raw records on each call.
   * Returns undefined if no timing data has been recorded for the session.
   *
   * @param sessionId - Session to retrieve profile for
   */
  getProfile(sessionId: string): PipelineProfile | undefined {
    const sessionRecords = this.records.get(sessionId);
    if (!sessionRecords || sessionRecords.length === 0) {
      return undefined;
    }

    const bottlenecks: PipelineStage[] = sessionRecords
      .filter((r) => r.isBottleneck)
      .map((r) => r.stage);

    // totalDurationMs sums all stage durations (the "total" stage, if recorded,
    // is included in the raw stages array but is also summed — callers that want
    // only individual-stage totals can filter themselves).
    const totalDurationMs = sessionRecords.reduce((sum, r) => sum + r.durationMs, 0);

    const lastRecord = sessionRecords[sessionRecords.length - 1];

    return {
      sessionId,
      stages: [...sessionRecords],
      totalDurationMs,
      bottlenecks,
      bottleneckAlert: bottlenecks.length > 0,
      recordCount: sessionRecords.length,
      lastRecordedAt: new Date(lastRecord.endMs).toISOString(),
      createdAt: this.createdAt.get(sessionId)!,
    };
  }

  /**
   * Get all session IDs that have at least one timing record.
   */
  listProfiledSessions(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Delete all timing records for a session.
   *
   * No-op if the session has no profile. Intended to be called on session end
   * to free memory.
   *
   * @param sessionId - Session to clear
   */
  clearProfile(sessionId: string): void {
    this.records.delete(sessionId);
    this.createdAt.delete(sessionId);
  }

  /**
   * Get a compact bottleneck summary for a session.
   *
   * Returns the sessionId, list of bottleneck stages, and a boolean alert flag.
   * If no profile exists for the session, returns null (caller maps to 404).
   *
   * @param sessionId - Session to inspect
   */
  getBottlenecks(
    sessionId: string,
  ): { sessionId: string; bottlenecks: PipelineStage[]; alert: boolean } | null {
    const profile = this.getProfile(sessionId);
    if (!profile) {
      return null;
    }
    return {
      sessionId,
      bottlenecks: profile.bottlenecks,
      alert: profile.bottleneckAlert,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

/** Process-scoped singleton. Import and use directly — no init required. */
export const pipelineProfiler = new PipelineProfiler();
