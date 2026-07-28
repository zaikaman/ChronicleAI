/**
 * Block explorer helpers.
 *
 * Dual-rail:
 * - Registry / desk / trade tickets → Ethereum Sepolia (sepoliaTxUrl)
 * - x402 payment settlements → Base Sepolia (baseSepoliaTxUrl)
 * Monitored source events may be on other chains — use txExplorerUrl(chainId, hash).
 */

// Import chains subpath so the web bundle does not pull server-env.
import {
  chainLabel,
  explorerOrigin,
  txExplorerUrl as sharedTxExplorerUrl,
} from "@chronicleai/config/chains";

const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";
const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";
/** Flashbots Protect transaction status (Sepolia desk rail). */
const FLASHBOTS_PROTECT_SEPOLIA_STATUS_BASE =
  "https://protect-sepolia.flashbots.net/tx";

/** Registry / desk proof tx URL (Ethereum Sepolia). */
export function sepoliaTxUrl(txHash: string): string {
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`;
}

/**
 * Flashbots Protect status page for a Sepolia tx hash.
 * Returns null when the hash is not a 32-byte hex tx id.
 */
export function flashbotsProtectStatusUrl(txHash: string): string | null {
  const hash = txHash?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  return `${FLASHBOTS_PROTECT_SEPOLIA_STATUS_BASE}/${hash}`;
}

/** Registry / desk address URL (Ethereum Sepolia). */
export function sepoliaAddressUrl(address: string): string {
  return `${SEPOLIA_EXPLORER}/address/${address}`;
}

/** x402 payment settlement tx URL (Base Sepolia). */
export function baseSepoliaTxUrl(txHash: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/tx/${txHash}`;
}

/** x402 payment settlement address URL (Base Sepolia). */
export function baseSepoliaAddressUrl(address: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/address/${address}`;
}

/** Human-readable chain name for badges (e.g. "Ethereum Mainnet", "Base Sepolia"). */
export { chainLabel };

/** Explorer origin for a known chain id, or null. */
export { explorerOrigin };

/** Source-event (or any chain) tx explorer URL; null when chain is unknown. */
export function txExplorerUrl(chainId: number, txHash: string): string | null {
  return sharedTxExplorerUrl(chainId, txHash);
}

export function truncateHash(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Format gas units (decimal string) for display, e.g. "91,234 gas". */
export function formatGasUsed(gasUsed: string | number | undefined | null): string | null {
  if (gasUsed === undefined || gasUsed === null || gasUsed === "") return null;
  try {
    const asBig = typeof gasUsed === "number" ? BigInt(Math.trunc(gasUsed)) : BigInt(gasUsed);
    return `${asBig.toLocaleString("en-US")} gas`;
  } catch {
    return `${String(gasUsed)} gas`;
  }
}
