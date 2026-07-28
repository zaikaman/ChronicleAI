/**
 * Risk defend strategy: plan repay / delever from Aave health factor.
 * Pure planning — execution is KeeperHub desk-defend workflow.
 */

import type { DeskPolicyConfig, DeskLeg, StrategyPlan } from "./types.ts";

export interface RiskDefendInput {
  healthFactor: number | null;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  freeUsdc: number;
  freeLink?: number | undefined;
  linkUsdPrice?: number | null | undefined;
  /** Optional inventory WETH (not preferred for repay in v1). */
  freeWeth?: number | undefined;
  maxTradeUsdc: number;
}

export interface RiskDefendStrategy {
  plan(input: RiskDefendInput): StrategyPlan;
}

function roundAmount(n: number, decimals = 6): string {
  const f = 10 ** decimals;
  return (Math.round(n * f) / f).toFixed(decimals);
}

/**
 * Target repay notional so HF moves toward warn when debt is non-zero.
 * Conservative: repay min(debt, free inventory, maxTrade, fraction of debt).
 */
export function sizeDefendRepayUsdc(input: {
  healthFactor: number;
  totalDebtUsd: number;
  freeUsdc: number;
  freeLinkUsd: number;
  maxTradeUsdc: number;
  hfCritical: number;
  hfWarn: number;
}): number {
  if (input.totalDebtUsd <= 0) return 0;
  const inventory = Math.max(0, input.freeUsdc) + Math.max(0, input.freeLinkUsd);
  if (inventory <= 0) return 0;

  // Critical: repay up to half of debt or full inventory (capped).
  // Warn: smaller touch (25% of debt) to lift HF.
  const fraction = input.healthFactor < input.hfCritical ? 0.5 : 0.25;
  const target = input.totalDebtUsd * fraction;
  return Math.min(target, inventory, input.maxTradeUsdc, input.totalDebtUsd);
}

export function createRiskDefendStrategy(config: DeskPolicyConfig): RiskDefendStrategy {
  return {
    plan(input) {
      const hf = input.healthFactor;
      if (hf == null || !Number.isFinite(hf)) {
        return { action: "ignore", reasonCodes: ["hf_unknown"] };
      }
      // Aave encodes "no debt" as max uint256 / very large HF.
      if (hf > 100 || input.totalDebtUsd <= 0) {
        return { action: "ignore", reasonCodes: ["hf_healthy_no_debt"] };
      }
      if (hf >= config.hfWarn) {
        return { action: "ignore", reasonCodes: ["hf_above_warn"] };
      }

      const linkUsd =
        (input.freeLink ?? 0) *
        (input.linkUsdPrice != null && input.linkUsdPrice > 0 ? input.linkUsdPrice : 0);
      const repayUsdc = sizeDefendRepayUsdc({
        healthFactor: hf,
        totalDebtUsd: input.totalDebtUsd,
        freeUsdc: input.freeUsdc,
        freeLinkUsd: linkUsd,
        maxTradeUsdc: Math.min(config.maxTradeUsdc, input.maxTradeUsdc),
        hfCritical: config.hfCritical,
        hfWarn: config.hfWarn,
      });

      const legs: DeskLeg[] = [];
      let remaining = repayUsdc;

      // Prefer USDC repay first (stable inventory).
      const usdcRepay = Math.min(remaining, Math.max(0, input.freeUsdc));
      if (usdcRepay > 0) {
        legs.push({
          protocol: "aave-v3",
          action: "repay",
          asset: "USDC",
          amount: roundAmount(usdcRepay, 6),
          note: hf < config.hfCritical ? "critical_repay_usdc" : "warn_repay_usdc",
        });
        remaining -= usdcRepay;
      }

      // Then LINK if still needed and priced.
      if (remaining > 0.01 && (input.freeLink ?? 0) > 0 && linkUsd > 0) {
        const linkPrice = input.linkUsdPrice!;
        const linkAmount = Math.min(input.freeLink!, remaining / linkPrice);
        if (linkAmount > 0) {
          legs.push({
            protocol: "aave-v3",
            action: "repay",
            asset: "LINK",
            amount: roundAmount(linkAmount, 8),
            note: "defend_repay_link",
          });
          remaining -= linkAmount * linkPrice;
        }
      }

      // If still underwater and collateral exists, withdraw excess risk (best-effort signal to workflow).
      if (legs.length === 0 && input.totalCollateralUsd > 0 && hf < config.hfCritical) {
        const withdrawUsd = Math.min(
          config.maxTradeUsdc,
          input.totalCollateralUsd * 0.1,
        );
        legs.push({
          protocol: "aave-v3",
          action: "withdraw",
          asset: "LINK",
          amount: roundAmount(withdrawUsd, 6),
          note: "critical_withdraw_reduce_risk",
        });
      }

      if (legs.length === 0) {
        return {
          action: "ignore",
          reasonCodes: ["defend_no_inventory_or_debt_action"],
        };
      }

      const notional = Math.min(
        config.maxTradeUsdc,
        repayUsdc > 0 ? repayUsdc : config.maxTradeUsdc,
      );
      const critical = hf < config.hfCritical;
      // After a partial repay, HF rises; we do not have a full simulation — mark post-trade as ≥ warn when debt reduced materially.
      const simulatedHfAfter =
        input.totalDebtUsd > 0
          ? Math.max(hf, critical ? config.hfCritical : config.hfWarn)
          : hf;

      return {
        action: "propose",
        strategy: "risk_defend",
        notionalUsdc: Math.round(notional * 1e6) / 1e6,
        legs,
        reasonCodes: [
          critical ? "hf_critical" : "hf_warn",
          `hf=${hf.toFixed(4)}`,
        ],
        riskIncreasing: false,
        simulatedHfAfter,
        severity: critical ? 95 : 70,
        policyVerdict: "defend",
      };
    },
  };
}
