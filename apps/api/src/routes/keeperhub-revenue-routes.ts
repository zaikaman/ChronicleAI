// KeeperHub revenue routing route: POST /keeperhub/revenue/route
// Accepts signed revenue routing payloads from KeeperHub scheduled workflows (Loop 5)

import { Router, type Router as RouterType } from "express";
import { badRequest } from "../errors.ts";
import type { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";

export interface RevenueRoutingPayload {
  periodHash: string;
  force?: boolean;
}

export function createKeeperhubRevenueRoutes(handler: RevenueRoutingHandler): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/revenue/route
   *
   * Trigger autonomous revenue routing. Calculates distributable revenue,
   * creates payout records, executes batched transfers, and calls recordPayout
   * on the Chronicle Registry.
   * The request must include a valid X-ChronicleAI-Signature header.
   *
   * Request body:
   *   periodHash: string - Unique identifier for this routing period
   *   force: boolean (optional) - Force routing even if conditions aren't met
   *
   * Responses:
   *   201 - Revenue routed successfully
   *   202 - Revenue routing skipped (conditions not met)
   *   400 - Invalid payload
   *   401 - Missing or invalid webhook signature
   */
  router.post("/keeperhub/revenue/route", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;

      if (!body || typeof body !== "object") {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const errors = validateRevenueRoutingPayload(body);
      if (errors.length > 0) {
        next(badRequest(`Invalid revenue routing payload: ${errors.join("; ")}`));
        return;
      }

      const payload: RevenueRoutingPayload = {
        periodHash: String(body.periodHash),
        force: Boolean(body.force ?? false),
      };

      const result = await handler.route(payload);

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        payoutCount: result.payoutCount,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function validateRevenueRoutingPayload(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!payload.periodHash || typeof payload.periodHash !== "string") {
    errors.push("periodHash is required and must be a string");
  }

  return errors;
}
