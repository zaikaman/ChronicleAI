// Payment Settlement Service
// Executes route-specific verification, underpayment detection, settlement recording,
// and triggers sponsored watches when applicable.

import type { ExecutionLogRepository, PaymentRecordRepository } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { badRequest } from "../errors.ts";
import type { PaymentAdapter, SettlementVerificationResult } from "../payments/payment-adapter.ts";

export interface SettlementResult {
  settled: boolean;
  paymentRecordId: string;
  verification: SettlementVerificationResult;
  isSponsoredWatch: boolean;
  sponsoredWatchId?: string;
}

export class PaymentSettlementService {
  private readonly paymentRecordRepo: PaymentRecordRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly adapters: Map<PaymentRoute, PaymentAdapter>;

  constructor(params: {
    paymentRecordRepo: PaymentRecordRepository;
    execLogRepo: ExecutionLogRepository;
    adapters: Map<PaymentRoute, PaymentAdapter>;
  }) {
    this.paymentRecordRepo = params.paymentRecordRepo;
    this.execLogRepo = params.execLogRepo;
    this.adapters = params.adapters;
  }

  /**
   * Settle a payment challenge.
   *
   * Steps:
   * 1. Look up the payment record by challenge reference
   * 2. Verify the settlement via the route adapter
   * 3. Check for underpayment / expiry / failure
   * 4. Record the settlement result
   * 5. Log execution
   * 6. Return result (which may trigger sponsored watch creation)
   */
  async settle(params: {
    challengeReference: string;
    settlementReference: string;
    paymentRoute: PaymentRoute;
    amountSettled?: number | undefined;
    currency?: string | undefined;
  }): Promise<SettlementResult> {
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

    // Check if already settled
    if (record.status === "settled") {
      const vPayerRef = record.payer_reference ?? undefined;
      return {
        settled: true,
        paymentRecordId: record.id,
        verification: {
          verified: true,
          amountSettled: record.amount_settled ?? 0,
          currency: record.currency ?? params.currency ?? "USDC",
          settlementReference: record.settlement_reference ?? params.settlementReference,
          ...(vPayerRef !== undefined ? { payerReference: vPayerRef } : {}),
        },
        isSponsoredWatch: false,
      };
    }

    // Check if expired
    if (record.status === "expired") {
      return {
        settled: false,
        paymentRecordId: record.id,
        verification: {
          verified: false,
          amountSettled: 0,
          currency: params.currency ?? "USDC",
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

    // Verify the settlement
    const verification = await adapter.verifySettlement({
      challengeReference: params.challengeReference,
      settlementReference: params.settlementReference,
      amountRequested: record.amount_requested ?? 0,
      currency: params.currency ?? record.currency ?? "USDC",
      paymentRoute: params.paymentRoute,
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

      // Check if underpaid
      if (
        verification.amountSettled > 0 &&
        verification.amountSettled < (record.amount_requested ?? 0)
      ) {
        await this.paymentRecordRepo.markUnderpaid(record.id);
      } else {
        await this.paymentRecordRepo.markFailed(record.id, verification.errorMessage);
      }

      return {
        settled: false,
        paymentRecordId: record.id,
        verification,
        isSponsoredWatch: false,
      };
    }

    // Prefer the on-chain / adapter-verified payer; fall back to challenge-time payer.
    // Persisting this is required for findSettledByPayer and payer-scoped access receipts.
    const payerReference =
      verification.payerReference ?? record.payer_reference ?? null;

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
        amountSettled: verification.amountSettled,
        currency: verification.currency,
        payerReference: settleWrite.value.payer_reference ?? payerReference,
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
      paymentRecordId: record.id,
      verification: verificationWithPayer,
      isSponsoredWatch: false, // Caller determines this from the premium item type
    };
  }
}
