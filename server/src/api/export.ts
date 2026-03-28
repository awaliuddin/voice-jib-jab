/**
 * Export API Router — HTTP endpoints for exporting session data.
 *
 * Endpoints:
 *   GET /export/sessions        — bulk export with optional filters
 *   GET /export/sessions/:id    — single session export
 *
 * Supports both application/json (default) and application/x-ndjson
 * for the bulk endpoint.
 */

import { Router, type Request, type Response } from "express";
import type { SessionExportService, ExportFilters } from "../services/SessionExportService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidIso(value: string): boolean {
  const d = new Date(value);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/** Router for /export — bulk and single-session data export as streaming NDJSON. */
export function createExportRouter(exportService: SessionExportService): Router {
  const router = Router();

  /**
   * GET /export/sessions — bulk export
   *
   * Query params:
   *   tenantId        — filter by tenant
   *   from            — ISO date lower bound (inclusive, on startedAt)
   *   to              — ISO date upper bound (inclusive, on startedAt)
   *   sessionIds      — comma-separated list of session IDs (overrides date range)
   *   limit           — max sessions to return (default 50, max 500)
   *   offset          — skip N sessions
   *
   * Accept: application/json (default) — full JSON object
   * Accept: application/x-ndjson      — one JSON line per session
   */
  router.get("/sessions", async (req: Request, res: Response) => {
    const { tenantId, from, to, sessionIds: sessionIdsRaw, limit: limitRaw, offset: offsetRaw } = req.query;

    // Validate from/to
    if (from !== undefined && typeof from === "string" && !isValidIso(from)) {
      res.status(400).json({ error: "Invalid 'from' date — expected ISO 8601 string" });
      return;
    }
    if (to !== undefined && typeof to === "string" && !isValidIso(to)) {
      res.status(400).json({ error: "Invalid 'to' date — expected ISO 8601 string" });
      return;
    }

    // Validate limit
    const limitNum = limitRaw !== undefined ? parseInt(String(limitRaw), 10) : 50;
    if (isNaN(limitNum) || limitNum > 500) {
      res.status(400).json({ error: "Invalid 'limit' — maximum is 500" });
      return;
    }

    const offsetNum = offsetRaw !== undefined ? parseInt(String(offsetRaw), 10) : 0;

    // Parse sessionIds
    let sessionIds: string[] | undefined;
    if (sessionIdsRaw !== undefined && typeof sessionIdsRaw === "string" && sessionIdsRaw.length > 0) {
      sessionIds = sessionIdsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }

    const filters: ExportFilters = {
      limit: limitNum,
      offset: isNaN(offsetNum) ? 0 : offsetNum,
    };

    if (typeof tenantId === "string") {
      filters.tenantId = tenantId;
    }
    if (typeof from === "string") {
      filters.from = from;
    }
    if (typeof to === "string") {
      filters.to = to;
    }
    if (sessionIds !== undefined) {
      filters.sessionIds = sessionIds;
    }

    const result = await exportService.exportBulk(filters);

    const acceptHeader = req.headers["accept"] ?? "";
    if (acceptHeader.includes("application/x-ndjson")) {
      res.setHeader("Content-Type", "application/x-ndjson");
      // Write metadata line first, then one line per session
      res.write(JSON.stringify({
        exportedAt: result.exportedAt,
        totalSessions: result.totalSessions,
        ...(result.from !== undefined ? { from: result.from } : {}),
        ...(result.to !== undefined ? { to: result.to } : {}),
        ...(result.tenantId !== undefined ? { tenantId: result.tenantId } : {}),
      }) + "\n");
      for (const session of result.sessions) {
        res.write(JSON.stringify(session) + "\n");
      }
      res.end();
      return;
    }

    res.json(result);
  });

  /**
   * GET /export/sessions/:sessionId — single session export
   *
   * Returns SessionExport as JSON (200).
   * Returns 404 if session not found.
   */
  router.get("/sessions/:sessionId", async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const exported = await exportService.exportSession(sessionId);
    if (!exported) {
      res.status(404).json({ error: `Session not found: ${sessionId}` });
      return;
    }

    res.json(exported);
  });

  return router;
}
