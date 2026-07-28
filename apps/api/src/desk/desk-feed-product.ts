/**
 * Premium desk feed catalog product (x402).
 * Ensures a stable premium_intelligence_items row for desk feed access receipts.
 */

import type {
  PremiumIntelligenceItemRow,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import type { PaymentRecordRepository } from "@chronicleai/db";
import {
  extractAccessReceiptFromRequest,
  type PremiumAccessReceiptService,
} from "../services/premium-access-receipt-service.ts";
import { PRIVATE_ROUTING_PRODUCT_DESCRIPTION } from "../services/routing-metadata.ts";

export const DESK_FEED_PRODUCT_SLUG = "chronicle-desk-feed";

/** Public teaser for the desk feed product (x402 catalog + OpenAPI-style discovery). */
export const DESK_FEED_SUMMARY_PUBLIC =
  "Machine-readable desk intents, trade tickets, and live feed snapshot (x402). " +
  PRIVATE_ROUTING_PRODUCT_DESCRIPTION;

export interface DeskFeedProductConfig {
  priceUsdc: number;
}

export interface DeskFeedAccessGate {
  /** Ensure catalog product exists (create/update price). */
  ensureProduct(): Promise<PremiumIntelligenceItemRow>;
  /** Verify receipt + settled payment for the desk feed product. */
  verifyAccess(params: {
    authorizationHeader?: string | undefined;
    receiptHeader?: string | string[] | undefined;
    receiptQuery?: string | string[] | undefined;
    cookieHeader?: string | undefined;
  }): Promise<
    | { allowed: true; product: PremiumIntelligenceItemRow; paymentRecordId: string }
    | { allowed: false; product: PremiumIntelligenceItemRow; reason: string }
  >;
}

export function createDeskFeedAccessGate(deps: {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  receiptService: PremiumAccessReceiptService;
  priceUsdc: number;
}): DeskFeedAccessGate {
  async function ensureProduct(): Promise<PremiumIntelligenceItemRow> {
    const existing = await deps.premiumRepo.findBySlug(DESK_FEED_PRODUCT_SLUG);
    if (!existing.ok) {
      throw new Error(`Failed to load desk feed product: ${existing.error.message}`);
    }

    if (existing.value) {
      const needsUpdate =
        existing.value.price_amount !== deps.priceUsdc ||
        existing.value.price_currency !== "USDC" ||
        !existing.value.payment_routes.includes("x402") ||
        existing.value.status !== "available" ||
        existing.value.summary_public !== DESK_FEED_SUMMARY_PUBLIC;

      if (!needsUpdate) {
        return existing.value;
      }

      const updated = await deps.premiumRepo.update(existing.value.id, {
        price_amount: deps.priceUsdc,
        price_currency: "USDC",
        payment_routes: ["x402"],
        status: "available",
        content_type: "structured_feed",
        title: "Chronicle Desk Feed",
        summary_public: DESK_FEED_SUMMARY_PUBLIC,
      });
      if (!updated.ok) {
        throw new Error(`Failed to update desk feed product: ${updated.error.message}`);
      }
      return updated.value;
    }

    const created = await deps.premiumRepo.create({
      slug: DESK_FEED_PRODUCT_SLUG,
      title: "Chronicle Desk Feed",
      content_type: "structured_feed",
      summary_public: DESK_FEED_SUMMARY_PUBLIC,
      content_private: {
        product: "desk_feed",
        endpoints: [
          "/premium/desk/intents",
          "/premium/desk/tickets/:id",
          "/premium/desk/stream",
        ],
        executionRouting: PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
        notes: [
          "Private submission path on Sepolia via KeeperHub + Flashbots Protect — not mainnet sandwich claims.",
          `Priced at ${deps.priceUsdc} USDC via x402.`,
        ],
      },
      source_event_ids: [],
      price_amount: deps.priceUsdc,
      price_currency: "USDC",
      payment_routes: ["x402"],
      status: "available",
    });

    if (!created.ok) {
      throw new Error(`Failed to create desk feed product: ${created.error.message}`);
    }
    return created.value;
  }

  return {
    ensureProduct,

    async verifyAccess(params) {
      const product = await ensureProduct();

      const receiptToken = extractAccessReceiptFromRequest({
        authorizationHeader: params.authorizationHeader,
        receiptHeader: params.receiptHeader,
        receiptQuery: params.receiptQuery,
        cookieHeader: params.cookieHeader,
        premiumItemId: product.id,
      });

      if (!receiptToken) {
        return { allowed: false, product, reason: "missing_receipt" };
      }

      const verified = deps.receiptService.verify(receiptToken);
      if (!verified.ok) {
        return { allowed: false, product, reason: verified.reason };
      }

      if (verified.claims.pi !== product.id) {
        return { allowed: false, product, reason: "receipt_item_mismatch" };
      }

      const paymentResult = await deps.paymentRecordRepo.findById(verified.claims.pr);
      if (!paymentResult.ok || !paymentResult.value) {
        return { allowed: false, product, reason: "payment_not_found" };
      }

      const payment = paymentResult.value;
      if (
        payment.status !== "settled" ||
        payment.premium_item_id !== product.id
      ) {
        return { allowed: false, product, reason: "payment_not_settled" };
      }

      if (verified.claims.pay && payment.payer_reference) {
        const claimPay = verified.claims.pay.trim().toLowerCase();
        const storedPay = payment.payer_reference.trim().toLowerCase();
        if (claimPay !== storedPay) {
          return { allowed: false, product, reason: "payer_mismatch" };
        }
      }

      return {
        allowed: true,
        product,
        paymentRecordId: payment.id,
      };
    },
  };
}
