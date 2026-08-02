// Shared EVM chain labels and block-explorer URL builders.
// Used by alert LLM prompts, Telegram broadcasts, and UI chain badges.

import { CHAIN_ID_BASE_SEPOLIA, CHAIN_ID_SEPOLIA } from "./protocol-registry.ts";

export { CHAIN_ID_BASE_SEPOLIA, CHAIN_ID_SEPOLIA };

/** Well-known chain IDs used by ChronicleAI monitoring + registry writes. */
export const CHAIN_ID_ETHEREUM = 1;
export const CHAIN_ID_BASE = 8_453;

/** Primary chain observed by intelligence monitors and public products. */
export const PRIMARY_SIGNAL_CHAIN_ID = CHAIN_ID_ETHEREUM;

/** Active Chronicle execution/publication chain. */
export const ACTIVE_INTELLIGENCE_CHAIN_ID = CHAIN_ID_SEPOLIA;

/** Signal sources accepted by the ingestion boundary. */
export const ALLOWED_SIGNAL_CHAIN_IDS = [
  PRIMARY_SIGNAL_CHAIN_ID,
  ACTIVE_INTELLIGENCE_CHAIN_ID,
] as const;

/** @deprecated Mainnet is a supported signal source; use PRIMARY_SIGNAL_CHAIN_ID. */
export const LEGACY_INTELLIGENCE_CHAIN_ID = CHAIN_ID_ETHEREUM;

/** Product primary ops testnet — registry proofs, desk execution, capital plane. */
export const PRIMARY_TESTNET_CHAIN_ID = CHAIN_ID_SEPOLIA;

/** Human payment testnet — x402 + CDP facilitator (Base Sepolia). */
export const PAYMENT_TESTNET_CHAIN_ID = CHAIN_ID_BASE_SEPOLIA;

export function isActiveIntelligenceChain(chainId: number): boolean {
  return chainId === ACTIVE_INTELLIGENCE_CHAIN_ID;
}

export function isAllowedSignalSourceChain(chainId: number): boolean {
  return (ALLOWED_SIGNAL_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function isLegacyIntelligenceChain(chainId: number): boolean {
  return chainId === LEGACY_INTELLIGENCE_CHAIN_ID;
}

const CHAIN_LABELS: Readonly<Record<number, string>> = {
  [CHAIN_ID_ETHEREUM]: "Ethereum Mainnet",
  [CHAIN_ID_BASE]: "Base",
  [CHAIN_ID_BASE_SEPOLIA]: "Base Sepolia",
  [CHAIN_ID_SEPOLIA]: "Ethereum Sepolia",
};

const EXPLORER_ORIGINS: Readonly<Record<number, string>> = {
  [CHAIN_ID_ETHEREUM]: "https://etherscan.io",
  [CHAIN_ID_BASE]: "https://basescan.org",
  [CHAIN_ID_BASE_SEPOLIA]: "https://sepolia.basescan.org",
  [CHAIN_ID_SEPOLIA]: "https://sepolia.etherscan.io",
};

/** Human-readable chain name for prompts and UI (falls back to "Chain {id}"). */
export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
}

/** Block explorer origin for a chain, or null when unknown. */
export function explorerOrigin(chainId: number): string | null {
  return EXPLORER_ORIGINS[chainId] ?? null;
}

/** Transaction URL on the given chain's explorer, or null when unknown/invalid. */
export function txExplorerUrl(chainId: number, txHash: string): string | null {
  const origin = explorerOrigin(chainId);
  const hash = txHash.trim();
  if (!origin || !hash) return null;
  return `${origin}/tx/${hash}`;
}

/**
 * Infer a short registry-network label from a proof explorer URL.
 * Used when the Telegram body links the KeeperHub registry tx (Ethereum Sepolia)
 * while the alert narrative describes a different monitored source chain.
 */
export function registryNetworkLabelFromExplorerUrl(explorerUrl: string): string | null {
  const url = explorerUrl.toLowerCase();
  if (url.includes("sepolia.basescan.org")) return "Base Sepolia";
  if (url.includes("basescan.org")) return "Base";
  if (url.includes("sepolia.etherscan.io")) return "Ethereum Sepolia";
  if (url.includes("etherscan.io")) return "Ethereum Mainnet";
  return null;
}
