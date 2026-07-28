// Wagmi + RainbowKit config (browser-only; no secrets except public WalletConnect project id)

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createStorage, http } from "wagmi";
import { base, baseSepolia, type Chain } from "wagmi/chains";
import { resolveTargetChain } from "./chains.ts";

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

function resolveChains(): readonly [Chain, ...Chain[]] {
  const target = resolveTargetChain();
  // Preferred payment chain first so RainbowKit / switch defaults there.
  if (target.chainId === base.id) {
    return [base, baseSepolia];
  }
  return [baseSepolia, base];
}

function resolveTransports(): Record<number, ReturnType<typeof http>> {
  let sepoliaRpc = "https://sepolia.base.org";
  try {
    const envRpc = import.meta.env.VITE_X402_RPC_URL;
    if (typeof envRpc === "string" && envRpc.trim()) {
      sepoliaRpc = envRpc.trim();
    }
  } catch {
    // ignore
  }

  return {
    [baseSepolia.id]: http(sepoliaRpc),
    [base.id]: http("https://mainnet.base.org"),
  };
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
  transports: resolveTransports(),
  storage: walletStorage,
});

export const rainbowInitialChain = chains[0];
