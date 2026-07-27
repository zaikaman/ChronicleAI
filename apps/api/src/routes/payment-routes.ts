// Payment Routes
// POST /payments/challenges - Create a payment challenge
// POST /payments/settlements - Settle a payment challenge

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  SponsoredWatchRepository,
} from "@chronicleai/db";
import type { ExecutionLogInsert } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { Router, type Router as RouterType, type Response } from "express";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import {
  buildPremiumAccessReceiptCookie,
  DEFAULT_PREMIUM_ACCESS_RECEIPT_TTL_SECONDS,
  type PremiumAccessReceiptService,
} from "../services/premium-access-receipt-service.ts";
import { PaymentChallengeService } from "../services/payment-challenge-service.ts";
import { PaymentSettlementService } from "../services/payment-settlement-service.ts";
import { createSponsoredWatchService } from "../services/sponsored-watch-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

export function createPaymentRoutes(params: {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
  adapters: Map<PaymentRoute, PaymentAdapter>;
  receiptService: PremiumAccessReceiptService;
  web3Client?: Web3Client | null;
  /** When true, Set-Cookie includes Secure (production / HTTPS). */
  secureCookies?: boolean;
}): RouterType {
  const router: RouterType = Router();

  const challengeService = new PaymentChallengeService({
    paymentRecordRepo: params.paymentRecordRepo,
    adapters: params.adapters,
  });

  const settlementService = new PaymentSettlementService({
    paymentRecordRepo: params.paymentRecordRepo,
    execLogRepo: params.execLogRepo,
    adapters: params.adapters,
  });

  const watchService = createSponsoredWatchService({
    watchRepo: params.watchRepo,
    execLogRepo: params.execLogRepo,
    web3Client: params.web3Client ?? null,
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

  /**
   * POST /payments/challenges
   *
   * Create a payment challenge for a premium intelligence item.
   */
  router.post("/payments/challenges", async (req, res, next) => {
    try {
      const { premiumItemId, paymentRoute, payerReference } = req.body as {
        premiumItemId?: string;
        paymentRoute?: string;
        payerReference: string | undefined;
      };

      if (!premiumItemId) {
        res.status(400).json({ error: "premiumItemId is required" });
        return;
      }

      if (!paymentRoute) {
        res.status(400).json({ error: "paymentRoute is required" });
        return;
      }

      if (!challengeService.validateRoute(paymentRoute)) {
        res.status(400).json({
          error: "Unsupported payment route. Supported routes: x402, mpp",
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

      if (!challengeService.validateRouteForItem(itemResult.value, paymentRoute)) {
        res.status(400).json({
          error: `Premium item does not support payment route: ${paymentRoute}`,
        });
        return;
      }

      const result = await challengeService.createChallenge({
        premiumItem: itemResult.value,
        paymentRoute,
        payerReference: payerReference ?? undefined,
      });

      const logEntry: ExecutionLogInsert = {
        action_type: "payment",
        entity_type: "premium_intelligence_item",
        entity_id: premiumItemId,
        status: "started",
        message: `Payment challenge issued via ${paymentRoute}`,
        details: {
          challengeReference: result.challenge.challengeReference,
          paymentRoute,
          amountRequested: result.challenge.amountRequested,
          currency: result.challenge.currency,
          premiumItemId,
        },
      };

      await params.execLogRepo.append(logEntry);

      res.status(201).json({
        challengeReference: result.challenge.challengeReference,
        paymentRoute: result.challenge.paymentRoute,
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
  router.post("/payments/settlements", async (req, res, next) => {
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

      if (
        premiumItemResult.ok &&
        premiumItemResult.value &&
        premiumItemResult.value.content_type === "sponsored_monitor"
      ) {
        try {
          const now = new Date();
          const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

          // Extract target contract from premium item's content_private
          const contentPrivate = premiumItemResult.value.content_private as
            | { targetContract?: string; watchSpecHash?: string }
            | undefined;
          const targetContract = contentPrivate?.targetContract;
          const watchSpecHash = contentPrivate?.watchSpecHash ?? `0x${"c".repeat(64)}`;

          if (!targetContract) {
            res.status(400).json({
              settled: false,
              error:
                "Sponsored monitor premium item is missing targetContract in content_private",
            });
            return;
          }

          const watch = await watchService.createSponsoredWatch({
            targetContract,
            watchSpecHash,
            startsAt: now.toISOString(),
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
            },
          });
          return;
        } catch (watchError) {
          console.error("Failed to create sponsored watch:", watchError);
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
