// RainbowKit + wagmi wallet providers.
// Session is persisted (localStorage) and reconnected on mount — production default.

import { useTheme } from "@/components/theme-provider";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
  type Theme,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { rainbowInitialChain, wagmiConfig } from "./wagmi-config.ts";

import "@rainbow-me/rainbowkit/styles.css";

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

// Module-level QueryClient so route / StrictMode remounts do not wipe cache mid-session.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * App wallet stack: Wagmi → React Query → RainbowKit.
 *
 * `reconnectOnMount` (default true) restores the last connected wallet from
 * localStorage (`chronicleai.wallet.*`). Users still must connect explicitly
 * the first time; after that, navigation and reloads keep them connected.
 * Disconnect clears storage via RainbowKit / wagmi disconnect.
 */
export function WalletProvider({ children }: { children: ReactNode }): ReactElement {
  // useState keeps the same client reference if this component remounts in the same session
  // while the module-level client is the real source of truth across HMR-ish remounts.
  const [client] = useState(() => queryClient);

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={client}>
        <RainbowKitThemed>{children}</RainbowKitThemed>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
