// Unit tests: Revenue Routing Service
// Tests autonomous revenue routing — creator recovery only (affiliates withdraw separately)

import type {
  ExecutionLogRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import type {
  ChronicleRegistryService,
  RegistryPublishResult,
} from "../services/chronicle-registry-service.ts";
import { createStaticRevenueFxService } from "../services/revenue-fx-service.ts";
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

describe("attributeReferralRewards (legacy helper)", () => {
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
        {
          status: "settled",
          amount_settled: 999,
          referral_address: null,
        },
        {
          status: "settled",
          amount_settled: 500,
          referral_address: "0x3333333333333333333333333333333333333333",
        },
      ],
      approvedReferralWallets: approved,
      referralPool: 1000,
    });

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
      findById: vi.fn().mockImplementation(async (id: string) => {
        const payout = payouts.find((p) => p.id === id);
        if (!payout) {
          return { ok: true as const, value: null };
        }
        return { ok: true as const, value: payout };
      }),
      findByPeriod: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
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
      listRecent: vi.fn(), listPage: vi.fn()
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
            explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "d".repeat(64),
          }) as RegistryPublishResult,
      ),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
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
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      sendTransfer: vi.fn().mockResolvedValue({
        txHash: "0x" + "c".repeat(64),
        keeperHubRunId: "exec_transfer",
        explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "c".repeat(64),
      }),
    };

    return {
      payoutRepo: mockPayoutRepo,
      treasuryRepo: mockTreasuryRepo,
      execLogRepo: mockExecLogRepo,
      registryService: mockRegistryService,
      web3Client: mockWeb3Client,
      payouts,
    };
  }

  const baseConfig = {
    creatorRecoveryWallet: CREATOR_WALLET,
    creatorRecoveryShare: 0.8,
    maxPayoutShare: 0.5,
    routingIntervalMs: 1, // allow immediate re-route in unit tests
  };

  const fxService = createStaticRevenueFxService(0.000001);

  it("should route revenue with real transfer and registry hashes when conditions are met", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        fxService,
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
        fxService,
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
        fxService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-failtx-${Date.now()}`);

    expect(result.routed).toBe(false);
    expect(result.errorMessage).toMatch(/On-chain (USDC )?transfer failed/i);
    expect(repos.payoutRepo.markTransferred).not.toHaveBeenCalled();
  });

  it("should reject invalid creator recovery wallet at construction", () => {
    const repos = createMockRepos();

    expect(() =>
      createRevenueRoutingService(
        {
          ...repos,
          treasuryService,
          fxService,
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
        fxService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-skip-${Date.now()}`);

    expect(result.routed).toBe(false);
    expect(result.payoutIds.length).toBe(0);
    expect(result.errorMessage).toBeDefined();
  });

  it("should cap creator recovery by CREATOR_RECOVERY_SHARE only", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        fxService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-calc-${Date.now()}`);

    // Snapshot costs: gen 5000 + tx 1000 = 6000
    // totalRevenue 25000 - costs 6000 = 19000 net
    // excess balance 40000 * maxPayoutShare 0.5 = 20000
    // distributable = min(20000, 19000) = 19000
    // Creator share 80% → 15200
    expect(result.routed).toBe(true);
    expect(result.creatorRecoveryAmount).toBe(15200);
    expect(result.referralRewardsAmount).toBe(0);
    expect(result.estimatedOperatingCosts).toBe(6000);
    expect(repos.payoutRepo.create).toHaveBeenCalledTimes(1);
    expect(repos.payoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: CREATOR_WALLET,
        amount: 15200,
      }),
    );
  });

  it("never auto-pays affiliates even when deprecated referral config is provided", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        fxService,
      },
      {
        ...baseConfig,
        referralRewardShare: 0.2,
        referralRewardCap: 1000,
      },
    );

    const result = await service.routeRevenue(`test-period-no-affiliate-payout-${Date.now()}`);

    // distributable 19000; creator 80% = 15200; affiliates not paid by routing
    expect(result.routed).toBe(true);
    expect(result.referralRewardsAmount).toBe(0);
    expect(result.creatorRecoveryAmount).toBe(15200);

    const createCalls = (repos.payoutRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { recipient: string; amount: number },
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual(
      expect.objectContaining({ recipient: CREATOR_WALLET, amount: 15200 }),
    );
    expect(createCalls.some((c) => c.recipient.toLowerCase() === AFFILIATE_A.toLowerCase())).toBe(
      false,
    );
  });

  it("routes only creator recovery (affiliates withdraw via agent)", async () => {
    const repos = createMockRepos();

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        fxService,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-creator-only-${Date.now()}`);

    expect(result.routed).toBe(true);
    expect(result.referralRewardsAmount).toBe(0);
    // costs 6000 → net 19000 → creator 80% = 15200
    expect(result.creatorRecoveryAmount).toBe(15200);
    expect(repos.payoutRepo.create).toHaveBeenCalledTimes(1);
    expect(repos.web3Client.sendTransfer).toHaveBeenCalledTimes(1);
    expect(repos.web3Client.sendTransfer).toHaveBeenCalledWith(
      CREATOR_WALLET,
      15200,
      "payout-payout-mock-1",
    );
  });

  it("sends USDC amounts 1:1 without ETH FX conversion", async () => {
    const repos = createMockRepos();
    // Even a broken FX service must not block routing (payouts are USDC).
    const brokenFx = {
      getEthPerCurrencyUnit: async () => {
        throw new Error("Chainlink ETH/USD unavailable");
      },
    };

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        fxService: brokenFx,
      },
      baseConfig,
    );

    const result = await service.routeRevenue(`test-period-usdc-${Date.now()}`);
    expect(result.routed).toBe(true);
    // costs 6000 → net 19000 → creator 80% = 15200 USDC (no FX)
    expect(repos.web3Client.sendTransfer).toHaveBeenCalledWith(
      CREATOR_WALLET,
      15200,
      "payout-payout-mock-1",
    );
  });

  it("should respect routingIntervalMs since last_routed_at", async () => {
    const repos = createMockRepos();
    (repos.treasuryRepo.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue({
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
        last_routed_at: new Date().toISOString(),
        last_payout_period_hash: "prior",
        total_routed_amount: 100,
        captured_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    });

    const service = createRevenueRoutingService(
      {
        ...repos,
        treasuryService,
        fxService,
      },
      { ...baseConfig, routingIntervalMs: 7 * 24 * 60 * 60 * 1000 },
    );

    const result = await service.routeRevenue(`test-period-interval-${Date.now()}`);
    expect(result.routed).toBe(false);
    expect(result.errorMessage).toMatch(/Routing interval/i);
  });
});
