// Public alerts routes: GET /alerts, GET /alerts/:id
// Returns newest-first public alerts with page-based pagination, plus by-id lookup
// for HTTPS on-chain content URIs.

import type { PublicAlertRepository, PublicAlertRow } from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { notFound } from "../errors.ts";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";

function formatAlertResponse(alert: PublicAlertRow): Record<string, unknown> {
  return {
    id: alert.id,
    title: alert.title,
    summary: alert.summary,
    sourceReferences: alert.source_references,
    deliveryStatus: alert.delivery_status,
    publishedAt: alert.published_at,
    confidence: alert.confidence,
    generationProvider: alert.generation_provider ?? undefined,
    registryTxHash: alert.registry_tx_hash ?? undefined,
    sourceEventHash: alert.source_event_hash ?? undefined,
    contentHash: alert.content_hash ?? undefined,
    contentUri: alert.content_uri ?? undefined,
    gasUsed: alert.gas_used ?? undefined,
    gasUsedWei: alert.gas_used_wei ?? undefined,
    explorerUrl: alert.explorer_url ?? undefined,
    keeperHubRunId: alert.keeper_hub_run_id ?? undefined,
    eventType: alert.event_type ?? undefined,
    chainId: alert.chain_id ?? undefined,
    protocol: alert.protocol ?? undefined,
    ...(alert.flow_context ? { flowContext: alert.flow_context } : {}),
  };
}

export function createAlertRoutes(alertRepo: PublicAlertRepository): RouterType {
  const router: RouterType = Router();

  /**
   * GET /alerts
   *
   * List public alerts with newest-first ordering (page-based).
   *
   * Query parameters:
   *   page  - Page number (1-based, default 1)
   *   limit - Page size (1-100, default 20)
   *
   * Responses:
   *   200 - { items: PublicAlert[], pagination: PaginationMeta }
   */
  router.get("/alerts", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await alertRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
      });

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(fromDbPage(result.value, formatAlertResponse));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /alerts/:id
   *
   * Fetch a single public alert by id (content URI resolution target).
   */
  router.get("/alerts/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: "alert id is required" });
        return;
      }

      const result = await alertRepo.findById(id);

      if (!result.ok) {
        if (result.error.statusCode === 404) {
          next(notFound("Alert not found"));
          return;
        }
        res.status(500).json({ error: result.error.message });
        return;
      }

      const alert = result.value;
      if (alert.delivery_status !== "published") {
        next(notFound("Alert not found"));
        return;
      }

      res.json(formatAlertResponse(alert));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
