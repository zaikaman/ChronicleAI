// Premium Access Service
// Gates premium content behind HMAC-signed access receipts issued at settlement.
// Client-supplied ?payer= alone never unlocks private content.

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  SponsoredWatchRepository,
} from "@chronicleai/db";
import type { PremiumIntelligenceItemRow } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import type { PremiumAccessReceiptService } from "./premium-access-receipt-service.ts";
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
  private readonly receiptService: PremiumAccessReceiptService;
  private readonly visibilityService: PremiumContentVisibilityService;

  private readonly watchRepo?: SponsoredWatchRepository | undefined;

  constructor(params: {
    premiumRepo: PremiumIntelligenceRepository;
    paymentRecordRepo: PaymentRecordRepository;
    execLogRepo: ExecutionLogRepository;
    receiptService: PremiumAccessReceiptService;
    watchRepo?: SponsoredWatchRepository | undefined;
  }) {
    this.premiumRepo = params.premiumRepo;
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.execLogRepo = params.execLogRepo;
    this.receiptService = params.receiptService;
    this.watchRepo = params.watchRepo;
    this.visibilityService = new PremiumContentVisibilityService();
  }

  /**
   * Attempt to access premium content.
   *
   * Access is granted only when a valid HMAC-signed access receipt is presented
   * and the referenced payment record is still settled for this item.
   * Bare payer references are not accepted as proof of entitlement.
   *
   * Otherwise throws PaymentRequiredError (402).
   */
  async accessPremiumItem(params: {
    itemId: string;
    accessReceipt?: string | undefined;
    payerReference?: string | undefined;
    paymentRoute?: PaymentRoute | undefined;
  }): Promise<PremiumAccessResult & { accessReceipt?: string }> {
    const itemResult = await this.premiumRepo.findById(params.itemId);

    if (!itemResult.ok || !itemResult.value) {
      throw new Error(`Premium item not found: ${params.itemId}`);
    }

    const item = itemResult.value;
    const paymentRoute =
      params.paymentRoute ?? (item.payment_routes[0] as PaymentRoute) ?? "x402";

    let receiptToken = params.accessReceipt?.trim();
    let autoIssuedReceipt: string | undefined = undefined;

    if (!receiptToken && params.payerReference?.trim()) {
      const settledResult = await this.paymentRecordRepo.findSettledByPayer(
        params.itemId,
        params.payerReference.trim(),
      );
      if (settledResult.ok && settledResult.value) {
        const issued = this.receiptService.issue({
          paymentRecordId: settledResult.value.id,
          premiumItemId: params.itemId,
          payerReference: settledResult.value.payer_reference,
        });
        receiptToken = issued.token;
        autoIssuedReceipt = issued.token;
      }
    }

    if (!receiptToken) {
      throw new PaymentRequiredError(item, paymentRoute);
    }

    const verified = this.receiptService.verify(receiptToken);
    if (!verified.ok) {
      throw new PaymentRequiredError(item, paymentRoute);
    }

    const { claims } = verified;

    // Receipt must be bound to the requested item
    if (claims.pi !== params.itemId) {
      throw new PaymentRequiredError(item, paymentRoute);
    }

    // Defense in depth: re-check settlement status in the database
    const paymentResult = await this.paymentRecordRepo.findById(claims.pr);
    if (!paymentResult.ok || !paymentResult.value) {
      throw new PaymentRequiredError(item, paymentRoute);
    }

    const payment = paymentResult.value;
    if (
      payment.status !== "settled" ||
      payment.premium_item_id !== params.itemId
    ) {
      throw new PaymentRequiredError(item, paymentRoute);
    }

    // If the receipt carries a payer claim, it must match the settled record
    // (EVM addresses compared case-insensitively to match normalizePayerReference storage).
    if (claims.pay && payment.payer_reference) {
      const claimPay = claims.pay.trim().toLowerCase();
      const storedPay = payment.payer_reference.trim().toLowerCase();
      if (claimPay !== storedPay) {
        throw new PaymentRequiredError(item, paymentRoute);
      }
    }

    const fullContent = this.visibilityService.toFullWithPrivateContent(item);

    if (item.content_type === "sponsored_monitor" && this.watchRepo) {
      try {
        const watchesResult = await this.watchRepo.list();
        if (watchesResult.ok && Array.isArray(watchesResult.value)) {
          const privateObj =
            typeof item.content_private === "object" && item.content_private !== null
              ? (item.content_private as Record<string, unknown>)
              : {};
          const targetContract = String(privateObj.targetContract ?? "").toLowerCase();
          const watchSpecHash = String(privateObj.watchSpecHash ?? "").toLowerCase();

          const match = watchesResult.value.find((w: { watch_spec_hash?: string | null; target_contract?: string | null }) => {
            if (watchSpecHash && w.watch_spec_hash?.toLowerCase() === watchSpecHash) return true;
            if (targetContract && w.target_contract?.toLowerCase() === targetContract) return true;
            return false;
          });

          if (match) {
            fullContent.contentPrivate = {
              ...privateObj,
              watchId: match.id,
              status: match.status,
              reportTitle: match.report_title ?? undefined,
              reportSummary: match.report_summary ?? undefined,
              reportHighlights: match.report_highlights ?? undefined,
              reportAnalysis: match.report_analysis ?? undefined,
              createTxHash: match.create_tx_hash ?? undefined,
              reportTxHash: match.report_tx_hash ?? undefined,
              createExplorerUrl: match.create_explorer_url ?? undefined,
              reportExplorerUrl: match.report_explorer_url ?? undefined,
              sourceEventRoot: match.source_event_root ?? undefined,
              monitoredEventCount: match.monitored_event_count ?? 0,
            };
          }
        }
      } catch {
        // ignore enrichment failure
      }
    }

    return {
      allowed: true,
      content: fullContent,
      ...(autoIssuedReceipt ? { accessReceipt: autoIssuedReceipt } : {}),
    };
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
