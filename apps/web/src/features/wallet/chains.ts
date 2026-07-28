// Public chain config for x402 payments (browser-safe; no secrets).
// Defaults match server x402 defaults (Base Sepolia payment rail).
// Registry / desk explorers remain on Ethereum Sepolia via lib/explorer.ts.

import type { WalletChainConfig } from "./types.ts";

/** Base Sepolia — default x402 payment rail (CDP facilitator). */
export const BASE_SEPOLIA_CHAIN_ID = 84_532;

/** Ethereum Sepolia — desk / registry / capital ops (not the default payment chain). */
export const SEPOLIA_CHAIN_ID = 11_155_111;

const KNOWN_CHAINS: Record<number, Omit<WalletChainConfig, "chainId" | "chainIdHex">> = {
  // Base Sepolia — human premium payments (x402)
  84_532: {
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
  // Ethereum Sepolia — desk / registry (not payment default)
  11_155_111: {
    name: "Ethereum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
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
 * Defaults to Base Sepolia to match server X402 defaults (CDP payment rail).
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

/** Lookup known chain metadata for challenge-domain switches. */
export function knownChainConfig(chainId: number): WalletChainConfig | null {
  const known = KNOWN_CHAINS[chainId];
  if (!known) return null;
  return {
    chainId,
    chainIdHex: toHexChainId(chainId),
    ...known,
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
