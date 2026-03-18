/**
 * Sessions API Router — provides HTTP endpoints for listing, viewing,
 * and replaying recorded session data.
 *
 * Endpoints:
 *   GET /sessions          — list all recorded sessions (metadata only)
 *   GET /sessions/:id      — full recording with timeline
 *   GET /sessions/:id/replay — audit trail JSONL timeline (existing infra)
 */

import { Router } from "express";
import type { SessionRecorder } from "../services/SessionRecorder.js";

export function createSessionsRouter(recorder: SessionRecorder): Router {
  const router = Router();

  /**
   * GET /sessions — list all recorded sessions (no timeline).
   */
  router.get("/", (_req, res) => {
    const recordings = recorder.listRecordings();
    res.json(recordings);
  });

  /**
   * GET /sessions/:id — get full recording with timeline.
   */
  router.get("/:id", (req, res) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }
    const recording = recorder.loadRecording(req.params.id);
    if (!recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    res.json(recording);
  });

  /**
   * GET /sessions/:id/replay — timeline loaded from audit JSONL (existing infrastructure).
   * Returns: { sessionId, timeline, summary: { eventCount, policyDecisions } }
   */
  router.get("/:id/replay", async (req, res) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }
    try {
      const { loadSessionTimeline } = await import("../insurance/audit_trail.js");
      const sessionId = req.params.id;
      const timeline = await loadSessionTimeline(sessionId);

      if (timeline.length === 0) {
        res.status(404).json({ error: "No audit trail found for session" });
        return;
      }

      // Build summary from timeline events
      const policyDecisions: Record<string, number> = {};
      for (const event of timeline) {
        if (event.type === "policy.decision") {
          const payload = event.payload as { decision?: string } | null;
          const decision = payload?.decision ?? "unknown";
          policyDecisions[decision] = (policyDecisions[decision] ?? 0) + 1;
        }
      }

      res.json({
        sessionId,
        timeline,
        summary: {
          eventCount: timeline.length,
          policyDecisions,
        },
      });
    } catch (error) {
      console.error("[Sessions] Failed to load replay:", error);
      res.status(500).json({ error: "Failed to load session replay" });
    }
  });

  return router;
}
