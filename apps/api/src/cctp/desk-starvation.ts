/**
 * Pure desk-starvation signal for CCTP force-on-starvation and capital messaging.
 *
 * Desk is "CCTP-starved" when:
 *  - desk book needs a top-up (below target or min AUM), AND
 *  - Sepolia treasury cannot fund reserve + chunk, AND
 *  - Base pocket has surplus above CCTP safety buffer + rebalance threshold
 *
 * Capital manager must never spend Base USDC; this only prioritizes rebalance.
 */

export interface DeskCctpStarvationInput {
  deskEquityUsdc: number;
  minAumUsdc: number;
  targetAumUsdc: number;
  /** Ethereum Sepolia treasury USDC (ops / deployable rail). */
  treasurySepoliaUsdc: number;
  usdcOperatingReserve: number;
  topupChunkUsdc: number;
  /** Base Sepolia treasury USDC (payment rail). */
  treasuryBaseUsdc: number;
  baseSafetyBufferUsdc: number;
  rebalanceThresholdUsdc: number;
}

export interface DeskCctpStarvationResult {
  starved: boolean;
  /** Machine reason for logs / capital decision. */
  reason: string;
  /** Operator-facing detail. */
  detail: string;
  deskNeedsCapital: boolean;
  sepoliaCanTopup: boolean;
  baseSurplusUsdc: number;
}

export function evaluateDeskCctpStarvation(
  input: DeskCctpStarvationInput,
): DeskCctpStarvationResult {
  const deskNeedsCapital =
    input.deskEquityUsdc < input.targetAumUsdc ||
    input.deskEquityUsdc < input.minAumUsdc;

  const sepoliaCanTopup =
    input.treasurySepoliaUsdc >=
    input.usdcOperatingReserve + input.topupChunkUsdc;

  const baseSurplusUsdc = Math.max(
    0,
    input.treasuryBaseUsdc - input.baseSafetyBufferUsdc,
  );
  const baseFlush = baseSurplusUsdc >= input.rebalanceThresholdUsdc;

  if (!deskNeedsCapital) {
    return {
      starved: false,
      reason: "desk_equity_ok",
      detail: "Desk equity at or above target/min AUM",
      deskNeedsCapital: false,
      sepoliaCanTopup,
      baseSurplusUsdc,
    };
  }

  if (sepoliaCanTopup) {
    return {
      starved: false,
      reason: "sepolia_can_topup",
      detail: `Sepolia treasury ${input.treasurySepoliaUsdc} USDC can fund reserve+chunk`,
      deskNeedsCapital: true,
      sepoliaCanTopup: true,
      baseSurplusUsdc,
    };
  }

  if (!baseFlush) {
    return {
      starved: false,
      reason: "base_not_flush",
      detail:
        `Desk needs capital and Sepolia treasury is low ` +
        `(${input.treasurySepoliaUsdc} USDC), but Base surplus ` +
        `${baseSurplusUsdc} USDC is below rebalance threshold ` +
        `${input.rebalanceThresholdUsdc}`,
      deskNeedsCapital: true,
      sepoliaCanTopup: false,
      baseSurplusUsdc,
    };
  }

  return {
    starved: true,
    reason: "awaiting_cctp_rebalance",
    detail:
      `Desk needs top-up but Sepolia treasury ` +
      `${input.treasurySepoliaUsdc} USDC is below reserve+chunk; ` +
      `Base has ${input.treasuryBaseUsdc} USDC surplus ` +
      `(${baseSurplusUsdc} above buffer) — awaiting CCTP rebalance`,
    deskNeedsCapital: true,
    sepoliaCanTopup: false,
    baseSurplusUsdc,
  };
}

/** Deployable Sepolia USDC after operating reserve (never negative). */
export function deployableToDeskUsdc(
  sepoliaUsdc: number,
  usdcOperatingReserve: number,
): number {
  if (!Number.isFinite(sepoliaUsdc) || !Number.isFinite(usdcOperatingReserve)) {
    return 0;
  }
  return Math.max(0, sepoliaUsdc - Math.max(0, usdcOperatingReserve));
}
