/**
 * Pure CCTP rebalance eligibility + amount selection.
 * No I/O — all inputs explicit for exhaustive unit tests.
 *
 * eligible when ALL true:
 *  - feature flag enabled
 *  - in_flight_count < maxInFlight
 *  - now - last_successful_burn_at >= cooldownMs (unless forceOnDeskStarvation)
 *  - treasuryBaseUsdc - baseSafetyBuffer >= rebalanceThreshold
 *  - treasuryBaseEth >= baseMinGasEth
 *  - Mode A ⇒ treasurySepoliaEth >= sepoliaMinGasEth
 *  - no emergency pause
 *  - amount = min(chunk, maxChunk, floor(base - buffer)) > 0
 */

import { CCTP_USDC_DECIMALS } from "./constants.ts";
import { atomicToString, usdcToAtomic } from "./cctp-contracts.ts";
import type {
  CctpPolicyConfig,
  CctpPolicyDecision,
  CctpPolicyInput,
  CctpPolicySkipReason,
} from "./types.ts";

function roundUsdc6(n: number): number {
  return Math.floor(n * 1e6 + 1e-9) / 1e6;
}

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/**
 * Compute max fee in atomic units from human USDC max fee config.
 */
export function maxFeeUsdcToAtomic(maxFeeUsdc: number): bigint {
  if (!Number.isFinite(maxFeeUsdc) || maxFeeUsdc < 0) return 0n;
  return usdcToAtomic(maxFeeUsdc, CCTP_USDC_DECIMALS);
}

/**
 * Pure amount selection: min(chunk, maxChunk, available, optional override).
 * Floors to 6 decimal places (USDC).
 */
export function selectRebalanceAmountUsdc(args: {
  treasuryBaseUsdc: number;
  baseSafetyBufferUsdc: number;
  rebalanceChunkUsdc: number;
  rebalanceMaxChunkUsdc: number;
  amountOverrideUsdc?: number | undefined;
}): { amountUsdc: number; availableAboveBufferUsdc: number } {
  const availableAboveBufferUsdc = roundUsdc6(
    Math.max(0, args.treasuryBaseUsdc - args.baseSafetyBufferUsdc),
  );
  const chunk = Math.min(
    args.rebalanceChunkUsdc,
    args.rebalanceMaxChunkUsdc,
  );
  let amount = Math.min(chunk, availableAboveBufferUsdc);
  if (
    args.amountOverrideUsdc != null &&
    Number.isFinite(args.amountOverrideUsdc) &&
    args.amountOverrideUsdc > 0
  ) {
    amount = Math.min(
      args.amountOverrideUsdc,
      args.rebalanceMaxChunkUsdc,
      availableAboveBufferUsdc,
    );
  }
  amount = roundUsdc6(Math.max(0, amount));
  return { amountUsdc: amount, availableAboveBufferUsdc };
}

export function evaluateRebalancePolicy(
  config: CctpPolicyConfig,
  input: CctpPolicyInput,
): CctpPolicyDecision {
  const now = input.nowMs ?? Date.now();
  const b = input.balances;
  const mode = input.mode ?? "direct";

  const skip = (
    reason: CctpPolicySkipReason,
    detail: string,
    extra?: Partial<CctpPolicyDecision>,
  ): CctpPolicyDecision => ({
    eligible: false,
    amountUsdc: 0,
    amountAtomic: "0",
    maxFeeAtomic: atomicToString(maxFeeUsdcToAtomic(config.maxFeeUsdc)),
    reason,
    detail,
    availableAboveBufferUsdc: extra?.availableAboveBufferUsdc ?? 0,
    ...extra,
  });

  if (!config.enabled) {
    return skip("disabled", "CCTP_REBALANCE_ENABLED is false");
  }

  if (config.emergencyPaused) {
    return skip("emergency_paused", "Treasury emergency pause / kill-switch active");
  }

  if (
    !isFiniteNonNeg(b.treasuryBaseUsdc) ||
    !isFiniteNonNeg(b.treasurySepoliaUsdc) ||
    !isFiniteNonNeg(b.treasuryBaseEth) ||
    !isFiniteNonNeg(b.treasurySepoliaEth) ||
    !isFiniteNonNeg(b.inFlightUsdc)
  ) {
    return skip("invalid_balances", "One or more treasury balances are invalid");
  }

  if (input.inFlightCount >= config.maxInFlight) {
    return skip(
      "max_in_flight",
      `In-flight count ${input.inFlightCount} >= max ${config.maxInFlight}`,
    );
  }

  // Cooldown after last successful burn (unless demo force on desk starvation).
  const skipCooldown =
    config.forceOnDeskStarvation === true && input.deskStarved === true;
  if (!skipCooldown && input.lastSuccessfulBurnAt) {
    const last = Date.parse(input.lastSuccessfulBurnAt);
    if (Number.isFinite(last)) {
      const elapsed = now - last;
      if (elapsed < config.cooldownMs) {
        return skip(
          "cooldown",
          `Cooldown remaining ${config.cooldownMs - elapsed}ms (need ${config.cooldownMs}ms)`,
        );
      }
    }
  }

  if (b.treasuryBaseEth < config.baseMinGasEth) {
    return skip(
      "insufficient_base_gas",
      `Base ETH ${b.treasuryBaseEth} < min ${config.baseMinGasEth}`,
    );
  }

  const requireSepoliaGas =
    config.requireSepoliaGasForDirectMint && mode === "direct";
  if (requireSepoliaGas && b.treasurySepoliaEth < config.sepoliaMinGasEth) {
    return skip(
      "insufficient_sepolia_gas",
      `Sepolia ETH ${b.treasurySepoliaEth} < min ${config.sepoliaMinGasEth} (Mode A)`,
    );
  }

  const { amountUsdc, availableAboveBufferUsdc } = selectRebalanceAmountUsdc({
    treasuryBaseUsdc: b.treasuryBaseUsdc,
    baseSafetyBufferUsdc: config.baseSafetyBufferUsdc,
    rebalanceChunkUsdc: config.rebalanceChunkUsdc,
    rebalanceMaxChunkUsdc: config.rebalanceMaxChunkUsdc,
    amountOverrideUsdc: input.amountOverrideUsdc,
  });

  // Threshold: surplus above buffer must meet rebalanceThreshold (unless override force amount).
  const surplusOk =
    availableAboveBufferUsdc + 1e-12 >= config.rebalanceThresholdUsdc;
  if (!surplusOk && input.amountOverrideUsdc == null) {
    return skip(
      "below_threshold",
      `Base surplus above buffer ${availableAboveBufferUsdc} < threshold ${config.rebalanceThresholdUsdc}`,
      { availableAboveBufferUsdc },
    );
  }

  // With override, still require amount > 0 and within available.
  if (amountUsdc <= 0) {
    return skip("amount_zero", "Computed rebalance amount is zero", {
      availableAboveBufferUsdc,
    });
  }

  // Ensure amount + maxFee still leaves safety buffer (conservative fee-on-top).
  const maxFeeAtomic = maxFeeUsdcToAtomic(config.maxFeeUsdc);
  const amountAtomic = usdcToAtomic(amountUsdc);
  const feeUsdc = Number(maxFeeAtomic) / 10 ** CCTP_USDC_DECIMALS;
  const residual =
    b.treasuryBaseUsdc - amountUsdc - feeUsdc;
  if (residual + 1e-12 < config.baseSafetyBufferUsdc) {
    // Shrink amount to preserve buffer + fee.
    const maxSpend = roundUsdc6(
      b.treasuryBaseUsdc - config.baseSafetyBufferUsdc - feeUsdc,
    );
    const shrunk = roundUsdc6(
      Math.min(amountUsdc, maxSpend, config.rebalanceMaxChunkUsdc),
    );
    if (shrunk <= 0) {
      return skip(
        "amount_zero",
        "Cannot burn without violating base safety buffer after fees",
        { availableAboveBufferUsdc },
      );
    }
    const shrunkAtomic = usdcToAtomic(shrunk);
    return {
      eligible: true,
      amountUsdc: shrunk,
      amountAtomic: atomicToString(shrunkAtomic),
      maxFeeAtomic: atomicToString(maxFeeAtomic),
      reason: "eligible",
      detail: `Eligible (shrunk for fee buffer) for ${shrunk} USDC Base → Sepolia`,
      availableAboveBufferUsdc,
    };
  }

  return {
    eligible: true,
    amountUsdc,
    amountAtomic: atomicToString(amountAtomic),
    maxFeeAtomic: atomicToString(maxFeeAtomic),
    reason: "eligible",
    detail: `Eligible for ${amountUsdc} USDC Base → Sepolia`,
    availableAboveBufferUsdc,
  };
}

/** Build policy config from partial overrides (tests / service). */
export function defaultCctpPolicyConfig(
  overrides: Partial<CctpPolicyConfig> = {},
): CctpPolicyConfig {
  return {
    enabled: true,
    baseSafetyBufferUsdc: 5,
    rebalanceThresholdUsdc: 10,
    rebalanceChunkUsdc: 10,
    rebalanceMaxChunkUsdc: 50,
    maxInFlight: 1,
    cooldownMs: 900_000,
    maxFeeUsdc: 0.05,
    baseMinGasEth: 0.005,
    sepoliaMinGasEth: 0.01,
    requireSepoliaGasForDirectMint: true,
    emergencyPaused: false,
    forceOnDeskStarvation: false,
    ...overrides,
  };
}
