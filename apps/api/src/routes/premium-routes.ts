// Premium Intelligence Routes
// GET /premium/items - List available premium item teasers
// GET /premium/items/:id - Access a premium item (returns 402 if not paid)

import { ACTIVE_INTELLIGENCE_CHAIN_ID } from "@chronicleai/config";
import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  SponsoredWatchRepository,
} from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";
import {
  type PremiumAccessReceiptService,
  extractAccessReceiptFromRequest,
} from "../services/premium-access-receipt-service.ts";
import { PaymentRequiredError, PremiumAccessService } from "../services/premium-access-service.ts";
import { PremiumContentVisibilityService } from "../services/premium-content-visibility-service.ts";

function formatWatchListItem(watch: {
  id: string;
  target_contract: string;
  watch_spec_hash: string;
  starts_at: string;
  ends_at: string;
  status: string;
  on_chain_watch_id?: number | null;
  create_tx_hash?: string | null;
  report_tx_hash?: string | null;
  create_explorer_url?: string | null;
  report_explorer_url?: string | null;
  source_event_root?: string | null;
  report_content_hash?: string | null;
  monitored_event_count?: number | null;
  last_monitored_at?: string | null;
}) {
  return {
    id: watch.id,
    targetContract: watch.target_contract,
    watchSpecHash: watch.watch_spec_hash,
    startsAt: watch.starts_at,
    endsAt: watch.ends_at,
    status: watch.status,
    onChainWatchId: watch.on_chain_watch_id ?? undefined,
    createTxHash: watch.create_tx_hash ?? undefined,
    reportTxHash: watch.report_tx_hash ?? undefined,
    createExplorerUrl: watch.create_explorer_url ?? undefined,
    reportExplorerUrl: watch.report_explorer_url ?? undefined,
    sourceEventRoot: watch.source_event_root ?? undefined,
    reportContentHash: watch.report_content_hash ?? undefined,
    monitoredEventCount: watch.monitored_event_count ?? 0,
    lastMonitoredAt: watch.last_monitored_at ?? undefined,
    auditTrail: {
      createTxHash: watch.create_tx_hash ?? null,
      createExplorerUrl: watch.create_explorer_url ?? null,
      reportTxHash: watch.report_tx_hash ?? null,
      reportExplorerUrl: watch.report_explorer_url ?? null,
      sourceEventRoot: watch.source_event_root ?? null,
    },
  };
}

export function createPremiumRoutes(params: {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
  receiptService: PremiumAccessReceiptService;
}): RouterType {
  const router: RouterType = Router();

  // Premium item responses can contain payer-specific receipts or paid content.
  // Set this before any handler runs so success and error responses are never
  // eligible for the global public GET cache.
  router.use("/premium/items", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  const visibilityService = new PremiumContentVisibilityService();
  const accessService = new PremiumAccessService({
    premiumRepo: params.premiumRepo,
    paymentRecordRepo: params.paymentRecordRepo,
    execLogRepo: params.execLogRepo,
    receiptService: params.receiptService,
    watchRepo: params.watchRepo,
  });

  /**
   * GET /premium/watches
   *
   * List sponsored watch campaigns (page-based, newest first).
   * Query: page (default 1), limit (default 20, max 100).
   * Response: { items, pagination } (also mirrors `watches` for older clients).
   */
  router.get("/premium/watches", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await params.watchRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const envelope = fromDbPage(result.value, formatWatchListItem);
      res.json({
        ...envelope,
        // Back-compat for clients still reading `watches`.
        watches: envelope.items,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/watches/:id
   *
   * Fetch a single sponsored watch by id (HTTPS content URI resolution target
   * for on-chain publishSponsoredReport proofs).
   */
  router.get("/premium/watches/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: "watch id is required" });
        return;
      }

      const result = await params.watchRepo.findById(id);
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      if (!result.value) {
        res.status(404).json({ error: "Sponsored watch not found" });
        return;
      }

      const watch = result.value;
      res.json({
        id: watch.id,
        targetContract: watch.target_contract,
        watchSpecHash: watch.watch_spec_hash,
        startsAt: watch.starts_at,
        endsAt: watch.ends_at,
        status: watch.status,
        onChainWatchId: watch.on_chain_watch_id ?? undefined,
        createTxHash: watch.create_tx_hash ?? undefined,
        reportTxHash: watch.report_tx_hash ?? undefined,
        reportContentHash: watch.report_content_hash ?? undefined,
        sourceEventRoot: watch.source_event_root ?? undefined,
        sourceEventIds: watch.source_event_ids ?? [],
        contentUri: watch.content_uri ?? undefined,
        createExplorerUrl: watch.create_explorer_url ?? undefined,
        reportExplorerUrl: watch.report_explorer_url ?? undefined,
        createKeeperHubRunId: watch.create_keeper_hub_run_id ?? undefined,
        reportKeeperHubRunId: watch.report_keeper_hub_run_id ?? undefined,
        reportTitle: watch.report_title ?? undefined,
        reportSummary: watch.report_summary ?? undefined,
        reportHighlights: watch.report_highlights ?? [],
        reportAnalysis: watch.report_analysis ?? undefined,
        monitoredEventCount: watch.monitored_event_count ?? 0,
        lastMonitoredAt: watch.last_monitored_at ?? undefined,
        // Dual on-chain audit trail for the paid campaign
        auditTrail: {
          createTxHash: watch.create_tx_hash ?? null,
          createExplorerUrl: watch.create_explorer_url ?? null,
          reportTxHash: watch.report_tx_hash ?? null,
          reportExplorerUrl: watch.report_explorer_url ?? null,
          sourceEventRoot: watch.source_event_root ?? null,
          reportContentHash: watch.report_content_hash ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/items
   *
   * List available premium intelligence item teasers (public-safe fields only).
   * Query: page (default 1), limit (default 20, max 100).
   *
   * Responses:
   *   200 - { items: PremiumItemTeaser[], pagination, unlockedItemIds?, receipts? }
   */
  router.get("/premium/items", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await params.premiumRepo.listTeasersPage({
        page: parsed.page,
        limit: parsed.limit,
        chainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
      });

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const page = result.value;
      const items = visibilityService.toTeaserList(page.items);

      res.json({
        items,
        pagination: {
          page: page.page,
          limit: page.limit,
          total: page.total,
          totalPages: page.totalPages,
          hasNextPage: page.hasNextPage,
          hasPreviousPage: page.hasPreviousPage,
        },
        // Entitlements are returned only from the authenticated settlement
        // response. A public wallet address is not an ownership proof.
        unlockedItemIds: [],
        receipts: {},
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/items/:id
   *
   * Access a premium intelligence item.
   *
   * Full private content is returned only when a valid HMAC-signed access
   * receipt is presented (issued at settlement). Bare ?payer= is not accepted.
   *
   * Auth (any one of):
   *   Authorization: Bearer <accessReceipt>
   *   X-Premium-Access-Receipt: <accessReceipt>
   *   HttpOnly cookie chronicle_premium_receipt_<itemId>
   *
   * Responses:
   *   200 - Full premium item content
   *   402 - Payment required with challenge details
   *   404 - Premium item not found
   */
  router.get("/premium/items/:id", async (req, res, next) => {
    try {
      const { id } = req.params;

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

      const accessReceipt = extractAccessReceiptFromRequest({
        authorizationHeader:
          typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
        receiptHeader: req.headers["x-premium-access-receipt"],
        cookieHeader: typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
        premiumItemId: id,
      });

      // Try to access the item (may throw PaymentRequiredError)
      try {
        const accessResult = await accessService.accessPremiumItem({
          itemId: id,
          accessReceipt,
        });

        if (accessResult.allowed) {
          if (accessResult.accessReceipt) {
            res.setHeader("X-Premium-Access-Receipt", accessResult.accessReceipt);
          }
          res.json(accessResult.content);
          return;
        }
      } catch (error) {
        if (error instanceof PaymentRequiredError) {
          // Return 402 with challenge details
          const item = error.item;
          const teaser = visibilityService.toTeaser(item);

          // Advertise dual-rail support so agents do not assume x402-only.
          res.status(402).json({
            error: "Payment required",
            item: teaser,
            paymentRoute: error.paymentRoute,
            supportedPaymentRoutes: item.payment_routes,
            premiumItemId: item.id,
            agentPaymentsDiscovery: "/payments",
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
