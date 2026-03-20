/**
 * RecordingStore Unit Tests
 *
 * Tests the RecordingStore service that accumulates audio chunks per session,
 * writes WAV files, and manages retention. Uses real filesystem via OS temp dirs.
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import { RecordingStore } from "../../services/RecordingStore.js";

// ── Helpers ────────────────────────────────────────────────────────────

function tempDir(label: string): string {
  return join(
    tmpdir(),
    `recording-store-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

/** Build a minimal PCM16 buffer of the given number of samples. */
function pcmBuffer(samples: number): Buffer {
  return Buffer.alloc(samples * 2, 0x10); // 2 bytes per sample
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("RecordingStore", () => {
  let store: RecordingStore;
  let dir: string;

  beforeEach(() => {
    dir = tempDir("store");
    store = new RecordingStore({ audioDir: dir });
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── startCapture ────────────────────────────────────────────────────

  describe("startCapture()", () => {
    it("creates an active entry for the session", async () => {
      store.startCapture("sess-1", "tenant-a");
      // Confirm capture is active by appending a chunk then stopping
      store.appendChunk("sess-1", pcmBuffer(24));
      const meta = await store.stopCapture("sess-1");
      expect(meta).not.toBeNull();
      expect(meta!.audioAvailable).toBe(true);
    });

    it("is idempotent — second call does not reset startedAt or chunks", async () => {
      store.startCapture("sess-2", "tenant-b");
      store.appendChunk("sess-2", pcmBuffer(10));
      store.startCapture("sess-2", "tenant-b"); // second call — should be no-op
      const meta = await store.stopCapture("sess-2");
      expect(meta).not.toBeNull();
      // Audio should still be present from the chunk appended before second startCapture
      expect(meta!.audioAvailable).toBe(true);
    });
  });

  // ── appendChunk ─────────────────────────────────────────────────────

  describe("appendChunk()", () => {
    it("adds the chunk to the session buffer", async () => {
      store.startCapture("sess-3");
      const chunk = pcmBuffer(100);
      store.appendChunk("sess-3", chunk);
      const meta = await store.stopCapture("sess-3");
      expect(meta).not.toBeNull();
      expect(meta!.audioSizeBytes).toBeGreaterThan(0);
    });

    it("is a no-op for an unknown session", () => {
      // Should not throw
      expect(() => store.appendChunk("unknown-session", pcmBuffer(10))).not.toThrow();
    });
  });

  // ── stopCapture ─────────────────────────────────────────────────────

  describe("stopCapture()", () => {
    it("returns meta with audioAvailable=false when no audio was captured", async () => {
      store.startCapture("sess-4", "tenant-c");
      const meta = await store.stopCapture("sess-4");
      expect(meta).not.toBeNull();
      expect(meta!.audioAvailable).toBe(false);
      expect(meta!.audioSizeBytes).toBe(0);
    });

    it("writes a WAV file when audio chunks were captured", async () => {
      store.startCapture("sess-5", "tenant-d");
      store.appendChunk("sess-5", pcmBuffer(48)); // 48 samples = 96 bytes
      await store.stopCapture("sess-5");
      expect(existsSync(store.getAudioPath("sess-5"))).toBe(true);
    });

    it("WAV file has correct 44-byte header", async () => {
      store.startCapture("sess-6");
      store.appendChunk("sess-6", pcmBuffer(24));
      await store.stopCapture("sess-6");

      const { readFileSync } = await import("fs");
      const wav = readFileSync(store.getAudioPath("sess-6"));

      // RIFF marker at bytes 0-3
      expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
      // WAVE marker at bytes 8-11
      expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
      // fmt  sub-chunk at bytes 12-15
      expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
      // audioFormat = 1 (PCM) at bytes 20-21 (little-endian uint16)
      expect(wav.readUInt16LE(20)).toBe(1);
      // numChannels = 1 at bytes 22-23
      expect(wav.readUInt16LE(22)).toBe(1);
      // sampleRate = 24000 at bytes 24-27
      expect(wav.readUInt32LE(24)).toBe(24000);
    });

    it("WAV data length matches total chunk bytes", async () => {
      const chunk1 = pcmBuffer(100); // 200 bytes
      const chunk2 = pcmBuffer(50);  //  100 bytes
      store.startCapture("sess-7");
      store.appendChunk("sess-7", chunk1);
      store.appendChunk("sess-7", chunk2);
      await store.stopCapture("sess-7");

      const { readFileSync } = await import("fs");
      const wav = readFileSync(store.getAudioPath("sess-7"));
      const expectedDataSize = 300; // 200 + 100
      // data chunk size at bytes 40-43
      expect(wav.readUInt32LE(40)).toBe(expectedDataSize);
      // total WAV = 44 header + 300 data
      expect(wav.length).toBe(344);
    });

    it("returns RecordingMeta with correct fields", async () => {
      store.startCapture("sess-8", "tenant-e");
      store.appendChunk("sess-8", pcmBuffer(24));
      const before = Date.now();
      const meta = await store.stopCapture("sess-8");
      const after = Date.now();

      expect(meta).not.toBeNull();
      expect(meta!.sessionId).toBe("sess-8");
      expect(meta!.tenantId).toBe("tenant-e");
      expect(meta!.audioAvailable).toBe(true);
      expect(meta!.sampleRate).toBe(24000);
      expect(meta!.channels).toBe(1);
      expect(new Date(meta!.startedAt).getTime()).toBeGreaterThanOrEqual(before - 5000);
      expect(new Date(meta!.endedAt!).getTime()).toBeLessThanOrEqual(after + 100);
      expect(meta!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("removes the session from the active map after stopping", async () => {
      store.startCapture("sess-9");
      await store.stopCapture("sess-9");
      // A second stopCapture should return null
      const result = await store.stopCapture("sess-9");
      expect(result).toBeNull();
    });

    it("returns null for an unknown session", async () => {
      const meta = await store.stopCapture("not-started");
      expect(meta).toBeNull();
    });
  });

  // ── listRecordings ──────────────────────────────────────────────────

  describe("listRecordings()", () => {
    it("returns empty array when audioDir does not exist", async () => {
      const missingDir = join(tmpdir(), `recording-missing-${Date.now()}`);
      const emptyStore = new RecordingStore({ audioDir: missingDir });
      // Remove the dir that the constructor created
      rmSync(missingDir, { recursive: true, force: true });
      const list = await emptyStore.listRecordings();
      expect(list).toEqual([]);
    });

    it("lists all recordings in the directory", async () => {
      store.startCapture("sess-a");
      store.appendChunk("sess-a", pcmBuffer(10));
      await store.stopCapture("sess-a");

      store.startCapture("sess-b");
      await store.stopCapture("sess-b");

      const list = await store.listRecordings();
      expect(list).toHaveLength(2);
      const ids = list.map((m) => m.sessionId).sort();
      expect(ids).toEqual(["sess-a", "sess-b"]);
    });

    it("filters by tenantId", async () => {
      store.startCapture("sess-c", "tenant-x");
      await store.stopCapture("sess-c");
      store.startCapture("sess-d", "tenant-y");
      await store.stopCapture("sess-d");

      const list = await store.listRecordings({ tenantId: "tenant-x" });
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe("sess-c");
    });

    it("filters by from date (inclusive)", async () => {
      store.startCapture("sess-e");
      await store.stopCapture("sess-e");

      const future = new Date(Date.now() + 60_000);
      const list = await store.listRecordings({ from: future });
      expect(list).toHaveLength(0);
    });

    it("filters by to date (inclusive)", async () => {
      store.startCapture("sess-f");
      await store.stopCapture("sess-f");

      const past = new Date(Date.now() - 60_000);
      const list = await store.listRecordings({ to: past });
      expect(list).toHaveLength(0);
    });

    it("returns recordings sorted by startedAt descending", async () => {
      store.startCapture("sess-g1");
      store.appendChunk("sess-g1", pcmBuffer(5));
      await store.stopCapture("sess-g1");

      await new Promise((resolve) => setTimeout(resolve, 5));

      store.startCapture("sess-g2");
      store.appendChunk("sess-g2", pcmBuffer(5));
      await store.stopCapture("sess-g2");

      const list = await store.listRecordings();
      expect(list.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      const relevant = list.filter((m) =>
        m.sessionId === "sess-g1" || m.sessionId === "sess-g2",
      );
      expect(relevant[0].sessionId).toBe("sess-g2");
      expect(relevant[1].sessionId).toBe("sess-g1");
    });
  });

  // ── hasRecording ────────────────────────────────────────────────────

  describe("hasRecording()", () => {
    it("returns false when no WAV file exists", () => {
      expect(store.hasRecording("nonexistent")).toBe(false);
    });

    it("returns true after stopCapture with audio", async () => {
      store.startCapture("sess-h");
      store.appendChunk("sess-h", pcmBuffer(8));
      await store.stopCapture("sess-h");
      expect(store.hasRecording("sess-h")).toBe(true);
    });
  });

  // ── deleteRecording ─────────────────────────────────────────────────

  describe("deleteRecording()", () => {
    it("removes both the WAV and meta files", async () => {
      store.startCapture("sess-i");
      store.appendChunk("sess-i", pcmBuffer(16));
      await store.stopCapture("sess-i");

      expect(store.hasRecording("sess-i")).toBe(true);
      await store.deleteRecording("sess-i");
      expect(store.hasRecording("sess-i")).toBe(false);

      const metaPath = join(dir, "sess-i.meta.json");
      expect(existsSync(metaPath)).toBe(false);
    });

    it("is a no-op when files do not exist", async () => {
      // Should not throw
      await expect(store.deleteRecording("phantom-session")).resolves.toBeUndefined();
    });
  });

  // ── pruneExpired ────────────────────────────────────────────────────

  describe("pruneExpired()", () => {
    it("deletes recordings whose retentionExpiresAt is in the past", async () => {
      // Use retentionDays=0 so expiry is effectively now/past
      const pruneStore = new RecordingStore({ audioDir: dir, retentionDays: 0 });
      pruneStore.startCapture("sess-j");
      pruneStore.appendChunk("sess-j", pcmBuffer(10));
      await pruneStore.stopCapture("sess-j");

      // Overwrite meta with a past expiry to guarantee it's expired
      const { writeFileSync, readFileSync } = await import("fs");
      const metaPath = join(dir, "sess-j.meta.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      meta.retentionExpiresAt = new Date(Date.now() - 1000).toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      const count = await pruneStore.pruneExpired();
      expect(count).toBe(1);
      expect(store.hasRecording("sess-j")).toBe(false);
    });

    it("keeps recordings whose retentionExpiresAt is in the future", async () => {
      store.startCapture("sess-k");
      store.appendChunk("sess-k", pcmBuffer(10));
      await store.stopCapture("sess-k");

      const count = await store.pruneExpired();
      expect(count).toBe(0);
      expect(store.hasRecording("sess-k")).toBe(true);
    });

    it("returns the correct count of deleted recordings", async () => {
      const { writeFileSync, readFileSync } = await import("fs");

      // Create two sessions
      for (const id of ["sess-l1", "sess-l2"]) {
        store.startCapture(id);
        store.appendChunk(id, pcmBuffer(5));
        await store.stopCapture(id);
        // Force both to be expired
        const metaPath = join(dir, `${id}.meta.json`);
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        meta.retentionExpiresAt = new Date(Date.now() - 1000).toISOString();
        writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }

      const count = await store.pruneExpired();
      expect(count).toBe(2);
    });
  });

  // ── getAudioPath ────────────────────────────────────────────────────

  describe("getAudioPath()", () => {
    it("returns the correct path for a session WAV file", () => {
      const expected = join(dir, "my-session.wav");
      expect(store.getAudioPath("my-session")).toBe(expected);
    });
  });
});
