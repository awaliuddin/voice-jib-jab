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
import { ConversationSummarizer } from "../services/ConversationSummarizer.js";

const summarizer = new ConversationSummarizer();

/** Router for /sessions — list, get, replay, summarize, and compliance-export recorded sessions. */
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
   * GET /sessions/:id/summary — structured conversation summary.
   */
  router.get("/:id/summary", (req, res) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }
    const recording = recorder.loadRecording(req.params.id);
    if (!recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    // Reconstruct transcript turns from timeline events
    const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (const entry of recording.timeline) {
      const p = entry.payload as Record<string, unknown> | undefined;
      if (!p?.text || typeof p.text !== "string") continue;
      if (entry.type === "user_transcript" && p.isFinal) {
        turns.push({ role: "user", text: p.text });
      } else if (entry.type === "transcript" && p.isFinal) {
        turns.push({ role: "assistant", text: p.text });
      }
    }

    // Rebuild sentiment readings from recording summary if available
    const sentimentReadings = recording.summary.sentiment
      ? [{ sentiment: recording.summary.sentiment.dominantSentiment, score: recording.summary.sentiment.averageScore }]
      : undefined;

    const summary = summarizer.summarize(req.params.id, turns, {
      durationMs: recording.durationMs ?? undefined,
      sentimentReadings,
    });

    res.json(summary);
  });

  /**
   * GET /sessions/:id/compliance — structured compliance audit export (JSON).
   * Returns all policy decisions, claims checks, escalations with timestamps.
   * Suitable for EU AI Act / enterprise audit requirements.
   */
  router.get("/:id/compliance", (req, res) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }
    const recording = recorder.loadRecording(req.params.id);
    if (!recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    // Extract compliance-relevant events from timeline
    const policyDecisions: Array<{ t_ms: number; decision: string; reason?: string; claim?: string }> = [];
    const escalations: Array<{ t_ms: number; reason?: string }> = [];
    const claimsChecked: Array<{ t_ms: number; claim: string; result: string }> = [];

    for (const entry of recording.timeline) {
      const p = entry.payload as Record<string, unknown> | undefined;
      if (entry.type === "policy.decision" && p) {
        policyDecisions.push({
          t_ms: entry.t_ms,
          decision: (p.decision as string) ?? "unknown",
          reason: p.reason as string | undefined,
          claim: p.claim as string | undefined,
        });
        if (p.decision === "escalate") {
          escalations.push({ t_ms: entry.t_ms, reason: p.reason as string | undefined });
        }
      }
      if (entry.type === "claims.check" && p) {
        claimsChecked.push({
          t_ms: entry.t_ms,
          claim: (p.claim as string) ?? "",
          result: (p.result as string) ?? "unknown",
        });
      }
    }

    res.json({
      sessionId: req.params.id,
      exportedAt: new Date().toISOString(),
      session: {
        startedAt: recording.startedAt,
        endedAt: recording.endedAt,
        durationMs: recording.durationMs,
        tenantId: recording.tenantId,
        turnCount: recording.summary.turnCount,
      },
      compliance: {
        policyDecisionCount: policyDecisions.length,
        policyDecisions,
        escalationCount: escalations.length,
        escalations,
        claimsCheckedCount: claimsChecked.length,
        claimsChecked,
        sentimentEscalation: recording.summary.sentiment?.escalationTriggered ?? false,
      },
      meta: {
        standard: "EU AI Act Article 13 — Transparency obligations",
        generatedBy: "voice-jib-jab compliance engine",
      },
    });
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
