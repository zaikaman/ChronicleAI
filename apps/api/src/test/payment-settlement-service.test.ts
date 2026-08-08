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
      markExpired: vi
        .fn()
        .mockResolvedValue({ ok: true as const, value: { ...record, status: "expired" as const } }),
      markFailed: vi.fn().mockResolvedValue({ ok: true as const, value: record }),
      markRegistryProof: vi.fn().mockResolvedValue({ ok: true as const, value: settledRow }),
      expireOpenChallenges: vi.fn().mockResolvedValue({ ok: true as const, value: 0 }),
      deleteExpiredChallenges: vi.fn().mockResolvedValue({ ok: true as const, value: 0 }),
      listByPremiumItem: vi.fn(),
      list: vi.fn(),
      listPage: vi.fn(),
      listSettledWithReferral: vi.fn().mockResolvedValue({ ok: true as const, value: [] }),
      listByPayer: vi.fn(),
      findSettledByPayer: vi.fn(),
    };

    const execLogRepo: ExecutionLogRepository = {
      append: vi.fn().mockResolvedValue({ ok: true as const, value: { id: "log-1" } }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    };

    const adapter: PaymentAdapter = {
      route: "x402",
      createChallenge: vi.fn(),
      verifySettlement: vi.fn().mockResolvedValue(verification),
    };

    const earningsService = {
      resolveAffiliateForPayer: vi.fn(),
      creditFromSettledPayment: vi.fn().mockResolvedValue({
        credited: true,
        rewardAmount: 1,
        earningId: "earn-1",
      }),
    };

    const service = new PaymentSettlementService({
      paymentRecordRepo,
      execLogRepo,
      adapters: new Map([["x402", adapter]]),
      earningsService,
    });

    return {
      service,
      paymentRecordRepo,
      execLogRepo,
      adapter,
      verification,
      settledRow,
      earningsService,
    };
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
      verification.payerReference!.toLowerCase(),
    );
    expect(result.verification.payerReference).toBe(verification.payerReference?.toLowerCase());
  });

  it("falls back to challenge-time payer_reference when verification omits payer", async () => {
    const challengePayer = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf02";
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
      challengePayer.toLowerCase(),
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

  it("credits affiliate earnings after a successful settlement", async () => {
    const { service, earningsService, settledRow, verification } = createMocks();

    const result = await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: verification.settlementReference,
      paymentRoute: "x402",
    });

    expect(result.settled).toBe(true);
    expect(earningsService.creditFromSettledPayment).toHaveBeenCalledTimes(1);
    expect(earningsService.creditFromSettledPayment).toHaveBeenCalledWith(settledRow);
    expect(result.affiliateReward).toEqual({
      credited: true,
      rewardAmount: 1,
    });
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

  it("rejects settlement when record.expires_at is in the past and marks expired", async () => {
    const { service, paymentRecordRepo, adapter } = createMocks({
      record: {
        ...challengeRecord,
        expires_at: new Date(Date.now() - 1_000).toISOString(),
      },
    });

    const result = await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: "0xshouldnotsettle",
      paymentRoute: "x402",
    });

    expect(result.settled).toBe(false);
    expect(result.verification.errorMessage).toMatch(/expired/i);
    expect(paymentRecordRepo.markExpired).toHaveBeenCalledWith(challengeRecord.id);
    expect(adapter.verifySettlement).not.toHaveBeenCalled();
    expect(paymentRecordRepo.markSettled).not.toHaveBeenCalled();
  });

  it("passes challenge-time payer_reference into adapter.verifySettlement", async () => {
    const challengePayer = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf03";
    const { service, adapter, verification } = createMocks({
      record: {
        ...challengeRecord,
        payer_reference: challengePayer,
      },
    });

    await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: verification.settlementReference,
      paymentRoute: "x402",
    });

    expect(adapter.verifySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        challengePayerReference: challengePayer,
      }),
    );
  });

  it("prefers EVM challenge payer over synthetic verification payer", async () => {
    const challengePayer = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf04";
    const { service, paymentRecordRepo } = createMocks({
      record: {
        ...challengeRecord,
        payer_reference: challengePayer,
      },
      verification: {
        verified: true,
        amountSettled: 5,
        currency: "USDC",
        settlementReference: "0xsettlementtx00000000000000000000000000000000003",
        payerReference: "mpp-client-2026-07-",
      },
    });

    await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: "0xsettlementtx00000000000000000000000000000000003",
      paymentRoute: "x402",
    });

    expect(paymentRecordRepo.markSettled).toHaveBeenCalledWith(
      challengeRecord.id,
      "0xsettlementtx00000000000000000000000000000000003",
      5,
      "USDC",
      challengePayer.toLowerCase(),
    );
  });

  it("runs expireOpenChallenges reaper before settling", async () => {
    const { service, paymentRecordRepo, verification } = createMocks();

    await service.settle({
      challengeReference: challengeRecord.challenge_reference!,
      settlementReference: verification.settlementReference,
      paymentRoute: "x402",
    });

    expect(paymentRecordRepo.expireOpenChallenges).toHaveBeenCalled();
  });

  it("allows a settlement reference to be consumed by only one of two items", async () => {
    const settlementReference = "0xsharedsettlement00000000000000000000000000000000001";
    const first = createMocks({
      record: {
        ...challengeRecord,
        id: "payment-item-1",
        premium_item_id: "premium-item-1",
        challenge_reference: "challenge-item-1",
      },
      verification: {
        verified: true,
        amountSettled: 5,
        currency: "USDC",
        settlementReference,
        payerReference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
      },
    });
    const second = createMocks({
      record: {
        ...challengeRecord,
        id: "payment-item-2",
        premium_item_id: "premium-item-2",
        challenge_reference: "challenge-item-2",
      },
      verification: {
        verified: true,
        amountSettled: 5,
        currency: "USDC",
        settlementReference,
        payerReference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
      },
    });

    let consumed = false;
    const consumeOnce = async () => {
      if (consumed) {
        return {
          ok: false as const,
          error: {
            name: "ConflictError",
            code: "CONFLICT",
            message: "settlement already consumed",
            statusCode: 409,
          } as never,
        };
      }
      consumed = true;
      return { ok: true as const, value: first.settledRow };
    };
    vi.mocked(first.paymentRecordRepo.markSettled).mockImplementation(consumeOnce);
    vi.mocked(second.paymentRecordRepo.markSettled).mockImplementation(consumeOnce);

    const results = await Promise.allSettled([
      first.service.settle({
        challengeReference: "challenge-item-1",
        settlementReference,
        paymentRoute: "x402",
      }),
      second.service.settle({
        challengeReference: "challenge-item-2",
        settlementReference,
        paymentRoute: "x402",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("does not report two concurrent submissions for one challenge as settled", async () => {
    const { service, paymentRecordRepo, verification, settledRow } = createMocks();
    let consumed = false;
    vi.mocked(paymentRecordRepo.markSettled).mockImplementation(async () => {
      if (consumed) {
        return {
          ok: false as const,
          error: {
            name: "ConflictError",
            code: "CONFLICT",
            message: "settlement already consumed",
            statusCode: 409,
          } as never,
        };
      }
      consumed = true;
      return { ok: true as const, value: settledRow };
    });

    const results = await Promise.allSettled([
      service.settle({
        challengeReference: challengeRecord.challenge_reference!,
        settlementReference: verification.settlementReference,
        paymentRoute: "x402",
      }),
      service.settle({
        challengeReference: challengeRecord.challenge_reference!,
        settlementReference: verification.settlementReference,
        paymentRoute: "x402",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(paymentRecordRepo.markSettled).toHaveBeenCalledTimes(2);
  });
});
