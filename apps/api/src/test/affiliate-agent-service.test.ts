import { describe, expect, it, vi } from "vitest";
import {
  type AffiliateAgentLlm,
  affiliateWithdrawalAmountSchema,
  createAffiliateAgentService,
} from "../services/affiliate-agent-service.ts";
import type { AffiliateDashboardStats } from "../services/affiliate-dashboard-service.ts";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

function baseStats(overrides?: Partial<AffiliateDashboardStats>): AffiliateDashboardStats {
  return {
    affiliate: {
      walletAddress: WALLET,
      displayName: "Demo",
      referralCode: "DEMOREF",
      status: "approved",
      referralLinkPath: "/?ref=DEMOREF",
    },
    referredCount: 3,
    totalEarnedUsdc: 10,
    totalWithdrawnUsdc: 2,
    reservedUsdc: 0,
    availableUsdc: 8,
    currency: "USDC",
    recentReferrals: [],
    recentEarnings: [],
    recentWithdrawals: [],
    ...overrides,
  };
}

describe("createAffiliateAgentService", () => {
  it("accepts numeric strings emitted by LLM tool callers", () => {
    expect(affiliateWithdrawalAmountSchema.parse("2.5")).toBe("2.5");
    expect(affiliateWithdrawalAmountSchema.parse("all")).toBe("all");
  });

  describe("deterministic fallback (no LLM)", () => {
    it("returns help text for help queries", async () => {
      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats: vi.fn(),
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw: vi.fn() },
        llm: null,
      });

      const result = await agent.chat({
        affiliateWallet: WALLET,
        message: "help",
      });

      expect(result.mode).toBe("fallback");
      expect(result.toolCalls[0]?.name).toBe("help");
      expect(result.reply.toLowerCase()).toContain("withdraw");
    });

    it("calls get_affiliate_stats for stats questions", async () => {
      const stats = baseStats();
      const getStats = vi.fn().mockResolvedValue(stats);
      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats,
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw: vi.fn() },
        llm: null,
      });

      const result = await agent.chat({
        affiliateWallet: WALLET,
        message: "Show my stats",
      });

      expect(getStats).toHaveBeenCalledWith(WALLET);
      expect(result.toolCalls.some((t) => t.name === "get_affiliate_stats")).toBe(true);
      expect(result.reply).toContain("People referred");
      expect(result.reply).toContain("3");
    });

    it("withdraws available balance on withdraw all", async () => {
      const stats = baseStats({ availableUsdc: 5.5 });
      const withdraw = vi.fn().mockResolvedValue({
        ok: true,
        txHash: "0xabc",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xabc",
        keeperHubRunId: "run-1",
      });
      const getStats = vi
        .fn()
        .mockResolvedValueOnce(stats)
        .mockResolvedValueOnce({ ...stats, availableUsdc: 0, totalWithdrawnUsdc: 7.5 });

      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats,
          getAvailableBalanceUsdc: vi.fn().mockResolvedValue(5.5),
        },
        withdrawalService: { withdraw },
        llm: null,
      });

      const result = await agent.chat({
        affiliateWallet: WALLET,
        message: "withdraw all",
      });

      expect(withdraw).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliateWallet: WALLET,
          amountUsdc: 5.5,
        }),
      );
      expect(result.reply.toLowerCase()).toContain("keeperhub");
      expect(result.toolCalls[0]?.name).toBe("withdraw_usdc");
    });

    it("parses a specific USDC amount", async () => {
      const stats = baseStats({ availableUsdc: 20 });
      const withdraw = vi.fn().mockResolvedValue({ ok: true, txHash: "0x1" });
      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats: vi.fn().mockResolvedValue(stats),
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw },
        llm: null,
      });

      await agent.chat({
        affiliateWallet: WALLET,
        message: "Please withdraw 2.5 USDC",
      });

      expect(withdraw).toHaveBeenCalledWith(
        expect.objectContaining({ amountUsdc: 2.5 }),
      );
    });

    it("uses the signed amount for a full-balance withdrawal", async () => {
      const stats = baseStats({ availableUsdc: 8 });
      const withdrawalAuthorization = {
        wallet: WALLET,
        amount: "5500000",
        nonce: `0x${"33".repeat(32)}`,
        expiry: Math.floor(Date.now() / 1000) + 300,
        action: "withdraw_usdc",
        signature: `0x${"44".repeat(65)}`,
      };
      const withdraw = vi.fn().mockResolvedValue({ ok: true, txHash: "0x1" });
      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats: vi.fn().mockResolvedValue(stats),
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw },
        llm: null,
      });

      await agent.chat({
        affiliateWallet: WALLET,
        message: "withdraw all",
        withdrawalAuthorization,
      });

      expect(withdraw).toHaveBeenCalledWith(
        expect.objectContaining({
          amountUsdc: 5.5,
          authorization: withdrawalAuthorization,
        }),
      );
    });
  });

  describe("LLM tool-calling loop", () => {
    it("executes tools requested by the LLM then returns the model reply", async () => {
      const stats = baseStats({ availableUsdc: 4 });
      const getStats = vi.fn().mockResolvedValue(stats);
      const withdraw = vi.fn().mockResolvedValue({
        ok: true,
        txHash: "0xdeadbeef",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xdeadbeef",
        keeperHubRunId: "kh-99",
      });

      let round = 0;
      const llm: AffiliateAgentLlm = {
        async complete() {
          round += 1;
          if (round === 1) {
            return {
              kind: "tool_calls",
              provider: "openai",
              calls: [
                {
                  id: "call_1",
                  name: "get_available_balance",
                  arguments: {},
                },
              ],
            };
          }
          if (round === 2) {
            return {
              kind: "tool_calls",
              provider: "openai",
              calls: [
                {
                  id: "call_2",
                  name: "withdraw_usdc",
                  arguments: { amount: "all" },
                },
              ],
            };
          }
          return {
            kind: "message",
            provider: "openai",
            content:
              "I sent your full available balance on-chain via KeeperHub. Tx 0xdeadbeef.",
          };
        },
      };

      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats,
          getAvailableBalanceUsdc: vi.fn().mockResolvedValue(4),
        },
        withdrawalService: { withdraw },
        llm,
      });

      const result = await agent.chat({
        affiliateWallet: WALLET,
        message: "if I've earned anything, cash me out please",
      });

      expect(result.mode).toBe("llm");
      expect(result.provider).toBe("openai");
      expect(result.toolCalls.map((t) => t.name)).toEqual([
        "get_available_balance",
        "withdraw_usdc",
      ]);
      expect(withdraw).toHaveBeenCalledWith(
        expect.objectContaining({ amountUsdc: 4 }),
      );
      expect(result.reply).toContain("0xdeadbeef");
    });

    it("falls back to deterministic tools when the LLM throws", async () => {
      const stats = baseStats();
      const getStats = vi.fn().mockResolvedValue(stats);
      const llm: AffiliateAgentLlm = {
        async complete() {
          throw new Error("provider down");
        },
      };

      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats,
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw: vi.fn() },
        llm,
      });

      const result = await agent.chat({
        affiliateWallet: WALLET,
        message: "show my stats",
      });

      expect(result.mode).toBe("fallback");
      expect(getStats).toHaveBeenCalled();
      expect(result.reply.toLowerCase()).toContain("provider down");
    });
  });

  describe("background job execution", () => {
    it("starts job in pending/processing state and settles to completed", async () => {
      const stats = baseStats();
      const getStats = vi.fn().mockResolvedValue(stats);
      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats,
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw: vi.fn() },
        llm: null,
      });

      const job = agent.startChatJob({
        affiliateWallet: WALLET,
        message: "show my stats",
      });

      expect(job.id).toBeDefined();
      expect(job.status).toMatch(/pending|processing/);

      // Wait briefly for background execution to complete
      await new Promise((r) => setTimeout(r, 50));

      const updated = await agent.getChatJob(job.id, WALLET);
      expect(updated?.status).toBe("completed");
      expect(updated?.result?.reply).toContain("People referred");
      expect(await agent.getChatJob(job.id, OTHER_WALLET)).toBeNull();
    });

    it("creates wallet-bound, non-predictable job ids", () => {
      const agent = createAffiliateAgentService({
        dashboardService: {
          getStats: vi.fn(),
          getAvailableBalanceUsdc: vi.fn(),
        },
        withdrawalService: { withdraw: vi.fn() },
        llm: null,
      });

      const first = agent.startChatJob({ affiliateWallet: WALLET, message: "help" });
      const second = agent.startChatJob({ affiliateWallet: WALLET, message: "help" });

      expect(first.id).toMatch(new RegExp(`^job_${WALLET}_[0-9a-f-]{36}$`));
      expect(second.id).toMatch(new RegExp(`^job_${WALLET}_[0-9a-f-]{36}$`));
      expect(first.id).not.toBe(second.id);
    });
  });
});
