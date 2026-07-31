// Digest routes: GET /digests, GET /digests/latest, GET /digests/:id
// Returns published public digests for feed + HTTPS content URI resolution

import type { DailyDigestRepository, DailyDigestRow } from "@chronicleai/db";
import type { DigestSections } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";
import { notFound } from "../errors.ts";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";
import { parseSectionsFromAnalysis } from "../services/digest-generation-service.ts";

export function createDigestRoutes(digestRepo: DailyDigestRepository): RouterType {
  const router: RouterType = Router();

  /**
   * GET /digests
   *
   * List published public digests (page-based, newest first).
   * Query: page (default 1), limit (default 20, max 100).
   */
  router.get("/digests", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await digestRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(fromDbPage(result.value, formatDigestResponse));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /digests/latest
   *
   * Retrieve the most recently published public digest.
   *
   * Responses:
   *   200 - DailyDigestResponse
   *   404 - No published digests available
   */
  router.get("/digests/latest", async (_req, res, next) => {
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

  /**
   * GET /digests/:id
   *
   * Fetch a single public digest by id (on-chain content URI target).
   * Registered after /digests/latest so "latest" is not treated as an id.
   */
  router.get("/digests/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: "digest id is required" });
        return;
      }

      const result = await digestRepo.findById(id);

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const digest = result.value;
      if (!digest || digest.audience !== "public" || !digest.published_at) {
        next(notFound("Digest not found"));
        return;
      }

      res.json(formatDigestResponse(digest));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function extractSections(digest: DailyDigestRow): DigestSections | undefined {
  const narrative = digest.market_narrative as Record<string, unknown> | null | undefined;
  if (narrative && typeof narrative === "object") {
    const sections = narrative.sections;
    if (sections && typeof sections === "object") {
      const s = sections as Record<string, unknown>;
      if (
        typeof s.capitalDirection === "string" ||
        typeof s.exchangeAndProtocolFlows === "string"
      ) {
        return {
          capitalDirection:
            typeof s.capitalDirection === "string"
              ? s.capitalDirection
              : "No qualifying directional flow today.",
          exchangeAndProtocolFlows:
            typeof s.exchangeAndProtocolFlows === "string"
              ? s.exchangeAndProtocolFlows
              : "No qualifying CEX or protocol flow today.",
          stressBoard:
            typeof s.stressBoard === "string"
              ? s.stressBoard
              : "No material stress signals today.",
          storyOfTheDay:
            typeof s.storyOfTheDay === "string"
              ? s.storyOfTheDay
              : "Quiet day — no single multi-event narrative.",
          coverageNote: typeof s.coverageNote === "string" ? s.coverageNote : "",
        };
      }
    }
  }
  return parseSectionsFromAnalysis(digest.analysis) ?? undefined;
}

function formatDigestResponse(digest: DailyDigestRow): Record<string, unknown> {
  const sections = extractSections(digest);
  return {
    id: digest.id,
    reportDate: digest.report_date,
    title: digest.title,
    summary: digest.summary,
    highlights: digest.highlights,
    analysis: digest.analysis ?? undefined,
    ...(sections ? { sections } : {}),
    publicationStatus: digest.publication_status,
    publishedAt: digest.published_at,
    registryTxHash: digest.registry_tx_hash ?? undefined,
    sourceEventRoot: digest.source_event_root ?? undefined,
    contentHash: digest.content_hash ?? undefined,
    contentUri: digest.content_uri ?? undefined,
    gasUsed: digest.gas_used ?? undefined,
    gasUsedWei: digest.gas_used_wei ?? undefined,
    keeperHubRunId: digest.keeper_hub_run_id ?? undefined,
    explorerUrl: digest.explorer_url ?? undefined,
  };
}
