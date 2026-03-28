/**
 * Conversation Analytics API Router
 *
 * Endpoints:
 *   GET /analytics/conversations/insights  — full ConversationInsights report
 *   GET /analytics/conversations/dashboard — self-contained HTML dashboard
 */

import { Router } from "express";
import type { ConversationAnalyticsService } from "../services/ConversationAnalyticsService.js";
import { conversationAnalyticsDashboardHtml } from "./conversationAnalyticsDashboard.js";

/** Router for /analytics/conversations — conversation insights report and HTML dashboard. */
export function createConversationAnalyticsRouter(
  service: ConversationAnalyticsService,
): Router {
  const router = Router();

  /**
   * GET /analytics/conversations/insights
   *
   * Query params: tenantId, from, to, maxSessions
   * Returns ConversationInsights (200).
   * Returns 400 for invalid dates or maxSessions > 1000.
   */
  router.get("/insights", async (req, res) => {
    const { tenantId, from, to, maxSessions: maxSessionsStr } = req.query as Record<
      string,
      string | undefined
    >;

    // Validate from date
    if (from !== undefined && from !== "") {
      if (isNaN(Date.parse(from))) {
        res.status(400).json({ error: "from must be a valid ISO date string" });
        return;
      }
    }

    // Validate to date
    if (to !== undefined && to !== "") {
      if (isNaN(Date.parse(to))) {
        res.status(400).json({ error: "to must be a valid ISO date string" });
        return;
      }
    }

    // Validate maxSessions
    let maxSessions: number | undefined;
    if (maxSessionsStr !== undefined && maxSessionsStr !== "") {
      maxSessions = parseInt(maxSessionsStr, 10);
      if (isNaN(maxSessions) || maxSessions > 1000) {
        res.status(400).json({ error: "maxSessions must be an integer <= 1000" });
        return;
      }
    }

    try {
      const insights = await service.generateInsights({
        tenantId: tenantId || undefined,
        from: from || undefined,
        to: to || undefined,
        maxSessions,
      });
      res.json(insights);
    } catch (err) {
      res.status(500).json({ error: "Failed to generate insights" });
    }
  });

  /**
   * GET /analytics/conversations/dashboard
   *
   * Returns self-contained HTML analytics dashboard (200).
   */
  router.get("/dashboard", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(conversationAnalyticsDashboardHtml());
  });

  return router;
}
