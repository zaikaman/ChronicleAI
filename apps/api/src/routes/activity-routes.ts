// Public activity routes: GET /activity
// Returns agent activity data aggregated from multiple tables (no auth)

import { Router, type Router as RouterType } from "express";
import type { AgentActivityService } from "../services/agent-activity-service.ts";

export function createActivityRoutes(activityService: AgentActivityService): RouterType {
  const router: RouterType = Router();

  /**
   * GET /activity
   *
   * Public endpoint. Returns aggregated agent activity including recent alerts,
   * digests, payments, treasury status, active sponsored watches,
   * payout records, and execution logs.
   *
   * Responses:
   *   200 - { alerts, digests, payments, treasury, executionLogs }
   */
  router.get("/activity", async (_req, res, next) => {
    try {
      const result = await activityService.getActivity();

      if (!result.success) {
        res.status(500).json({ error: result.error ?? "Failed to fetch activity data" });
        return;
      }

      res.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
