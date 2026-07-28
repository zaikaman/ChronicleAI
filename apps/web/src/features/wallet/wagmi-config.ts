// Wagmi + RainbowKit config (browser-only; no secrets except public WalletConnect project id)
// Payment rail is Base Sepolia (x402 / CDP) — that chain is the only configured network
// so wallets on any other network are treated as unsupported and must switch.
// Registry / desk proofs still use Ethereum Sepolia explorers (lib/explorer.ts).

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createStorage, http, type Transport } from "wagmi";
import { base, baseSepolia, type Chain, sepolia } from "wagmi/chains";
import { BASE_SEPOLIA_CHAIN_ID, resolveTargetChain, SEPOLIA_CHAIN_ID } from "./chains.ts";

/**
 * Persist connector + account under a ChronicleAI-specific key.
 * wagmi reconnects from this on mount (production standard — not a custom hack).
 */
const walletStorage = createStorage({
  key: "chronicleai.wallet",
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
});

/**
 * WalletConnect Cloud project id (public). Required for WalletConnect / mobile
 * wallets in the RainbowKit modal. Injected wallets (MetaMask, etc.) still work
 * without a real id. Get a free id at https://cloud.reown.com
 */
function resolveWalletConnectProjectId(): string {
  try {
    const fromEnv = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    if (typeof fromEnv === "string" && fromEnv.trim().length >= 8) {
      return fromEnv.trim();
    }
  } catch {
    // import.meta.env only in Vite
  }
  // Placeholder so the app boots without env; WC QR path will fail until configured.
  return "00000000000000000000000000000000";
}

function withRpcOverride(chain: Chain, rpcUrl: string | undefined): Chain {
  if (!rpcUrl?.trim()) return chain;
  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: { http: [rpcUrl.trim()] },
    },
  };
}

function resolvePreferredRpc(): string | undefined {
  try {
    const envRpc = import.meta.env.VITE_X402_RPC_URL;
    if (typeof envRpc === "string" && envRpc.trim()) {
      return envRpc.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Map app target chain id → wagmi Chain definition.
 * Defaults to Base Sepolia (x402 payment rail). Desk/registry stay on Ethereum Sepolia.
 */
function chainDefinitionForId(chainId: number, rpcUrl: string | undefined): Chain {
  if (chainId === baseSepolia.id || chainId === BASE_SEPOLIA_CHAIN_ID) {
    return withRpcOverride(baseSepolia, rpcUrl ?? "https://sepolia.base.org");
  }
  if (chainId === sepolia.id || chainId === SEPOLIA_CHAIN_ID) {
    return withRpcOverride(
      {
        ...sepolia,
        name: "Ethereum Sepolia",
      },
      rpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com",
    );
  }
  if (chainId === base.id) {
    return withRpcOverride(base, rpcUrl ?? "https://mainnet.base.org");
  }

  // Unknown env override: synthesize a minimal chain so switch/add still works.
  const target = resolveTargetChain();
  return {
    id: chainId,
    name: target.name,
    nativeCurrency: target.nativeCurrency,
    rpcUrls: {
      default: {
        http:
          target.rpcUrls.length > 0
            ? target.rpcUrls
            : rpcUrl
              ? [rpcUrl]
              : ["https://sepolia.base.org"],
      },
    },
    blockExplorers:
      target.blockExplorerUrls[0] != null
        ? {
            default: {
              name: target.name,
              url: target.blockExplorerUrls[0],
            },
          }
        : undefined,
    testnet: true,
  } satisfies Chain;
}

/**
 * Only the payment/target chain is configured.
 * Any other network is "unsupported" in RainbowKit → Wrong network UI,
 * and switchChainAsync can target exactly one required chain.
 */
function resolveChains(): readonly [Chain, ...Chain[]] {
  const target = resolveTargetChain();
  const rpcUrl = resolvePreferredRpc();
  return [chainDefinitionForId(target.chainId, rpcUrl)];
}

function resolveTransports(chains: readonly [Chain, ...Chain[]]): Record<number, Transport> {
  const transports: Record<number, Transport> = {};
  for (const chain of chains) {
    const rpc = chain.rpcUrls.default.http[0];
    transports[chain.id] = http(rpc);
  }
  return transports;
}

const chains = resolveChains();

/**
 * Shared wagmi config for ChronicleAI.
 * Session is persisted to localStorage; WagmiProvider reconnects on load.
 * First-time visitors still see "Connect wallet" until they connect once.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "ChronicleAI",
  projectId: resolveWalletConnectProjectId(),
  chains,
  ssr: false,
  transports: resolveTransports(chains),
  storage: walletStorage,
});

export const rainbowInitialChain = chains[0];
