// Eager wallet stack: Wagmi + RainbowKit + live useWallet bridge.
// Dynamically imported only when connect/payment flows need it (see WalletProvider).

import { useTheme } from "@/components/theme-provider";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
  type Theme,
} from "@rainbow-me/rainbowkit";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { WagmiProvider } from "wagmi";
import { rainbowInitialChain, wagmiConfig } from "./wagmi-config.ts";
import { useWalletLive } from "./useWalletLive.ts";
import type { WalletContextValue } from "./types.ts";

import "@rainbow-me/rainbowkit/styles.css";

/** Set before loading the stack so the connect modal opens once RainbowKit mounts. */
export let pendingOpenConnectModal = false;

export function markPendingOpenConnectModal(): void {
  pendingOpenConnectModal = true;
}

function buildRainbowTheme(mode: "dark" | "light"): Theme {
  const base = mode === "dark" ? darkTheme : lightTheme;
  return base({
    accentColor: "#a8d946",
    accentColorForeground: "#0a0a0a",
    borderRadius: "large",
    fontStack: "system",
    overlayBlur: "small",
  });
}

function RainbowKitThemed({ children }: { children: ReactNode }): ReactElement {
  const { resolvedTheme } = useTheme();
  const theme = useMemo(
    () => buildRainbowTheme(resolvedTheme === "light" ? "light" : "dark"),
    [resolvedTheme],
  );

  return (
    <RainbowKitProvider
      theme={theme}
      modalSize="compact"
      initialChain={rainbowInitialChain}
      appInfo={{
        appName: "ChronicleAI",
        learnMoreUrl: "https://docs.keeperhub.com/ai-tools/agentic-wallet",
      }}
      coolMode={false}
    >
      {children}
    </RainbowKitProvider>
  );
}

const LiveWalletContext = createContext<WalletContextValue | null>(null);

/**
 * Bridges live wagmi/RainbowKit state into LiveWalletContext.
 * Opens the connect modal once if the user clicked Connect before the stack loaded.
 */
function LiveWalletBridge({ children }: { children: ReactNode }): ReactElement {
  const wallet = useWalletLive();

  useEffect(() => {
    if (!pendingOpenConnectModal) return;
    pendingOpenConnectModal = false;
    const id = window.setTimeout(() => {
      wallet.openConnectModal();
    }, 50);
    return () => window.clearTimeout(id);
  }, [wallet]);

  return (
    <LiveWalletContext.Provider value={wallet}>{children}</LiveWalletContext.Provider>
  );
}

export function useLiveWalletContext(): WalletContextValue | null {
  return useContext(LiveWalletContext);
}

/**
 * Full web3 provider tree. Must only be mounted after dynamic import.
 * QueryClientProvider lives higher (providers.tsx) — do not nest another here.
 */
export function WalletStack({ children }: { children: ReactNode }): ReactElement {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <RainbowKitThemed>
        <LiveWalletBridge>{children}</LiveWalletBridge>
      </RainbowKitThemed>
    </WagmiProvider>
  );
}
