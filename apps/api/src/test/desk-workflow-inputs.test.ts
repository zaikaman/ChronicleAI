import { describe, expect, it } from "vitest";
import { SEPOLIA_DESK } from "@chronicleai/config";
import {
  AAVE_MAX_UINT256,
  buildDefendInput,
  buildKillSwitchInput,
  buildOracleArbInput,
  buildRotateInput,
  buildSweepInput,
  buildWorkflowInputForPlan,
  minPolicyBalance,
  resolveTokenAddress,
  toBaseUnits,
} from "../desk/workflow-inputs.ts";
import type { StrategyPlan } from "../desk/types.ts";

const DESK = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";

describe("workflow-inputs", () => {
  it("resolves Sepolia token symbols", () => {
    expect(resolveTokenAddress("USDC").toLowerCase()).toBe(
      SEPOLIA_DESK.usdc.toLowerCase(),
    );
    expect(resolveTokenAddress("LINK").toLowerCase()).toBe(
      SEPOLIA_DESK.link.toLowerCase(),
    );
  });

  it("converts human amounts to base units", () => {
    expect(toBaseUnits(15, 6)).toBe("15000000");
    expect(toBaseUnits("1.5", 18)).toBe("1500000000000000000");
  });

  it("min(policy, balance) caps correctly", () => {
    expect(minPolicyBalance(15, 40)).toBe(15);
    expect(minPolicyBalance(15, 10)).toBe(10);
    expect(minPolicyBalance(15, 0)).toBe(0);
  });

  it("builds defend repay input", () => {
    const input = buildDefendInput({
      deskAddress: DESK,
      legs: [
        {
          protocol: "aave-v3",
          action: "repay",
          asset: "USDC",
          amount: "10",
          note: "warn_repay_usdc",
        },
      ],
      intentId: "i1",
    });
    expect(input.mode).toBe("repay");
    expect(input.amount).toBe("10000000");
    expect(input.asset.toLowerCase()).toBe(SEPOLIA_DESK.usdc.toLowerCase());
    expect(input.strategy).toBe("risk_defend");
  });

  it("builds defend withdraw input", () => {
    const input = buildDefendInput({
      deskAddress: DESK,
      legs: [
        {
          protocol: "aave-v3",
          action: "withdraw",
          asset: "LINK",
          amount: "0.5",
        },
      ],
    });
    expect(input.mode).toBe("withdraw");
    expect(input.amount).toBe(toBaseUnits(0.5, 18));
  });

  it("builds rotation into Aave with min(policy, balance)", () => {
    const input = buildRotateInput({
      deskAddress: DESK,
      freeUsdc: 40,
      maxTradeUsdc: 15,
      estimatedLinkHuman: 1.2,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "USDC",
          tokenOut: "LINK",
          amountIn: "15",
          note: "rotate_usdc_to_link",
        },
        {
          protocol: "aave-v3",
          action: "supply",
          asset: "LINK",
          amount: "min(policy,balance)",
          note: "supply_link_after_swap",
        },
      ],
    });
    expect(input.direction).toBe("into_aave_link");
    expect(input.amountIn).toBe("15000000");
    expect(input.amountLink).toBe(toBaseUnits(1.2, 18));
  });

  it("builds rotation out of Aave", () => {
    const input = buildRotateInput({
      deskAddress: DESK,
      freeUsdc: 5,
      maxTradeUsdc: 15,
      linkBalanceHuman: 2,
      legs: [
        {
          protocol: "aave-v3",
          action: "withdraw",
          asset: "LINK",
          amount: "1",
          note: "rotate_out_withdraw_link",
        },
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "LINK",
          tokenOut: "USDC",
          amountIn: "1",
          note: "rotate_link_to_usdc",
        },
      ],
    });
    expect(input.direction).toBe("out_of_aave_link");
    expect(input.amountLink).toBe(toBaseUnits(1, 18));
  });

  it("builds oracle arb fade swap", () => {
    const input = buildOracleArbInput({
      deskAddress: DESK,
      basisBps: 100,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "WETH",
          tokenOut: "USDC",
          amountIn: "0.005",
          note: "fade_amm_rich_sell_weth",
        },
      ],
    });
    expect(input.tokenIn.toLowerCase()).toBe(SEPOLIA_DESK.weth.toLowerCase());
    expect(input.tokenOut.toLowerCase()).toBe(SEPOLIA_DESK.usdc.toLowerCase());
    expect(input.amountIn).toBe(toBaseUnits(0.005, 18));
    expect(input.fee).toBe("3000");
  });

  it("builds sweep and kill-switch inputs", () => {
    const sweep = buildSweepInput({
      amountUsdc: 15,
      treasuryAddress: TREASURY,
      deskAddress: DESK,
    });
    expect(sweep.amount).toBe("15");

    const kill = buildKillSwitchInput({
      amountUsdc: 12.5,
      treasuryAddress: TREASURY,
      deskAddress: DESK,
      withdrawLink: true,
      reason: "heartbeat_stale",
    });
    expect(kill.withdrawLink).toBe("true");
    expect(kill.amountLink).toBe(AAVE_MAX_UINT256);
    expect(kill.amount).toBe("12.5");
  });

  it("buildWorkflowInputForPlan routes by strategy", () => {
    const plan: Extract<StrategyPlan, { action: "propose" }> = {
      action: "propose",
      strategy: "oracle_amm",
      notionalUsdc: 10,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amountIn: "10",
        },
      ],
      reasonCodes: ["oracle_amm"],
      riskIncreasing: true,
      severity: 60,
      policyVerdict: "trade",
    };
    const input = buildWorkflowInputForPlan({
      plan,
      deskAddress: DESK,
      freeUsdc: 40,
      maxTradeUsdc: 15,
    });
    expect(input.strategy).toBe("oracle_amm");
    expect(input.amountIn).toBe("10000000");
  });

  it("buildWorkflowInputForPlan free-link powder uses oracle_arb shape", () => {
    const plan: Extract<StrategyPlan, { action: "propose" }> = {
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: 4,
      legs: [
        {
          protocol: "uniswap",
          action: "swap-exact-input",
          tokenIn: "LINK",
          tokenOut: "USDC",
          amountIn: "0.5",
          note: "rotate_free_link_to_usdc",
        },
      ],
      reasonCodes: ["yield_rotation", "out_of_free_link", "free_usdc_shortfall"],
      riskIncreasing: false,
      severity: 55,
      policyVerdict: "trade",
    };
    const input = buildWorkflowInputForPlan({
      plan,
      deskAddress: DESK,
      freeUsdc: 6,
      maxTradeUsdc: 15,
      freeLinkPowder: true,
    });
    // Single-swap oracle_arb payload (not rotate direction)
    expect(input.tokenIn).toBeDefined();
    expect(input.tokenOut).toBeDefined();
    expect(input.amountIn).toBeDefined();
    expect(input.direction).toBeUndefined();
  });
});
