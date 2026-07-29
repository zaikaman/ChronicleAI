// Payment Routes
// GET  /payments | /.well-known/agent-payments — dual-rail discovery for agents
// POST /payments/challenges - Create a payment challenge
// POST /payments/settlements - Settle a payment challenge

import type {
  AffiliateRepository,
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  ReferralAttributionRepository,
  SponsoredWatchRepository,
} from "@chronicleai/db";
import type { ExecutionLogInsert } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { Router, type Router as RouterType, type Response } from "express";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import { buildAgentPaymentsDiscovery } from "../services/agent-payments-discovery.ts";
import {
  createChronicleRegistryService,
  type ChronicleRegistryService,
} from "../services/chronicle-registry-service.ts";
import {
  buildPremiumAccessReceiptCookie,
  DEFAULT_PREMIUM_ACCESS_RECEIPT_TTL_SECONDS,
  type PremiumAccessReceiptService,
} from "../services/premium-access-receipt-service.ts";
import type { AffiliateEarningsService } from "../services/affiliate-earnings-service.ts";
import { PaymentChallengeService } from "../services/payment-challenge-service.ts";
import { PaymentSettlementService } from "../services/payment-settlement-service.ts";
import {
  createPremiumReceiptPublicationService,
  type PremiumReceiptPublicationService,
} from "../services/premium-receipt-publication-service.ts";
import {
  createSponsoredWatchService,
  type SponsoredWatchService,
} from "../services/sponsored-watch-service.ts";
import {
  createSponsoredWatchProductService,
  type SponsoredWatchProductConfig,
} from "../services/sponsored-watch-product-service.ts";
import {
  parseSponsoredMonitorContentPrivate,
  resolveCampaignWindowFromContent,
  resolveTargetContract,
  resolveWatchSpecHash,
} from "../services/watch-spec-hash.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

export function createPaymentRoutes(params: {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
  adapters: Map<PaymentRoute, PaymentAdapter>;
  receiptService: PremiumAccessReceiptService;
  web3Client?: Web3Client | null;
  /** Shared Loop 4 service when provided (preferred — includes event monitoring). */
  watchService?: SponsoredWatchService | null;
  /** Product affiliate registry for referral intent validation. */
  affiliateRepo?: AffiliateRepository | null;
  /** First-touch wallet-connect attribution. */
  attributionRepo?: ReferralAttributionRepository | null;
  /** Credits affiliate ledger on settle. */
  earningsService?: AffiliateEarningsService | null;
  /** When true, Set-Cookie includes Secure (production / HTTPS). */
  secureCookies?: boolean;
  /** Public SPA origin for HTTPS sponsored-report / premium-receipt content URIs. */
  frontendOrigin?: string;
  /** When true, on-chain contentUri must be https non-localhost (production). */
  strictContentUri?: boolean;
  /** Optional pre-built registry (defaults from web3Client). */
  registryService?: ChronicleRegistryService | null;
  /** Optional pre-built premium receipt publisher. */
  premiumReceiptService?: PremiumReceiptPublicationService | null;
  /** Default campaign length when premium item omits endsAt (days). */
  sponsoredWatchDefaultDurationDays?: number;
  /** Pricing + duration bounds for custom sponsored watch product creation. */
  sponsoredWatchProductConfig?: SponsoredWatchProductConfig;
}): RouterType {
  const router: RouterType = Router();

  const challengeService = new PaymentChallengeService({
    paymentRecordRepo: params.paymentRecordRepo,
    adapters: params.adapters,
    affiliateRepo: params.affiliateRepo ?? null,
    attributionRepo: params.attributionRepo ?? null,
  });

  const sponsoredWatchProductService = params.sponsoredWatchProductConfig
    ? createSponsoredWatchProductService({
        premiumRepo: params.premiumRepo,
        challengeService,
        config: params.sponsoredWatchProductConfig,
      })
    : null;

  const settlementService = new PaymentSettlementService({
    paymentRecordRepo: params.paymentRecordRepo,
    execLogRepo: params.execLogRepo,
    adapters: params.adapters,
    earningsService: params.earningsService ?? null,
  });

  const registryService =
    params.registryService !== undefined
      ? params.registryService
      : createChronicleRegistryService(params.web3Client ?? null, {
          strictContentUri: params.strictContentUri === true,
        });

  const premiumReceiptService =
    params.premiumReceiptService !== undefined
      ? params.premiumReceiptService
      : createPremiumReceiptPublicationService({
          paymentRecordRepo: params.paymentRecordRepo,
          execLogRepo: params.execLogRepo,
          registry: registryService,
          frontendOrigin: params.frontendOrigin ?? null,
        });

  const watchService =
    params.watchService ??
    createSponsoredWatchService({
      watchRepo: params.watchRepo,
      execLogRepo: params.execLogRepo,
      web3Client: params.web3Client ?? null,
      ...(params.frontendOrigin !== undefined
        ? { frontendOrigin: params.frontendOrigin }
        : {}),
    });

  function issueAccessReceipt(args: {
    paymentRecordId: string;
    premiumItemId: string;
    payerReference?: string | null;
  }): { accessReceipt: string; accessReceiptExpiresAt: string } {
    const issued = params.receiptService.issue({
      paymentRecordId: args.paymentRecordId,
      premiumItemId: args.premiumItemId,
      payerReference: args.payerReference ?? null,
    });
    return {
      accessReceipt: issued.token,
      accessReceiptExpiresAt: issued.expiresAt,
    };
  }

  function attachReceiptCookie(
    res: Response,
    premiumItemId: string,
    accessReceipt: string,
    expiresAt: string,
  ): void {
    const maxAgeSeconds = Math.max(
      0,
      Math.floor((Date.parse(expiresAt) - Date.now()) / 1000) ||
        DEFAULT_PREMIUM_ACCESS_RECEIPT_TTL_SECONDS,
    );
    res.append(
      "Set-Cookie",
      buildPremiumAccessReceiptCookie({
        token: accessReceipt,
        premiumItemId,
        maxAgeSeconds,
        secure: params.secureCookies === true,
      }),
    );
  }

  function sendAgentPaymentsDiscovery(_req: unknown, res: Response): void {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(buildAgentPaymentsDiscovery());
  }

  /**
   * GET /payments
   *
   * Machine-readable dual-rail discovery (x402 + MPP). Safe for agents to crawl.
   */
  router.get("/payments", sendAgentPaymentsDiscovery);

  /**
   * GET /.well-known/agent-payments
   *
   * Same discovery document under the well-known path for automated clients.
   */
  router.get("/.well-known/agent-payments", sendAgentPaymentsDiscovery);

  /**
   * POST /payments/sponsored-watch/challenges
   *
   * Create a custom sponsored monitoring product from a buyer-submitted
   * target contract + campaign window, then issue a payment challenge (Loop 4).
   */
  router.post("/payments/sponsored-watch/challenges", async (req, res, _next) => {
    try {
      if (!sponsoredWatchProductService) {
        res.status(503).json({
          error: "Sponsored watch product service is not configured",
        });
        return;
      }

      const body = req.body as {
        targetContract?: string;
        eventSignature?: string;
        description?: string;
        startsAt?: string;
        endsAt?: string;
        durationDays?: number;
        /** Short demo campaigns (e.g. 1 hour). */
        durationHours?: number;
        paymentRoute?: string;
        payerReference?: string;
        referralAddress?: string;
      };

      if (!body.targetContract || typeof body.targetContract !== "string") {
        res.status(400).json({ error: "targetContract is required" });
        return;
      }

      const routeInput = body.paymentRoute ?? "auto";
      if (!challengeService.validateRoute(routeInput)) {
        res.status(400).json({
          error: "Unsupported payment route. Supported routes: x402, mpp, auto",
        });
        return;
      }

      const chronicleClientHeader = typeof req.headers["x-chronicle-client"] === "string"
        ? req.headers["x-chronicle-client"]
        : undefined;

      const prepared = await sponsoredWatchProductService.prepareCampaign({
        targetContract: body.targetContract,
        ...(body.eventSignature !== undefined
          ? { eventSignature: body.eventSignature }
          : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
        ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
        ...(body.durationDays !== undefined ? { durationDays: body.durationDays } : {}),
        ...(body.durationHours !== undefined ? { durationHours: body.durationHours } : {}),
        paymentRoute: routeInput as PaymentRoute,
        ...(body.payerReference !== undefined
          ? { payerReference: body.payerReference }
          : {}),
        ...(body.referralAddress !== undefined
          ? { referralAddress: body.referralAddress }
          : {}),
      });

      res.status(201).json({
        premiumItemId: prepared.premiumItem.id,
        paymentRecordId: prepared.paymentRecordId,
        challengeReference: prepared.challenge.challengeReference,
        paymentRoute: prepared.challenge.paymentRoute,
        amountRequested: prepared.challenge.amountRequested,
        currency: prepared.challenge.currency,
        expiresAt: prepared.challenge.expiresAt,
        challengeData: prepared.challenge.challengeData,
        campaign: prepared.campaign,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to prepare sponsored watch";
      res.status(400).json({ error: message });
    }
  });

  /**
   * POST /payments/challenges
   *
   * Create a payment challenge for a premium intelligence item.
   */
  router.post("/payments/challenges", async (req, res, next) => {
    try {
      const { premiumItemId, paymentRoute, payerReference, referralAddress, clientType } = req.body as {
        premiumItemId?: string;
        paymentRoute?: string;
        payerReference?: string | undefined;
        clientType?: string | undefined;
        /** Optional affiliate wallet for capped revenue attribution (not the payer). */
        referralAddress?: string | undefined;
      };

      if (!premiumItemId) {
        res.status(400).json({ error: "premiumItemId is required" });
        return;
      }

      const routeInput = paymentRoute ?? "auto";
      if (!challengeService.validateRoute(routeInput)) {
        res.status(400).json({
          error: "Unsupported payment route. Supported routes: x402, mpp, auto",
        });
        return;
      }

      const itemResult = await params.premiumRepo.findById(premiumItemId);

      if (!itemResult.ok) {
        res.status(500).json({ error: itemResult.error.message });
        return;
      }

      if (!itemResult.value) {
        res.status(404).json({ error: "Premium item not found" });
        return;
      }

      if (!challengeService.validateItemAvailable(itemResult.value)) {
        res.status(400).json({ error: "Premium item is not available for purchase" });
        return;
      }

      const chronicleClientHeader = typeof req.headers["x-chronicle-client"] === "string"
        ? req.headers["x-chronicle-client"]
        : undefined;

      const result = await challengeService.createChallenge({
        premiumItem: itemResult.value,
        paymentRoute: routeInput,
        payerReference: payerReference ?? undefined,
        chronicleClientHeader,
        clientType,
        referralAddress: referralAddress ?? null,
      });

      const logEntry: ExecutionLogInsert = {
        action_type: "payment",
        entity_type: "premium_intelligence_item",
        entity_id: premiumItemId,
        status: "started",
        message: `Payment challenge issued via ${result.challenge.paymentRoute}`,
        details: {
          challengeReference: result.challenge.challengeReference,
          paymentRoute: result.challenge.paymentRoute,
          autoSelectReason: result.autoSelectReason,
          amountRequested: result.challenge.amountRequested,
          currency: result.challenge.currency,
          premiumItemId,
          referralAddress: referralAddress ?? null,
        },
      };

      await params.execLogRepo.append(logEntry);

      res.status(201).json({
        challengeReference: result.challenge.challengeReference,
        paymentRoute: result.challenge.paymentRoute,
        autoSelectReason: result.autoSelectReason,
        amountRequested: result.challenge.amountRequested,
        currency: result.challenge.currency,
        expiresAt: result.challenge.expiresAt,
        challengeData: result.challenge.challengeData,
        paymentRecordId: result.paymentRecordId,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /payments/settlements
   *
   * Settle a payment challenge and issue an access receipt on success.
   */
  router.post("/payments/settlements", async (req, res, _next) => {
    try {
      const { challengeReference, settlementReference, paymentRoute, amountSettled, currency } =
        req.body as {
          challengeReference?: string;
          settlementReference?: string;
          paymentRoute?: PaymentRoute;
          amountSettled?: number;
          currency?: string;
        };

      if (!challengeReference) {
        res.status(400).json({ error: "challengeReference is required" });
        return;
      }

      if (!settlementReference) {
        res.status(400).json({ error: "settlementReference is required" });
        return;
      }

      if (!paymentRoute) {
        res.status(400).json({ error: "paymentRoute is required" });
        return;
      }

      const result = await settlementService.settle({
        challengeReference,
        settlementReference,
        paymentRoute,
        amountSettled,
        currency,
      });

      if (!result.settled) {
        res.status(400).json({
          settled: false,
          error: result.verification.errorMessage ?? "Settlement failed",
          paymentRecordId: result.paymentRecordId,
          verification: {
            amountSettled: result.verification.amountSettled,
            currency: result.verification.currency,
          },
        });
        return;
      }

      const recordResult =
        await params.paymentRecordRepo.findByChallengeReference(challengeReference);

      if (!recordResult.ok || !recordResult.value) {
        res.status(400).json({
          settled: false,
          error: "Settlement succeeded but payment record could not be loaded for access receipt",
          paymentRecordId: result.paymentRecordId,
        });
        return;
      }

      const paymentRecord = recordResult.value;
      const receipt = issueAccessReceipt({
        paymentRecordId: result.paymentRecordId,
        premiumItemId: paymentRecord.premium_item_id,
        payerReference:
          result.verification.payerReference ?? paymentRecord.payer_reference ?? null,
      });

      attachReceiptCookie(
        res,
        paymentRecord.premium_item_id,
        receipt.accessReceipt,
        receipt.accessReceiptExpiresAt,
      );

      // Check if the premium item is a sponsored_monitor to create a watch
      const premiumItemResult = await params.premiumRepo.findById(paymentRecord.premium_item_id);
      const premiumItem =
        premiumItemResult.ok && premiumItemResult.value ? premiumItemResult.value : null;

      if (premiumItem?.content_type === "sponsored_monitor") {
        try {
          // Require real targetContract + watchSpecHash (or derive hash from watchSpec).
          // Campaign window comes from content_private (buyer-chosen) when present.
          let targetContract: string;
          let watchSpecHash: string;
          let startsAt: string;
          let endsAt: string;
          try {
            const contentPrivate = parseSponsoredMonitorContentPrivate(
              premiumItem.content_private,
            );
            targetContract = resolveTargetContract(contentPrivate);
            watchSpecHash = resolveWatchSpecHash(contentPrivate);
            const window = resolveCampaignWindowFromContent(contentPrivate, {
              defaultDurationDays: params.sponsoredWatchDefaultDurationDays ?? 7,
            });
            startsAt = window.startsAt;
            endsAt = window.endsAt;
          } catch (specError) {
            res.status(400).json({
              settled: false,
              error:
                specError instanceof Error
                  ? specError.message
                  : "Sponsored monitor premium item has an invalid watch specification",
            });
            return;
          }

          const watch = await watchService.createSponsoredWatch({
            targetContract,
            watchSpecHash,
            startsAt,
            endsAt,
          });

          res.json({
            settled: true,
            paymentRecordId: result.paymentRecordId,
            verification: {
              amountSettled: result.verification.amountSettled,
              currency: result.verification.currency,
              settlementReference: result.verification.settlementReference,
              payerReference: result.verification.payerReference,
            },
            accessReceipt: receipt.accessReceipt,
            accessReceiptExpiresAt: receipt.accessReceiptExpiresAt,
            sponsoredWatch: {
              id: watch.id,
              targetContract: watch.target_contract,
              status: watch.status,
              createTxHash: watch.create_tx_hash,
              createExplorerUrl: watch.create_explorer_url,
              onChainWatchId: watch.on_chain_watch_id,
              startsAt: watch.starts_at,
              endsAt: watch.ends_at,
              // Report fields are null until end-of-campaign publishSponsoredReport
              reportTxHash: watch.report_tx_hash,
              reportExplorerUrl: watch.report_explorer_url,
              sourceEventRoot: watch.source_event_root,
            },
          });
          return;
        } catch (watchError) {
          console.error("Failed to create sponsored watch:", watchError);
        }
      }

      // Soft-fail premium receipt registry write (settlement already succeeded).
      let premiumReceipt: {
        attempted: boolean;
        success: boolean;
        registryTxHash?: string;
        keeperHubRunId?: string;
        explorerUrl?: string;
        contentUri?: string;
        errorMessage?: string;
      } | undefined;
      if (premiumReceiptService) {
        try {
          const pub = await premiumReceiptService.publishForSettlement({
            payment: paymentRecord,
            premiumItem,
          });
          if (pub.attempted || pub.errorMessage !== "skipped_sponsored_monitor") {
            premiumReceipt = {
              attempted: pub.attempted,
              success: pub.success,
              ...(pub.registryTxHash ? { registryTxHash: pub.registryTxHash } : {}),
              ...(pub.keeperHubRunId ? { keeperHubRunId: pub.keeperHubRunId } : {}),
              ...(pub.explorerUrl ? { explorerUrl: pub.explorerUrl } : {}),
              ...(pub.contentUri ? { contentUri: pub.contentUri } : {}),
              ...(pub.errorMessage ? { errorMessage: pub.errorMessage } : {}),
            };
          }
        } catch (receiptError) {
          console.error(
            "Failed to publish premium receipt (settlement still valid):",
            receiptError,
          );
          premiumReceipt = {
            attempted: true,
            success: false,
            errorMessage:
              receiptError instanceof Error
                ? receiptError.message
                : "premium_receipt_publish_failed",
          };
        }
      }

      res.json({
        settled: true,
        paymentRecordId: result.paymentRecordId,
        verification: {
          amountSettled: result.verification.amountSettled,
          currency: result.verification.currency,
          settlementReference: result.verification.settlementReference,
          payerReference: result.verification.payerReference,
        },
        accessReceipt: receipt.accessReceipt,
        accessReceiptExpiresAt: receipt.accessReceiptExpiresAt,
        ...(premiumReceipt ? { premiumReceipt } : {}),
      });
    } catch (error: unknown) {
      res.status(400).json({
        settled: false,
        error: error instanceof Error ? error.message : "Settlement failed",
      });
    }
  });

  return router;
}
