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
import {
  extractAccessReceiptFromRequest,
  type PremiumAccessReceiptService,
} from "../services/premium-access-receipt-service.ts";
import { PaymentRequiredError, PremiumAccessService } from "../services/premium-access-service.ts";
import { PremiumContentVisibilityService } from "../services/premium-content-visibility-service.ts";

export function createPremiumRoutes(params: {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
  receiptService: PremiumAccessReceiptService;
}): RouterType {
  const router: RouterType = Router();
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
   * List active sponsored watch campaigns.
   */
  router.get("/premium/watches", async (_req, res, next) => {
    try {
      const result = await params.watchRepo.listActive();
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }
      res.json({
        watches: result.value.map((watch) => ({
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
        })),
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
   *
   * Responses:
   *   200 - { items: PremiumItemTeaser[] }
   */
  router.get("/premium/items", async (req, res, next) => {
    try {
      const result = await params.premiumRepo.listTeasers();

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const items = visibilityService.toTeaserList(result.value);

      const rawPayer =
        (typeof req.query.payer === "string" ? req.query.payer.trim() : null) ||
        (typeof req.headers["x-payer-reference"] === "string"
          ? (req.headers["x-payer-reference"] as string).trim()
          : null);

      const unlockedItemIds: string[] = [];
      const receipts: Record<string, string> = {};

      if (rawPayer) {
        for (const item of items) {
          const settledResult = await params.paymentRecordRepo.findSettledByPayer(item.id, rawPayer);
          if (settledResult.ok && settledResult.value) {
            unlockedItemIds.push(item.id);
            const { token } = params.receiptService.issue({
              premiumItemId: item.id,
              payerReference: rawPayer,
              paymentRecordId: settledResult.value.id,
            });
            receipts[item.id] = token;
          }
        }
      }

      res.json({ items, unlockedItemIds, receipts });
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
   *   ?receipt=<accessReceipt>
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

      const payerHeader = req.headers["x-payer-reference"];
      const payerReference =
        typeof payerHeader === "string" && payerHeader.trim()
          ? payerHeader.trim()
          : typeof req.query.payer === "string" && req.query.payer.trim()
            ? req.query.payer.trim()
            : undefined;

      const accessReceipt = extractAccessReceiptFromRequest({
        authorizationHeader:
          typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
        receiptHeader: req.headers["x-premium-access-receipt"],
        receiptQuery: req.query.receipt as string | string[] | undefined,
        cookieHeader: typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
        premiumItemId: id,
      });

      // Try to access the item (may throw PaymentRequiredError)
      try {
        const accessResult = await accessService.accessPremiumItem({
          itemId: id,
          accessReceipt,
          payerReference,
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
