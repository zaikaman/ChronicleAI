// Public chain config for x402 payments (browser-safe; no secrets).
// Defaults match server x402 defaults (Base Sepolia) so local demos work out of the box.

import type { WalletChainConfig } from "./types.ts";

/** Base Sepolia — default hackathon / demo target for x402. */
export const BASE_SEPOLIA_CHAIN_ID = 84_532;

const KNOWN_CHAINS: Record<number, Omit<WalletChainConfig, "chainId" | "chainIdHex">> = {
  // Base Sepolia
  84_532: {
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
  // Base mainnet
  8453: {
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
};

function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/**
 * Resolve the payment/target chain for the web app from public Vite env.
 * Defaults to Base Sepolia to match server X402 defaults.
 */
export function resolveTargetChain(): WalletChainConfig {
  let chainId = BASE_SEPOLIA_CHAIN_ID;
  let rpcUrl: string | undefined;

  try {
    chainId = parsePositiveInt(import.meta.env.VITE_X402_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID);
    const envRpc = import.meta.env.VITE_X402_RPC_URL;
    if (typeof envRpc === "string" && envRpc.trim()) {
      rpcUrl = envRpc.trim();
    }
  } catch {
    // import.meta.env only in Vite
  }

  const known = KNOWN_CHAINS[chainId];
  const base: Omit<WalletChainConfig, "chainId" | "chainIdHex"> = known ?? {
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: rpcUrl ? [rpcUrl] : [],
    blockExplorerUrls: [],
  };

  const rpcUrls =
    rpcUrl && !base.rpcUrls.includes(rpcUrl) ? [rpcUrl, ...base.rpcUrls] : base.rpcUrls;

  return {
    chainId,
    chainIdHex: toHexChainId(chainId),
    name: base.name,
    nativeCurrency: base.nativeCurrency,
    rpcUrls,
    blockExplorerUrls: base.blockExplorerUrls,
  };
}

export function shortenAddress(address: string, chars = 4): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function isEvmAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
