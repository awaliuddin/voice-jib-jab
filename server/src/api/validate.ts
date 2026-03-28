/**
 * Validate API
 *
 * POST /validate — validate voice agent configuration before a session starts
 *
 * Returns 200 with a ConfigValidationResponse regardless of whether the
 * configuration is valid (valid:false means the session should be blocked,
 * but the validation endpoint itself succeeded). Returns 400 only when the
 * request body is structurally malformed.
 */

import { Router, type Request, type Response } from "express";
import type { ConfigValidator, ConfigValidationRequest } from "../services/ConfigValidator.js";

// ── Router factory ────────────────────────────────────────────────────

/** Router for /validate — pre-session voice agent configuration validation. */
export function createValidateRouter(validator: ConfigValidator): Router {
  const router = Router();

  /**
   * POST /validate
   *
   * Body: ConfigValidationRequest (all fields optional)
   *
   * Returns:
   *   200 — ConfigValidationResponse (valid:true or valid:false)
   *   400 — body is not a JSON object
   */
  router.post("/", async (req: Request, res: Response) => {
    const body = req.body;

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    const validationReq = body as ConfigValidationRequest;

    try {
      const result = await validator.validate(validationReq);
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
