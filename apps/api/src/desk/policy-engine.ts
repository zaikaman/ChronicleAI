/**
 * Pure desk policy engine: allow/deny, size notionals, strategy priority.
 * No I/O — all inputs are explicit so unit tests cover every gate.
 *
 * Rules (plan §7.1):
 * 1. kill-switch / paused → no risk-increasing intents
 * 2. elevated gas → defer non-defend
 * 3. notional ≤ maxTrade and equity − notional ≥ floor
 * 4. single-flight per strategy (optional global)
 * 5. cooldown after failed run
 * 6. risk_defend outranks rotation and arb
 * 7. simulated HF after trade ≥ hfWarn when applicable
 * 8. stale oracle → refuse opens
 */

import type { DeskStrategy } from "@chronicleai/schemas";
import type {
  DeskPolicyConfig,
  DeskPolicySnapshot,
  GasRegime,
  PolicyDecision,
  PolicyEvaluationContext,
} from "./types.ts";

export interface PolicyEngine {
  evaluate(ctx: PolicyEvaluationContext): PolicyDecision;
  sizeNotional(
    proposed: number,
    freeUsdc: number,
    deskEquityUsdc: number,
    opts?: { inventoryBacked?: boolean | undefined },
  ): number;
  /**
   * Priority order for concurrent candidate strategies.
   * risk_defend always wins; otherwise first allowed in list order.
   */
  pickStrategy(candidates: DeskStrategy[]): DeskStrategy | null;
  classifyGasRegime(gasGwei: number | undefined | null): GasRegime;
  isRiskIncreasing(strategy: DeskStrategy, legsRiskIncreasing?: boolean): boolean;
}

export const STRATEGY_PRIORITY: readonly DeskStrategy[] = [
  "risk_defend",
  "yield_rotation",
  "oracle_amm",
] as const;

function roundUsdc(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function createPolicyEngine(config: DeskPolicyConfig): PolicyEngine {
  function sizeNotional(
    proposed: number,
    freeUsdc: number,
    deskEquityUsdc: number,
    opts?: { inventoryBacked?: boolean | undefined },
  ): number {
    if (!Number.isFinite(proposed) || proposed <= 0) return 0;
    const equityFloor = config.minAumUsdc;
    const maxByCap = config.maxTradeUsdc;
    // Inventory-backed exits (maintenance free-powder / rotate-out) are not
    // limited by free USDC — notional is backed by freeable Aave/LINK inventory.
    const maxByFree = opts?.inventoryBacked
      ? maxByCap
      : Math.max(0, freeUsdc);
    // Leave equity at or above floor after the trade when equity is known.
    // Composition-only free-powder conserves equity; still apply floor as a guard.
    const maxByFloor =
      Number.isFinite(deskEquityUsdc) && deskEquityUsdc > 0
        ? Math.max(0, deskEquityUsdc - equityFloor)
        : maxByCap;
    const sized = Math.min(proposed, maxByCap, maxByFree, maxByFloor);
    return roundUsdc(Math.max(0, sized));
  }

  function classifyGasRegime(gasGwei: number | undefined | null): GasRegime {
    if (gasGwei == null || !Number.isFinite(gasGwei)) return "normal";
    if (gasGwei >= config.gasElevatedGwei * 2) return "critical";
    if (gasGwei >= config.gasElevatedGwei) return "elevated";
    return "normal";
  }

  function isRiskIncreasing(
    strategy: DeskStrategy,
    legsRiskIncreasing?: boolean,
  ): boolean {
    if (strategy === "risk_defend") return false;
    if (legsRiskIncreasing !== undefined) return legsRiskIncreasing;
    // Rotation and arb increase market / inventory risk by default.
    return strategy === "yield_rotation" || strategy === "oracle_amm";
  }

  function pickStrategy(candidates: DeskStrategy[]): DeskStrategy | null {
    if (candidates.length === 0) return null;
    const set = new Set(candidates);
    for (const s of STRATEGY_PRIORITY) {
      if (set.has(s)) return s;
    }
    return candidates[0] ?? null;
  }

  function evaluate(ctx: PolicyEvaluationContext): PolicyDecision {
    const now = ctx.nowMs ?? Date.now();
    const reasonCodes: string[] = [];
    let allow = true;
    let verdict: PolicyDecision["verdict"] = "trade";

    const riskIncreasing = ctx.riskIncreasing;
    const paused = config.paused;
    const kill = ctx.killSwitchArmed;

    // Rule 1 — kill / pause blocks risk-increasing; defend may still proceed when not fully paused.
    if (kill) {
      reasonCodes.push("kill_switch_armed");
      if (riskIncreasing) {
        allow = false;
        verdict = "defer";
      }
    }
    if (paused) {
      reasonCodes.push("desk_paused");
      if (riskIncreasing) {
        allow = false;
        verdict = "defer";
      } else if (ctx.strategy !== "risk_defend") {
        allow = false;
        verdict = "defer";
      }
    }

    // Rule 2 — elevated gas defers non-defend
    if (ctx.strategy !== "risk_defend") {
      if (ctx.gasRegime === "elevated" || ctx.gasRegime === "critical") {
        reasonCodes.push(`gas_regime_${ctx.gasRegime}`);
        allow = false;
        verdict = "defer";
      }
    }

    // Rule 4 — single-flight
    if (ctx.openByStrategy[ctx.strategy]) {
      reasonCodes.push("single_flight_strategy");
      allow = false;
      verdict = "defer";
    }
    if (
      (ctx.globalSingleFlight || ctx.hasAnyOpenIntent) &&
      ctx.strategy !== "risk_defend"
    ) {
      // Global single-flight: only defend can preempt.
      if (ctx.hasAnyOpenIntent && !ctx.openByStrategy.risk_defend) {
        reasonCodes.push("single_flight_global");
        allow = false;
        verdict = "defer";
      }
    }

    // Rule 5 — cooldown after failed run
    const lastFail = ctx.lastFailedAtMsByStrategy?.[ctx.strategy];
    if (
      lastFail != null &&
      Number.isFinite(lastFail) &&
      now - lastFail < config.failedRunCooldownMs
    ) {
      reasonCodes.push("failed_run_cooldown");
      allow = false;
      verdict = "defer";
    }

    // Rule 8 — stale oracle refuses opens (non-defend)
    if (
      ctx.strategy !== "risk_defend" &&
      ctx.oracleUpdatedAtMs != null &&
      Number.isFinite(ctx.oracleUpdatedAtMs)
    ) {
      const age = now - ctx.oracleUpdatedAtMs;
      if (age > config.oracleMaxStalenessMs) {
        reasonCodes.push("oracle_stale");
        allow = false;
        verdict = "ignore";
      }
    }

    // Rule 3 — size notional
    // Maintenance free-powder is risk-decreasing yield_rotation: inventory-backed.
    const inventoryBacked =
      !riskIncreasing && ctx.strategy === "yield_rotation";
    const sized = sizeNotional(
      ctx.proposedNotionalUsdc,
      ctx.freeUsdc,
      ctx.deskEquityUsdc,
      { inventoryBacked },
    );
    if (sized <= 0 && ctx.strategy !== "risk_defend") {
      reasonCodes.push("notional_zero");
      allow = false;
      verdict = verdict === "trade" ? "ignore" : verdict;
    } else if (sized < ctx.proposedNotionalUsdc && sized > 0) {
      reasonCodes.push("notional_capped");
    }

    // Equity floor applies to risk-increasing opens. Free-powder conserves equity.
    if (
      !inventoryBacked &&
      ctx.strategy !== "risk_defend" &&
      sized > 0 &&
      ctx.deskEquityUsdc - sized < config.minAumUsdc - 1e-9
    ) {
      reasonCodes.push("equity_floor");
      allow = false;
      verdict = "defer";
    }

    // Rule 7 — post-trade simulated HF
    if (
      ctx.simulatedHfAfter != null &&
      Number.isFinite(ctx.simulatedHfAfter) &&
      ctx.simulatedHfAfter < config.hfWarn
    ) {
      reasonCodes.push("simulated_hf_below_warn");
      // Defend may still need to run when HF is already critical; only block risk-increasing.
      if (riskIncreasing) {
        allow = false;
        verdict = "defer";
      }
    }

    // Defend-specific verdict labeling
    if (allow && ctx.strategy === "risk_defend") {
      verdict = "defend";
      if (!reasonCodes.includes("risk_defend")) {
        reasonCodes.push("risk_defend");
      }
    }

    if (allow && reasonCodes.length === 0) {
      reasonCodes.push("policy_ok");
    }

    if (!allow && verdict === "trade") {
      verdict = "defer";
    }

    const policySnapshot: DeskPolicySnapshot = {
      maxTradeUsdc: config.maxTradeUsdc,
      minAumUsdc: config.minAumUsdc,
      targetAumUsdc: config.targetAumUsdc,
      maxAumUsdc: config.maxAumUsdc,
      hfWarn: config.hfWarn,
      hfCritical: config.hfCritical,
      basisBps: config.basisBps,
      apyDeltaBps: config.apyDeltaBps,
      deskPaused: paused,
      killSwitchArmed: kill,
      gasRegime: ctx.gasRegime,
      deskEquityUsdc: ctx.deskEquityUsdc,
      freeUsdc: ctx.freeUsdc,
      notionalUsdc: sized,
      reasonCodes: [...reasonCodes],
      evaluatedAt: new Date(now).toISOString(),
      ...(ctx.simulatedHfAfter != null ? { simulatedHfAfter: ctx.simulatedHfAfter } : {}),
    };

    return {
      allow,
      verdict,
      reasonCodes,
      sizedNotionalUsdc: sized,
      policySnapshot,
    };
  }

  return {
    evaluate,
    sizeNotional,
    pickStrategy,
    classifyGasRegime,
    isRiskIncreasing,
  };
}

/** Pure capital eligibility (Loop 7) — no I/O. */
export function evaluateTopupEligibility(input: {
  treasuryUsdc: number;
  usdcOperatingReserve: number;
  chunkUsdc: number;
  deskEquityUsdc: number;
  targetAumUsdc: number;
  minAumUsdc: number;
  maxAumUsdc: number;
  lastTopupAtMs: number | null | undefined;
  topupCooldownMs: number;
  deskPaused: boolean;
  killSwitchArmed: boolean;
  nowMs?: number | undefined;
  /**
   * When true, allow top-up even if equity ≥ target AUM
   * (free-USDC inventory shortfall with no on-desk unwind path).
   */
  forceInventoryTopup?: boolean | undefined;
}): { eligible: boolean; amountUsdc: number; reason: string; urgent: boolean } {
  const now = input.nowMs ?? Date.now();

  if (input.deskPaused) {
    return { eligible: false, amountUsdc: 0, reason: "desk_paused", urgent: false };
  }
  if (input.killSwitchArmed) {
    return { eligible: false, amountUsdc: 0, reason: "kill_switch_armed", urgent: false };
  }

  const urgent = input.deskEquityUsdc < input.minAumUsdc;
  const belowTarget = input.deskEquityUsdc < input.targetAumUsdc;
  const forceInventory = input.forceInventoryTopup === true;
  if (!belowTarget && !urgent && !forceInventory) {
    return {
      eligible: false,
      amountUsdc: 0,
      reason: "desk_equity_at_or_above_target",
      urgent: false,
    };
  }

  if (input.deskEquityUsdc + input.chunkUsdc > input.maxAumUsdc + 1e-9) {
    return {
      eligible: false,
      amountUsdc: 0,
      reason: "topup_would_exceed_max_aum",
      urgent,
    };
  }

  // Treasury must retain USDC operating reserve after the chunk.
  // (ETH safety buffer is enforced separately via gas balance — not USDC units.)
  if (input.treasuryUsdc < input.usdcOperatingReserve + input.chunkUsdc) {
    return {
      eligible: false,
      amountUsdc: 0,
      reason: "treasury_usdc_below_reserve_plus_chunk",
      urgent,
    };
  }

  if (
    input.lastTopupAtMs != null &&
    Number.isFinite(input.lastTopupAtMs) &&
    now - input.lastTopupAtMs < input.topupCooldownMs
  ) {
    return {
      eligible: false,
      amountUsdc: 0,
      reason: "topup_cooldown",
      urgent,
    };
  }

  let reason = "desk_below_target_aum";
  if (urgent) {
    reason = "desk_below_min_aum";
  } else if (forceInventory && !belowTarget) {
    reason = "free_usdc_shortfall_no_unwind";
  }

  return {
    eligible: true,
    amountUsdc: roundUsdc(input.chunkUsdc),
    reason,
    urgent,
  };
}

/** Unwindable on-desk inventory marked in USDC (free LINK + debt-free Aave collateral). */
export function computeUnwindableInventoryUsdc(input: {
  freeLinkOnDesk?: number | undefined;
  linkUsdPrice?: number | null | undefined;
  aaveTotalCollateralUsd?: number | undefined;
  aaveTotalDebtUsd?: number | undefined;
  aaveLinkSupplied?: number | undefined;
}): {
  freeLinkUsd: number;
  aaveFreeableUsd: number;
  unwindableUsdc: number;
  source: "aave_link" | "free_link" | "mixed" | "none";
} {
  const linkPrice =
    input.linkUsdPrice != null &&
    Number.isFinite(input.linkUsdPrice) &&
    input.linkUsdPrice > 0
      ? input.linkUsdPrice
      : null;

  const freeLink = Math.max(0, input.freeLinkOnDesk ?? 0);
  const freeLinkUsd =
    linkPrice != null ? roundUsdc(freeLink * linkPrice) : 0;

  // Supplied LINK USD when priced; otherwise rely on Aave account USD mark.
  const aaveLinkUsd =
    linkPrice != null &&
    input.aaveLinkSupplied != null &&
    Number.isFinite(input.aaveLinkSupplied) &&
    input.aaveLinkSupplied > 0
      ? roundUsdc(input.aaveLinkSupplied * linkPrice)
      : 0;

  const collateral = Math.max(0, input.aaveTotalCollateralUsd ?? 0);
  const debt = Math.max(0, input.aaveTotalDebtUsd ?? 0);
  // Only treat Aave collateral as freeable when:
  // - there is no material debt (partial withdraw with debt → risk_defend)
  // - LINK/USD is priced (execute path needs price to size withdraw+swap)
  const aaveFreeableUsd =
    debt <= 1e-6 && linkPrice != null
      ? roundUsdc(Math.max(aaveLinkUsd, collateral))
      : 0;

  const unwindableUsdc = roundUsdc(freeLinkUsd + aaveFreeableUsd);
  let source: "aave_link" | "free_link" | "mixed" | "none" = "none";
  if (freeLinkUsd > 1e-9 && aaveFreeableUsd > 1e-9) source = "mixed";
  else if (freeLinkUsd > 1e-9) source = "free_link";
  else if (aaveFreeableUsd > 1e-9) source = "aave_link";

  return { freeLinkUsd, aaveFreeableUsd, unwindableUsdc, source };
}

export type FreeInventoryShortfallResult =
  | {
      kind: "ok";
      amountUsdc: 0;
      reason: "free_usdc_at_or_above_min";
    }
  | {
      kind: "free_inventory";
      amountUsdc: number;
      reason: string;
      source: "aave_link" | "free_link" | "mixed";
    }
  | {
      kind: "topup_inventory";
      amountUsdc: number;
      reason: string;
    }
  | {
      kind: "skip";
      amountUsdc: 0;
      reason: string;
    };

/**
 * Pure free-USDC inventory shortfall decision (A1 capital loop).
 * Prefer on-desk unwind when equity is already funded; only request treasury
 * inventory top-up when unwind is impossible or preferUnwind is false.
 */
export function evaluateFreeInventoryShortfall(input: {
  freeUsdcOnDesk: number;
  minFreeUsdc: number;
  inventoryTopupUsdc: number;
  preferUnwindForFreeUsdc: boolean;
  deskEquityUsdc: number;
  minAumUsdc: number;
  targetAumUsdc: number;
  maxAumUsdc: number;
  deskPaused: boolean;
  killSwitchArmed: boolean;
  freeLinkOnDesk?: number | undefined;
  linkUsdPrice?: number | null | undefined;
  aaveTotalCollateralUsd?: number | undefined;
  aaveTotalDebtUsd?: number | undefined;
  aaveLinkSupplied?: number | undefined;
}): FreeInventoryShortfallResult {
  if (input.deskPaused) {
    return { kind: "skip", amountUsdc: 0, reason: "desk_paused" };
  }
  if (input.killSwitchArmed) {
    return { kind: "skip", amountUsdc: 0, reason: "kill_switch_armed" };
  }

  const free = Math.max(0, input.freeUsdcOnDesk);
  const minFree = Math.max(0, input.minFreeUsdc);
  if (free + 1e-9 >= minFree) {
    return { kind: "ok", amountUsdc: 0, reason: "free_usdc_at_or_above_min" };
  }

  const shortfall = roundUsdc(minFree - free);
  const chunk = roundUsdc(Math.max(0, input.inventoryTopupUsdc));
  if (chunk <= 0) {
    return { kind: "skip", amountUsdc: 0, reason: "inventory_topup_chunk_zero" };
  }

  // Discrete inventory chunk (mirrors treasury top-up sizing).
  const amountUsdc = chunk;

  const inventory = computeUnwindableInventoryUsdc({
    freeLinkOnDesk: input.freeLinkOnDesk,
    linkUsdPrice: input.linkUsdPrice,
    aaveTotalCollateralUsd: input.aaveTotalCollateralUsd,
    aaveTotalDebtUsd: input.aaveTotalDebtUsd,
    aaveLinkSupplied: input.aaveLinkSupplied,
  });

  // Design: freeable inventory worth ≥ chunk (or at least the shortfall if smaller).
  const needUsdc = roundUsdc(Math.min(chunk, shortfall));
  const canUnwind =
    inventory.source !== "none" &&
    inventory.unwindableUsdc + 1e-9 >= needUsdc;

  // When book is under min AUM, capital growth (treasury top-up) outranks inventory free.
  // free_inventory does not increase equity — leave that path to evaluateTopupEligibility.
  const underMinAum = input.deskEquityUsdc < input.minAumUsdc - 1e-9;

  if (input.preferUnwindForFreeUsdc && canUnwind && !underMinAum) {
    const freeAmount = roundUsdc(
      Math.min(amountUsdc, inventory.unwindableUsdc),
    );
    if (freeAmount > 0) {
      return {
        kind: "free_inventory",
        amountUsdc: freeAmount,
        reason: "free_usdc_shortfall_unwind",
        source: inventory.source === "none" ? "aave_link" : inventory.source,
      };
    }
  }

  // Unwind impossible, or preferUnwind=false → treasury inventory top-up when equity
  // is already at/above target (below-target is handled by normal top-up path).
  const equityAtOrAboveTarget =
    input.deskEquityUsdc + 1e-9 >= input.targetAumUsdc;
  const wouldExceedMax =
    input.deskEquityUsdc + chunk > input.maxAumUsdc + 1e-9;

  if (!canUnwind || !input.preferUnwindForFreeUsdc) {
    if (wouldExceedMax && equityAtOrAboveTarget) {
      return {
        kind: "skip",
        amountUsdc: 0,
        reason: canUnwind
          ? "prefer_unwind_disabled_max_aum"
          : "insufficient_collateral_to_free_max_aum",
      };
    }
    if (!canUnwind) {
      // Signal capital manager to force inventory top-up (even if equity ≥ target).
      return {
        kind: "topup_inventory",
        amountUsdc: chunk,
        reason: "free_usdc_shortfall_no_unwind",
      };
    }
    // preferUnwind false but can unwind — treasury top-up for free powder when
    // over-allocated; otherwise normal top-up covers under-target.
    if (equityAtOrAboveTarget) {
      return {
        kind: "topup_inventory",
        amountUsdc: chunk,
        reason: "free_usdc_shortfall_prefer_treasury",
      };
    }
    return {
      kind: "skip",
      amountUsdc: 0,
      reason: "free_usdc_shortfall_defer_to_equity_topup",
    };
  }

  // preferUnwind && canUnwind but under min AUM → skip free path so urgent top-up runs.
  if (underMinAum) {
    return {
      kind: "skip",
      amountUsdc: 0,
      reason: "free_usdc_shortfall_under_min_aum_prefer_topup",
    };
  }

  return {
    kind: "skip",
    amountUsdc: 0,
    reason: "insufficient_collateral_to_free",
  };
}

/** Dust floor for non-emergency sweeps (USDC). Below this, skip. */
const SWEEP_DUST_USDC = 0.01;

/**
 * Detect maintenance ↔ max-AUM sweep thrash from recent history.
 * True when the last N capital moves are sweeps and the last N filled
 * intents are free-powder shortfall maintenance.
 */
export function detectPowderThrash(input: {
  recentCapitalMoves: Array<{ direction: string; reason?: string | null }>;
  recentFilledIntents: Array<{ reasonCodes: string[] }>;
  /** Window size (default 3). */
  window?: number | undefined;
}): boolean {
  const n = input.window ?? 3;
  if (n <= 0) return false;
  const moves = input.recentCapitalMoves.slice(0, n);
  if (moves.length < n) return false;
  if (!moves.every((m) => m.direction === "sweep")) return false;
  const fills = input.recentFilledIntents.slice(0, n);
  if (fills.length < n) return false;
  return fills.every((i) =>
    (i.reasonCodes ?? []).some(
      (c) => c === "free_usdc_shortfall" || c.includes("free_usdc_shortfall"),
    ),
  );
}

/**
 * Pure capital sweep eligibility (Loop 7) — no I/O.
 *
 * Dry powder invariant (non-emergency):
 *   reservedFreeUsdc = minFreeUsdc
 *   sweepableUsdc    = max(0, freeUsdcOnDesk - reservedFreeUsdc)
 *   amountToSweep    = min(desiredSweep, sweepableUsdc)
 *
 * Emergency / kill-switch flatten may still sweep full free USDC.
 * Max-AUM sweeps only move free cash above the powder reserve; they never
 * invent free USDC from Aave inventory (that is strategy/maintenance work).
 */
export function evaluateSweepEligibility(input: {
  deskEquityUsdc: number;
  freeUsdcOnDesk: number;
  targetAumUsdc: number;
  maxAumUsdc: number;
  profitSweepUsdc: number;
  killSwitchArmed: boolean;
  emergency?: boolean;
  /**
   * Floor of liquid free USDC reserved as dry powder.
   * Non-emergency sweeps never take this slice.
   */
  minFreeUsdc?: number | undefined;
  /**
   * When true, freeable Aave/LINK inventory exists. Used only to pick a
   * clearer skip reason when equity is over max but free is fully reserved.
   */
  hasFreeableInventory?: boolean | undefined;
  /**
   * Thrash guard: pause max-AUM sweeps (profit excess free still allowed).
   */
  suppressMaxAumSweep?: boolean | undefined;
  /**
   * Timestamp of last free-powder maintenance fill (ms). Combined with
   * postMaintenanceSweepCooldownMs to avoid immediately undoing powder.
   */
  lastFreePowderFillAtMs?: number | null | undefined;
  /** Cooldown after free-powder fill before max-AUM sweeps resume (ms). */
  postMaintenanceSweepCooldownMs?: number | undefined;
  nowMs?: number | undefined;
}): { eligible: boolean; amountUsdc: number; reason: string; emergency: boolean } {
  const free = Math.max(0, input.freeUsdcOnDesk);
  const now = input.nowMs ?? Date.now();

  // Emergency / kill-switch: full free USDC, no powder reserve.
  if (input.killSwitchArmed || input.emergency) {
    const amount = roundUsdc(free);
    return {
      eligible: amount > 0,
      amountUsdc: amount,
      reason: "emergency_return",
      emergency: true,
    };
  }

  const minFree = Math.max(0, input.minFreeUsdc ?? 0);
  const reservedFreeUsdc = minFree;
  const sweepableUsdc = roundUsdc(Math.max(0, free - reservedFreeUsdc));

  const freeWellAbovePowder =
    free > minFree + Math.max(0, input.profitSweepUsdc) - 1e-9;

  const inPostMaintenanceCooldown =
    input.lastFreePowderFillAtMs != null &&
    Number.isFinite(input.lastFreePowderFillAtMs) &&
    input.postMaintenanceSweepCooldownMs != null &&
    input.postMaintenanceSweepCooldownMs > 0 &&
    now - input.lastFreePowderFillAtMs < input.postMaintenanceSweepCooldownMs;

  // Max-AUM path may be suppressed by thrash guard or post-maintenance cooldown
  // unless free is well above powder + profit threshold.
  const maxAumSweepAllowed =
    !input.suppressMaxAumSweep &&
    (!inPostMaintenanceCooldown || freeWellAbovePowder);

  if (input.deskEquityUsdc > input.maxAumUsdc) {
    if (maxAumSweepAllowed) {
      const desired = roundUsdc(
        Math.min(free, Math.max(0, input.deskEquityUsdc - input.targetAumUsdc)),
      );
      const amount = roundUsdc(Math.min(desired, sweepableUsdc));
      if (amount >= SWEEP_DUST_USDC) {
        return {
          eligible: true,
          amountUsdc: amount,
          reason: "desk_equity_above_max_aum",
          emergency: false,
        };
      }
      // Equity over max but nothing sweepable after powder reserve.
      if (free > SWEEP_DUST_USDC && sweepableUsdc < SWEEP_DUST_USDC) {
        return {
          eligible: false,
          amountUsdc: 0,
          reason: "equity_above_max_but_free_usdc_reserved",
          emergency: false,
        };
      }
      if (free <= SWEEP_DUST_USDC && input.hasFreeableInventory) {
        return {
          eligible: false,
          amountUsdc: 0,
          reason: "equity_above_max_requires_strategy_unwind",
          emergency: false,
        };
      }
      if (free <= SWEEP_DUST_USDC) {
        return {
          eligible: false,
          amountUsdc: 0,
          reason: "equity_above_max_no_free_usdc",
          emergency: false,
        };
      }
      return {
        eligible: false,
        amountUsdc: 0,
        reason: "free_usdc_reserved_for_powder",
        emergency: false,
      };
    }

    // Max-AUM suppressed — still allow profit-style excess free below if any.
    if (inPostMaintenanceCooldown && !freeWellAbovePowder) {
      // Fall through: only profit path if free is large enough.
    } else if (input.suppressMaxAumSweep && !freeWellAbovePowder) {
      // Thrash pause: no max-AUM vacuum of powder-adjacent free.
      if (sweepableUsdc < SWEEP_DUST_USDC) {
        return {
          eligible: false,
          amountUsdc: 0,
          reason: "desk_powder_thrash_detected",
          emergency: false,
        };
      }
    }
  }

  // Profit sweep: only free above powder reserve, and leave equity ≥ target.
  if (
    free >= input.profitSweepUsdc - 1e-9 &&
    input.deskEquityUsdc - Math.min(sweepableUsdc, free) >=
      input.targetAumUsdc - 1e-9
  ) {
    const desired = roundUsdc(
      Math.min(free, Math.max(0, input.deskEquityUsdc - input.targetAumUsdc)),
    );
    const amount = roundUsdc(Math.min(desired, sweepableUsdc));
    if (amount >= SWEEP_DUST_USDC) {
      // Prefer profit threshold when free is large enough relative to profit knob.
      if (
        free >= input.profitSweepUsdc - 1e-9 &&
        input.deskEquityUsdc - amount >= input.targetAumUsdc - 1e-9
      ) {
        return {
          eligible: true,
          amountUsdc: amount,
          reason: "profit_sweep_threshold",
          emergency: false,
        };
      }
    }
  }

  // Post-maintenance cooldown skip surface (readable for Activity).
  if (
    inPostMaintenanceCooldown &&
    input.deskEquityUsdc > input.maxAumUsdc &&
    !freeWellAbovePowder
  ) {
    return {
      eligible: false,
      amountUsdc: 0,
      reason: "post_maintenance_sweep_cooldown",
      emergency: false,
    };
  }

  if (
    input.suppressMaxAumSweep &&
    input.deskEquityUsdc > input.maxAumUsdc &&
    !freeWellAbovePowder
  ) {
    return {
      eligible: false,
      amountUsdc: 0,
      reason: "desk_powder_thrash_detected",
      emergency: false,
    };
  }

  return {
    eligible: false,
    amountUsdc: 0,
    reason: "no_sweep_needed",
    emergency: false,
  };
}
