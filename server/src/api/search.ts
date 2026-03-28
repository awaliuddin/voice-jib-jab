/**
 * Search API Router — full-text search over conversation transcripts.
 *
 * Endpoints:
 *   GET /search/conversations          — search transcript hits
 *   GET /search/conversations/:id/summary — get session summary
 */

import { Router } from "express";
import type { ConversationSearchService, SearchFilters } from "../services/ConversationSearchService.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidIsoDate(value: string): boolean {
  const ms = Date.parse(value);
  return !isNaN(ms);
}

const VALID_SPEAKERS = new Set(["user", "assistant", "both"]);

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/** Router for /search — full-text conversation transcript search and session summaries. */
export function createSearchRouter(searchService: ConversationSearchService): Router {
  const router = Router();

  /**
   * GET /search/conversations
   *
   * Query params:
   *   keyword, speaker, tenantId, from, to, sentiment, policyDecision, limit, offset
   *
   * Returns ConversationSearchResult (200).
   * Returns 400 on invalid input.
   */
  router.get("/conversations", async (req, res) => {
    const {
      keyword,
      speaker,
      tenantId,
      from,
      to,
      sentiment,
      policyDecision,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    // Validate speaker
    if (speaker !== undefined && !VALID_SPEAKERS.has(speaker)) {
      res.status(400).json({
        error: `Invalid speaker value "${speaker}". Must be "user", "assistant", or "both".`,
      });
      return;
    }

    // Validate from date
    if (from !== undefined && !isValidIsoDate(from)) {
      res.status(400).json({
        error: `Invalid "from" date: "${from}". Must be a valid ISO date string.`,
      });
      return;
    }

    // Validate to date
    if (to !== undefined && !isValidIsoDate(to)) {
      res.status(400).json({
        error: `Invalid "to" date: "${to}". Must be a valid ISO date string.`,
      });
      return;
    }

    // Parse and validate limit
    let limit: number | undefined;
    if (limitStr !== undefined) {
      limit = parseInt(limitStr, 10);
      if (isNaN(limit) || limit < 0) {
        res.status(400).json({ error: `Invalid "limit" value: "${limitStr}".` });
        return;
      }
      if (limit > 100) {
        res.status(400).json({
          error: `"limit" must not exceed 100. Received ${limit}.`,
        });
        return;
      }
    }

    // Parse offset
    let offset: number | undefined;
    if (offsetStr !== undefined) {
      offset = parseInt(offsetStr, 10);
      if (isNaN(offset) || offset < 0) {
        res.status(400).json({ error: `Invalid "offset" value: "${offsetStr}".` });
        return;
      }
    }

    const filters: SearchFilters = {
      keyword,
      speaker: speaker as SearchFilters["speaker"],
      tenantId,
      from,
      to,
      sentiment,
      policyDecision,
      limit,
      offset,
    };

    try {
      const result = await searchService.search(filters);
      res.status(200).json(result);
    } catch (err) {
      console.error("[Search] search() failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /search/conversations/:sessionId/summary
   *
   * Returns SessionSummary (200) or 404 when not found.
   */
  router.get("/conversations/:sessionId/summary", async (req, res) => {
    const { sessionId } = req.params;

    try {
      const summary = await searchService.getSessionSummary(sessionId);
      if (!summary) {
        res.status(404).json({ error: `Session "${sessionId}" not found.` });
        return;
      }
      res.status(200).json(summary);
    } catch (err) {
      console.error("[Search] getSessionSummary() failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
