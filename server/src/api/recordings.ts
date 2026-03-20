/**
 * Recordings API
 *
 * GET  /recordings               — list recordings (tenant/date filters)
 * GET  /recordings/:sessionId    — download WAV audio file
 * DELETE /recordings/:sessionId  — delete recording
 */

import { Router } from "express";
import { createReadStream } from "fs";
import type { RecordingStore } from "../services/RecordingStore.js";

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_OFFSET = 0;

// ── Validation helpers ────────────────────────────────────────────────

/**
 * Parse a string into a Date, returning null when the string is not a
 * valid date representation.
 */
function parseDate(value: string): Date | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Clamp a numeric query parameter to an inclusive range.
 */
function clampInt(raw: unknown, defaultVal: number, max: number): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : defaultVal;
  if (!Number.isFinite(n) || n < 0) return defaultVal;
  return Math.min(n, max);
}

// ── Router factory ────────────────────────────────────────────────────

export function createRecordingsRouter(store: RecordingStore): Router {
  const router = Router();

  // ── GET /recordings ──────────────────────────────────────────────

  /**
   * List recordings, with optional tenant and date-range filters.
   *
   * Query params:
   *   tenant  — filter by tenantId
   *   from    — ISO date string lower bound (inclusive)
   *   to      — ISO date string upper bound (inclusive)
   *   limit   — page size (default 100, max 500)
   *   offset  — page offset (default 0)
   *
   * Returns: { recordings, total, limit, offset }
   */
  router.get("/", async (req, res) => {
    const { tenant, from: fromRaw, to: toRaw } = req.query;

    // Validate from/to when provided
    let from: Date | undefined;
    let to: Date | undefined;

    if (fromRaw !== undefined) {
      if (typeof fromRaw !== "string") {
        res.status(400).json({ error: "from must be an ISO date string" });
        return;
      }
      const parsed = parseDate(fromRaw);
      if (!parsed) {
        res.status(400).json({ error: `Invalid from date: "${fromRaw}"` });
        return;
      }
      from = parsed;
    }

    if (toRaw !== undefined) {
      if (typeof toRaw !== "string") {
        res.status(400).json({ error: "to must be an ISO date string" });
        return;
      }
      const parsed = parseDate(toRaw);
      if (!parsed) {
        res.status(400).json({ error: `Invalid to date: "${toRaw}"` });
        return;
      }
      to = parsed;
    }

    const limit = clampInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = clampInt(req.query.offset, DEFAULT_OFFSET, Number.MAX_SAFE_INTEGER);

    try {
      const all = await store.listRecordings({
        tenantId: typeof tenant === "string" ? tenant : undefined,
        from,
        to,
      });

      const total = all.length;
      const recordings = all.slice(offset, offset + limit);

      res.json({ recordings, total, limit, offset });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── GET /recordings/:sessionId ───────────────────────────────────

  /**
   * Stream the WAV audio file for a session.
   *
   * Returns 404 when the recording does not exist.
   * Sets Content-Type, Content-Disposition, and Cache-Control headers.
   */
  router.get("/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    if (!store.hasRecording(sessionId)) {
      res.status(404).json({ error: `Recording not found: ${sessionId}` });
      return;
    }

    const audioPath = store.getAudioPath(sessionId);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sessionId}.wav"`,
    );
    res.setHeader("Cache-Control", "no-store");

    createReadStream(audioPath).pipe(res);
  });

  // ── DELETE /recordings/:sessionId ────────────────────────────────

  /**
   * Delete the recording for a session.
   *
   * Returns 404 when the recording does not exist, 204 on success.
   */
  router.delete("/:sessionId", async (req, res) => {
    const { sessionId } = req.params;

    if (!store.hasRecording(sessionId)) {
      res.status(404).json({ error: `Recording not found: ${sessionId}` });
      return;
    }

    try {
      await store.deleteRecording(sessionId);
      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
