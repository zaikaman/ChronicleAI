/**
 * Yield rotation strategy: APY comparison → multi-leg plan (USDC book ↔ LINK Aave).
 * Prefer LINK supply path on Sepolia (USDC/DAI supply often capped).
 *
 * A2: maintenance free-powder / rebalance paths that do not claim yield edge.
 * Reason codes for maintenance never use edge_bps as the sole justification.
 */

import type { DeskPolicyConfig, DeskLeg, StrategyPlan } from "./types.ts";

export type RotationDirection =
  | "into_aave_link"
  | "out_of_aave_link"
  | "into_morpho"
  | "out_of_morpho";

export interface YieldRotationInput {
  /** Idle USDC APY in bps (typically 0). */
  idleUsdcApyBps: number;
  /** Aave LINK (or primary reserve) supply APY in bps. */
  aaveSupplyApyBps: number;
  /** Optional Morpho vault APY in bps. */
  morphoApyBps?: number | null | undefined;
  /** How many consecutive polls have shown edge ≥ threshold. */
  consecutiveEdgePolls: number;
  freeUsdc: number;
  /** LINK currently supplied on Aave (human units). */
  aaveLinkSupplied?: number | undefined;
  /**
   * Free (wallet) LINK human units — used for free-powder shortfall when
   * Aave is empty (swap free LINK → USDC, no withdraw).
   */
  freeLink?: number | undefined;
  /**
   * Optional Aave account totals — used to estimate supplied LINK when
   * `aaveLinkSupplied` is missing (desk is LINK-collateral primary).
   */
  totalCollateralUsd?: number | undefined;
  totalDebtUsd?: number | undefined;
  linkUsdPrice?: number | null | undefined;
  /** Morpho vault USDC balance if any. */
  morphoUsdc?: number | undefined;
  maxTradeUsdc: number;
  /**
   * Last successful maintenance fill (ms epoch). When null/undefined,
   * cadence maintenance is allowed immediately if other conditions hold.
   */
  lastMaintenanceAtMs?: number | null | undefined;
  /** Wall clock for cadence / tests. */
  nowMs?: number | undefined;
}

export interface YieldRotationStrategy {
  plan(input: YieldRotationInput): StrategyPlan;
  /**
   * Compute signed APY edge in bps: positive means destination beats source.
   */
  apyDeltaBps(fromBps: number, toBps: number): number;
}

function roundAmount(n: number, decimals = 6): string {
  const f = 10 ** decimals;
  return (Math.round(n * f) / f).toFixed(decimals);
}

function roundUsdc(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** True when reason codes mark an inventory-maintenance plan (not yield edge). */
export function isMaintenanceReasonCodes(reasonCodes: readonly string[]): boolean {
  return reasonCodes.some(
    (c) =>
      c === "maintenance_rebalance" ||
      c === "free_usdc_shortfall" ||
      c === "apy_data_quality_hold_inventory" ||
      c === "event_linked_microtrade" ||
      c.startsWith("maintenance_") ||
      c.startsWith("event_linked_microtrade"),
  );
}

function resolveAaveLinkSupplied(input: YieldRotationInput): number {
  if (input.aaveLinkSupplied != null && input.aaveLinkSupplied > 0) {
    return input.aaveLinkSupplied;
  }
  const debt = input.totalDebtUsd ?? 0;
  const collat = input.totalCollateralUsd ?? 0;
  const price = input.linkUsdPrice;
  // Desk primary path is LINK collateral; when debt≈0, collateral USD ≈ LINK mark.
  if (debt < 0.01 && collat > 0 && price != null && price > 0) {
    return collat / price;
  }
  return 0;
}

/** Aave withdraw + swap free powder (when aToken inventory remains). */
function freePowderAaveLegs(linkAmount: number): DeskLeg[] {
  return [
    {
      protocol: "aave-v3",
      action: "withdraw",
      asset: "LINK",
      amount: roundAmount(linkAmount, 8),
      note: "rotate_out_withdraw_link",
    },
    {
      protocol: "uniswap",
      action: "swap-exact-input",
      tokenIn: "LINK",
      tokenOut: "USDC",
      amountIn: roundAmount(linkAmount, 8),
      note: "rotate_link_to_usdc",
    },
  ];
}

/** Wallet free LINK → USDC only (Aave already empty). Executed via oracle_arb. */
function freePowderFreeLinkLegs(linkAmount: number): DeskLeg[] {
  return [
    {
      protocol: "uniswap",
      action: "swap-exact-input",
      tokenIn: "LINK",
      tokenOut: "USDC",
      amountIn: roundAmount(linkAmount, 8),
      note: "rotate_free_link_to_usdc",
    },
  ];
}

/** True when plan legs are free-wallet LINK→USDC powder (no Aave withdraw). */
export function isFreeLinkPowderLegs(legs: readonly DeskLeg[]): boolean {
  if (legs.length === 0) return false;
  const hasWithdraw = legs.some(
    (l) => l.action === "withdraw" || l.note === "rotate_out_withdraw_link",
  );
  if (hasWithdraw) return false;
  return legs.some(
    (l) =>
      l.action === "swap-exact-input" &&
      (l.tokenIn ?? "").toUpperCase() === "LINK" &&
      (l.tokenOut ?? "").toUpperCase() === "USDC" &&
      (l.note === "rotate_free_link_to_usdc" ||
        l.note === "free_inventory_link_to_usdc" ||
        l.note === "rotate_link_to_usdc"),
  );
}

export function createYieldRotationStrategy(
  config: DeskPolicyConfig,
): YieldRotationStrategy {
  function apyDeltaBps(fromBps: number, toBps: number): number {
    return Math.round(toBps - fromBps);
  }

  function maintenanceCapUsdc(): number {
    const knobs = [
      config.maintenanceNotionalUsdc,
      config.maxTradeUsdc,
      config.inventoryTopupUsdc,
    ].filter((n) => Number.isFinite(n) && n > 0);
    return knobs.length > 0 ? Math.min(...knobs) : config.maxTradeUsdc;
  }

  /**
   * Edge-independent free-powder / rebalance plan.
   * Never justifies solely with edge_bps.
   *
   * Prefer Aave withdraw→swap when aToken inventory remains; fall back to
   * free-wallet LINK→USDC swap when free USDC is below the floor and Aave is empty.
   */
  function planMaintenance(input: YieldRotationInput): StrategyPlan | null {
    const aaveLink = resolveAaveLinkSupplied(input);
    const freeLink = Math.max(0, input.freeLink ?? 0);
    const linkPrice =
      input.linkUsdPrice != null && input.linkUsdPrice > 0 ? input.linkUsdPrice : null;
    if (linkPrice == null) {
      return null;
    }

    const freeUsdc = Math.max(0, input.freeUsdc);
    const minFree = Math.max(0, config.minFreeUsdc);
    const aaveFreeableUsd = aaveLink > 0 ? aaveLink * linkPrice : 0;
    const freeLinkUsd = freeLink > 0 ? freeLink * linkPrice : 0;

    const shortfall = freeUsdc + 1e-9 < minFree;
    const now = input.nowMs ?? Date.now();
    const lastMaint = input.lastMaintenanceAtMs;
    const intervalDue =
      lastMaint == null ||
      !Number.isFinite(lastMaint) ||
      now - lastMaint >= config.rebalanceIntervalMs;

    // One-sided book: material freeable Aave inventory that dominates free USDC.
    // Must be independent of minFree — otherwise cadence reasons never fire once
    // free USDC is restored to the floor (shortfall path already covers free < min).
    const oneSidedAave =
      aaveFreeableUsd >= Math.min(maintenanceCapUsdc(), 1) && freeUsdc < aaveFreeableUsd;

    let reason: "free_usdc_shortfall" | "maintenance_rebalance" | null =
      null;

    if (shortfall) {
      // Free-powder shortfall is not interval-gated (need dry powder every tick).
      reason = "free_usdc_shortfall";
    } else if (oneSidedAave && intervalDue) {
      reason = "maintenance_rebalance";
    }

    if (!reason) return null;

    // Inventory source: Aave first; free-wallet LINK only for shortfall when Aave empty.
    const useAave = aaveFreeableUsd >= 0.5;
    const useFreeLink = !useAave && shortfall && freeLinkUsd >= 0.5;
    if (!useAave && !useFreeLink) return null;

    const freeableUsd = useAave ? aaveFreeableUsd : freeLinkUsd;
    const linkInventory = useAave ? aaveLink : freeLink;

    let notional = maintenanceCapUsdc();
    if (reason === "free_usdc_shortfall") {
      const need = Math.max(0, minFree - freeUsdc);
      notional = Math.min(notional, Math.max(need, config.inventoryTopupUsdc));
    }
    notional = Math.min(notional, freeableUsd, config.maxTradeUsdc);
    notional = roundUsdc(notional);
    if (notional <= 0) return null;

    // Haircut 1bp so float mark/price sizing never exceeds live balance.
    const linkAmount = Math.min(linkInventory * 0.9999, (notional / linkPrice) * 0.9999);
    if (linkAmount <= 0) return null;

    const sourceCode = useAave ? "out_of_aave_link" : "out_of_free_link";
    const reasonCodes = [
      "yield_rotation",
      sourceCode,
      reason,
      `notional_usdc=${notional}`,
    ];
    if (shortfall) {
      reasonCodes.push(`free_usdc=${roundUsdc(freeUsdc)}`, `min_free=${minFree}`);
    }

    return {
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: notional,
      legs: useAave ? freePowderAaveLegs(linkAmount) : freePowderFreeLinkLegs(linkAmount),
      reasonCodes,
      // Free-powder restores dry powder — not risk-increasing.
      riskIncreasing: false,
      severity: reason === "free_usdc_shortfall" ? 55 : 40,
      policyVerdict: "trade",
    };
  }

  return {
    apyDeltaBps,

    plan(input) {
      // Maintenance runs even when consecutive-edge gate would block yield entries.
      const maintenance = planMaintenance(input);

      const edgeIntoAave = apyDeltaBps(input.idleUsdcApyBps, input.aaveSupplyApyBps);

      // Free-USDC shortfall always wins over a yield thesis (cannot open without powder).
      if (
        maintenance &&
        maintenance.action === "propose" &&
        maintenance.reasonCodes.includes("free_usdc_shortfall")
      ) {
        return maintenance;
      }

      if (input.consecutiveEdgePolls < config.apyConsecutivePolls) {
        // Cadence / shortfall maintenance may still run without consecutive edge.
        if (maintenance) return maintenance;
        return {
          action: "ignore",
          reasonCodes: [
            "apy_edge_not_consecutive",
            `polls=${input.consecutiveEdgePolls}`,
            `need=${config.apyConsecutivePolls}`,
          ],
        };
      }

      const candidates: Array<{
        direction: RotationDirection;
        edgeBps: number;
        notional: number;
        legs: DeskLeg[];
      }> = [];

      // Into Aave LINK from idle USDC
      if (edgeIntoAave >= config.apyDeltaBps && input.freeUsdc > 0) {
        const notional = Math.min(input.freeUsdc, input.maxTradeUsdc, config.maxTradeUsdc);
        if (notional > 0) {
          const legs: DeskLeg[] = [
            {
              protocol: "uniswap",
              action: "swap-exact-input",
              tokenIn: "USDC",
              tokenOut: "LINK",
              amountIn: roundAmount(notional, 6),
              note: "rotate_usdc_to_link",
            },
            {
              protocol: "aave-v3",
              action: "supply",
              asset: "LINK",
              amount: "min(policy,balance)",
              note: "supply_link_after_swap",
            },
          ];
          candidates.push({
            direction: "into_aave_link",
            edgeBps: edgeIntoAave,
            notional,
            legs,
          });
        }
      }

      // Out of Aave LINK when idle/Morpho better or Aave edge gone
      const aaveLink = resolveAaveLinkSupplied(input);
      const linkPrice =
        input.linkUsdPrice != null && input.linkUsdPrice > 0 ? input.linkUsdPrice : null;
      if (aaveLink > 0 && linkPrice != null) {
        const edgeOut = apyDeltaBps(input.aaveSupplyApyBps, input.idleUsdcApyBps);
        // Exit when Aave is no longer ahead by threshold (or inverse edge).
        if (edgeOut >= config.apyDeltaBps || edgeIntoAave < config.apyDeltaBps / 2) {
          const linkUsd = aaveLink * linkPrice;
          const notional = Math.min(linkUsd, input.maxTradeUsdc, config.maxTradeUsdc);
          const linkAmount = notional / linkPrice;
          if (notional > 0) {
            candidates.push({
              direction: "out_of_aave_link",
              edgeBps: Math.max(edgeOut, config.apyDeltaBps),
              notional,
              legs: freePowderAaveLegs(linkAmount),
            });
          }
        }
      }

      // Morpho USDC vault path when configured with a real APY
      const morphoApy = input.morphoApyBps;
      if (morphoApy != null && Number.isFinite(morphoApy)) {
        const edgeMorpho = apyDeltaBps(input.idleUsdcApyBps, morphoApy);
        if (edgeMorpho >= config.apyDeltaBps && input.freeUsdc > 0) {
          const notional = Math.min(input.freeUsdc, input.maxTradeUsdc, config.maxTradeUsdc);
          if (notional > 0) {
            candidates.push({
              direction: "into_morpho",
              edgeBps: edgeMorpho,
              notional,
              legs: [
                {
                  protocol: "morpho",
                  action: "deposit",
                  asset: "USDC",
                  amount: roundAmount(notional, 6),
                  note: "rotate_into_morpho_usdc",
                },
              ],
            });
          }
        }
        const morphoBal = input.morphoUsdc ?? 0;
        const edgeOutMorpho = apyDeltaBps(morphoApy, input.idleUsdcApyBps);
        if (edgeOutMorpho >= config.apyDeltaBps && morphoBal > 0) {
          const notional = Math.min(morphoBal, input.maxTradeUsdc, config.maxTradeUsdc);
          if (notional > 0) {
            candidates.push({
              direction: "out_of_morpho",
              edgeBps: edgeOutMorpho,
              notional,
              legs: [
                {
                  protocol: "morpho",
                  action: "withdraw",
                  asset: "USDC",
                  amount: roundAmount(notional, 6),
                  note: "rotate_out_morpho_usdc",
                },
              ],
            });
          }
        }
      }

      if (candidates.length === 0) {
        if (maintenance) return maintenance;
        return {
          action: "ignore",
          reasonCodes: ["no_rotation_edge", `need_bps>=${config.apyDeltaBps}`],
        };
      }

      candidates.sort((a, b) => b.edgeBps - a.edgeBps);
      const best = candidates[0]!;

      return {
        action: "propose",
        strategy: "yield_rotation",
        notionalUsdc: Math.round(best.notional * 1e6) / 1e6,
        legs: best.legs,
        reasonCodes: [
          "yield_rotation",
          best.direction,
          `edge_bps=${best.edgeBps}`,
        ],
        riskIncreasing: best.direction.startsWith("into_"),
        severity: Math.min(90, 40 + Math.floor(best.edgeBps / 5)),
        policyVerdict: "trade",
      };
    },
  };
}
