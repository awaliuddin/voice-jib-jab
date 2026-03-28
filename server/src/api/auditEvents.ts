import { Router } from "express";
import type { AuditEventLogger, AuditEventType } from "../services/AuditEventLogger.js";

/** Router for /audit — SSE live-tail stream and queryable audit event log. */
export function createAuditEventsRouter(logger: AuditEventLogger): Router {
  const router = Router();

  // GET /audit/events/stream — SSE live tail of audit events.
  // Registered before /events (parameterised) to avoid Express shadowing.
  router.get("/events/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Catch-up: send last 50 events
    const recent = logger.getRecent(50);
    for (const ev of recent) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    const onEvent = (ev: Parameters<typeof logger.on>[1] extends (ev: infer E) => void ? E : never) => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    logger.on("event", onEvent);

    req.on("close", () => {
      logger.off("event", onEvent);
    });
  });

  // GET /audit/events — queryable log
  router.get("/events", (req, res) => {
    const { tenantId, type, from, to, limit } = req.query;
    const filters: Parameters<typeof logger.query>[0] = {};
    if (tenantId && typeof tenantId === "string") filters.tenantId = tenantId;
    if (type && typeof type === "string") filters.type = type as AuditEventType;
    if (from && typeof from === "string") filters.from = from;
    if (to && typeof to === "string") filters.to = to;
    if (limit && typeof limit === "string") {
      const n = parseInt(limit, 10);
      if (!isNaN(n) && n > 0) filters.limit = n;
    }
    res.json(logger.query(filters));
  });

  return router;
}
