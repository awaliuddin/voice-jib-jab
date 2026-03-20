/**
 * VoiceprintStore — JSON-persisted caller voiceprint store for speaker identification.
 *
 * Caller identification works by comparing a simulated audio embedding
 * (derived deterministically from raw audio bytes) against stored voiceprints.
 * The embedding algorithm divides the audio buffer into 64 equal chunks and
 * normalises the byte-sum of each chunk to a 0-1 float. Real deployments
 * would replace extractEmbedding() with a proper speaker-embedding model.
 *
 * Usage:
 *   const store = initVoiceprintStore("/path/to/voiceprints.json");
 *   store.enroll("tenant-1", "customer-42", audioBuffer);
 *   const result = store.identify("tenant-1", audioBuffer);
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

export interface Voiceprint {
  voiceprintId: string;
  callerId: string;
  tenantId: string;
  /** Fixed-length 64-element feature vector. */
  embedding: number[];
  enrolledAt: string;
  /** How many audio samples have contributed to the stored embedding. */
  sampleCount: number;
}

export interface IdentifyResult {
  identified: boolean;
  callerId: string | null;
  voiceprintId: string | null;
  /** Best cosine similarity score found (0 when not identified). */
  confidence: number;
  /** The threshold that was applied. */
  threshold: number;
}

// ── VoiceprintStore ───────────────────────────────────────────────────

export class VoiceprintStore {
  private voiceprints: Map<string, Voiceprint> = new Map();
  private storageFile: string;
  private identifyThreshold: number;

  constructor(storageFile: string, identifyThreshold = 0.82) {
    this.storageFile = storageFile;
    this.identifyThreshold = identifyThreshold;
    this.loadFromDisk();
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Extract a 64-element embedding from an audio buffer.
   *
   * Algorithm: divide the buffer into 64 equal chunks; for each chunk
   * sum the byte values and normalise to [0, 1] by dividing by 255.
   * If the buffer is empty, return an array of 64 zeros.
   *
   * This is a simulation — a real implementation would use a speaker
   * embedding model (e.g. x-vectors, ECAPA-TDNN, etc.).
   */
  private extractEmbedding(audioBuffer: Buffer): number[] {
    const DIMS = 64;

    if (audioBuffer.length === 0) {
      return new Array(DIMS).fill(0);
    }

    const chunkSize = audioBuffer.length / DIMS;
    const embedding: number[] = new Array(DIMS);

    for (let i = 0; i < DIMS; i++) {
      const start = Math.floor(i * chunkSize);
      const end = Math.floor((i + 1) * chunkSize);

      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += audioBuffer[j] % 256;
      }

      const count = end - start;
      embedding[i] = count > 0 ? sum / count / 255 : 0;
    }

    return embedding;
  }

  /**
   * Compute cosine similarity between two equal-length vectors.
   * Returns 0 if either vector has zero magnitude.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) {
      return 0;
    }

    return dot / denom;
  }

  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      const records = JSON.parse(raw) as Voiceprint[];
      for (const vp of records) {
        this.voiceprints.set(vp.voiceprintId, vp);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const records = Array.from(this.voiceprints.values());
    writeFileSync(this.storageFile, JSON.stringify(records, null, 2), "utf-8");
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Enroll or update a voiceprint for a caller.
   *
   * If a voiceprint already exists for (tenantId, callerId), the new
   * embedding is averaged element-wise with the existing one and
   * sampleCount is incremented. Otherwise a new voiceprint is created.
   *
   * @param tenantId   - Tenant scope
   * @param callerId   - Caller identifier (e.g. "customer-42")
   * @param audioBuffer - Raw audio bytes used to extract an embedding
   * @returns The created or updated Voiceprint
   */
  enroll(tenantId: string, callerId: string, audioBuffer: Buffer): Voiceprint {
    const newEmbedding = this.extractEmbedding(audioBuffer);

    const existing = Array.from(this.voiceprints.values()).find(
      (vp) => vp.tenantId === tenantId && vp.callerId === callerId,
    );

    if (existing) {
      // Element-wise average of existing and new embedding
      const averaged = existing.embedding.map(
        (v, i) => (v * existing.sampleCount + newEmbedding[i]) / (existing.sampleCount + 1),
      );

      const updated: Voiceprint = {
        ...existing,
        embedding: averaged,
        sampleCount: existing.sampleCount + 1,
      };

      this.voiceprints.set(existing.voiceprintId, updated);
      this.saveToDisk();
      return updated;
    }

    const voiceprint: Voiceprint = {
      voiceprintId: randomUUID(),
      callerId,
      tenantId,
      embedding: newEmbedding,
      enrolledAt: new Date().toISOString(),
      sampleCount: 1,
    };

    this.voiceprints.set(voiceprint.voiceprintId, voiceprint);
    this.saveToDisk();
    return voiceprint;
  }

  /**
   * Identify a caller from audio.
   *
   * Extracts an embedding from the audio buffer and computes cosine
   * similarity against all voiceprints belonging to the tenant. Returns
   * the best match if its similarity meets or exceeds the configured
   * threshold.
   *
   * @param tenantId   - Tenant scope (cross-tenant matches are never returned)
   * @param audioBuffer - Raw audio bytes for the unknown caller
   * @returns IdentifyResult with match details
   */
  identify(tenantId: string, audioBuffer: Buffer): IdentifyResult {
    const queryEmbedding = this.extractEmbedding(audioBuffer);
    const candidates = this.listVoiceprints(tenantId);

    let bestScore = 0;
    let bestVoiceprint: Voiceprint | null = null;

    for (const vp of candidates) {
      const score = this.cosineSimilarity(queryEmbedding, vp.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestVoiceprint = vp;
      }
    }

    if (bestVoiceprint !== null && bestScore >= this.identifyThreshold) {
      return {
        identified: true,
        callerId: bestVoiceprint.callerId,
        voiceprintId: bestVoiceprint.voiceprintId,
        confidence: bestScore,
        threshold: this.identifyThreshold,
      };
    }

    return {
      identified: false,
      callerId: null,
      voiceprintId: null,
      confidence: 0,
      threshold: this.identifyThreshold,
    };
  }

  /**
   * List all voiceprints for a tenant.
   *
   * @param tenantId - Tenant scope
   * @returns All voiceprints belonging to the tenant
   */
  listVoiceprints(tenantId: string): Voiceprint[] {
    return Array.from(this.voiceprints.values()).filter(
      (vp) => vp.tenantId === tenantId,
    );
  }

  /**
   * Delete a voiceprint by id.
   *
   * @param voiceprintId - The voiceprint to delete
   * @returns true if found and removed, false if not found
   */
  deleteVoiceprint(voiceprintId: string): boolean {
    if (!this.voiceprints.has(voiceprintId)) {
      return false;
    }

    this.voiceprints.delete(voiceprintId);
    this.saveToDisk();
    return true;
  }

  /**
   * Get a single voiceprint by id.
   *
   * @param voiceprintId - The voiceprint to retrieve
   * @returns The Voiceprint or undefined if not found
   */
  getVoiceprint(voiceprintId: string): Voiceprint | undefined {
    return this.voiceprints.get(voiceprintId);
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

let _store: VoiceprintStore | null = null;

/** Module-level singleton. Access after calling initVoiceprintStore(). */
export const voiceprintStore: VoiceprintStore = new Proxy(
  {} as VoiceprintStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "VoiceprintStore not initialized. Call initVoiceprintStore() first.",
        );
      }
      const value = (_store as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_store);
      }
      return value;
    },
  },
);

/** Initialize the module-level singleton with a storage file path. */
export function initVoiceprintStore(storageFile: string, identifyThreshold?: number): VoiceprintStore {
  _store = new VoiceprintStore(storageFile, identifyThreshold);
  return _store;
}
