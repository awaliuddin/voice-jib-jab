/**
 * Demo API Router — HTTP endpoints for the self-contained voice agent demo mode.
 *
 * Endpoints:
 *   GET    /demo/scenarios            — list all available demo scenarios
 *   GET    /demo/scenarios/:id        — get a single scenario by id
 *   POST   /demo/start                — start a demo playback session
 *   GET    /demo/events/:sessionId    — poll playback events for a session
 *   DELETE /demo/session/:sessionId   — stop and remove a session
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { DemoPlayer } from "../demo/DemoPlayer.js";
import {
  listDemoScenarios,
  getDemoScenario,
  type DemoScenarioId,
} from "../demo/fixtures.js";

// ── Module-level session store ────────────────────────────────────────

const activeSessions = new Map<string, DemoPlayer>();

/** Exported for test isolation — reset between test suites. */
export function _clearActiveSessions(): void {
  activeSessions.clear();
}

// ── Validation helpers ────────────────────────────────────────────────

const VALID_SCENARIO_IDS: ReadonlySet<string> = new Set([
  "support",
  "compliance",
  "sales",
]);

function isValidScenarioId(id: unknown): id is DemoScenarioId {
  return typeof id === "string" && VALID_SCENARIO_IDS.has(id);
}

/** Clamp speed to [0, 5]. Returns null if the value type is wrong. */
function parseSpeed(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 1;
  if (typeof raw !== "number") return null;
  return Math.min(5, Math.max(0, raw));
}

// ── Router factory ────────────────────────────────────────────────────

/**
 * Create an Express router for the demo mode endpoints.
 *
 * The router maintains a module-level Map of active DemoPlayer instances
 * keyed by sessionId. Sessions persist until explicitly deleted or the
 * process restarts.
 *
 * @returns Configured Express Router
 */
export function createDemoRouter(): Router {
  const router = Router();

  // ── GET /demo/scenarios ──────────────────────────────────────────

  /**
   * List all available demo scenarios.
   *
   * Response body:
   *   scenarios — array of DemoScenario objects
   *   count     — number of scenarios
   */
  router.get("/scenarios", (_req: Request, res: Response) => {
    try {
      const scenarios = listDemoScenarios();
      res.json({ scenarios, count: scenarios.length });
    } catch (err) {
      console.error("[Demo API] GET /scenarios error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── GET /demo/scenarios/:id ──────────────────────────────────────

  /**
   * Get a single demo scenario by ID.
   *
   * Response body:
   *   scenario — DemoScenario object
   *
   * Errors:
   *   404 — unknown scenario id
   */
  router.get("/scenarios/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isValidScenarioId(id)) {
        res.status(404).json({ error: `Scenario '${id}' not found` });
        return;
      }

      const scenario = getDemoScenario(id);
      res.json({ scenario });
    } catch (err) {
      console.error("[Demo API] GET /scenarios/:id error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── POST /demo/start ─────────────────────────────────────────────

  /**
   * Start a new demo playback session.
   *
   * Request body:
   *   scenarioId — required; "support" | "compliance" | "sales"
   *   speed      — optional; number 0-5 (default 1); values > 5 are clamped to 5
   *
   * Response body:
   *   sessionId  — unique session identifier
   *   scenarioId — echo of the requested scenario
   *   startedAt  — ISO timestamp of when playback started
   *
   * Errors:
   *   400 — missing or invalid scenarioId; invalid speed type
   */
  router.post("/start", async (req: Request, res: Response) => {
    try {
      const { scenarioId, speed } = req.body ?? {};

      if (!scenarioId) {
        res.status(400).json({ error: "scenarioId is required" });
        return;
      }

      if (!isValidScenarioId(scenarioId)) {
        res
          .status(400)
          .json({ error: `Invalid scenarioId '${scenarioId}'. Must be one of: support, compliance, sales` });
        return;
      }

      const resolvedSpeed = parseSpeed(speed);
      if (resolvedSpeed === null) {
        res.status(400).json({ error: "speed must be a number between 0 and 5" });
        return;
      }

      const player = new DemoPlayer({ speedMultiplier: resolvedSpeed, scenarioId });
      const sessionId = await player.play(scenarioId);

      activeSessions.set(sessionId, player);

      res.json({
        sessionId,
        scenarioId,
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[Demo API] POST /start error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── GET /demo/events/:sessionId ──────────────────────────────────

  /**
   * Poll playback events for an active or completed session.
   *
   * Response body:
   *   events    — array of DemoPlaybackEvent objects emitted so far
   *   playing   — whether the player is still actively emitting events
   *   sessionId — echo of the requested sessionId
   *
   * Errors:
   *   404 — unknown sessionId
   */
  router.get("/events/:sessionId", (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const player = activeSessions.get(sessionId);

      if (!player) {
        res.status(404).json({ error: `Session '${sessionId}' not found` });
        return;
      }

      res.json({
        events: player.getEvents(sessionId),
        playing: player.isPlaying(),
        sessionId,
      });
    } catch (err) {
      console.error("[Demo API] GET /events/:sessionId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── DELETE /demo/session/:sessionId ──────────────────────────────

  /**
   * Stop and remove a demo session.
   *
   * Response: 204 No Content on success.
   *
   * Errors:
   *   404 — unknown sessionId
   */
  router.delete("/session/:sessionId", (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      if (!activeSessions.has(sessionId)) {
        res.status(404).json({ error: `Session '${sessionId}' not found` });
        return;
      }

      activeSessions.delete(sessionId);
      res.status(204).send();
    } catch (err) {
      console.error("[Demo API] DELETE /session/:sessionId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
