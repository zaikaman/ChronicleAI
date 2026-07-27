// Integration tests: Operator Audit
// Tests treasury check webhook, operator audit data, and revenue routing

import { describe, expect, it, vi } from "vitest";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";
import { createOperatorNotificationService } from "../services/operator-notification-service.ts";
import { createOperatorAuditService } from "../services/operator-audit-service.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
import type {
  ExecutionLogRepository,
  OperatorAuditRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import type { ChronicleRegistryService, RegistryPublishResult } from "../services/chronicle-registry-service.ts";

describe("Operator Audit Integration", () => {
  const treasuryService = createTreasuryStatusService();

  it("should process treasury check and evaluate status correctly", async () => {
    const execLogRepo: ExecutionLogRepository = {
      append: vi.fn().mockResolvedValue({ ok: true as const, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
    };

    const treasuryRepo: TreasurySnapshotRepository = {
      create: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          id: "treasury-test-001",
          available_balance: 50000,
          currency: "USDC",
          safety_buffer: 10000,
          revenue_total: null,
          estimated_generation_cost: null,
          estimated_transaction_cost: null,
          paid_request_count: null,
          status: "healthy",
          captured_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      }),
      findLatest: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          id: "treasury-prev-001",
          available_balance: 45000,
          currency: "USDC",
          safety_buffer: 10000,
          revenue_total: 22000,
          estimated_generation_cost: 4000,
          estimated_transaction_cost: 800,
          paid_request_count: 120,
          status: "healthy",
          captured_at: new Date(Date.now() - 3600000).toISOString(),
          created_at: new Date(Date.now() - 3600000).toISOString(),
        },
      }),
      findById: vi.fn(),
      list: vi.fn(),
      listStatusHistory: vi.fn(),
      update: vi.fn(),
      getAggregates: vi.fn(),
    };

    // Simulate treasury check logic
    const evaluation = treasuryService.evaluate({
      availableBalance: 50000,
      safetyBuffer: 10000,
      previousStatus: "healthy",
    });

    expect(evaluation.status).toBe("healthy");
    expect(evaluation.changed).toBe(false);

    // Send notification
    const notificationService = createOperatorNotificationService(execLogRepo);
    const notificationResult = await notificationService.sendLowBalanceWarning({
      availableBalance: 50000,
      safetyBuffer: 10000,
      deficitPercentage: 0,
      status: evaluation.status,
    });

    // Should still deliver notification (log-based)
    expect(notificationResult.delivered).toBe(true);

    // Verify log was created
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

    // Should suspend registry writes
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

  it("should aggregate operator audit data from repositories", async () => {
    const mockAuditRepo: OperatorAuditRepository = {
      getAuditData: vi.fn().mockResolvedValue({
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

    const auditService = createOperatorAuditService(mockAuditRepo);
    const result = await auditService.getAudit();

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
      findByChallengeReference: vi.fn(),
      markSettled: vi.fn(),
      markUnderpaid: vi.fn(),
      markExpired: vi.fn(),
      markFailed: vi.fn(),
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
      recordPayout: vi.fn().mockResolvedValue({
        success: true,
        txHash: "0x" + "a".repeat(64),
      } as RegistryPublishResult),
    };

    const routingService = createRevenueRoutingService(
      {
        treasuryRepo,
        paymentRepo,
        payoutRepo,
        execLogRepo,
        treasuryService,
        registryService: mockRegistryService,
      },
      {
        creatorRecoveryWallet: "0xrecovery-wallet",
        referralRewardCap: 1000,
        maxPayoutShare: 0.5,
        routingIntervalMs: 99999999,
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
