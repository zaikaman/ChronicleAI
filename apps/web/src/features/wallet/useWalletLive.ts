// Live wallet implementation — must only be called under Wagmi + RainbowKit.
// App code should call `useWallet()` which reads WalletApiContext.

import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useDisconnect,
  useSignTypedData,
  useSwitchChain,
} from "wagmi";
import { isEvmAddress, resolveTargetChain } from "./chains.ts";
import { notifyWalletConnected } from "./connect-bridge.ts";
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
  const e = err as {
    code?: number | string;
    name?: string;
    shortMessage?: string;
    message?: string;
  };
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

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: InjectedProvider }).ethereum;
  if (!eth || typeof eth.request !== "function") return null;
  return eth;
}

/**
 * Direct EIP-3326 / EIP-3085 fallback when wagmi switchChain fails
 * (e.g. chain missing from wallet, or connector hiccup).
 * Returns "ok" | "rejected" | "unavailable".
 */
async function tryInjectedSwitchOrAdd(
  chain: WalletChainConfig,
): Promise<"ok" | "rejected" | "unavailable"> {
  const provider = getInjectedProvider();
  if (!provider) return "unavailable";

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainIdHex }],
    });
    return "ok";
  } catch (switchErr) {
    const code =
      switchErr && typeof switchErr === "object" && "code" in switchErr
        ? (switchErr as { code?: number | string }).code
        : undefined;

    if (code === 4001 || code === "ACTION_REJECTED") {
      return "rejected";
    }

    if (code === 4902 || code === -32603 || code === "Unrecognized chain ID") {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chain.chainIdHex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls.length > 0 ? chain.rpcUrls : undefined,
              blockExplorerUrls:
                chain.blockExplorerUrls.length > 0 ? chain.blockExplorerUrls : undefined,
            },
          ],
        });
        return "ok";
      } catch (addErr) {
        const addCode =
          addErr && typeof addErr === "object" && "code" in addErr
            ? (addErr as { code?: number | string }).code
            : undefined;
        if (addCode === 4001 || addCode === "ACTION_REJECTED") return "rejected";
        return "unavailable";
      }
    }

    return "unavailable";
  }
}

/**
 * Primary wallet API for ChronicleAI UI and x402 payment signing.
 * Must be used under WalletStack (Wagmi + RainbowKit).
 */
export function useWalletLive(): WalletContextValue {
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

  useEffect(() => {
    if (!address || !isEvmAddress(address)) return;
    // Resolve local connect() waiters
    if (pendingConnectRef.current) {
      const pending = pendingConnectRef.current;
      pendingConnectRef.current = null;
      clearTimeout(pending.timer);
      pending.resolve(address);
    }
    // Resolve stub-bridge waiters started before the wallet stack loaded
    notifyWalletConnected(address);
  }, [address]);

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
        return;
      } catch (switchErr) {
        const injected = await tryInjectedSwitchOrAdd(chain);
        if (injected === "ok") return;

        const msg = mapWalletError(
          switchErr,
          injected === "rejected"
            ? `Switch your wallet to ${chain.name} to continue.`
            : `Failed to switch to ${chain.name}. Open your wallet and select ${chain.name} (chain id ${chain.chainId}).`,
        );
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

      const { EIP712Domain: _ignored, ...restTypes } = typedData.types as Record<
        string,
        Array<{ name: string; type: string }>
      > & { EIP712Domain?: unknown };

      const domain = typedData.domain;
      const message = { ...typedData.message };

      for (const key of ["value", "validAfter", "validBefore", "chainId"] as const) {
        if (key in message && message[key] !== undefined && typeof message[key] !== "bigint") {
          try {
            message[key] = toBigIntish(message[key]);
          } catch {
            // leave as-is if not integer-like
          }
        }
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
