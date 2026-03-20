/**
 * Capacity Planner Router
 *
 * Routes:
 *   POST /capacity/calculate  — compute a CapacityRecommendation
 *   GET  /capacity/calculator — self-contained HTML calculator UI
 */

import { Router } from "express";
import type { CapacityPlannerService } from "../services/CapacityPlannerService.js";
import { capacityCalculatorHtml } from "./capacityCalculatorHtml.js";

const VALID_DEPLOYMENT_TARGETS = new Set([
  "single_server",
  "docker",
  "kubernetes",
]);

/**
 * Create the capacity planner router.
 *
 * @param service - CapacityPlannerService instance to delegate computation to
 * @returns Express Router to be mounted at /capacity
 */
export function createCapacityPlannerRouter(
  service: CapacityPlannerService,
): Router {
  const router = Router();

  // ── POST /capacity/calculate ─────────────────────────────────────────────

  router.post("/calculate", (req, res) => {
    const body = req.body as Record<string, unknown>;

    // Validate peakConcurrentSessions
    if (
      body.peakConcurrentSessions === undefined ||
      body.peakConcurrentSessions === null
    ) {
      res.status(400).json({ error: "peakConcurrentSessions is required" });
      return;
    }
    const peakConcurrentSessions = Number(body.peakConcurrentSessions);
    if (!isFinite(peakConcurrentSessions) || peakConcurrentSessions <= 0) {
      res
        .status(400)
        .json({ error: "peakConcurrentSessions must be greater than 0" });
      return;
    }

    // Validate avgSessionDurationMinutes
    if (
      body.avgSessionDurationMinutes === undefined ||
      body.avgSessionDurationMinutes === null
    ) {
      res
        .status(400)
        .json({ error: "avgSessionDurationMinutes is required" });
      return;
    }
    const avgSessionDurationMinutes = Number(body.avgSessionDurationMinutes);
    if (!isFinite(avgSessionDurationMinutes) || avgSessionDurationMinutes <= 0) {
      res
        .status(400)
        .json({ error: "avgSessionDurationMinutes must be greater than 0" });
      return;
    }

    // Validate dailyCallVolume
    if (
      body.dailyCallVolume === undefined ||
      body.dailyCallVolume === null
    ) {
      res.status(400).json({ error: "dailyCallVolume is required" });
      return;
    }
    const dailyCallVolume = Number(body.dailyCallVolume);
    if (!isFinite(dailyCallVolume) || dailyCallVolume < 0) {
      res
        .status(400)
        .json({ error: "dailyCallVolume must be 0 or greater" });
      return;
    }

    // Validate deploymentTarget
    const deploymentTarget = body.deploymentTarget as string | undefined;
    if (deploymentTarget !== undefined && !VALID_DEPLOYMENT_TARGETS.has(deploymentTarget)) {
      res.status(400).json({
        error: `deploymentTarget must be one of: ${[...VALID_DEPLOYMENT_TARGETS].join(", ")}`,
      });
      return;
    }

    const input = {
      peakConcurrentSessions,
      avgSessionDurationMinutes,
      dailyCallVolume,
      recordingsEnabled: Boolean(body.recordingsEnabled),
      recordingRetentionDays: Number(body.recordingRetentionDays ?? 0),
      ragEnabled: Boolean(body.ragEnabled),
      sentimentAnalysisEnabled: Boolean(body.sentimentAnalysisEnabled),
      policyEvaluationEnabled: Boolean(body.policyEvaluationEnabled),
      deploymentTarget: (deploymentTarget ?? "single_server") as
        | "single_server"
        | "docker"
        | "kubernetes",
    };

    const recommendation = service.calculate(input);
    res.json(recommendation);
  });

  // ── GET /capacity/calculator ─────────────────────────────────────────────

  router.get("/calculator", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(capacityCalculatorHtml());
  });

  return router;
}
