import { describe, expect, it, vi } from "vitest";
import {
  applyForceDefendOverride,
  applyForceMaintenanceOverride,
  applyMinConfidence,
  combineNotional,
  mapProposalToDecision,
} from "../desk/agent/map-proposal.ts";
import { holdProposal, parseProposal } from "../desk/agent/proposal-schema.ts";
import {
  DESK_AGENT_PROMPT_INVARIANTS,
  DESK_AGENT_SYSTEM_PROMPT,
} from "../desk/agent/prompt.ts";
import { createDeskTradingAgent } from "../desk/agent/desk-trading-agent.ts";
import { createFailureClassifier } from "../desk/agent/failure-classifier.ts";
import { createSignalFusionJudge } from "../desk/agent/signal-fusion.ts";
import type { DeskAgentContext } from "../desk/agent/types.ts";
import type { DeskAgentProposal } from "@chronicleai/schemas";
import type { LLMProviderMap } from "../services/llm-provider-client.ts";

const baseContext = (): DeskAgentContext => ({
  chainId: 11155111,
  deskWalletAddress: "0xdesk",
  mark: {
    asOf: "2026-07-28T00:00:00.000Z",
    equityUsdc: 40,
    freeUsdc: 20,
    freeWeth: 0,
    freeLink: 0,
    healthFactor: 2.5,
    totalCollateralUsd: 0,
    totalDebtUsd: 0,
    ethUsd: 3000,
    linkUsd: 15,
  },
  policy: {
    maxTradeUsdc: 15,
    minAumUsdc: 20,
    targetAumUsdc: 50,
    maxAumUsdc: 80,
    hfWarn: 1.5,
    hfCritical: 1.2,
    basisBps: 50,
    apyDeltaBps: 50,
    paused: false,
    killSwitchArmed: false,
    gasRegime: "normal",
    forceDefendOnCriticalHf: true,
    minConfidence: 0.35,
  },
  signals: [
    {
      id: "sig-1",
      signalType: "apy_delta",
      severity: 60,
      policyVerdict: "trade",
      features: { apyDeltaBps: 80, consecutiveEdgePolls: 2 },
      createdAt: "2026-07-28T00:00:00.000Z",
    },
  ],
  intents: [],
  openByStrategy: {},
  lastFailedByStrategy: {},
  capitalMoves: [],
  lastCapitalSummary: null,
  gasRegime: "normal",
  gasGwei: 12,
});

const providers: LLMProviderMap = {
  gemini: { apiKey: "g", model: "gemini-test" },
  openai: { apiKey: "o", model: "o" },
  groq: { apiKey: "q", model: "q" },
};

describe("proposal-schema", () => {
  it("parses a valid propose proposal", () => {
    const raw = JSON.stringify({
      version: 1,
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: 10,
      priority: 0.7,
      confidence: 0.8,
      thesis: "APY delta 80 bps with freeUsdc=20 exceeds band; rotate into LINK Aave.",
      riskNotes: ["sepolia_liquidity"],
      legsHint: ["usdc_to_link", "aave_supply_link"],
      declineReasons: [],
    });
    const result = parseProposal(raw, { maxTradeUsdc: 15 });
    expect(result.ok).toBe(true);
    expect(result.proposal.action).toBe("propose");
    expect(result.proposal.strategy).toBe("yield_rotation");
    expect(result.proposal.notionalUsdc).toBe(10);
  });

  it("clamps oversize notional to max trade", () => {
    const raw = {
      version: 1,
      action: "propose",
      strategy: "oracle_amm",
      notionalUsdc: 999,
      priority: 0.5,
      confidence: 0.9,
      thesis: "basisBps=120 freeUsdc=30",
      riskNotes: [],
      legsHint: ["usdc_to_weth"],
      declineReasons: [],
    };
    const result = parseProposal(raw, { maxTradeUsdc: 15 });
    expect(result.ok).toBe(true);
    expect(result.proposal.notionalUsdc).toBe(15);
  });

  it("rejects free text and returns hold", () => {
    const result = parseProposal("I think we should buy everything");
    expect(result.ok).toBe(false);
    expect(result.proposal.action).toBe("hold");
    expect(result.proposal.notionalUsdc).toBe(0);
  });

  it("forces hold/defer to null strategy and zero notional", () => {
    const result = parseProposal({
      version: 1,
      action: "hold",
      strategy: "yield_rotation",
      notionalUsdc: 12,
      priority: 0,
      confidence: 0.2,
      thesis: "No edge",
      riskNotes: [],
      legsHint: ["usdc_to_link"],
      declineReasons: [],
    });
    expect(result.ok).toBe(true);
    expect(result.proposal.strategy).toBeNull();
    expect(result.proposal.notionalUsdc).toBe(0);
  });

  it("forces defend strategy", () => {
    const result = parseProposal({
      version: 1,
      action: "defend",
      strategy: null,
      notionalUsdc: 5,
      priority: 1,
      confidence: 0.9,
      thesis: "hf=1.1 freeUsdc=8",
      riskNotes: [],
      legsHint: ["repay_debt"],
      declineReasons: [],
    });
    expect(result.ok).toBe(true);
    expect(result.proposal.strategy).toBe("risk_defend");
  });

  it("strips unknown legsHint", () => {
    const result = parseProposal({
      version: 1,
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: 5,
      priority: 0.5,
      confidence: 0.6,
      thesis: "edge",
      riskNotes: [],
      legsHint: ["usdc_to_link", "invented_protocol_xyz"],
      declineReasons: [],
    });
    expect(result.ok).toBe(true);
    expect(result.proposal.legsHint).toContain("usdc_to_link");
    expect(result.proposal.legsHint).not.toContain("invented_protocol_xyz");
  });

  it("holdProposal safe default", () => {
    const p = holdProposal("timeout");
    expect(p.action).toBe("hold");
    expect(p.declineReasons).toContain("timeout");
  });
});

describe("prompt invariants", () => {
  it("encodes non-negotiable desk rules", () => {
    for (const inv of DESK_AGENT_PROMPT_INVARIANTS) {
      expect(DESK_AGENT_SYSTEM_PROMPT.toLowerCase()).toContain(inv.toLowerCase());
    }
  });
});

describe("map-proposal", () => {
  it("maps hold to skip risk-increasing", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "hold",
      strategy: null,
      notionalUsdc: 0,
      priority: 0,
      confidence: 0.5,
      thesis: "hold",
      riskNotes: [],
      legsHint: ["none"],
      declineReasons: [],
    };
    const m = mapProposalToDecision(proposal);
    expect(m.skipRiskIncreasing).toBe(true);
    expect(m.preferredStrategy).toBeNull();
  });

  it("maps propose yield with filtered legs", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: 10,
      priority: 0.8,
      confidence: 0.7,
      thesis: "rotate",
      riskNotes: [],
      legsHint: ["usdc_to_link", "usdc_to_weth"],
      declineReasons: [],
    };
    const m = mapProposalToDecision(proposal);
    expect(m.preferredStrategy).toBe("yield_rotation");
    expect(m.legsHint).toContain("usdc_to_link");
    expect(m.legsHint).not.toContain("usdc_to_weth");
    expect(m.riskIncreasingProposal).toBe(true);
  });

  it("applies min confidence gate", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "propose",
      strategy: "oracle_amm",
      notionalUsdc: 8,
      priority: 0.5,
      confidence: 0.2,
      thesis: "weak",
      riskNotes: [],
      legsHint: ["usdc_to_weth"],
      declineReasons: [],
    };
    const gated = applyMinConfidence(proposal, 0.35);
    expect(gated.action).toBe("hold");
    expect(gated.notionalUsdc).toBe(0);
  });

  it("force-defends on critical HF even when agent holds", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "hold",
      strategy: null,
      notionalUsdc: 0,
      priority: 0,
      confidence: 0.1,
      thesis: "holding",
      riskNotes: [],
      legsHint: ["none"],
      declineReasons: ["no_edge"],
    };
    const forced = applyForceDefendOverride(proposal, {
      healthFactor: 1.05,
      hfCritical: 1.2,
      paused: false,
      forceDefendEnabled: true,
    });
    expect(forced.action).toBe("defend");
    expect(forced.strategy).toBe("risk_defend");
    expect(forced.forceDefendOverride).toBe(true);
  });

  it("combineNotional takes min of plan, agent, policy", () => {
    expect(
      combineNotional({
        planNotionalUsdc: 12,
        agentNotionalCapUsdc: 8,
        policyMaxTradeUsdc: 15,
      }),
    ).toBe(8);
    expect(
      combineNotional({
        planNotionalUsdc: 12,
        agentNotionalCapUsdc: 20,
        policyMaxTradeUsdc: 15,
      }),
    ).toBe(12);
  });

  it("force-maintenance upgrades hold when free USDC short + freeable Aave", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "hold",
      strategy: null,
      notionalUsdc: 0,
      priority: 0,
      confidence: 0.5,
      thesis: "no edge",
      riskNotes: [],
      legsHint: ["none"],
      declineReasons: ["no_edge"],
    };
    const forced = applyForceMaintenanceOverride(proposal, {
      freeUsdc: 0,
      minFreeUsdc: 10,
      aaveLinkSupplied: 0,
      linkUsdPrice: 12,
      totalCollateralUsd: 600,
      totalDebtUsd: 0,
      maintenanceNotionalUsdc: 10,
      maxTradeUsdc: 15,
      paused: false,
      killSwitchArmed: false,
    });
    expect(forced.action).toBe("propose");
    expect(forced.strategy).toBe("yield_rotation");
    expect(forced.forceMaintenanceOverride).toBe(true);
    expect(forced.notionalUsdc).toBeGreaterThan(0);
    expect(forced.legsHint).toContain("aave_withdraw_link");
  });

  it("force-maintenance uses free-wallet LINK when Aave is empty", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "hold",
      strategy: null,
      notionalUsdc: 0,
      priority: 0,
      confidence: 0.9,
      thesis: "apy absurd, hold",
      riskNotes: [],
      legsHint: ["none"],
      declineReasons: ["apy_delta_unreliable"],
    };
    const forced = applyForceMaintenanceOverride(proposal, {
      freeUsdc: 6.12,
      minFreeUsdc: 10,
      aaveLinkSupplied: 0,
      freeLink: 67.5,
      linkUsdPrice: 8.4,
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      maintenanceNotionalUsdc: 10,
      maxTradeUsdc: 15,
      paused: false,
      killSwitchArmed: false,
    });
    expect(forced.action).toBe("propose");
    expect(forced.strategy).toBe("yield_rotation");
    expect(forced.forceMaintenanceOverride).toBe(true);
    expect(forced.notionalUsdc).toBeGreaterThan(0);
    expect(forced.legsHint).toEqual(["link_to_usdc"]);
    expect(forced.legsHint).not.toContain("aave_withdraw_link");
    expect(forced.riskNotes.some((n) => n.includes("source=free_link"))).toBe(true);
    expect(forced.thesis.toLowerCase()).toContain("free-wallet");
  });

  it("force-maintenance prefers Aave over free LINK when both freeable", () => {
    const proposal: DeskAgentProposal = {
      version: 1,
      action: "hold",
      strategy: null,
      notionalUsdc: 0,
      priority: 0,
      confidence: 0.5,
      thesis: "hold",
      riskNotes: [],
      legsHint: ["none"],
      declineReasons: [],
    };
    const forced = applyForceMaintenanceOverride(proposal, {
      freeUsdc: 0,
      minFreeUsdc: 10,
      aaveLinkSupplied: 5,
      freeLink: 67,
      linkUsdPrice: 10,
      maintenanceNotionalUsdc: 10,
      maxTradeUsdc: 15,
      paused: false,
      killSwitchArmed: false,
    });
    expect(forced.legsHint).toContain("aave_withdraw_link");
    expect(forced.riskNotes.some((n) => n.includes("source=aave_link"))).toBe(true);
  });
});

describe("desk-trading-agent", () => {
  it("returns hold on timeout/error (safe default)", async () => {
    const agent = createDeskTradingAgent(providers, {
      timeoutMs: 50,
      callLlm: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "{}";
      },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const result = await agent.run(baseContext());
    expect(result.proposal.action === "hold" || result.safeDefault).toBe(true);
    expect(result.proposal.notionalUsdc).toBe(0);
  });

  it("parses mocked LLM propose", async () => {
    const agent = createDeskTradingAgent(providers, {
      callLlm: async () =>
        JSON.stringify({
          version: 1,
          action: "propose",
          strategy: "yield_rotation",
          notionalUsdc: 10,
          priority: 0.7,
          confidence: 0.8,
          thesis: "apyDeltaBps=80 freeUsdc=20 supports LINK rotation.",
          riskNotes: [],
          legsHint: ["usdc_to_link"],
          declineReasons: [],
        }),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const result = await agent.run(baseContext());
    expect(result.safeDefault).toBe(false);
    expect(result.proposal.action).toBe("propose");
    expect(result.proposal.strategy).toBe("yield_rotation");
  });

  it("force-defends when HF critical even if LLM holds", async () => {
    const agent = createDeskTradingAgent(providers, {
      forceDefendOnCriticalHf: true,
      callLlm: async () =>
        JSON.stringify({
          version: 1,
          action: "hold",
          strategy: null,
          notionalUsdc: 0,
          priority: 0,
          confidence: 0.9,
          thesis: "prefer hold",
          riskNotes: [],
          legsHint: ["none"],
          declineReasons: [],
        }),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const ctx = baseContext();
    ctx.mark.healthFactor = 1.05;
    const result = await agent.run(ctx);
    expect(result.proposal.action).toBe("defend");
    expect(result.proposal.forceDefendOverride).toBe(true);
  });

  it("holds without calling LLM when paused", async () => {
    const callLlm = vi.fn();
    const agent = createDeskTradingAgent(providers, {
      callLlm,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const ctx = baseContext();
    ctx.policy.paused = true;
    const result = await agent.run(ctx);
    expect(callLlm).not.toHaveBeenCalled();
    expect(result.proposal.action).toBe("hold");
  });
});

describe("failure-classifier", () => {
  it("heuristically classifies slippage as retry_smaller", async () => {
    const clf = createFailureClassifier(null);
    const r = await clf.classify({
      strategy: "oracle_amm",
      errorMessage: "slippage exceeded",
      notionalUsdc: 10,
    });
    expect(r.nextStep).toBe("retry_smaller");
  });

  it("arms kill near liquidation HF", async () => {
    const clf = createFailureClassifier(null);
    const r = await clf.classify({
      strategy: "risk_defend",
      errorMessage: "repay failed",
      notionalUsdc: 5,
      healthFactor: 1.01,
    });
    expect(r.nextStep).toBe("arm_kill");
  });
});

describe("signal-fusion", () => {
  it("labels small basis as noise", () => {
    const judge = createSignalFusionJudge(null);
    const r = judge.judgeHeuristic({
      signalType: "oracle_basis",
      features: { basisBps: 10, oraclePrice: 3000, ammPrice: 3010 },
      severity: 20,
      policyVerdict: "ignore",
      basisBpsThreshold: 50,
    });
    expect(r.label).toBe("noise");
  });

  it("waits for consecutive APY polls", () => {
    const judge = createSignalFusionJudge(null);
    const r = judge.judgeHeuristic({
      signalType: "apy_delta",
      features: { apyDeltaBps: 80, consecutiveEdgePolls: 0 },
      severity: 50,
      policyVerdict: "trade",
      apyDeltaBpsThreshold: 50,
      apyConsecutivePolls: 2,
    });
    expect(r.label).toBe("wait_for_confirm");
  });

  it("labels absurd APY as data_quality", () => {
    const judge = createSignalFusionJudge(null);
    const r = judge.judgeHeuristic({
      signalType: "apy_delta",
      features: { apyDeltaBps: 22_700, consecutiveEdgePolls: 21 },
      severity: 50,
      policyVerdict: "trade",
      apyDeltaBpsThreshold: 50,
      apyConsecutivePolls: 2,
      apyAbsurdBpsThreshold: 5_000,
    });
    expect(r.label).toBe("data_quality");
  });
});
