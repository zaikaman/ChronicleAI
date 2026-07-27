// Premium Intelligence Routes
// GET /premium/items - List available premium item teasers
// GET /premium/items/:id - Access a premium item (returns 402 if not paid)

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  SponsoredWatchRepository,
} from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { PaymentRequiredError, PremiumAccessService } from "../services/premium-access-service.ts";
import { PremiumContentVisibilityService } from "../services/premium-content-visibility-service.ts";

export function createPremiumRoutes(params: {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
}): RouterType {
  const router: RouterType = Router();
  const visibilityService = new PremiumContentVisibilityService();
  const accessService = new PremiumAccessService({
    premiumRepo: params.premiumRepo,
    paymentRecordRepo: params.paymentRecordRepo,
    execLogRepo: params.execLogRepo,
  });

  /**
   * GET /premium/watches
   *
   * List active sponsored watch campaigns.
   */
  router.get("/premium/watches", async (_req, res, next) => {
    try {
      const result = await params.watchRepo.listActive();
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }
      res.json({ watches: result.value });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/items
   *
   * List available premium intelligence item teasers (public-safe fields only).
   *
   * Responses:
   *   200 - { items: PremiumItemTeaser[] }
   */
  router.get("/premium/items", async (_req, res, next) => {
    try {
      const result = await params.premiumRepo.listTeasers();

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const items = visibilityService.toTeaserList(result.value);

      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/items/:id
   *
   * Access a premium intelligence item.
   *
   * If the user has a settled payment, returns the full content.
   * Otherwise, returns 402 Payment Required with challenge details.
   *
   * Query parameters:
   *   payer - Optional payer/wallet reference for access check
   *
   * Responses:
   *   200 - Full premium item content
   *   402 - Payment required with challenge details
   *   404 - Premium item not found
   */
  router.get("/premium/items/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      const payerReference = req.query.payer as string | undefined;

      // Check if item exists
      const itemResult = await params.premiumRepo.findById(id);

      if (!itemResult.ok) {
        res.status(500).json({ error: itemResult.error.message });
        return;
      }

      if (!itemResult.value) {
        res.status(404).json({ error: "Premium item not found" });
        return;
      }

      // Check if item is available
      if (itemResult.value.status !== "available") {
        res.status(404).json({ error: "Premium item not found" });
        return;
      }

      // Try to access the item (may throw PaymentRequiredError)
      try {
        const accessResult = await accessService.accessPremiumItem({
          itemId: id,
          payerReference: payerReference ?? undefined,
        });

        if (accessResult.allowed) {
          res.json(accessResult.content);
          return;
        }
      } catch (error) {
        if (error instanceof PaymentRequiredError) {
          // Return 402 with challenge details
          const item = error.item;
          const teaser = visibilityService.toTeaser(item);

          res.status(402).json({
            error: "Payment required",
            item: teaser,
            paymentRoute: error.paymentRoute,
            premiumItemId: item.id,
          });
          return;
        }

        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
