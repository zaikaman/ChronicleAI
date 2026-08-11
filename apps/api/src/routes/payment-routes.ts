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
  TelegramBindingRepository,
} from "@chronicleai/db";
import { isPersistentBindingToken } from "@chronicleai/db";
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
import type { AffiliateFundingService } from "../services/affiliate-funding-service.ts";
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
  resolveTargetKind,
  resolveTelegramBindingCode,
  resolveVisibility,
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
  /** Funds the KeeperHub affiliate execution wallet from the x402 treasury. */
  fundingService?: AffiliateFundingService | null;
  /** When true, issue the Secure receipt cookie (production / HTTPS). */
  secureCookies?: boolean;
  /** Public SPA origin for HTTPS sponsored-report / premium-receipt content URIs. */
  frontendOrigin?: string;
  /** When true, on-chain contentUri must be https non-localhost (production). */
  strictContentUri?: boolean;
  /** Optional pre-built registry (defaults from web3Client). */
  registryService?: ChronicleRegistryService | null;
  /** Optional pre-built premium receipt publisher. */
  premiumReceiptService?: PremiumReceiptPublicationService | null;
  /** Queue premium receipt publication after the access response is sent. */
  enqueuePremiumReceipt?: (params: {
    payment: import("@chronicleai/db").PaymentRecordRow;
    premiumItem: import("@chronicleai/db").PremiumIntelligenceItemRow | null;
  }) => void;
  /** Default campaign length when premium item omits endsAt (days). */
  sponsoredWatchDefaultDurationDays?: number;
  /** Pricing + duration bounds for custom sponsored watch product creation. */
  sponsoredWatchProductConfig?: SponsoredWatchProductConfig;
  /** Resolves Telegram binding codes at prepare + settle. */
  telegramBindingRepo?: TelegramBindingRepository | null;
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
        telegramBindingRepo: params.telegramBindingRepo ?? null,
        paymentRecordRepo: params.paymentRecordRepo,
      })
    : null;

  const settlementService = new PaymentSettlementService({
    paymentRecordRepo: params.paymentRecordRepo,
    execLogRepo: params.execLogRepo,
    adapters: params.adapters,
    earningsService: params.earningsService ?? null,
    fundingService: params.fundingService ?? null,
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
    // A receipt is a bearer credential. Never issue a cookie that can travel
    // over plaintext HTTP; callers in development can use the response token
    // through Authorization instead.
    if (params.secureCookies !== true) {
      return;
    }

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
        targetKind?: string;
        telegramBindingCode?: string;
        visibility?: string;
        paymentRoute?: string;
        payerReference?: string;
        referralAddress?: string;
      };

      if (!body.targetContract || typeof body.targetContract !== "string") {
        res.status(400).json({ error: "targetContract is required" });
        return;
      }

      if (
        body.targetKind !== undefined &&
        body.targetKind !== "contract" &&
        body.targetKind !== "wallet"
      ) {
        res.status(400).json({ error: 'targetKind must be "contract" or "wallet"' });
        return;
      }

      if (
        body.visibility !== undefined &&
        body.visibility !== "public" &&
        body.visibility !== "private"
      ) {
        res.status(400).json({ error: 'visibility must be "public" or "private"' });
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
        ...(body.targetKind === "contract" || body.targetKind === "wallet"
          ? { targetKind: body.targetKind }
          : {}),
        ...(typeof body.telegramBindingCode === "string"
          ? { telegramBindingCode: body.telegramBindingCode }
          : {}),
        ...(body.visibility === "public" || body.visibility === "private"
          ? { visibility: body.visibility }
          : {}),
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
        // Return the resolved route (important when the request used `auto`).
        paymentRoute: prepared.challenge.paymentRoute,
        amountRequested: prepared.challenge.amountRequested,
        currency: prepared.challenge.currency,
        expiresAt: prepared.challenge.expiresAt,
        challengeData: prepared.challenge.challengeData,
        campaign: prepared.campaign,
        ...(prepared.reused ? { reused: true } : {}),
        ...(prepared.alreadySettled ? { alreadySettled: true } : {}),
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

      // A replay of an already-settled challenge may issue a receipt again, but
      // it must never create another paid watch or submit another RPC write.
      if (premiumItem?.content_type === "sponsored_monitor" && result.newlySettled) {
        try {
          // Require real targetContract + watchSpecHash (or derive hash from watchSpec).
          // Campaign window comes from content_private (buyer-chosen) when present.
          let targetContract: string;
          let watchSpecHash: string;
          let startsAt: string;
          let endsAt: string;
          let targetKind: "contract" | "wallet" = "contract";
          let visibility: "public" | "private" = "public";
          let telegramChatId: string | null = null;
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
            targetKind = resolveTargetKind(contentPrivate);
            visibility = resolveVisibility(contentPrivate);

            const bindingCode = resolveTelegramBindingCode(contentPrivate);
            if (visibility === "private" && !bindingCode) {
              res.status(400).json({
                settled: false,
                error: "Private sponsored watch is missing a Telegram binding code",
              });
              return;
            }
            if (bindingCode) {
              if (!params.telegramBindingRepo) {
                res.status(400).json({
                  settled: false,
                  error: "Telegram binding is not configured on this server",
                });
                return;
              }
              // Prefer unused codes; fall back to valid (e.g. CHRONICLE_BIND already marked used).
              let bindingResult = await params.telegramBindingRepo.findByCode(bindingCode);
              if (!bindingResult.ok) {
                res.status(500).json({
                  settled: false,
                  error: bindingResult.error.message,
                });
                return;
              }
              if (!bindingResult.value) {
                bindingResult = await params.telegramBindingRepo.findValidByCode(bindingCode);
                if (!bindingResult.ok) {
                  res.status(500).json({
                    settled: false,
                    error: bindingResult.error.message,
                  });
                  return;
                }
              }
              const binding = bindingResult.value;
              if (!binding) {
                res.status(400).json({
                  settled: false,
                  error:
                    "Telegram binding code is invalid, expired, or already used. Send /start to the bot for a new code.",
                });
                return;
              }
              telegramChatId = binding.chat_id;
              if (!binding.used_at && !isPersistentBindingToken(bindingCode)) {
                const marked = await params.telegramBindingRepo.markUsed(binding.id, {
                  walletAddress: result.verification.payerReference ?? null,
                });
                if (!marked.ok) {
                  console.warn(
                    "[payments/settlements] Failed to mark Telegram binding used:",
                    marked.error.message,
                  );
                }
              } else if (!binding.wallet_address && result.verification.payerReference) {
                await params.telegramBindingRepo.update(binding.id, {
                  wallet_address: result.verification.payerReference,
                });
              }
            }
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

          // Trigger sponsored watch creation in background to prevent HTTP request timeout (Heroku 30s limit)
          void watchService
            .createSponsoredWatch({
              targetContract,
              watchSpecHash,
              startsAt,
              endsAt,
              targetKind,
              visibility,
              telegramChatId,
            })
            .catch((watchError) => {
              console.error("[payments/settlements] Background createSponsoredWatch failed:", watchError);
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
              targetContract,
              watchSpecHash,
              startsAt,
              endsAt,
              status: "accepted",
              targetKind,
              visibility,
            },
          });
          return;
        } catch (watchError) {
          console.error("Failed to prepare sponsored watch for settlement:", watchError);
        }
      }

      // Settlement and access are complete. Registry publication is deliberately
      // queued after the response so KeeperHub latency cannot trip the Heroku
      // request timeout. The settled payment row is the durable retry cursor.
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
        premiumReceipt: {
          attempted: false,
          success: false,
          pending: Boolean(premiumReceiptService && !paymentRecord.registry_tx_hash),
        },
      });

      if (premiumReceiptService && !paymentRecord.registry_tx_hash) {
        const enqueue =
          params.enqueuePremiumReceipt ??
          ((job: {
            payment: typeof paymentRecord;
            premiumItem: typeof premiumItem;
          }) => {
            void premiumReceiptService.publishForSettlement(job).catch((error) => {
              console.error(
                `[payments/settlements] Background premium receipt publication failed payment=${paymentRecord.id}:`,
                error,
              );
            });
          });
        enqueue({ payment: paymentRecord, premiumItem });
      }
    } catch (error: unknown) {
      res.status(400).json({
        settled: false,
        error: error instanceof Error ? error.message : "Settlement failed",
      });
    }
  });

  return router;
}
