/**
 * Phase 5 — event-linked microtrade (newspaper → desk).
 *
 * When enabled, a recent qualified monitored event (large_swap / gas_spike /
 * volume_anomaly) or elevated desk gas_regime may authorize ≤1 policy-capped
 * KeeperHub execution with reason `event_linked_microtrade`.
 *
 * Prefer tiny maintenance rebalance (yield_rotation free-powder) over risk-
 * increasing paths. Oracle–AMM only when basis is honestly tradeable and free
 * inventory covers notional. Enabled by default (env can disable).
 */

import { ACTIVE_INTELLIGENCE_CHAIN_ID } from "@chronicleai/config";
import type { DeskStrategy } from "@chronicleai/schemas";
import type {
  DeskLeg,
  DeskPolicyConfig,
  DeskSignalFeatures,
  GasRegime,
  StrategyPlan,
} from "./types.ts";
import { DESK_BASIS_ABSURD_BPS } from "./oracle-amm-pricing.ts";
import { computeOracleAmmBasisBps } from "./strategy-oracle-amm.ts";

/** Event types that can authorize a microtrade (newspaper / block sensors). */
export const EVENT_MICROTRADE_TRIGGER_TYPES = [
  "large_swap",
  "gas_spike",
  "volume_anomaly",
] as const;

export type EventMicrotradeTriggerType =
  (typeof EVENT_MICROTRADE_TRIGGER_TYPES)[number];

export const EVENT_LINKED_MICROTRADE_REASON = "event_linked_microtrade";

export interface EventMicrotradeTrigger {
  /** Monitored event id when the trigger is a newspaper event. */
  monitoredEventId?: string | null | undefined;
  eventType: string;
  /** ISO timestamp used for lookback filtering. */
  capturedAt?: string | null | undefined;
  /** Optional on-chain tx for provenance in reason codes / tickets. */
  transactionHash?: string | null | undefined;
  /** Observation/source chain. Execution remains on the active Sepolia desk. */
  sourceChainId?: number | null | undefined;
  source?: "monitored_event" | "desk_gas_regime" | undefined;
}

export interface EventMicrotradeInventory {
  freeUsdc: number;
  freeWeth?: number | undefined;
  freeLink?: number | undefined;
  aaveLinkSupplied?: number | undefined;
  totalCollateralUsd?: number | undefined;
  totalDebtUsd?: number | undefined;
  linkUsdPrice?: number | null | undefined;
  ethUsdPrice?: number | null | undefined;
  deskEquityUsdc: number;
}

export interface EventMicrotradeEligibilityInput {
  enabled: boolean;
  deskPaused: boolean;
  killSwitchArmed: boolean;
  /** Global single-flight: any open intent blocks a new microtrade. */
  hasAnyOpenIntent: boolean;
  /** When true, this desk tick already opened/executed an intent — skip. */
  tickAlreadyHasIntent: boolean;
  lastEventMicrotradeAtMs?: number | null | undefined;
  cooldownMs: number;
  lookbackMs: number;
  notionalCapUsdc: number;
  maxTradeUsdc: number;
  freeUsdc: number;
  /** Candidate triggers (newest first preferred). */
  triggers: EventMicrotradeTrigger[];
  /** Optional desk gas_regime from recent signal. */
  gasRegime?: GasRegime | undefined;
  nowMs?: number | undefined;
}

export type EventMicrotradeSkipReason =
  | "disabled"
  | "desk_paused"
  | "kill_switch_armed"
  | "open_intent"
  | "tick_already_has_intent"
  | "cooldown"
  | "no_trigger"
  | "notional_cap_zero"
  | "no_executable_plan";

export interface EventMicrotradeEligibilityResult {
  allow: boolean;
  skipReason?: EventMicrotradeSkipReason | undefined;
  trigger?: EventMicrotradeTrigger | undefined;
  notionalCapUsdc: number;
  reasonCodes: string[];
}

export interface EventMicrotradePlanInput {
  config: DeskPolicyConfig;
  inventory: EventMicrotradeInventory;
  features?: DeskSignalFeatures | undefined;
  trigger: EventMicrotradeTrigger;
  notionalCapUsdc: number;
  nowMs?: number | undefined;
}

export interface EventMicrotradePlanResult {
  plan: StrategyPlan;
  strategy: DeskStrategy | null;
  mode: "maintenance_rebalance" | "oracle_amm" | "none";
}

function roundAmount(n: number, decimals = 6): string {
  const f = 10 ** decimals;
  return (Math.round(n * f) / f).toFixed(decimals);
}

function roundUsdc(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function isEventMicrotradeTriggerType(
  eventType: string,
): eventType is EventMicrotradeTriggerType {
  return (EVENT_MICROTRADE_TRIGGER_TYPES as readonly string[]).includes(
    eventType,
  );
}

export function isEventLinkedMicrotradeReasons(
  reasonCodes: readonly string[],
): boolean {
  return reasonCodes.some(
    (c) =>
      c === EVENT_LINKED_MICROTRADE_REASON ||
      c.startsWith("event_linked_microtrade"),
  );
}

function resolveAaveLinkSupplied(inv: EventMicrotradeInventory): number {
  if (inv.aaveLinkSupplied != null && inv.aaveLinkSupplied > 0) {
    return inv.aaveLinkSupplied;
  }
  const debt = inv.totalDebtUsd ?? 0;
  const collat = inv.totalCollateralUsd ?? 0;
  const price = inv.linkUsdPrice;
  if (debt < 0.01 && collat > 0 && price != null && price > 0) {
    return collat / price;
  }
  return 0;
}

function freePowderLegs(linkAmount: number): DeskLeg[] {
  return [
    {
      protocol: "aave-v3",
      action: "withdraw",
      asset: "LINK",
      amount: roundAmount(linkAmount, 8),
      note: "event_microtrade_withdraw_link",
    },
    {
      protocol: "uniswap",
      action: "swap-exact-input",
      tokenIn: "LINK",
      tokenOut: "USDC",
      amountIn: roundAmount(linkAmount, 8),
      note: "event_microtrade_link_to_usdc",
    },
  ];
}

function triggerWithinLookback(
  trigger: EventMicrotradeTrigger,
  nowMs: number,
  lookbackMs: number,
): boolean {
  if (!trigger.capturedAt) return true;
  const ms = Date.parse(trigger.capturedAt);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms <= lookbackMs;
}

/**
 * Pure eligibility gate. Does not build legs — only decides whether a
 * microtrade may be attempted and which trigger to attach for provenance.
 */
export function evaluateEventMicrotradeEligibility(
  input: EventMicrotradeEligibilityInput,
): EventMicrotradeEligibilityResult {
  const notionalCap = roundUsdc(
    Math.min(
      Math.max(0, input.notionalCapUsdc),
      Math.max(0, input.maxTradeUsdc),
    ),
  );

  if (!input.enabled) {
    return {
      allow: false,
      skipReason: "disabled",
      notionalCapUsdc: notionalCap,
      reasonCodes: ["event_microtrade_disabled"],
    };
  }
  if (input.deskPaused) {
    return {
      allow: false,
      skipReason: "desk_paused",
      notionalCapUsdc: notionalCap,
      reasonCodes: ["desk_paused"],
    };
  }
  if (input.killSwitchArmed) {
    return {
      allow: false,
      skipReason: "kill_switch_armed",
      notionalCapUsdc: notionalCap,
      reasonCodes: ["kill_switch_armed"],
    };
  }
  if (input.hasAnyOpenIntent) {
    return {
      allow: false,
      skipReason: "open_intent",
      notionalCapUsdc: notionalCap,
      reasonCodes: ["open_intent_blocks_microtrade"],
    };
  }
  if (input.tickAlreadyHasIntent) {
    return {
      allow: false,
      skipReason: "tick_already_has_intent",
      notionalCapUsdc: notionalCap,
      reasonCodes: ["tick_already_has_intent"],
    };
  }
  if (notionalCap <= 0) {
    return {
      allow: false,
      skipReason: "notional_cap_zero",
      notionalCapUsdc: 0,
      reasonCodes: ["notional_cap_zero"],
    };
  }

  const now = input.nowMs ?? Date.now();
  const lastAt = input.lastEventMicrotradeAtMs;
  if (
    lastAt != null &&
    Number.isFinite(lastAt) &&
    now - lastAt < input.cooldownMs
  ) {
    return {
      allow: false,
      skipReason: "cooldown",
      notionalCapUsdc: notionalCap,
      reasonCodes: [
        "event_microtrade_cooldown",
        `cooldown_ms=${input.cooldownMs}`,
        `elapsed_ms=${now - lastAt}`,
      ],
    };
  }

  // Prefer monitored events in lookback; fall back to elevated gas regime.
  const eventTriggers = input.triggers.filter(
    (t) =>
      isEventMicrotradeTriggerType(t.eventType) &&
      (t.eventType !== "gas_spike" ||
        t.sourceChainId == null ||
        t.sourceChainId === ACTIVE_INTELLIGENCE_CHAIN_ID) &&
      triggerWithinLookback(t, now, input.lookbackMs),
  );

  let trigger: EventMicrotradeTrigger | undefined = eventTriggers[0];

  if (!trigger && (input.gasRegime === "elevated" || input.gasRegime === "critical")) {
    trigger = {
      eventType: "gas_regime",
      source: "desk_gas_regime",
      capturedAt: new Date(now).toISOString(),
    };
  }

  if (!trigger) {
    return {
      allow: false,
      skipReason: "no_trigger",
      notionalCapUsdc: notionalCap,
      reasonCodes: ["no_qualifying_event"],
    };
  }

  return {
    allow: true,
    trigger,
    notionalCapUsdc: notionalCap,
    reasonCodes: [
      EVENT_LINKED_MICROTRADE_REASON,
      `trigger=${trigger.eventType}`,
      ...(trigger.monitoredEventId
        ? [`monitored_event_id=${trigger.monitoredEventId}`]
        : []),
    ],
  };
}

/**
 * Build a policy-capped plan for an authorized event microtrade.
 *
 * Preference order:
 * 1. Maintenance free-powder (Aave LINK withdraw → swap USDC) — risk-decreasing
 * 2. Oracle–AMM fade when basis is honestly tradeable and inventory covers notional
 * 3. ignore with structured reasons (never invent fills)
 */
export function planEventMicrotrade(
  input: EventMicrotradePlanInput,
): EventMicrotradePlanResult {
  const { config, inventory, trigger, features } = input;
  const now = input.nowMs ?? Date.now();
  const notionalCap = roundUsdc(
    Math.min(
      Math.max(0, input.notionalCapUsdc),
      config.maxTradeUsdc,
      config.eventMicrotradeUsdc > 0
        ? config.eventMicrotradeUsdc
        : input.notionalCapUsdc,
    ),
  );

  const provenance: string[] = [
    EVENT_LINKED_MICROTRADE_REASON,
    `trigger=${trigger.eventType}`,
  ];
  if (trigger.monitoredEventId) {
    provenance.push(`monitored_event_id=${trigger.monitoredEventId}`);
  }
  if (trigger.transactionHash) {
    provenance.push(`event_tx=${trigger.transactionHash}`);
  }
  if (trigger.sourceChainId != null) {
    provenance.push(`source_chain_id=${trigger.sourceChainId}`);
  }
  if (trigger.source) {
    provenance.push(`source=${trigger.source}`);
  }

  // ── 1. Prefer tiny maintenance rebalance (free powder) ──────────────
  const aaveLink = resolveAaveLinkSupplied(inventory);
  const linkPrice =
    inventory.linkUsdPrice != null && inventory.linkUsdPrice > 0
      ? inventory.linkUsdPrice
      : null;
  const freeableUsd =
    aaveLink > 0 && linkPrice != null ? aaveLink * linkPrice : 0;

  if (freeableUsd > 0 && linkPrice != null && notionalCap > 0) {
    let notional = Math.min(notionalCap, freeableUsd);
    notional = roundUsdc(notional);
    if (notional > 0) {
      const linkAmount = notional / linkPrice;
      if (linkAmount > 0) {
        return {
          mode: "maintenance_rebalance",
          strategy: "yield_rotation",
          plan: {
            action: "propose",
            strategy: "yield_rotation",
            notionalUsdc: notional,
            legs: freePowderLegs(linkAmount),
            reasonCodes: [
              "yield_rotation",
              "out_of_aave_link",
              "maintenance_rebalance",
              ...provenance,
              `notional_usdc=${notional}`,
            ],
            riskIncreasing: false,
            severity: 45,
            policyVerdict: "trade",
          },
        };
      }
    }
  }

  // ── 2. Oracle–AMM only when basis is valid and inventory covers ─────
  const oraclePrice = features?.oraclePrice;
  const ammPrice = features?.ammPrice;
  if (
    oraclePrice != null &&
    ammPrice != null &&
    Number.isFinite(oraclePrice) &&
    oraclePrice > 0 &&
    Number.isFinite(ammPrice) &&
    ammPrice > 0
  ) {
    const oracleUpdatedAtMs = features?.oracleUpdatedAtMs;
    const stale =
      oracleUpdatedAtMs != null &&
      Number.isFinite(oracleUpdatedAtMs) &&
      now - oracleUpdatedAtMs > config.oracleMaxStalenessMs;

    if (!stale) {
      let basisBps: number | null = null;
      try {
        basisBps = computeOracleAmmBasisBps(oraclePrice, ammPrice);
      } catch {
        basisBps = null;
      }

      if (
        basisBps != null &&
        Math.abs(basisBps) >= config.basisBps &&
        Math.abs(basisBps) <= DESK_BASIS_ABSURD_BPS
      ) {
        const ethUsd =
          inventory.ethUsdPrice != null && inventory.ethUsdPrice > 0
            ? inventory.ethUsdPrice
            : oraclePrice;

        if (basisBps > 0) {
          // AMM rich: sell free WETH → USDC
          const freeWeth = Math.max(0, inventory.freeWeth ?? 0);
          const wethUsd = freeWeth * ethUsd;
          let notional = Math.min(notionalCap, wethUsd);
          notional = roundUsdc(notional);
          if (notional > 0) {
            const wethIn = notional / ethUsd;
            return {
              mode: "oracle_amm",
              strategy: "oracle_amm",
              plan: {
                action: "propose",
                strategy: "oracle_amm",
                notionalUsdc: notional,
                legs: [
                  {
                    protocol: "uniswap",
                    action: "swap-exact-input",
                    tokenIn: "WETH",
                    tokenOut: "USDC",
                    amountIn: roundAmount(wethIn, 8),
                    note: "event_microtrade_fade_amm_rich",
                  },
                ],
                reasonCodes: [
                  "oracle_amm",
                  "sell_weth",
                  `basis_bps=${basisBps}`,
                  ...provenance,
                  `notional_usdc=${notional}`,
                ],
                riskIncreasing: true,
                severity: Math.min(90, 50 + Math.floor(Math.abs(basisBps) / 2)),
                policyVerdict: "trade",
              },
            };
          }
        } else {
          // AMM cheap: buy WETH with free USDC
          const freeUsdc = Math.max(0, inventory.freeUsdc);
          let notional = Math.min(notionalCap, freeUsdc);
          notional = roundUsdc(notional);
          if (notional > 0) {
            return {
              mode: "oracle_amm",
              strategy: "oracle_amm",
              plan: {
                action: "propose",
                strategy: "oracle_amm",
                notionalUsdc: notional,
                legs: [
                  {
                    protocol: "uniswap",
                    action: "swap-exact-input",
                    tokenIn: "USDC",
                    tokenOut: "WETH",
                    amountIn: roundAmount(notional, 6),
                    note: "event_microtrade_fade_amm_cheap",
                  },
                ],
                reasonCodes: [
                  "oracle_amm",
                  "buy_weth",
                  `basis_bps=${basisBps}`,
                  ...provenance,
                  `notional_usdc=${notional}`,
                ],
                riskIncreasing: true,
                severity: Math.min(90, 50 + Math.floor(Math.abs(basisBps) / 2)),
                policyVerdict: "trade",
              },
            };
          }
        }
      }
    }
  }

  // ── 3. Free USDC available but no Aave inventory and no basis → skip ─
  // Design: free USDC ≥ notional OR maintenance free first. Without a real
  // executable leg we refuse rather than inventing a no-op swap.
  return {
    mode: "none",
    strategy: null,
    plan: {
      action: "ignore",
      reasonCodes: [
        ...provenance,
        "no_executable_plan",
        freeableUsd <= 0 ? "no_aave_link_inventory" : "inventory_notional_zero",
        inventory.freeUsdc + 1e-9 < notionalCap
          ? `free_usdc_below_notional=${roundUsdc(inventory.freeUsdc)}`
          : "basis_or_inventory_unavailable",
      ],
    },
  };
}

/**
 * Convenience: eligibility + plan in one call for control-plane / tests.
 */
export function evaluateAndPlanEventMicrotrade(params: {
  eligibility: EventMicrotradeEligibilityInput;
  inventory: EventMicrotradeInventory;
  config: DeskPolicyConfig;
  features?: DeskSignalFeatures | undefined;
}): {
  eligibility: EventMicrotradeEligibilityResult;
  planResult: EventMicrotradePlanResult | null;
} {
  const eligibility = evaluateEventMicrotradeEligibility(params.eligibility);
  if (!eligibility.allow || !eligibility.trigger) {
    return { eligibility, planResult: null };
  }

  const planResult = planEventMicrotrade({
    config: params.config,
    inventory: params.inventory,
    features: params.features,
    trigger: eligibility.trigger,
    notionalCapUsdc: eligibility.notionalCapUsdc,
    nowMs: params.eligibility.nowMs,
  });

  if (planResult.plan.action === "ignore") {
    return {
      eligibility: {
        ...eligibility,
        allow: false,
        skipReason: "no_executable_plan",
        reasonCodes: [
          ...eligibility.reasonCodes,
          ...planResult.plan.reasonCodes,
        ],
      },
      planResult,
    };
  }

  return { eligibility, planResult };
}
