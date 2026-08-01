// Payment Settlement Service
// Executes route-specific verification, underpayment detection, settlement recording,
// and triggers sponsored watches when applicable.

import type { ExecutionLogRepository, PaymentRecordRepository } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { badRequest } from "../errors.ts";
import type { PaymentAdapter, SettlementVerificationResult } from "../payments/payment-adapter.ts";
import type { AffiliateEarningsService } from "./affiliate-earnings-service.ts";
import type {
  AffiliateFundingResult,
  AffiliateFundingService,
} from "./affiliate-funding-service.ts";

export interface SettlementResult {
  settled: boolean;
  /** True only for the request that atomically consumed an open challenge. */
  newlySettled: boolean;
  paymentRecordId: string;
  verification: SettlementVerificationResult;
  isSponsoredWatch: boolean;
  sponsoredWatchId?: string;
  /** Present when a referred settlement credited affiliate earnings. */
  affiliateReward?: {
    credited: boolean;
    rewardAmount: number;
    reason?: string;
  };
  /** Funding status for the KeeperHub affiliate execution float. */
  affiliateFunding?: AffiliateFundingResult;
}

/** Fallback when a legacy record has no expires_at (matches x402 challenge window). */
const LEGACY_CHALLENGE_EXPIRY_MS = 600_000;

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Prefer a real EVM payout identity (needed for on-chain referral transfers).
 * Falls back to any non-empty reference for access scoping.
 */
export function resolveSettlementPayerReference(
  verificationPayer: string | null | undefined,
  challengePayer: string | null | undefined,
): string | null {
  const candidates = [verificationPayer, challengePayer]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);

  const evm = candidates.find((p) => EVM_ADDRESS_RE.test(p));
  if (evm) return evm.toLowerCase();

  // Drop synthetic MPP ids that cannot receive on-chain payouts.
  const usable = candidates.find((p) => !p.startsWith("mpp-client-"));
  return usable ?? null;
}

function resolveRecordExpiryMs(record: {
  expires_at?: string | null;
  requested_at: string;
}): number | null {
  if (record.expires_at) {
    const parsed = Date.parse(record.expires_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const requested = Date.parse(record.requested_at);
  if (Number.isNaN(requested)) return null;
  return requested + LEGACY_CHALLENGE_EXPIRY_MS;
}

export class PaymentSettlementService {
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly adapters: Map<PaymentRoute, PaymentAdapter>;
  private readonly earningsService: AffiliateEarningsService | null;
  private readonly fundingService: AffiliateFundingService | null;

  constructor(params: {
    paymentRecordRepo: PaymentRecordRepository;
    execLogRepo: ExecutionLogRepository;
    adapters: Map<PaymentRoute, PaymentAdapter>;
    /** When set, credits affiliate USDC ledger on successful settlement. */
    earningsService?: AffiliateEarningsService | null;
    /** When set, moves credited affiliate rewards into the KeeperHub float. */
    fundingService?: AffiliateFundingService | null;
  }) {
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.execLogRepo = params.execLogRepo;
    this.adapters = params.adapters;
    this.earningsService = params.earningsService ?? null;
    this.fundingService = params.fundingService ?? null;
  }

  /**
   * Settle a payment challenge.
   *
   * Steps:
   * 1. Look up the payment record by challenge reference
   * 2. Enforce challenge expiry (status + expires_at)
   * 3. Verify the settlement via the route adapter
   * 4. Check for underpayment / failure
   * 5. Record the settlement result
   * 6. Log execution
   * 7. Return result (which may trigger sponsored watch creation)
   */
  async settle(params: {
    challengeReference: string;
    settlementReference: string;
    paymentRoute: PaymentRoute;
    amountSettled?: number | undefined;
    currency?: string | undefined;
  }): Promise<SettlementResult> {
    // Best-effort reaper so open challenges transition to expired without a separate cron hit.
    // Failures here must not block settlement of a still-valid challenge.
    try {
      await this.paymentRecordRepo.expireOpenChallenges();
    } catch {
      // ignore reaper errors
    }

    // Look up the payment record
    const recordResult = await this.paymentRecordRepo.findByChallengeReference(
      params.challengeReference,
    );

    if (!recordResult.ok) {
      throw badRequest(`Failed to find payment record: ${recordResult.error.message}`);
    }

    const record = recordResult.value;
    if (!record) {
      throw badRequest(`Payment record not found for challenge: ${params.challengeReference}`);
    }

    // The challenge record is authoritative. Never let the caller switch rails
    // or currencies when settling or replaying a challenge.
    if (record.payment_route !== params.paymentRoute) {
      throw badRequest(
        `Payment route mismatch: challenge requires ${record.payment_route}`,
      );
    }
    const expectedCurrency = (record.currency ?? "USDC").trim();
    if (
      params.currency !== undefined &&
      params.currency.trim().toLowerCase() !== expectedCurrency.toLowerCase()
    ) {
      throw badRequest(`Currency mismatch: challenge requires ${expectedCurrency}`);
    }

    // Check if already settled
    if (record.status === "settled") {
      const vPayerRef = record.payer_reference ?? undefined;
      return {
        settled: true,
        newlySettled: false,
        paymentRecordId: record.id,
        verification: {
          verified: true,
          amountSettled: record.amount_settled ?? 0,
          currency: expectedCurrency,
          settlementReference: record.settlement_reference ?? params.settlementReference,
          ...(vPayerRef !== undefined ? { payerReference: vPayerRef } : {}),
        },
        isSponsoredWatch: false,
      };
    }

    // Check if already marked expired
    if (record.status === "expired") {
      return {
        settled: false,
        newlySettled: false,
        paymentRecordId: record.id,
        verification: {
          verified: false,
          amountSettled: 0,
          currency: expectedCurrency,
          settlementReference: params.settlementReference,
          errorMessage: "Challenge has expired",
        },
        isSponsoredWatch: false,
      };
    }

    // Enforce expires_at even when status was not yet reaped to "expired"
    const expiryMs = resolveRecordExpiryMs(record);
    if (expiryMs !== null && Date.now() >= expiryMs) {
      await this.paymentRecordRepo.markExpired(record.id);

      await this.execLogRepo.append({
        action_type: "payment",
        entity_type: "payment_record",
        entity_id: record.id,
        status: "failed",
        message: "Payment settlement rejected: challenge expired",
        details: {
          challengeReference: params.challengeReference,
          settlementReference: params.settlementReference,
          paymentRoute: params.paymentRoute,
          expiresAt: record.expires_at ?? new Date(expiryMs).toISOString(),
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return {
        settled: false,
        newlySettled: false,
        paymentRecordId: record.id,
        verification: {
          verified: false,
          amountSettled: 0,
          currency: expectedCurrency,
          settlementReference: params.settlementReference,
          errorMessage: "Challenge has expired",
        },
        isSponsoredWatch: false,
      };
    }

    // Get the route adapter
    const adapter = this.adapters.get(params.paymentRoute);
    if (!adapter) {
      throw new Error(`Unsupported payment route: ${params.paymentRoute}`);
    }

    // Verify the settlement (pass challenge-time payer + expiry for MPP rail hygiene)
    const verification = await adapter.verifySettlement({
      challengeReference: params.challengeReference,
      settlementReference: params.settlementReference,
      amountRequested: record.amount_requested ?? 0,
      currency: expectedCurrency,
      paymentRoute: params.paymentRoute,
      challengePayerReference: record.payer_reference,
      challengeExpiresAt: record.expires_at,
    });

    if (!verification.verified) {
      // Log the failed settlement
      await this.execLogRepo.append({
        action_type: "payment",
        entity_type: "payment_record",
        entity_id: record.id,
        status: "failed",
        message: `Payment settlement failed: ${verification.errorMessage ?? "Unknown error"}`,
        details: {
          challengeReference: params.challengeReference,
          settlementReference: params.settlementReference,
          paymentRoute: params.paymentRoute,
          errorMessage: verification.errorMessage,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      // If adapter reported expiry, mark the record expired for consistency
      const err = (verification.errorMessage ?? "").toLowerCase();
      if (err.includes("expired")) {
        await this.paymentRecordRepo.markExpired(record.id);
      } else if (
        verification.amountSettled > 0 &&
        verification.amountSettled < (record.amount_requested ?? 0)
      ) {
        await this.paymentRecordRepo.markUnderpaid(record.id);
      } else {
        await this.paymentRecordRepo.markFailed(record.id, verification.errorMessage);
      }

      return {
        settled: false,
        newlySettled: false,
        paymentRecordId: record.id,
        verification,
        isSponsoredWatch: false,
      };
    }

    // Prefer on-chain / EVM payer identities so referral rewards can transfer on-chain.
    const payerReference = resolveSettlementPayerReference(
      verification.payerReference,
      record.payer_reference,
    );

    const settleWrite = await this.paymentRecordRepo.markSettled(
      record.id,
      verification.settlementReference,
      verification.amountSettled,
      verification.currency,
      payerReference,
    );

    if (!settleWrite.ok) {
      throw badRequest(
        `Failed to record payment settlement: ${settleWrite.error.message}`,
      );
    }

    // Credit the affiliate ledger when payer is attributed. The reward remains
    // withdrawable only by the affiliate agent; funding the KeeperHub float is
    // a separate, idempotent treasury movement.
    let affiliateReward: SettlementResult["affiliateReward"];
    let affiliateFunding: SettlementResult["affiliateFunding"];
    if (this.earningsService) {
      try {
        const credit = await this.earningsService.creditFromSettledPayment(settleWrite.value);
        affiliateReward = {
          credited: credit.credited,
          rewardAmount: credit.rewardAmount,
          ...(credit.reason ? { reason: credit.reason } : {}),
        };
        if (credit.credited && credit.earningId && this.fundingService) {
          const funding = await this.fundingService.fundEarning({
            earningId: credit.earningId,
            amount: credit.rewardAmount,
            currency: settleWrite.value.currency ?? "USDC",
          });
          affiliateFunding = funding;
          if (funding.status === "failed") {
            console.error(
              `[affiliate-funding] failed earning=${credit.earningId}: ${funding.errorMessage ?? "unknown"}`,
            );
          }
        }
        if (!credit.credited) {
          console.warn(
            `[affiliate-earnings] credit skipped payment=${settleWrite.value.id}: ${credit.reason ?? "unknown"}`,
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "affiliate_credit_failed";
        console.error(
          `[affiliate-earnings] credit failed payment=${settleWrite.value.id}: ${reason}`,
        );
        affiliateReward = {
          credited: false,
          rewardAmount: 0,
          reason,
        };
      }
    }

    // Log the successful settlement
    await this.execLogRepo.append({
      action_type: "payment",
      entity_type: "payment_record",
      entity_id: record.id,
      status: "succeeded",
      message: "Payment settled successfully",
      details: {
        challengeReference: params.challengeReference,
        settlementReference: params.settlementReference,
        settlement_reference: params.settlementReference,
        paymentRoute: params.paymentRoute,
        amountSettled: verification.amountSettled,
        currency: verification.currency,
        payerReference: settleWrite.value.payer_reference ?? payerReference,
        referralAddress: settleWrite.value.referral_address,
        affiliateReward,
        affiliateFunding,
        // Prefer settlement tx hash when the adapter returns a 0x hash.
        ...(typeof params.settlementReference === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(params.settlementReference)
          ? {
              tx_hash: params.settlementReference,
              registry_tx_hash: params.settlementReference,
            }
          : {}),
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    // Check if this is a sponsored_monitor item (will trigger sponsored watch creation)
    // The caller (route handler) will check the premium item content type and create the watch

    // Surface the stored payer on the verification result so receipt issuance
    // and clients see the same value that was written to payment_records.
    const storedPayer = settleWrite.value.payer_reference;
    const verificationWithPayer: SettlementVerificationResult = {
      ...verification,
      ...(storedPayer
        ? { payerReference: storedPayer }
        : payerReference
          ? { payerReference }
          : {}),
    };

    return {
      settled: true,
      newlySettled: true,
      paymentRecordId: record.id,
      verification: verificationWithPayer,
      isSponsoredWatch: false, // Caller determines this from the premium item type
      ...(affiliateReward ? { affiliateReward } : {}),
      ...(affiliateFunding ? { affiliateFunding } : {}),
    };
  }
}
