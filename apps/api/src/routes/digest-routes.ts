// Digest routes: GET /digests/latest
// Returns the most recently published public digest

import type { DailyDigestRepository, DailyDigestRow } from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { notFound } from "../errors.ts";

export function createDigestRoutes(digestRepo: DailyDigestRepository): RouterType {
  const router: RouterType = Router();

  /**
   * GET /digests/latest
   *
   * Retrieve the most recently published public digest.
   *
   * Responses:
   *   200 - DailyDigestResponse
   *   404 - No published digests available
   */
  router.get("/digests/latest", async (req, res, next) => {
    try {
      const result = await digestRepo.findLatestPublic();

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const digest = result.value;

      if (!digest) {
        next(notFound("No published digests available"));
        return;
      }

      const response = formatDigestResponse(digest);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function formatDigestResponse(digest: DailyDigestRow): Record<string, unknown> {
  return {
    id: digest.id,
    reportDate: digest.report_date,
    title: digest.title,
    summary: digest.summary,
    highlights: digest.highlights,
    analysis: digest.analysis ?? undefined,
    publicationStatus: digest.publication_status,
    publishedAt: digest.published_at,
    registryTxHash: digest.registry_tx_hash ?? undefined,
    sourceEventRoot: digest.source_event_root ?? undefined,
    contentUri: digest.content_uri ?? undefined,
  };
}
