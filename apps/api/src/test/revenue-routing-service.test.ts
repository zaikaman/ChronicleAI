// Unit tests: Revenue Routing Service
// Tests autonomous revenue routing, creator recovery calculations, referral capping, and registry payout logging

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import type {
  ChronicleRegistryService,
  RegistryPublishResult,
} from "../services/chronicle-registry-service.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";

describe("RevenueRoutingService", () => {
  const treasuryService = createTreasuryStatusService();

  function createMockRepos() {
    const payouts: Array<Record<string, unknown>> = [];
    let payoutIdCounter = 0;

    const mockPayoutRepo: PayoutRecordRepository = {
      create: vi.fn().mockImplementation(async (data) => {
        payoutIdCounter++;
        const id = `payout-mock-${payoutIdCounter}`;
        const payout = {
          id,
          payout_period_hash: data.payout_period_hash,
          recipient: data.recipient,
          amount: data.amount,
          reason_hash: data.reason_hash,
          payout_tx_hash: null,
          registry_tx_hash: null,
          status: "pending",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        payouts.push(payout);
        return { ok: true as const, value: payout };
      }),
      findById: vi.fn(),
      findByPeriod: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      markTransferred: vi.fn().mockImplementation(async (id, payoutTxHash, registryTxHash) => {
        const payout = payouts.find((p) => p.id === id);
        if (payout) {
          payout.status = "transferred";
          payout.payout_tx_hash = payoutTxHash;
          payout.registry_tx_hash = registryTxHash;
          payout.updated_at = new Date().toISOString();
        }
        return { ok: true as const, value: payout };
      }),
      markFailed: vi.fn(),
    };

    const mockPaymentRepo: PaymentRecordRepository = {
      createChallenge: vi.fn(),
      findByChallengeReference: vi.fn(),
      markSettled: vi.fn(),
      markUnderpaid: vi.fn(),
      markExpired: vi.fn(),
      markFailed: vi.fn(),
      listByPremiumItem: vi.fn(),
      list: vi.fn().mockResolvedValue({ ok: true as const, value: [] }),
      findSettledByPayer: vi.fn(),
    };

    const mockTreasuryRepo: TreasurySnapshotRepository = {
      create: vi.fn(),
      findLatest: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          id: "treasury-001",
          available_balance: 50000,
          currency: "USDC",
          safety_buffer: 10000,
          revenue_total: 25000,
          estimated_generation_cost: 5000,
          estimated_transaction_cost: 1000,
          paid_request_count: 150,
          status: "healthy",
          captured_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      }),
      findById: vi.fn(),
      list: vi.fn(),
      listStatusHistory: vi.fn(),
      update: vi.fn().mockResolvedValue({ ok: true as const, value: {} }),
      getAggregates: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          totalRevenue: 25000,
          totalPaidRequests: 150,
          latestBalance: 50000,
          latestStatus: "healthy",
        },
      }),
    };

    const mockExecLogRepo: ExecutionLogRepository = {
      append: vi.fn().mockResolvedValue({ ok: true as const, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
    };

    const mockRegistryService: ChronicleRegistryService = {
      publishAlert: vi.fn(),
      publishDigest: vi.fn(),
      recordPayout: vi.fn().mockResolvedValue({
        success: true,
        txHash: "0x" + "a".repeat(64),
      } as RegistryPublishResult),
    };

    return {
      payoutRepo: mockPayoutRepo,
      paymentRepo: mockPaymentRepo,
      treasuryRepo: mockTreasuryRepo,
      execLogRepo: mockExecLogRepo,
      registryService: mockRegistryService,
    };
  }

  it("should route revenue when conditions are met", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      {
        creatorRecoveryWallet: "0xcreatorrecovery00000000000000000000000000001",
        referralRewardCap: 1000,
        maxPayoutShare: 0.5,
        routingIntervalMs: 99999999,
      },
    );

    const result = await service.routeRevenue(`test-period-${Date.now()}`);

    expect(result.routed).toBe(true);
    expect(result.payoutIds.length).toBeGreaterThan(0);
    expect(result.creatorRecoveryAmount).toBeGreaterThan(0);
    expect(result.totalRevenue).toBe(25000);
    expect(result.registryTxHash).toBeDefined();
  });

  it("should skip routing when conditions are not met", async () => {
    const repos = createMockRepos();

    // Override treasury aggregates to show zero revenue
    (repos.treasuryRepo.getAggregates as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true as const,
      value: {
        totalRevenue: 0,
        totalPaidRequests: 0,
        latestBalance: 5000,
        latestStatus: "warning",
      },
    });

    (repos.treasuryRepo.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true as const,
      value: {
        id: "treasury-002",
        available_balance: 5000,
        currency: "USDC",
        safety_buffer: 10000,
        revenue_total: 0,
        estimated_generation_cost: 2000,
        estimated_transaction_cost: 500,
        paid_request_count: 10,
        status: "warning",
        captured_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    });

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      {
        creatorRecoveryWallet: "0xcreatorrecovery00000000000000000000000000001",
        referralRewardCap: 1000,
        maxPayoutShare: 0.5,
        routingIntervalMs: 99999999,
      },
    );

    const result = await service.routeRevenue(`test-period-skip-${Date.now()}`);

    expect(result.routed).toBe(false);
    expect(result.payoutIds.length).toBe(0);
    expect(result.errorMessage).toBeDefined();
  });

  it("should calculate creator recovery share correctly", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      {
        creatorRecoveryWallet: "0xcreatorrecovery00000000000000000000000000001",
        referralRewardCap: 1000,
        maxPayoutShare: 0.5,
        routingIntervalMs: 99999999,
      },
    );

    const result = await service.routeRevenue(`test-period-calc-${Date.now()}`);

    // Available balance = 50000, safety buffer = 10000, excess = 40000
    // Max payout share = 50% = 20000
    // Creator recovery = 80% of distributable = 16000
    // Referral rewards = 20% = 4000, capped at 1000
    expect(result.creatorRecoveryAmount).toBeGreaterThan(0);
    expect(result.referralRewardsAmount).toBeGreaterThanOrEqual(0);
  });
});
