// Premium Access Service
// Gates premium content behind settled payment records.
// Returns 402 Payment Required when no valid payment exists.

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import type { PremiumIntelligenceItemRow } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import type { PaymentAdapter, ChallengeResult } from "../payments/payment-adapter.ts";
import {
  PremiumContentVisibilityService,
  type PremiumItemFull,
  type PremiumItemTeaser,
} from "./premium-content-visibility-service.ts";

export type PremiumAccessResult =
  | {
      allowed: true;
      content: PremiumItemFull;
    }
  | {
      allowed: false;
      challenge: {
        challengeReference: string;
        paymentRoute: PaymentRoute;
        amountRequested: number;
        currency: string;
        expiresAt: string;
        challengeData: Record<string, unknown>;
      };
      paymentRecordId: string;
    };

export class PremiumAccessService {
  private readonly premiumRepo: PremiumIntelligenceRepository;
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly visibilityService: PremiumContentVisibilityService;

  constructor(params: {
    premiumRepo: PremiumIntelligenceRepository;
    paymentRecordRepo: PaymentRecordRepository;
    execLogRepo: ExecutionLogRepository;
  }) {
    this.premiumRepo = params.premiumRepo;
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.execLogRepo = params.execLogRepo;
    this.visibilityService = new PremiumContentVisibilityService();
  }

  /**
   * Attempt to access premium content.
   *
   * If the user has a valid settled payment record for this item,
   * returns the full content with private data.
   *
   * Otherwise, returns a 402 challenge result.
   */
  async accessPremiumItem(params: {
    itemId: string;
    payerReference?: string | undefined;
    paymentRoute?: PaymentRoute | undefined;
  }): Promise<PremiumAccessResult> {
    const itemResult = await this.premiumRepo.findById(params.itemId);

    if (!itemResult.ok || !itemResult.value) {
      throw new Error(`Premium item not found: ${params.itemId}`);
    }

    const item = itemResult.value;

    // Check if there's a settled payment for this item
    if (params.payerReference) {
      const settledResult = await this.paymentRecordRepo.findSettledByPayer(
        params.itemId,
        params.payerReference,
      );

      if (settledResult.ok && settledResult.value) {
        // User has access - return full content
        return {
          allowed: true,
          content: this.visibilityService.toFullWithPrivateContent(item),
        };
      }
    }

    // No valid payment found - check all payment records for this item
    // to see if there's any settled record
    const allPayments = await this.paymentRecordRepo.listByPremiumItem(params.itemId);

    if (allPayments.ok) {
      const settledPayment = allPayments.value.find((p) => p.status === "settled");
      if (settledPayment) {
        return {
          allowed: true,
          content: this.visibilityService.toFullWithPrivateContent(item),
        };
      }
    }

    // No access - return 402
    throw new PaymentRequiredError(
      item,
      params.paymentRoute ?? (item.payment_routes[0] as PaymentRoute) ?? "x402",
    );
  }

  /**
   * List available premium teasers (public-safe fields only).
   */
  async listTeasers(): Promise<PremiumItemTeaser[]> {
    const result = await this.premiumRepo.listTeasers();

    if (!result.ok) {
      throw new Error(`Failed to list premium items: ${result.error.message}`);
    }

    return this.visibilityService.toTeaserList(result.value);
  }
}

/**
 * Custom error that signals a 402 Payment Required response.
 * The challenge property contains the payment challenge details.
 */
export class PaymentRequiredError extends Error {
  public readonly statusCode = 402;
  public readonly item: PremiumIntelligenceItemRow;
  public readonly paymentRoute: PaymentRoute;

  constructor(item: PremiumIntelligenceItemRow, paymentRoute: PaymentRoute) {
    super("Payment required to access premium content");
    this.name = "PaymentRequiredError";
    this.item = item;
    this.paymentRoute = paymentRoute;
  }
}
