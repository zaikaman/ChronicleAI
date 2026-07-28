// Unit tests: Agent Activity Service
// Tests aggregation across alerts, digests, payments, treasury, payout records, and logs

import type { AgentActivityData, AgentActivityRepository } from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import { createAgentActivityService } from "../services/agent-activity-service.ts";

describe("AgentActivityService", () => {
  function createMockActivityData(overrides?: Partial<AgentActivityData>): AgentActivityData {
    return {
      recentAlerts: [
        {
          id: "alert-001",
          monitored_event_id: "event-001",
          title: "Test Alert",
          summary: "Test summary",
          source_references: ["event-001"],
          audience: "public",
          destinations: null,
          delivery_status: "published",
          published_at: new Date().toISOString(),
          dedupe_key: "dedupe-001",
          confidence: "high",
          generation_provider: "gemini",
          generation_attempt_ids: [],
          registry_tx_hash: null,
          source_event_hash: null,
          content_uri: null,
          content_hash: null,
          gas_used: null,
          gas_used_wei: null,
          keeper_hub_run_id: null,
          explorer_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      recentDigests: [
        {
          id: "digest-001",
          report_date: new Date().toISOString().split("T")[0] ?? "2026-07-07",
          period_start: new Date(Date.now() - 86400000).toISOString(),
          period_end: new Date().toISOString(),
          title: "Test Digest",
          summary: "Test digest summary",
          highlights: ["Event 1", "Event 2"],
          analysis: "Test analysis",
          source_event_ids: ["event-001"],
          audience: "public",
          publication_status: "published",
          published_at: new Date().toISOString(),
          registry_tx_hash: "0xabc123",
          source_event_root: "0xroot",
          content_uri: null,
          content_hash: "0x" + "aa".repeat(32),
          gas_used: "85000",
          gas_used_wei: "85000000000",
          keeper_hub_run_id: "exec_digest_1",
          explorer_url: "https://sepolia.etherscan.io/tx/0xabc123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      recentPayments: [
        {
          id: "payment-001",
          premium_item_id: "item-001",
          payment_route: "x402",
          payer_reference: "0xpayer",
          referral_address: "0xaffiliate000000000000000000000000000001",
          amount_requested: 5,
          amount_settled: 5,
          currency: "USDC",
          status: "settled",
          challenge_reference: "challenge-001",
          settlement_reference: "settlement-001",
          requested_at: new Date().toISOString(),
          settled_at: new Date().toISOString(),
          expires_at: null,
          registry_tx_hash: null,
          keeper_hub_run_id: null,
          explorer_url: null,
          content_uri: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      paymentAnalytics: [
        {
          status: "settled",
          payment_route: "x402",
          amount_settled: 5,
          amount_requested: 5,
          currency: "USDC",
          referral_address: "0xaffiliate000000000000000000000000000001",
        },
        {
          status: "expired",
          payment_route: "mpp",
          amount_settled: null,
          amount_requested: 1,
          currency: "USDC",
          referral_address: null,
        },
      ],
      newsletterAnalytics: [
        {
          status: "active",
          amount_per_period: 10,
          currency: "USDC",
          billing_period_days: 30,
          referral_address: "0xaffiliate000000000000000000000000000001",
        },
      ],
      affiliates: [
        {
          id: "aff-001",
          wallet_address: "0xaffiliate000000000000000000000000000001",
          display_name: "Demo Affiliate",
          referral_code: "demo",
          status: "approved",
          metadata: {},
          approved_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
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
      recentPayouts: [
        {
          id: "payout-001",
          payout_period_hash: "period-001",
          recipient: "0xrecovery",
          amount: 5000,
          reason_hash: "reason-001",
          payout_tx_hash: "0xtxhash",
          registry_tx_hash: "0xregistry",
          keeper_hub_run_id: "exec_payout_1",
          explorer_url: "https://sepolia.etherscan.io/tx/0xregistry",
          transfer_keeper_hub_run_id: "exec_xfer_1",
          transfer_explorer_url: "https://sepolia.etherscan.io/tx/0xtxhash",
          status: "transferred",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      recentLogs: [
        {
          id: "log-001",
          action_type: "treasury_check",
          entity_type: "treasury_snapshot",
          entity_id: "treasury-001",
          status: "succeeded",
          message: "Treasury check completed",
          details: {},
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
      totalMonitoredEvents: 100,
      totalQualifiedEvents: 75,
      ...overrides,
    };
  }

  it("should return aggregated activity data", async () => {
    const mockActivityData = createMockActivityData();

    const mockRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: true as const,
        value: mockActivityData,
      }),
    };

    const service = createAgentActivityService(mockRepo);
    const result = await service.getActivity();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    if (result.data) {
      expect(result.data.alerts).toHaveLength(1);
      expect(result.data.alerts[0]?.title).toBe("Test Alert");

      expect(result.data.digests).toHaveLength(1);
      expect(result.data.digests[0]?.title).toBe("Test Digest");

      expect(result.data.payments).toHaveLength(1);
      expect(result.data.payments[0]?.paymentRoute).toBe("x402");
      expect(result.data.payments[0]?.referralAddress).toBe(
        "0xaffiliate000000000000000000000000000001",
      );

      expect(result.data.treasury.availableBalance).toBe(50000);
      expect(result.data.treasury.ethBalance).toBe(50000);
      expect(result.data.treasury.currency).toBe("USDC");
      expect(result.data.treasury.status).toBe("healthy");
      // No live USDC provider in unit tests — field omitted.
      expect(result.data.treasury.usdcBalance).toBeUndefined();

      expect(result.data.executionLogs).toHaveLength(1);
      expect(result.data.executionLogs[0]?.actionType).toBe("treasury_check");

      expect(result.data.subscriptionAnalytics).toMatchObject({
        mrr: 10,
        activeNewsletterSubscriptions: 1,
        settledPayments: 1,
        totalPaymentAttempts: 2,
        conversionRate: 0.5,
      });
      expect(result.data.referralAttribution?.partners).toHaveLength(1);
      expect(result.data.referralAttribution?.partners[0]?.displayName).toBe("Demo Affiliate");
    }
  });

  it("should handle empty data gracefully", async () => {
    const mockEmptyData = createMockActivityData({
      recentAlerts: [],
      recentDigests: [],
      recentPayments: [],
      treasurySnapshots: [],
      activeSponsoredWatches: [],
      recentPayouts: [],
      recentLogs: [],
      paymentAnalytics: [],
      newsletterAnalytics: [],
      affiliates: [],
    });

    const mockRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: true as const,
        value: mockEmptyData,
      }),
    };

    const service = createAgentActivityService(mockRepo);
    const result = await service.getActivity();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    if (result.data) {
      expect(result.data.alerts).toHaveLength(0);
      expect(result.data.digests).toHaveLength(0);
      expect(result.data.payments).toHaveLength(0);
      expect(result.data.executionLogs).toHaveLength(0);
      expect(result.data.treasury.availableBalance).toBe(0);
      expect(result.data.treasury.safetyBuffer).toBe(0);
      expect(result.data.treasury.currency).toBe("ETH");
    }
  });

  it("should return error when repository fails", async () => {
    const mockRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: false as const,
        error: new (await import("@chronicleai/db")).PersistenceError("Database error"),
      }),
    };

    const service = createAgentActivityService(mockRepo);
    const result = await service.getActivity();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to fetch activity data");
  });

  it("should include treasury status from latest snapshot", async () => {
    const mockActivityData = createMockActivityData({
      treasurySnapshots: [
        {
          id: "treasury-002",
          available_balance: 8000,
          currency: "USDC",
          safety_buffer: 10000,
          revenue_total: 12000,
          estimated_generation_cost: 6000,
          estimated_transaction_cost: 2000,
          paid_request_count: 80,
          status: "warning",
          last_routed_at: null,
          last_payout_period_hash: null,
          total_routed_amount: null,
          captured_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
    });

    const mockRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: true as const,
        value: mockActivityData,
      }),
    };

    const service = createAgentActivityService(mockRepo);
    const result = await service.getActivity();

    expect(result.success).toBe(true);
    expect(result.data?.treasury.status).toBe("warning");
    expect(result.data?.treasury.safetyBuffer).toBe(10000);
    expect(result.data?.treasury.currency).toBe("USDC");
  });

  it("should merge live ETH + USDC balances when provider succeeds", async () => {
    const mockActivityData = createMockActivityData({
      treasurySnapshots: [
        {
          id: "treasury-live",
          available_balance: 0.01,
          currency: "ETH",
          safety_buffer: 0.01,
          revenue_total: null,
          estimated_generation_cost: null,
          estimated_transaction_cost: null,
          paid_request_count: null,
          status: "healthy",
          last_routed_at: null,
          last_payout_period_hash: null,
          total_routed_amount: null,
          captured_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
    });

    const mockRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: true as const,
        value: mockActivityData,
      }),
    };

    const service = createAgentActivityService(mockRepo, {
      getLiveTreasuryBalances: async () => ({
        ethBalance: 0.025,
        usdcBalance: 2,
        walletAddress: "0xf7aede9453bfb56edbf14b2d05543676d3fcaf11",
        ethSource: "rpc" as const,
        usdcSource: "rpc" as const,
      }),
    });
    const result = await service.getActivity();

    expect(result.success).toBe(true);
    expect(result.data?.treasury.availableBalance).toBe(0.025);
    expect(result.data?.treasury.ethBalance).toBe(0.025);
    expect(result.data?.treasury.usdcBalance).toBe(2);
    expect(result.data?.treasury.currency).toBe("ETH");
    expect(result.data?.treasury.walletAddress).toBe(
      "0xf7aede9453bfb56edbf14b2d05543676d3fcaf11",
    );
    expect(result.data?.treasury.safetyBuffer).toBe(0.01);
  });

  it("should merge dual-rail Base/Sepolia USDC and CCTP rebalances", async () => {
    const mockActivityData = createMockActivityData();
    const mockRepo: AgentActivityRepository = {
      getActivityData: vi.fn().mockResolvedValue({
        ok: true as const,
        value: mockActivityData,
      }),
    };

    const service = createAgentActivityService(mockRepo, {
      getDualRailTreasury: async () => ({
        walletAddress: "0xf7aede9453bfb56edbf14b2d05543676d3fcaf11",
        baseUsdc: 40,
        sepoliaUsdc: 8,
        baseEth: 0.02,
        sepoliaEth: 0.03,
        inFlightCctpUsdc: 10,
        deployableToDeskUsdc: 0,
        usdcOperatingReserve: 10,
        cctpEnabled: true,
        capitalPlaneNote: "awaiting CCTP rebalance",
        recentTransfers: [
          {
            id: "cctp-1",
            status: "awaiting_attestation",
            amountUsdc: 10,
            mode: "direct",
            burnTxHash: "0x" + "a".repeat(64),
            mintTxHash: null,
            burnExplorerUrl: "https://sepolia.basescan.org/tx/0xaa",
            mintExplorerUrl: null,
            errorMessage: null,
            burnedAt: new Date().toISOString(),
            mintedAt: null,
            createdAt: new Date().toISOString(),
            durationMs: null,
          },
        ],
      }),
    });

    const result = await service.getActivity();
    expect(result.success).toBe(true);
    expect(result.data?.treasury.baseUsdcBalance).toBe(40);
    expect(result.data?.treasury.sepoliaUsdcBalance).toBe(8);
    expect(result.data?.treasury.usdcBalance).toBe(8);
    expect(result.data?.treasury.inFlightCctpUsdc).toBe(10);
    expect(result.data?.treasury.capitalPlaneNote).toContain("CCTP");
    expect(result.data?.cctpRebalances).toHaveLength(1);
    expect(result.data?.cctpRebalances?.[0]?.status).toBe("awaiting_attestation");
  });
});
