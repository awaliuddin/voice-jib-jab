/**
 * Agent A/B Test API
 *
 * GET    /abtests                    — list all tests (filter: ?tenantId=X&status=active)
 * POST   /abtests                    — create a new test
 * GET    /abtests/:testId            — get test + full report
 * POST   /abtests/:testId/assign     — assign a session to a variant
 * POST   /abtests/:testId/metrics    — record session metrics
 * POST   /abtests/:testId/conclude   — conclude test (auto or manual winner)
 * POST   /abtests/:testId/pause      — pause test
 * POST   /abtests/:testId/resume     — resume test
 * DELETE /abtests/:testId            — delete test + all session data
 */

import { Router } from "express";
import type { AgentAbTestService } from "../services/AgentAbTestService.js";

// ── Validation helpers ─────────────────────────────────────────────────

/**
 * Return a non-empty string from an unknown value, or null when the value
 * is absent or not a non-empty string.
 */
function requireString(value: unknown, field: string): { value: string } | { error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${field} is required and must be a non-empty string` };
  }
  return { value: value.trim() };
}

/**
 * Validate that splitRatio is in the range [0, 1].
 * Returns an error string when invalid, or null when valid.
 */
function validateSplitRatio(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return "splitRatio must be a number between 0 and 1 inclusive";
  }
  return null;
}

// ── Router factory ─────────────────────────────────────────────────────

export function createAbTestsRouter(svc: AgentAbTestService): Router {
  const router = Router();

  // ── GET /abtests ────────────────────────────────────────────────────

  /**
   * List all A/B tests, with optional filtering by tenantId and status.
   *
   * Query params:
   *   tenantId — filter to tests belonging to this tenant
   *   status   — filter by test status ("active" | "paused" | "concluded")
   *
   * Returns: { tests: AgentAbTest[], total: number }
   */
  router.get("/", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const statusFilter =
      typeof req.query.status === "string" ? req.query.status : undefined;

    let tests = svc.listTests(tenantId);

    if (statusFilter !== undefined) {
      tests = tests.filter((t) => t.status === statusFilter);
    }

    res.json({ tests, total: tests.length });
  });

  // ── POST /abtests ───────────────────────────────────────────────────

  /**
   * Create a new A/B test.
   *
   * Body: { name, tenantId?, hypothesis?, variantA, variantB, splitRatio?, minSamplesPerVariant? }
   *
   * Returns 201 + the created AgentAbTest on success.
   * Returns 400 when required fields are missing or splitRatio is out of range.
   */
  router.post("/", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const nameResult = requireString(body.name, "name");
    if ("error" in nameResult) {
      res.status(400).json({ error: nameResult.error });
      return;
    }

    const variantA = body.variantA as Record<string, unknown> | undefined;
    const variantB = body.variantB as Record<string, unknown> | undefined;

    if (!variantA || typeof variantA !== "object") {
      res.status(400).json({ error: "variantA is required" });
      return;
    }
    if (!variantB || typeof variantB !== "object") {
      res.status(400).json({ error: "variantB is required" });
      return;
    }

    const variantANameResult = requireString(variantA.name, "variantA.name");
    if ("error" in variantANameResult) {
      res.status(400).json({ error: variantANameResult.error });
      return;
    }

    const variantBNameResult = requireString(variantB.name, "variantB.name");
    if ("error" in variantBNameResult) {
      res.status(400).json({ error: variantBNameResult.error });
      return;
    }

    const splitRatioError = validateSplitRatio(body.splitRatio);
    if (splitRatioError !== null) {
      res.status(400).json({ error: splitRatioError });
      return;
    }

    const test = svc.createTest({
      name: nameResult.value,
      tenantId:
        typeof body.tenantId === "string" ? body.tenantId : null,
      hypothesis:
        typeof body.hypothesis === "string" ? body.hypothesis : undefined,
      variantA: variantA as never,
      variantB: variantB as never,
      splitRatio:
        body.splitRatio !== undefined ? Number(body.splitRatio) : undefined,
      minSamplesPerVariant:
        typeof body.minSamplesPerVariant === "number"
          ? body.minSamplesPerVariant
          : undefined,
    });

    res.status(201).json(test);
  });

  // ── GET /abtests/:testId ────────────────────────────────────────────

  /**
   * Return the full AgentAbTestReport for a test, including variant stats
   * and winner suggestion.
   *
   * Returns 404 when the testId is not recognised.
   */
  router.get("/:testId", (req, res) => {
    const { testId } = req.params;
    const report = svc.getReport(testId);

    if (!report) {
      res.status(404).json({ error: `Test not found: ${testId}` });
      return;
    }

    res.json(report);
  });

  // ── POST /abtests/:testId/assign ────────────────────────────────────

  /**
   * Assign a session to variant A or B for this test.
   *
   * Body: { sessionId: string }
   *
   * Returns: { variant, config, testId, sessionId }
   * Returns 400 when sessionId is missing, 404 when the test is not found.
   */
  router.post("/:testId/assign", (req, res) => {
    const { testId } = req.params;
    const body = req.body as Record<string, unknown>;

    const sessionIdResult = requireString(body.sessionId, "sessionId");
    if ("error" in sessionIdResult) {
      res.status(400).json({ error: sessionIdResult.error });
      return;
    }

    const assignment = svc.assignSession(testId, sessionIdResult.value);

    if (!assignment) {
      res.status(404).json({ error: `Test not found or not active: ${testId}` });
      return;
    }

    res.json({
      testId,
      sessionId: sessionIdResult.value,
      variant: assignment.variant,
      config: assignment.config,
    });
  });

  // ── POST /abtests/:testId/metrics ───────────────────────────────────

  /**
   * Record outcome metrics for a session that was assigned to this test.
   *
   * Body: { sessionId, qualityScore?, durationMs?, turnCount?, escalated?, ttfbMs? }
   *
   * Returns 204 on success.
   * Returns 400 when sessionId is missing.
   * Returns 404 when the session has no prior assignment to this test.
   */
  router.post("/:testId/metrics", (req, res) => {
    const { testId } = req.params;
    const body = req.body as Record<string, unknown>;

    const sessionIdResult = requireString(body.sessionId, "sessionId");
    if ("error" in sessionIdResult) {
      res.status(400).json({ error: sessionIdResult.error });
      return;
    }

    const recorded = svc.recordMetrics(testId, sessionIdResult.value, {
      qualityScore:
        typeof body.qualityScore === "number" ? body.qualityScore : undefined,
      durationMs:
        typeof body.durationMs === "number" ? body.durationMs : undefined,
      turnCount:
        typeof body.turnCount === "number" ? body.turnCount : undefined,
      escalated:
        typeof body.escalated === "boolean" ? body.escalated : undefined,
      ttfbMs:
        typeof body.ttfbMs === "number" ? body.ttfbMs : undefined,
    });

    if (!recorded) {
      res
        .status(404)
        .json({
          error: `Session ${sessionIdResult.value} not assigned to test ${testId}`,
        });
      return;
    }

    res.status(204).send();
  });

  // ── POST /abtests/:testId/conclude ──────────────────────────────────

  /**
   * Conclude a test, optionally supplying an explicit winner override.
   *
   * Body: { winner?: "A" | "B" | "none" }
   *
   * Returns 200 + the updated AgentAbTest, or 404 when not found.
   */
  router.post("/:testId/conclude", (req, res) => {
    const { testId } = req.params;
    const body = req.body as Record<string, unknown>;

    const winner =
      body.winner === "A" || body.winner === "B" || body.winner === "none"
        ? (body.winner as "A" | "B" | "none")
        : undefined;

    const test = svc.concludeTest(testId, winner);

    if (!test) {
      res.status(404).json({ error: `Test not found: ${testId}` });
      return;
    }

    res.json(test);
  });

  // ── POST /abtests/:testId/pause ─────────────────────────────────────

  /**
   * Pause an active test.
   *
   * Returns 200 + updated test, or 404 when not found.
   */
  router.post("/:testId/pause", (req, res) => {
    const { testId } = req.params;
    const test = svc.pauseTest(testId);

    if (!test) {
      res.status(404).json({ error: `Test not found: ${testId}` });
      return;
    }

    res.json(test);
  });

  // ── POST /abtests/:testId/resume ────────────────────────────────────

  /**
   * Resume a paused test.
   *
   * Returns 200 + updated test, or 404 when not found.
   */
  router.post("/:testId/resume", (req, res) => {
    const { testId } = req.params;
    const test = svc.resumeTest(testId);

    if (!test) {
      res.status(404).json({ error: `Test not found: ${testId}` });
      return;
    }

    res.json(test);
  });

  // ── DELETE /abtests/:testId ─────────────────────────────────────────

  /**
   * Delete a test and all its session data.
   *
   * Returns 204 on success, 404 when the test does not exist.
   */
  router.delete("/:testId", (req, res) => {
    const { testId } = req.params;
    const deleted = svc.deleteTest(testId);

    if (!deleted) {
      res.status(404).json({ error: `Test not found: ${testId}` });
      return;
    }

    res.status(204).send();
  });

  return router;
}
