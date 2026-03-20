/**
 * RecordingStore — Call recording capture and export
 *
 * Captures outbound audio (PCM16, 24kHz mono) from active voice sessions,
 * writes WAV files on session end, and manages retention policy.
 *
 * Storage layout:
 *   {audioDir}/{sessionId}.wav   — PCM16 WAV audio
 *   {audioDir}/{sessionId}.meta.json — recording metadata
 */

import { readdirSync, existsSync } from "fs";
import { writeFile, unlink, readFile } from "fs/promises";
import { mkdirSync } from "fs";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────

export interface RecordingMeta {
  sessionId: string;
  tenantId: string | null;
  startedAt: string;         // ISO 8601
  endedAt: string | null;    // ISO 8601, null if still active
  durationMs: number;
  audioSizeBytes: number;    // WAV file size in bytes
  audioAvailable: boolean;   // false if session ended with no audio
  retentionExpiresAt: string; // ISO 8601
  sampleRate: number;        // always 24000
  channels: number;          // always 1
}

export interface RecordingStoreConfig {
  audioDir: string;
  retentionDays?: number;    // default 30
}

interface ActiveSession {
  tenantId: string | null;
  startedAt: number;
  chunks: Buffer[];
}

// ── RecordingStore ─────────────────────────────────────────────────────

export class RecordingStore {
  private readonly audioDir: string;
  private readonly retentionDays: number;
  // Map of sessionId → { tenantId, startedAt, chunks: Buffer[] }
  private readonly active: Map<string, ActiveSession>;

  constructor(config: RecordingStoreConfig) {
    this.audioDir = config.audioDir;
    this.retentionDays = config.retentionDays ?? 30;
    this.active = new Map();
    mkdirSync(this.audioDir, { recursive: true });
  }

  /** Begin capturing audio for a session. Idempotent. */
  startCapture(sessionId: string, tenantId?: string | null): void {
    if (this.active.has(sessionId)) {
      return;
    }
    this.active.set(sessionId, {
      tenantId: tenantId ?? null,
      startedAt: Date.now(),
      chunks: [],
    });
  }

  /** Append a PCM16 audio chunk. No-op if session not found. */
  appendChunk(sessionId: string, pcm: Buffer): void {
    const session = this.active.get(sessionId);
    if (!session) {
      return;
    }
    session.chunks.push(pcm);
  }

  /**
   * Stop capturing. Writes WAV + meta to disk. Returns metadata, or null if no audio captured.
   * Never throws — errors are logged and null returned.
   */
  async stopCapture(sessionId: string): Promise<RecordingMeta | null> {
    const session = this.active.get(sessionId);
    if (!session) {
      return null;
    }

    this.active.delete(sessionId);

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - session.startedAt;
    const retentionExpiresAt = new Date(
      endedAt.getTime() + this.retentionDays * 24 * 60 * 60 * 1000,
    );

    try {
      if (session.chunks.length === 0) {
        const meta: RecordingMeta = {
          sessionId,
          tenantId: session.tenantId,
          startedAt: new Date(session.startedAt).toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs,
          audioSizeBytes: 0,
          audioAvailable: false,
          retentionExpiresAt: retentionExpiresAt.toISOString(),
          sampleRate: 24000,
          channels: 1,
        };
        await this.writeMeta(sessionId, meta);
        return meta;
      }

      const wavBuffer = this.writeWav(session.chunks);
      await writeFile(this.getAudioPath(sessionId), wavBuffer);

      const meta: RecordingMeta = {
        sessionId,
        tenantId: session.tenantId,
        startedAt: new Date(session.startedAt).toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs,
        audioSizeBytes: wavBuffer.length,
        audioAvailable: true,
        retentionExpiresAt: retentionExpiresAt.toISOString(),
        sampleRate: 24000,
        channels: 1,
      };
      await this.writeMeta(sessionId, meta);
      return meta;
    } catch (err) {
      console.error(`[RecordingStore] stopCapture failed for ${sessionId}:`, err);
      return null;
    }
  }

  /**
   * List recordings. Reads meta files from audioDir.
   * Optional filters: tenantId, from/to (inclusive, compares startedAt).
   */
  async listRecordings(opts?: {
    tenantId?: string;
    from?: Date;
    to?: Date;
  }): Promise<RecordingMeta[]> {
    if (!existsSync(this.audioDir)) {
      return [];
    }

    let files: string[];
    try {
      files = readdirSync(this.audioDir);
    } catch {
      return [];
    }

    const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
    const results: RecordingMeta[] = [];

    for (const file of metaFiles) {
      try {
        const raw = await readFile(join(this.audioDir, file), "utf-8");
        const meta = JSON.parse(raw) as RecordingMeta;

        if (opts?.tenantId !== undefined && meta.tenantId !== opts.tenantId) {
          continue;
        }

        const startedAt = new Date(meta.startedAt);
        if (opts?.from !== undefined && startedAt < opts.from) {
          continue;
        }
        if (opts?.to !== undefined && startedAt > opts.to) {
          continue;
        }

        results.push(meta);
      } catch {
        // Skip unparseable meta files
      }
    }

    results.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    return results;
  }

  /** Get full file path for a session WAV file. */
  getAudioPath(sessionId: string): string {
    return join(this.audioDir, `${sessionId}.wav`);
  }

  /** Check if a WAV file exists on disk for this session. */
  hasRecording(sessionId: string): boolean {
    return existsSync(this.getAudioPath(sessionId));
  }

  /** Delete WAV + meta files for a session. */
  async deleteRecording(sessionId: string): Promise<void> {
    const wavPath = this.getAudioPath(sessionId);
    const metaPath = this.metaPath(sessionId);

    const deletions: Promise<void>[] = [];

    if (existsSync(wavPath)) {
      deletions.push(unlink(wavPath));
    }
    if (existsSync(metaPath)) {
      deletions.push(unlink(metaPath));
    }

    await Promise.all(deletions);
  }

  /**
   * Delete recordings whose retentionExpiresAt is in the past.
   * Returns count of deleted recordings.
   */
  async pruneExpired(): Promise<number> {
    const all = await this.listRecordings();
    const now = Date.now();
    let count = 0;

    for (const meta of all) {
      if (new Date(meta.retentionExpiresAt).getTime() < now) {
        await this.deleteRecording(meta.sessionId);
        count++;
      }
    }

    return count;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /** Build a 44-byte WAV header for PCM16 mono 24kHz audio. */
  private buildWavHeader(dataSize: number): Buffer {
    const fileSize = dataSize + 36; // total RIFF chunk size = header(44) - 8 + dataSize
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8); // 48000
    const blockAlign = numChannels * (bitsPerSample / 8);             // 2

    const header = Buffer.alloc(44);
    let offset = 0;

    // RIFF chunk descriptor
    header.write("RIFF", offset, "ascii"); offset += 4;
    header.writeUInt32LE(fileSize, offset);  offset += 4;
    header.write("WAVE", offset, "ascii"); offset += 4;

    // fmt sub-chunk
    header.write("fmt ", offset, "ascii"); offset += 4;
    header.writeUInt32LE(16, offset);           offset += 4; // sub-chunk size = 16
    header.writeUInt16LE(1, offset);            offset += 2; // audioFormat = 1 (PCM)
    header.writeUInt16LE(numChannels, offset);  offset += 2;
    header.writeUInt32LE(sampleRate, offset);   offset += 4;
    header.writeUInt32LE(byteRate, offset);     offset += 4;
    header.writeUInt16LE(blockAlign, offset);   offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data sub-chunk
    header.write("data", offset, "ascii"); offset += 4;
    header.writeUInt32LE(dataSize, offset);

    return header;
  }

  /**
   * Concatenate all chunks and prepend a WAV header.
   * Returns the complete WAV file as a Buffer.
   */
  private writeWav(chunks: Buffer[]): Buffer {
    const data = Buffer.concat(chunks);
    const header = this.buildWavHeader(data.length);
    return Buffer.concat([header, data]);
  }

  /** Write metadata JSON file for a session. */
  private async writeMeta(sessionId: string, meta: RecordingMeta): Promise<void> {
    await writeFile(this.metaPath(sessionId), JSON.stringify(meta, null, 2), "utf-8");
  }

  /** Resolve the meta file path for a session. */
  private metaPath(sessionId: string): string {
    return join(this.audioDir, `${sessionId}.meta.json`);
  }
}
