// Integration tests: Public Agent Activity
// Tests treasury check webhook, activity data, and revenue routing

import type {
  AgentActivityRepository,
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
import { createAgentActivityService } from "../services/agent-activity-service.ts";
import { createNotificationService } from "../services/notification-service.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";

describe("Agent Activity Integration", () => {
  const treasuryService = createTreasuryStatusService();

  it("should process treasury check and evaluate status correctly", async () => {
    const execLogRepo: ExecutionLogRepository = {
      append: vi.fn().mockResolvedValue({ ok: true as const, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
    };

    const evaluation = treasuryService.evaluate({
      availableBalance: 50000,
      safetyBuffer: 10000,
      previousStatus: "healthy",
    });

    expect(evaluation.status).toBe("healthy");
    expect(evaluation.changed).toBe(false);

    const notificationService = createNotificationService(execLogRepo);
    const notificationResult = await notificationService.sendLowBalanceWarning({
      availableBalance: 50000,
      safetyBuffer: 10000,
      deficitPercentage: 0,
      status: evaluation.status,
    });

    expect(notificationResult.delivered).toBe(true);
    expect(execLogRepo.append).toHaveBeenCalled();
  });

  it("should detect low-balance warning state", async () => {
    const evaluation = treasuryService.evaluate({
      availableBalance: 7000,
      safetyBuffer: 10000,
      previousStatus: "healthy",
    });

    expect(evaluation.status).toBe("warning");
    expect(evaluation.changed).toBe(true);
    expect(evaluation.deficitPercentage).toBeDefined();
    expect(evaluation.deficitPercentage).toBeGreaterThan(0);

    const shouldSuspend = treasuryService.shouldSuspendRegistryWrites(7000, 10000);
    expect(shouldSuspend).toBe(true);
  });

  it("should detect critical low-balance state", async () => {
    const evaluation = treasuryService.evaluate({
      availableBalance: 2000,
      safetyBuffer: 10000,
      previousStatus: "warning",
    });

    expect(evaluation.status).toBe("critical");
    expect(evaluation.changed).toBe(true);
    expect(evaluation.deficitPercentage).toBe(80);
  });

  it("should aggregate public activity data from repositories", async () => {
    const mockActivityRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          recentAlerts: [],
          recentDigests: [],
          recentPayments: [],
          treasurySnapshots: [
            {
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
          ],
          activeSponsoredWatches: [],
          recentPayouts: [],
          recentLogs: [],
          totalMonitoredEvents: 100,
          totalQualifiedEvents: 75,
        },
      }),
    };

    const activityService = createAgentActivityService(mockActivityRepo);
    const result = await activityService.getActivity();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.alerts).toEqual([]);
    expect(result.data?.treasury.status).toBe("healthy");
    expect(result.data?.treasury.availableBalance).toBe(50000);
  });

  it("should handle revenue routing end-to-end with mock services", async () => {
    const payoutRepo: PayoutRecordRepository = {
      create: vi.fn().mockImplementation(async (data) => {
        const payout = {
          id: `payout-${Date.now()}`,
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return { ok: true as const, value: payout };
      }),
      findById: vi.fn(),
      findByPeriod: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      markTransferred: vi.fn().mockImplementation(async (id, payoutTxHash, registryTxHash) => ({
        ok: true as const,
        value: {
          id,
          payout_tx_hash: payoutTxHash,
          registry_tx_hash: registryTxHash,
          status: "transferred",
          updated_at: new Date().toISOString(),
        },
      })),
      markFailed: vi.fn(),
    };

    const paymentRepo: PaymentRecordRepository = {
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
      findSettledByPayer: vi.fn(),
    };

    const treasuryRepo: TreasurySnapshotRepository = {
      create: vi.fn(),
      findLatest: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          id: "treasury-routing-001",
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

    const execLogRepo: ExecutionLogRepository = {
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
            txHash: "0x" + "a".repeat(64),
          }) as RegistryPublishResult,
      ),
    };

    const mockWeb3Client = {
      getSignerAddress: vi.fn().mockResolvedValue("0xsigner"),
      getTreasuryAddress: vi.fn().mockResolvedValue("0xtreasury"),
      getTreasuryProvider: vi.fn().mockResolvedValue("keeperhub"),
      isKeeperHubBacked: vi.fn().mockReturnValue(true),
      isParaTreasuryBacked: vi.fn().mockReturnValue(false),
      publishAlert: vi.fn(),
      publishDigest: vi.fn(),
      createSponsoredWatch: vi.fn(),
      publishSponsoredReport: vi.fn(),
      recordPayout: vi.fn(),
      sendTransfer: vi.fn().mockResolvedValue({
        txHash: "0x" + "c".repeat(64),
        keeperHubRunId: "exec_transfer",
        explorerUrl: "https://sepolia.basescan.org/tx/0x" + "c".repeat(64),
      }),
    };

    (payoutRepo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
      ok: true as const,
      value: {
        id,
        payout_period_hash: "period",
        recipient: "0x90F8bf6A479f320ced073E570619A864489a3000",
        amount: 1000,
        reason_hash: "reason",
        payout_tx_hash: null,
        registry_tx_hash: null,
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));

    const routingService = createRevenueRoutingService(
      {
        treasuryRepo,
        paymentRepo,
        payoutRepo,
        execLogRepo,
        treasuryService,
        registryService: mockRegistryService,
        web3Client: mockWeb3Client as never,
      },
      {
        creatorRecoveryWallet: "0x90F8bf6A479f320ced073E570619A864489a3000",
        referralRewardCap: 1000,
        maxPayoutShare: 0.5,
        routingIntervalMs: 99999999,
        ethPerCurrencyUnit: 0.000001,
      },
    );

    const routingResult = await routingService.routeRevenue(`integration-period-${Date.now()}`);

    expect(routingResult.routed).toBe(true);
    expect(routingResult.payoutIds.length).toBeGreaterThan(0);
    expect(routingResult.creatorRecoveryAmount).toBeGreaterThan(0);
    expect(routingResult.totalRevenue).toBe(25000);
    expect(routingResult.registryTxHash).toBeDefined();
  });
});
