/** Shared receipt for every material on-chain write. */

export interface OnChainWriteReceipt {
  txHash: string;
  /** KeeperHub execution / run id when written via KeeperHub. */
  keeperHubRunId?: string;
  /** Block explorer URL for the transaction. */
  explorerUrl?: string;
  /**
   * Gas units consumed by the registry (or transfer) transaction.
   * Decimal string to preserve bigint precision from RPC / KeeperHub.
   * IDEA demo field: "Gas used".
   */
  gasUsed?: string;
  /**
   * Total gas cost in wei when available (KeeperHub web3 steps report cost as
   * gasUsed = units × price; we keep units in `gasUsed` and cost here).
   */
  gasUsedWei?: string;
}

export interface SponsoredWatchWriteReceipt extends OnChainWriteReceipt {
  watchId: number;
}

/** Normalize gas unit / wei values from ethers BigInt, number, or numeric string. */
export function normalizeGasValue(value: unknown): string | undefined {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Extract gas units + optional wei cost from a KeeperHub status/result payload.
 * Prefers explicit `gasUsedUnits` for units; treats lone `gasUsed` as cost-in-wei
 * when `gasUsedUnits` is present, otherwise as units (ethers-style).
 */
export function extractGasFromKeeperHubPayload(payload: unknown): {
  gasUsed?: string;
  gasUsedWei?: string;
} {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const nested =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : record.output && typeof record.output === "object"
        ? (record.output as Record<string, unknown>)
        : null;

  const sources = [record, nested].filter(Boolean) as Array<Record<string, unknown>>;

  let gasUsed: string | undefined;
  let gasUsedWei: string | undefined;

  for (const src of sources) {
    const units = normalizeGasValue(src.gasUsedUnits);
    const used = normalizeGasValue(src.gasUsed);
    const usedWei = normalizeGasValue(src.gasUsedWei);

    if (units && !gasUsed) {
      gasUsed = units;
    }
    if (usedWei && !gasUsedWei) {
      gasUsedWei = usedWei;
    }
    // KeeperHub web3 steps: gasUsed = total cost in wei, gasUsedUnits = units.
    if (units && used && !gasUsedWei) {
      gasUsedWei = used;
    }
    // Direct / ethers-style: only gasUsed present → treat as units.
    if (!units && used && !gasUsed) {
      gasUsed = used;
    }
    // Top-level run total cost only.
    if (!units && usedWei && !gasUsed && !used) {
      gasUsedWei = usedWei;
    }
  }

  const out: { gasUsed?: string; gasUsedWei?: string } = {};
  if (gasUsed) out.gasUsed = gasUsed;
  if (gasUsedWei) out.gasUsedWei = gasUsedWei;
  return out;
}
