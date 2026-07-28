// Shared viem chain resolution for multi-chain RPC clients.

import { defineChain, type Chain } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

const KNOWN: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
};

/**
 * Resolve a viem Chain for a numeric chainId.
 * Known product chains are preferred; otherwise a minimal defineChain stub is used
 * (sufficient for eth_call / balance / receipt reads when RPC URL is explicit).
 */
export function chainFromId(chainId: number): Chain {
  const known = KNOWN[chainId];
  if (known) return known;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["http://localhost"] },
    },
  });
}
