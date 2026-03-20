/**
 * Profiler API Router — HTTP endpoints for pipeline timing profiles.
 *
 * Mount at /sessions. All routes operate on the /:sessionId/profile
 * sub-path so they coexist safely with the existing sessions router
 * (which owns /:id, /:id/replay, /:id/summary, /:id/compliance).
 *
 * Route registration order (bottlenecks first to prevent shadowing):
 *   GET  /:sessionId/profile/bottlenecks
 *   GET  /:sessionId/profile
 *   POST /:sessionId/profile
 *   DELETE /:sessionId/profile
 */

import { Router, type Request, type Response } from "express";
import {
  type PipelineProfiler,
  type PipelineStage,
  VALID_PIPELINE_STAGES,
} from "../services/PipelineProfiler.js";

/**
 * Create and return an Express router for profiler endpoints.
 *
 * @param profiler - PipelineProfiler instance to delegate to
 */
export function createProfilerRouter(profiler: PipelineProfiler): Router {
  const router = Router();

  // ── GET /:sessionId/profile/bottlenecks ─────────────────────────────
  // Registered FIRST to avoid Express treating "/bottlenecks" as a dynamic
  // segment that shadows the plain /:sessionId/profile route.

  router.get("/:sessionId/profile/bottlenecks", (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const summary = profiler.getBottlenecks(sessionId);
    if (!summary) {
      res.status(404).json({ error: `No profile found for session '${sessionId}'` });
      return;
    }

    res.json(summary);
  });

  // ── GET /:sessionId/profile ──────────────────────────────────────────

  router.get("/:sessionId/profile", (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const profile = profiler.getProfile(sessionId);
    if (!profile) {
      res.status(404).json({ error: `No profile found for session '${sessionId}'` });
      return;
    }

    res.json(profile);
  });

  // ── POST /:sessionId/profile ─────────────────────────────────────────
  // Body: { stage: PipelineStage; startMs: number; endMs: number }
  // Records a timing entry and returns the StageTimingRecord (201).

  router.post("/:sessionId/profile", (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { stage, startMs, endMs } = req.body as {
      stage?: unknown;
      startMs?: unknown;
      endMs?: unknown;
    };

    // Validate stage
    if (stage === undefined || stage === null) {
      res.status(400).json({ error: "Missing required field: stage" });
      return;
    }
    if (typeof stage !== "string" || !VALID_PIPELINE_STAGES.has(stage)) {
      res.status(400).json({
        error: `Invalid stage '${String(stage)}'. Valid stages: ${[...VALID_PIPELINE_STAGES].join(", ")}`,
      });
      return;
    }

    // Validate startMs
    if (startMs === undefined || startMs === null) {
      res.status(400).json({ error: "Missing required field: startMs" });
      return;
    }
    if (typeof startMs !== "number") {
      res.status(400).json({ error: "startMs must be a number" });
      return;
    }

    // Validate endMs
    if (endMs === undefined || endMs === null) {
      res.status(400).json({ error: "Missing required field: endMs" });
      return;
    }
    if (typeof endMs !== "number") {
      res.status(400).json({ error: "endMs must be a number" });
      return;
    }

    const record = profiler.record(sessionId, stage as PipelineStage, startMs, endMs);
    res.status(201).json(record);
  });

  // ── DELETE /:sessionId/profile ───────────────────────────────────────
  // Clears all timing records for the session (204). Returns 404 if the
  // session has no profile.

  router.delete("/:sessionId/profile", (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const profile = profiler.getProfile(sessionId);
    if (!profile) {
      res.status(404).json({ error: `No profile found for session '${sessionId}'` });
      return;
    }

    profiler.clearProfile(sessionId);
    res.status(204).send();
  });

  return router;
}
