// Unit tests: Revenue Routing Service
// Tests autonomous revenue routing, creator recovery, affiliate registry attribution, and registry payout logging

import type {
  AffiliateRepository,
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
import {
  attributeReferralRewards,
  createRevenueRoutingService,
  normalizeApprovedReferralWallets,
} from "../services/revenue-routing-service.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

const CREATOR_WALLET = "0x90F8bf6A479f320ced073E570619A864489a3000";
const AFFILIATE_A = "0x1111111111111111111111111111111111111111";
const AFFILIATE_B = "0x2222222222222222222222222222222222222222";
const PAYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("attributeReferralRewards", () => {
  it("attributes pro-rata pool only to allowlisted referral_address (never payer)", () => {
    const approved = normalizeApprovedReferralWallets([AFFILIATE_A, AFFILIATE_B]);
    const rewards = attributeReferralRewards({
      payments: [
        {
          status: "settled",
          amount_settled: 100,
          referral_address: AFFILIATE_A,
        },
        {
          status: "settled",
          amount_settled: 300,
          referral_address: AFFILIATE_B,
        },
        // Payer without referral — ignored
        {
          status: "settled",
          amount_settled: 999,
          referral_address: null,
        },
        // Non-allowlisted referral — ignored
        {
          status: "settled",
          amount_settled: 500,
          referral_address: "0x3333333333333333333333333333333333333333",
        },
      ],
      approvedReferralWallets: approved,
      referralPool: 1000,
    });

    // 100:300 volume → 250 : 750 of pool
    expect(rewards.get(AFFILIATE_A.toLowerCase())).toBe(250);
    expect(rewards.get(AFFILIATE_B.toLowerCase())).toBe(750);
    expect(rewards.has(PAYER)).toBe(false);
    expect(rewards.has("0x3333333333333333333333333333333333333333")).toBe(false);
  });

  it("returns empty map when allowlist or pool is empty", () => {
    expect(
      attributeReferralRewards({
        payments: [
          { status: "settled", amount_settled: 100, referral_address: AFFILIATE_A },
        ],
        approvedReferralWallets: new Set(),
        referralPool: 1000,
      }).size,
    ).toBe(0);

    expect(
      attributeReferralRewards({
        payments: [
          { status: "settled", amount_settled: 100, referral_address: AFFILIATE_A },
        ],
        approvedReferralWallets: normalizeApprovedReferralWallets([AFFILIATE_A]),
        referralPool: 0,
      }).size,
    ).toBe(0);
  });
});

describe("RevenueRoutingService", () => {
  const treasuryService = createTreasuryStatusService();

  function createMockRepos(options?: {
    settledWithReferral?: Array<Record<string, unknown>>;
    approvedWallets?: string[];
  }) {
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
      findById: vi.fn().mockImplementation(async (id: string) => {
        const payout = payouts.find((p) => p.id === id);
        if (!payout) {
          return { ok: true as const, value: null };
        }
        return { ok: true as const, value: payout };
      }),
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
      markFailed: vi.fn().mockImplementation(async (id: string) => {
        const payout = payouts.find((p) => p.id === id);
        if (payout) {
          payout.status = "failed";
        }
        return { ok: true as const, value: payout };
      }),
    };

    const settledWithReferral = options?.settledWithReferral ?? [];
    const approvedWallets = options?.approvedWallets ?? [];

    const mockPaymentRepo: PaymentRecordRepository = {
      createChallenge: vi.fn(),
      findById: vi.fn(),
      findByChallengeReference: vi.fn(),
      markSettled: vi.fn(),
      markUnderpaid: vi.fn(),
      markExpired: vi.fn(),
      markFailed: vi.fn(),
      expireOpenChallenges: vi.fn().mockResolvedValue({ ok: true as const, value: 0 }),
      listByPremiumItem: vi.fn(),
      list: vi.fn().mockResolvedValue({ ok: true as const, value: [] }),
      listSettledWithReferral: vi.fn().mockResolvedValue({
        ok: true as const,
        value: settledWithReferral,
      }),
      findSettledByPayer: vi.fn(),
    };

    const mockAffiliateRepo: AffiliateRepository = {
      findById: vi.fn(),
      findByWallet: vi.fn(),
      findByReferralCode: vi.fn(),
      findApprovedByWalletOrCode: vi.fn(),
      listApprovedWallets: vi.fn().mockResolvedValue({
        ok: true as const,
        value: approvedWallets.map((w) => w.toLowerCase()),
      }),
      listApproved: vi.fn(),
      register: vi.fn(),
      update: vi.fn(),
      setStatus: vi.fn(),
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
          last_routed_at: null,
          last_payout_period_hash: null,
          total_routed_amount: null,
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
      recordPayout: vi.fn().mockImplementation(
        async (
          _payoutPeriodHash: string,
          _recipient: string,
          _amount: number,
          _transferTxHash: string,
        ) =>
          ({
            success: true,
            txHash: "0x" + "d".repeat(64),
            keeperHubRunId: "exec_record_payout",
            explorerUrl: "https://sepolia.basescan.org/tx/0x" + "d".repeat(64),
          }) as RegistryPublishResult,
      ),
    };

    const mockWeb3Client: Web3Client = {
      getSignerAddress: vi.fn().mockResolvedValue("0xsigner"),
      getTreasuryAddress: vi.fn().mockResolvedValue("0xtreasury"),
      getTreasuryProvider: vi.fn().mockResolvedValue("keeperhub"),
      isKeeperHubBacked: vi.fn().mockReturnValue(true),
      isParaTreasuryBacked: vi.fn().mockReturnValue(false),
      publishAlert: vi.fn(),
      publishDigest: vi.fn(),
      createSponsoredWatch: vi.fn(),
      publishSponsoredReport: vi.fn(),
      publishPremiumReceipt: vi.fn(),
      recordPayout: vi.fn(),
      sendTransfer: vi.fn().mockResolvedValue({
        txHash: "0x" + "c".repeat(64),
        keeperHubRunId: "exec_transfer",
        explorerUrl: "https://sepolia.basescan.org/tx/0x" + "c".repeat(64),
      }),
    };

    return {
      payoutRepo: mockPayoutRepo,
      paymentRepo: mockPaymentRepo,
      affiliateRepo: mockAffiliateRepo,
      treasuryRepo: mockTreasuryRepo,
      execLogRepo: mockExecLogRepo,
      registryService: mockRegistryService,
      web3Client: mockWeb3Client,
      payouts,
    };
  }

  const baseConfig = {
    creatorRecoveryWallet: CREATOR_WALLET,
    referralRewardShare: 0.2,
    referralRewardCap: 1000,
    maxPayoutShare: 0.5,
    routingIntervalMs: 99999999,
    ethPerCurrencyUnit: 0.000001,
  };

  it("should route revenue with real transfer and registry hashes when conditions are met", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-${Date.now()}`);

    expect(result.routed).toBe(true);
    expect(result.payoutIds.length).toBeGreaterThan(0);
    expect(result.creatorRecoveryAmount).toBeGreaterThan(0);
    expect(result.totalRevenue).toBe(25000);
    expect(result.registryTxHash).toBe("0x" + "d".repeat(64));
    expect(repos.web3Client.sendTransfer).toHaveBeenCalled();
    expect(repos.registryService.recordPayout).toHaveBeenCalled();
    expect(repos.payoutRepo.markTransferred).toHaveBeenCalledWith(
      expect.any(String),
      "0x" + "c".repeat(64),
      "0x" + "d".repeat(64),
      expect.objectContaining({
        keeperHubRunId: "exec_record_payout",
        transferKeeperHubRunId: "exec_transfer",
      }),
    );
  });

  it("should fail without inventing hashes when web3 client is missing", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        web3Client: null,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-noweb3-${Date.now()}`);

    expect(result.routed).toBe(false);
    expect(result.payoutIds.length).toBe(0);
    expect(result.errorMessage).toContain("Web3 client not configured");
  });

  it("should fail when on-chain transfer fails (no simulated fallback)", async () => {
    const repos = createMockRepos();
    (repos.web3Client.sendTransfer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("insufficient funds"),
    );

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-failtx-${Date.now()}`);

    expect(result.routed).toBe(false);
    expect(result.errorMessage).toContain("On-chain transfer failed");
    expect(repos.payoutRepo.markTransferred).not.toHaveBeenCalled();
  });

  it("should reject invalid creator recovery wallet at construction", () => {
    const repos = createMockRepos();

    expect(() =>
      createRevenueRoutingService(
        {
          ...repos,
          treasuryService,
        },
        { ...baseConfig, creatorRecoveryWallet: "not-an-address" },
      ),
    ).toThrow("creatorRecoveryWallet");
  });

  it("should skip routing when conditions are not met", async () => {
    const repos = createMockRepos();

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
        last_routed_at: null,
        last_payout_period_hash: null,
        total_routed_amount: null,
        captured_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    });

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-skip-${Date.now()}`);

    expect(result.routed).toBe(false);
    expect(result.payoutIds.length).toBe(0);
    expect(result.errorMessage).toBeDefined();
  });

  it("should give full distributable to creator when no approved affiliates in registry", async () => {
    const repos = createMockRepos({ approvedWallets: [] });

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-calc-${Date.now()}`);

    // Available balance = 50000, safety buffer = 10000, excess = 40000
    // Max payout share = 50% = 20000
    // No affiliate registry → creator gets full distributable
    expect(result.routed).toBe(true);
    expect(result.creatorRecoveryAmount).toBe(20000);
    expect(result.referralRewardsAmount).toBe(0);
    expect(repos.payoutRepo.create).toHaveBeenCalledTimes(1);
    expect(repos.payoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: CREATOR_WALLET,
        amount: 20000,
      }),
    );
    expect(repos.affiliateRepo.listApprovedWallets).toHaveBeenCalled();
  });

  it("should pay registry-approved affiliates from referral_address, not the payer", async () => {
    const repos = createMockRepos({
      approvedWallets: [AFFILIATE_A],
      settledWithReferral: [
        {
          id: "pay-1",
          status: "settled",
          amount_settled: 5000,
          payer_reference: PAYER,
          referral_address: AFFILIATE_A.toLowerCase(),
        },
        {
          id: "pay-2",
          status: "settled",
          amount_settled: 5000,
          payer_reference: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          referral_address: AFFILIATE_A.toLowerCase(),
        },
      ],
    });

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      {
        ...baseConfig,
        referralRewardShare: 0.2,
        referralRewardCap: 1000,
      },
    );

    const result = await service.routeRevenue(`test-period-affiliate-${Date.now()}`);

    // distributable = 20000; pool = min(4000, 1000) = 1000
    expect(result.routed).toBe(true);
    expect(result.referralRewardsAmount).toBe(1000);
    expect(result.creatorRecoveryAmount).toBe(19000);

    const createCalls = (repos.payoutRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { recipient: string; amount: number },
    );
    expect(createCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipient: CREATOR_WALLET, amount: 19000 }),
        expect.objectContaining({
          recipient: AFFILIATE_A.toLowerCase(),
          amount: 1000,
        }),
      ]),
    );
    // Must never pay the payer as a "referral"
    expect(createCalls.some((c) => c.recipient.toLowerCase() === PAYER)).toBe(false);
  });

  it("should ignore settled payments whose referral is not in the affiliates registry", async () => {
    const repos = createMockRepos({
      approvedWallets: [AFFILIATE_A],
      settledWithReferral: [
        {
          id: "pay-rogue",
          status: "settled",
          amount_settled: 10_000,
          referral_address: "0x3333333333333333333333333333333333333333",
          payer_reference: PAYER,
        },
      ],
    });

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-noallow-${Date.now()}`);

    expect(result.routed).toBe(true);
    expect(result.referralRewardsAmount).toBe(0);
    expect(result.creatorRecoveryAmount).toBe(20000);
    expect(repos.payoutRepo.create).toHaveBeenCalledTimes(1);
  });
});
