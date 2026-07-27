// Public alerts route: GET /alerts
// Returns newest-first public alerts with limit validation

import { Router, type Router as RouterType } from "express";
import type { PublicAlertRepository, PublicAlertRow } from "@chronicleai/db";

export function createAlertRoutes(
  alertRepo: PublicAlertRepository,
): RouterType {
  const router: RouterType = Router();

  /**
   * GET /alerts
   *
   * List public alerts with newest-first ordering.
   *
   * Query parameters:
   *   limit - Number of alerts to return (1-100, default 50)
   *
   * Responses:
   *   200 - { items: PublicAlert[] }
   */
  router.get("/alerts", async (req, res, next) => {
    try {
      const limitParam = req.query.limit ? Number(req.query.limit) : 50;

      if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 100) {
        res.status(400).json({ error: "limit must be an integer between 1 and 100" });
        return;
      }

      const result = await alertRepo.list(limitParam);

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const items = result.value.map((alert: PublicAlertRow) => ({
        id: alert.id,
        title: alert.title,
        summary: alert.summary,
        sourceReferences: alert.source_references,
        deliveryStatus: alert.delivery_status,
        publishedAt: alert.published_at,
        confidence: alert.confidence,
        generationProvider: alert.generation_provider ?? undefined,
      }));

      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
