// Unit tests: PaymentSettlementService
// Ensures successful verification persists payer_reference via markSettled.

import type { ExecutionLogRepository, PaymentRecordRepository } from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import { PaymentSettlementService } from "../services/payment-settlement-service.ts";
import { MOCK_PAYMENT_CHALLENGE_ISSUED, MOCK_PAYMENT_SETTLED } from "./fixtures/payments.ts";

describe("PaymentSettlementService", () => {
  const challengeRecord = {
    ...MOCK_PAYMENT_CHALLENGE_ISSUED,
    payer_reference: null as string | null,
  };

  function createMocks(overrides?: {
    record?: typeof challengeRecord;
    verification?: {
      verified: boolean;
      amountSettled: number;
      currency: string;
      settlementReference: string;
      payerReference?: string;
      errorMessage?: string;
    };
  }) {
    const record = overrides?.record ?? challengeRecord;
    const verification = overrides?.verification ?? {
      verified: true,
      amountSettled: 5,
      currency: "USDC",
      settlementReference: "0xsettlementtx00000000000000000000000000000000001",
      payerReference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
    };

    const settledRow = {
      ...record,
      status: "settled" as const,
      settlement_reference: verification.settlementReference,
      amount_settled: verification.amountSettled,
      currency: verification.currency,
      payer_reference: verification.payerReference?.toLowerCase() ?? record.payer_reference,
      settled_at: new Date().toISOString(),
    };

    const paymentRecordRepo: PaymentRecordRepository = {
      createChallenge: vi.fn(),
      findById: vi.fn(),
      findByChallengeReference: vi.fn().mockResolvedValue({ ok: true as const, value: record }),
      markSettled: vi.fn().mockResolvedValue({ ok: true as const, value: settledRow }),
      markUnderpaid: vi.fn().mockResolvedValue({ ok: true as const, value: record }),
      markExpired: vi.fn(),
      markFailed: vi.fn().mockResolvedValue({ ok: true as const, value: record }),
      listByPremiumItem: vi.fn(),
      list: vi.fn(),
      findSettledByPayer: vi.fn(),
    };

    const execLogRepo: ExecutionLogRepository = {
      append: vi.fn().mockResolvedValue({ ok: true as const, value: { id: "log-1" } }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
    };

    const adapter: PaymentAdapter = {
      route: "x402",
      createChallenge: vi.fn(),
      verifySettlement: vi.fn().mockResolvedValue(verification),
    };

    const service = new PaymentSettlementService({
      paymentRecordRepo,
      execLogRepo,
      adapters: new Map([["x402", adapter]]),
    });

    return { service, paymentRecordRepo, execLogRepo, adapter, verification, settledRow };
  }

  it("threads verification.payerReference into markSettled so payer_reference is stored", async () => {
    const { service, paymentRecordRepo, verification } = createMocks();

    const result = await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: verification.settlementReference,
      paymentRoute: "x402",
    });

    expect(result.settled).toBe(true);
    expect(paymentRecordRepo.markSettled).toHaveBeenCalledTimes(1);
    expect(paymentRecordRepo.markSettled).toHaveBeenCalledWith(
      challengeRecord.id,
      verification.settlementReference,
      verification.amountSettled,
      verification.currency,
      verification.payerReference,
    );
    expect(result.verification.payerReference).toBe(
      verification.payerReference?.toLowerCase(),
    );
  });

  it("falls back to challenge-time payer_reference when verification omits payer", async () => {
    const challengePayer = "0xChallengePayer00000000000000000000000001";
    const { service, paymentRecordRepo, verification } = createMocks({
      record: {
        ...challengeRecord,
        payer_reference: challengePayer,
      },
      verification: {
        verified: true,
        amountSettled: 5,
        currency: "USDC",
        settlementReference: "0xsettlementtx00000000000000000000000000000000002",
        // no payerReference from adapter
      },
    });

    await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: "0xsettlementtx00000000000000000000000000000000002",
      paymentRoute: "x402",
    });

    expect(paymentRecordRepo.markSettled).toHaveBeenCalledWith(
      challengeRecord.id,
      "0xsettlementtx00000000000000000000000000000000002",
      5,
      "USDC",
      challengePayer,
    );
  });

  it("logs payerReference on successful settlement", async () => {
    const { service, execLogRepo, verification } = createMocks();

    await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: verification.settlementReference,
      paymentRoute: "x402",
    });

    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        details: expect.objectContaining({
          payerReference: expect.any(String),
        }),
      }),
    );
  });

  it("does not call markSettled when verification fails", async () => {
    const { service, paymentRecordRepo } = createMocks({
      verification: {
        verified: false,
        amountSettled: 0,
        currency: "USDC",
        settlementReference: "0xfail",
        errorMessage: "not paid",
      },
    });

    const result = await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: "0xfail",
      paymentRoute: "x402",
    });

    expect(result.settled).toBe(false);
    expect(paymentRecordRepo.markSettled).not.toHaveBeenCalled();
    expect(paymentRecordRepo.markFailed).toHaveBeenCalled();
  });

  it("returns stored payer_reference when already settled", async () => {
    const settled = {
      ...MOCK_PAYMENT_SETTLED,
      payer_reference: "0xpayerwallet000000000000000000000000000001",
    };
    const { service, paymentRecordRepo, adapter } = createMocks({
      record: settled as typeof challengeRecord,
    });

    const result = await service.settle({
      challengeReference: settled.challenge_reference!,
      settlementReference: "0xanything",
      paymentRoute: "x402",
    });

    expect(result.settled).toBe(true);
    expect(result.verification.payerReference).toBe(settled.payer_reference);
    expect(adapter.verifySettlement).not.toHaveBeenCalled();
    expect(paymentRecordRepo.markSettled).not.toHaveBeenCalled();
  });

  it("surfaces markSettled failures instead of reporting settled", async () => {
    const { service, paymentRecordRepo, verification } = createMocks();
    vi.mocked(paymentRecordRepo.markSettled).mockResolvedValue({
      ok: false as const,
      error: {
        name: "PersistenceError",
        code: "PERSISTENCE",
        message: "write failed",
        statusCode: 500,
      } as never,
    });

    await expect(
      service.settle({
        challengeReference: challengeRecord.challenge_reference!,
        settlementReference: verification.settlementReference,
        paymentRoute: "x402",
      }),
    ).rejects.toThrow(/Failed to record payment settlement/);
  });
});
