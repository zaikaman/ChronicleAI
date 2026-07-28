// App-facing wallet hook. Always reads WalletApiContext (stub or live).
// Never imports wagmi/RainbowKit so the main bundle stays free of the web3 stack.

import { useContext } from "react";
import { WalletApiContext } from "./WalletProvider.tsx";
import type { WalletContextValue } from "./types.ts";

/**
 * Primary wallet API for ChronicleAI UI and x402 payment signing.
 * Must be used under WalletProvider. Before the wallet stack loads, returns a
 * disconnected stub that loads RainbowKit/wagmi on connect.
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletApiContext);
  if (!ctx) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return ctx;
}
