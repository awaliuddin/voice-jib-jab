/**
 * KB Search API Router — live knowledge base search endpoints.
 *
 * Endpoints:
 *   POST /kb-search             — search KB for a query within a tenant
 *   GET  /kb-search/suggest     — suggest KB articles from a transcript snippet
 */

import { Router } from "express";
import type { LiveKbSearchService } from "../services/LiveKbSearchService.js";

// ── Router factory ────────────────────────────────────────────────────

export function createKbSearchRouter(service: LiveKbSearchService): Router {
  const router = Router();

  /**
   * POST /kb-search
   *
   * Body: { query: string, tenantId: string }
   * Returns: KbSearchResponse (200)
   * Errors: 400 if query is empty/missing, 400 if tenantId is missing
   */
  router.post("/", async (req, res): Promise<void> => {
    const { query, tenantId } = req.body ?? {};

    if (typeof tenantId !== "string" || tenantId.length === 0) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    if (typeof query !== "string" || query.trim().length === 0) {
      res.status(400).json({ error: "query is required and must not be empty" });
      return;
    }

    const result = await service.search(query, tenantId);
    res.json(result);
  });

  /**
   * GET /kb-search/suggest
   *
   * Query params: text, tenantId
   * Calls extractSearchTerms(text) then search() and returns results.
   * Errors: 400 if text is empty/missing, 400 if tenantId is missing
   */
  router.get("/suggest", async (req, res): Promise<void> => {
    const text =
      typeof req.query.text === "string" ? req.query.text : "";
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : "";

    if (tenantId.length === 0) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    if (text.trim().length === 0) {
      res.status(400).json({ error: "text is required and must not be empty" });
      return;
    }

    const query = service.extractSearchTerms(text);
    const result = await service.search(query, tenantId);
    res.json(result);
  });

  return router;
}
