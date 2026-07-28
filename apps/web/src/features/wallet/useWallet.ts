// App-facing wallet hook on top of wagmi + RainbowKit connect modal

import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useDisconnect,
  useSignTypedData,
  useSwitchChain,
} from "wagmi";
import { isEvmAddress, resolveTargetChain } from "./chains.ts";
import type { WalletChainConfig, WalletContextValue, WalletStatus } from "./types.ts";

const CONNECT_TIMEOUT_MS = 120_000;

function mapAccountStatus(
  status: "connected" | "reconnecting" | "connecting" | "disconnected",
  hasAddress: boolean,
): WalletStatus {
  if (status === "connected" && hasAddress) return "connected";
  if (status === "connecting") return "connecting";
  if (status === "reconnecting") return "reconnecting";
  return "disconnected";
}

function mapWalletError(err: unknown, fallback: string): string {
  if (!err || typeof err !== "object") {
    return err instanceof Error ? err.message : fallback;
  }
  const e = err as { code?: number | string; name?: string; shortMessage?: string; message?: string };
  if (e.code === 4001 || e.code === "ACTION_REJECTED" || e.name === "UserRejectedRequestError") {
    return "Wallet request was rejected.";
  }
  if (typeof e.shortMessage === "string" && e.shortMessage.trim()) return e.shortMessage;
  if (typeof e.message === "string" && e.message.trim()) return e.message;
  return fallback;
}

function toBigIntish(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return BigInt(value.trim());
  throw new Error(`Invalid integer value for typed data: ${String(value)}`);
}

/**
 * Primary wallet API for ChronicleAI UI and x402 payment signing.
 * Must be used under WalletProvider (Wagmi + RainbowKit).
 */
export function useWallet(): WalletContextValue {
  const targetChain = useMemo(() => resolveTargetChain(), []);
  const { address, isConnected, chainId, status: accountStatus } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();

  const [error, setError] = useState<string | null>(null);
  const pendingConnectRef = useRef<{
    resolve: (address: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Resolve waiters when the user finishes connecting via the modal
  useEffect(() => {
    if (!address || !isEvmAddress(address) || !pendingConnectRef.current) return;
    const pending = pendingConnectRef.current;
    pendingConnectRef.current = null;
    clearTimeout(pending.timer);
    pending.resolve(address);
  }, [address]);

  // If the user closes the modal without connecting, we only time out —
  // RainbowKit does not expose a reliable "dismissed" event.

  const openConnectModalFn = useCallback(() => {
    clearError();
    if (!openConnectModal) {
      setError("Connect modal is not available. Refresh the page and try again.");
      return;
    }
    openConnectModal();
  }, [openConnectModal, clearError]);

  const openAccountModalFn = useCallback(() => {
    openAccountModal?.();
  }, [openAccountModal]);

  const connect = useCallback(async (): Promise<string> => {
    clearError();
    if (address && isEvmAddress(address) && isConnected) {
      return address;
    }
    if (!openConnectModal) {
      const msg = "Connect modal is not available. Refresh the page and try again.";
      setError(msg);
      throw new Error(msg);
    }

    // Cancel any previous waiter
    if (pendingConnectRef.current) {
      clearTimeout(pendingConnectRef.current.timer);
      pendingConnectRef.current.reject(new Error("Connection superseded by a new request."));
      pendingConnectRef.current = null;
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingConnectRef.current) {
          pendingConnectRef.current = null;
          const msg = "Wallet connection timed out. Open Connect wallet and try again.";
          setError(msg);
          reject(new Error(msg));
        }
      }, CONNECT_TIMEOUT_MS);

      pendingConnectRef.current = {
        resolve: (addr) => {
          clearTimeout(timer);
          resolve(addr);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      };

      try {
        openConnectModal();
      } catch (err) {
        pendingConnectRef.current = null;
        clearTimeout(timer);
        const msg = mapWalletError(err, "Failed to open connect modal.");
        setError(msg);
        reject(new Error(msg));
      }
    });
  }, [address, isConnected, openConnectModal, clearError]);

  const disconnect = useCallback(() => {
    clearError();
    if (pendingConnectRef.current) {
      clearTimeout(pendingConnectRef.current.timer);
      pendingConnectRef.current.reject(new Error("Disconnected."));
      pendingConnectRef.current = null;
    }
    wagmiDisconnect();
  }, [wagmiDisconnect, clearError]);

  const ensureChain = useCallback(
    async (chain: WalletChainConfig = targetChain): Promise<void> => {
      clearError();
      if (chainId === chain.chainId) return;
      try {
        await switchChainAsync({ chainId: chain.chainId });
      } catch (err) {
        const msg = mapWalletError(err, `Failed to switch to ${chain.name}.`);
        setError(msg);
        throw new Error(msg);
      }
    },
    [chainId, switchChainAsync, targetChain, clearError],
  );

  const signTypedData = useCallback(
    async (typedData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<string> => {
      clearError();
      if (!address) {
        const msg = "Connect a wallet before signing.";
        setError(msg);
        throw new Error(msg);
      }

      // viem adds EIP712Domain — strip if callers included it (raw eth_signTypedData_v4 style)
      const { EIP712Domain: _ignored, ...restTypes } = typedData.types as Record<
        string,
        Array<{ name: string; type: string }>
      > & { EIP712Domain?: unknown };

      const domain = typedData.domain;
      const message = { ...typedData.message };

      // Coerce common numeric EIP-712 fields to bigint for viem
      for (const key of ["value", "validAfter", "validBefore", "chainId"] as const) {
        if (key in message && message[key] !== undefined && typeof message[key] !== "bigint") {
          try {
            message[key] = toBigIntish(message[key]);
          } catch {
            // leave as-is if not integer-like
          }
        }
      }
      if (
        domain.chainId !== undefined &&
        typeof domain.chainId !== "bigint" &&
        typeof domain.chainId !== "number"
      ) {
        // domain.chainId as number is preferred by viem
      }

      try {
        const signature = await signTypedDataAsync({
          domain: {
            name: String(domain.name ?? ""),
            version: String(domain.version ?? "1"),
            chainId: Number(domain.chainId),
            verifyingContract: domain.verifyingContract as `0x${string}`,
          },
          types: restTypes,
          primaryType: typedData.primaryType,
          message,
        });
        return signature;
      } catch (err) {
        const msg = mapWalletError(err, "Failed to sign typed data.");
        setError(msg);
        throw new Error(msg);
      }
    },
    [address, signTypedDataAsync, clearError],
  );

  return {
    status: mapAccountStatus(accountStatus, !!address),
    address: address ?? null,
    chainId: chainId ?? null,
    error,
    // Browser always "available" for RainbowKit modal (inject + WC + coinbase, etc.)
    isAvailable: true,
    isConnected: isConnected && !!address,
    isCorrectChain: chainId === targetChain.chainId,
    targetChain,
    connect,
    openConnectModal: openConnectModalFn,
    openAccountModal: openAccountModalFn,
    disconnect,
    ensureChain,
    signTypedData,
    clearError,
  };
}
