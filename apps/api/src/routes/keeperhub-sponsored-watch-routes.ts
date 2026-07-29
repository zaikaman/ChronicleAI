// KeeperHub sponsored-watch campaign cycle route
// POST /keeperhub/sponsored-watches/run
//
// Loop 4 automation trigger: activate due watches, monitor in-window campaigns,
// and complete ended campaigns with report generation + publishSponsoredReport.

import { Router, type Router as RouterType } from "express";
import type { SponsoredWatchService } from "../services/sponsored-watch-service.ts";

export function createKeeperhubSponsoredWatchRoutes(
  watchService: SponsoredWatchService,
): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/sponsored-watches/run
   *
   * Run one sponsored-watch campaign cycle (activate / monitor / complete).
   * Requires valid X-ChronicleAI-Signature (KeeperHub webhook secret).
   *
   * Optional body:
   *   now?: ISO timestamp override (for deterministic tests / backfill)
   *
   * Responses:
   *   200 - Cycle completed (includes counters)
   *   401 - Missing or invalid webhook signature
   */
  router.post("/keeperhub/sponsored-watches/run", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { now?: string };
      let now: Date | undefined;
      if (body.now !== undefined) {
        if (typeof body.now !== "string" || Number.isNaN(Date.parse(body.now))) {
          res.status(400).json({ error: "now must be a valid ISO timestamp when provided" });
          return;
        }
        now = new Date(body.now);
      }

      const result = await watchService.processCampaignCycle(now);

      res.status(200).json({
        accepted: true,
        message: "Sponsored watch campaign cycle completed",
        activated: result.activated,
        monitored: result.monitored,
        completed: result.completed,
        repaired: result.repaired,
        failed: result.failed,
        errors: result.errors,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
