/**
 * Onboarding Wizard API
 *
 * POST   /onboarding/sessions                        — start a wizard session
 * GET    /onboarding/sessions/:sessionId             — get wizard state
 * GET    /onboarding/tenants/:tenantId               — get wizard state by tenant
 * POST   /onboarding/sessions/:sessionId/complete-step — advance step
 * POST   /onboarding/sessions/:sessionId/skip        — skip current step
 * POST   /onboarding/sessions/:sessionId/back        — go back one step
 * POST   /onboarding/sessions/:sessionId/reset       — reset wizard
 * GET    /onboarding/wizard                          — self-contained HTML wizard UI
 */

import { Router } from "express";
import type { OnboardingWizardService } from "../services/OnboardingWizardService.js";
import { onboardingWizardHtml } from "./onboardingWizardHtml.js";

// ── Router factory ─────────────────────────────────────────────────────

export function createOnboardingRouter(service: OnboardingWizardService): Router {
  const router = Router();

  // ── GET /onboarding/wizard ─────────────────────────────────────────

  /**
   * Self-contained HTML wizard UI.
   */
  router.get("/wizard", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(onboardingWizardHtml());
  });

  // ── POST /onboarding/sessions ──────────────────────────────────────

  /**
   * Start a new wizard session for a tenant.
   *
   * Body: { tenantId: string }
   * Returns: OnboardingSession (201)
   * Errors: 400 when tenantId missing, 409 when session already exists
   */
  router.post("/sessions", (req, res) => {
    const { tenantId } = req.body as { tenantId?: unknown };

    if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    const existing = service.getSessionByTenant(tenantId.trim());
    if (existing) {
      res.status(409).json(existing);
      return;
    }

    const session = service.createSession(tenantId.trim());
    res.status(201).json(session);
  });

  // ── GET /onboarding/sessions/:sessionId ───────────────────────────

  /**
   * Get wizard state by session ID.
   *
   * Returns: OnboardingSession (200)
   * Errors: 404 when not found
   */
  router.get("/sessions/:sessionId", (req, res) => {
    const session = service.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  });

  // ── GET /onboarding/tenants/:tenantId ─────────────────────────────

  /**
   * Get wizard state by tenant ID.
   *
   * Returns: OnboardingSession (200)
   * Errors: 404 when no session exists for this tenant
   */
  router.get("/tenants/:tenantId", (req, res) => {
    const session = service.getSessionByTenant(req.params.tenantId);
    if (!session) {
      res.status(404).json({ error: "No session found for tenant" });
      return;
    }
    res.json(session);
  });

  // ── POST /onboarding/sessions/:sessionId/complete-step ────────────

  /**
   * Complete the current step and advance the wizard.
   *
   * Body: StepCompletionPayload
   * Returns: OnboardingSession (200)
   * Errors: 400 on validation failure (includes validationErrors), 404 if not found
   */
  router.post("/sessions/:sessionId/complete-step", (req, res) => {
    const { sessionId } = req.params;
    const session = service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      const updated = service.completeStep(sessionId, req.body ?? {});
      res.json(updated);
    } catch (err: unknown) {
      const e = err as Error & { validationErrors?: string[] };
      if (e.validationErrors && e.validationErrors.length > 0) {
        res.status(400).json({
          error: e.message,
          validationErrors: e.validationErrors,
        });
        return;
      }
      res.status(400).json({ error: e.message ?? "Unknown error" });
    }
  });

  // ── POST /onboarding/sessions/:sessionId/skip ─────────────────────

  /**
   * Skip the current step.
   *
   * Returns: OnboardingSession (200)
   * Errors: 404 if not found
   */
  router.post("/sessions/:sessionId/skip", (req, res) => {
    const { sessionId } = req.params;
    const session = service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      const updated = service.skipStep(sessionId);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as Error;
      res.status(400).json({ error: e.message ?? "Unknown error" });
    }
  });

  // ── POST /onboarding/sessions/:sessionId/back ─────────────────────

  /**
   * Go back to the previous step.
   *
   * Returns: OnboardingSession (200)
   * Errors: 404 if not found
   */
  router.post("/sessions/:sessionId/back", (req, res) => {
    const { sessionId } = req.params;
    const session = service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      const updated = service.goBack(sessionId);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as Error;
      res.status(400).json({ error: e.message ?? "Unknown error" });
    }
  });

  // ── POST /onboarding/sessions/:sessionId/reset ────────────────────

  /**
   * Reset the wizard to the beginning.
   *
   * Returns: OnboardingSession (200)
   * Errors: 404 if not found
   */
  router.post("/sessions/:sessionId/reset", (req, res) => {
    const { sessionId } = req.params;
    const session = service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      const updated = service.resetSession(sessionId);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as Error;
      res.status(400).json({ error: e.message ?? "Unknown error" });
    }
  });

  return router;
}
