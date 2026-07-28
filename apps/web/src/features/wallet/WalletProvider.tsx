// Deferred wallet provider: RainbowKit/wagmi load only on demand.
// QueryClient stays at the app root (providers.tsx) for feature-hook caching.
// Must mount under the router (uses useLocation).

import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { resolveTargetChain } from "./chains.ts";
import { waitForWalletConnection } from "./connect-bridge.ts";
import type { WalletContextValue } from "./types.ts";

/** Routes that need wallet connectivity without an explicit Connect click. */
const WALLET_ROUTE_PREFIXES = ["/premium", "/affiliates"] as const;

const WALLET_STORAGE_PREFIX = "chronicleai.wallet";

type WalletStackModule = typeof import("./WalletStack.tsx");

export interface WalletBootstrapValue {
  /** True when Wagmi + RainbowKit are mounted. */
  isStackReady: boolean;
  /** True while the wallet chunk is downloading. */
  isStackLoading: boolean;
  /** Dynamically import and mount the wallet stack (idempotent). */
  ensureWalletStack: () => Promise<void>;
}

const WalletBootstrapContext = createContext<WalletBootstrapValue | null>(null);

/** Public API for wallet session — stub until stack loads, live after. */
export const WalletApiContext = createContext<WalletContextValue | null>(null);

export function useWalletBootstrap(): WalletBootstrapValue {
  const ctx = useContext(WalletBootstrapContext);
  if (!ctx) {
    throw new Error("useWalletBootstrap must be used within WalletProvider");
  }
  return ctx;
}

function pathNeedsWallet(pathname: string): boolean {
  return WALLET_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** True if wagmi previously persisted a connector session. */
export function hasStoredWalletSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(WALLET_STORAGE_PREFIX)) {
        const value = window.localStorage.getItem(key);
        if (value && value !== "null" && value !== "{}" && value !== "[]") {
          return true;
        }
      }
    }
  } catch {
    // private mode / blocked storage
  }
  return false;
}

function createStubWallet(ensureWalletStack: () => Promise<void>): WalletContextValue {
  const targetChain = resolveTargetChain();

  return {
    status: "disconnected",
    address: null,
    chainId: null,
    error: null,
    isAvailable: true,
    isConnected: false,
    isCorrectChain: false,
    targetChain,
    connect: async () => {
      const { markPendingOpenConnectModal } = await import("./WalletStack.tsx");
      markPendingOpenConnectModal();
      const waitPromise = waitForWalletConnection();
      await ensureWalletStack();
      return waitPromise;
    },
    openConnectModal: () => {
      void (async () => {
        const { markPendingOpenConnectModal } = await import("./WalletStack.tsx");
        markPendingOpenConnectModal();
        await ensureWalletStack();
      })();
    },
    openAccountModal: () => {
      // No-op until stack is ready
    },
    disconnect: () => {
      // No-op when disconnected stub
    },
    ensureChain: async () => {
      await ensureWalletStack();
    },
    signTypedData: async () => {
      throw new Error("Connect a wallet before signing.");
    },
    clearError: () => {
      // no-op
    },
  };
}

/**
 * Provides wallet API to the tree. Loads RainbowKit/wagmi only when:
 * - user is on /premium or /affiliates
 * - a prior session exists in localStorage
 * - ensureWalletStack() is called (Connect click / payment flow)
 */
export function WalletProvider({ children }: { children: ReactNode }): ReactElement {
  const location = useLocation();
  const [stackModule, setStackModule] = useState<WalletStackModule | null>(null);
  const [isStackLoading, setIsStackLoading] = useState(false);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const ensureWalletStack = useCallback(async () => {
    if (stackModule) return;
    if (loadPromiseRef.current) {
      await loadPromiseRef.current;
      return;
    }

    setIsStackLoading(true);
    const promise = import("./WalletStack.tsx")
      .then((mod) => {
        setStackModule(mod);
      })
      .finally(() => {
        setIsStackLoading(false);
        loadPromiseRef.current = null;
      });
    loadPromiseRef.current = promise;
    await promise;
  }, [stackModule]);

  // Eager-load on wallet routes or stored session (reconnect).
  useEffect(() => {
    if (stackModule) return;
    if (pathNeedsWallet(location.pathname) || hasStoredWalletSession()) {
      void ensureWalletStack();
    }
  }, [location.pathname, stackModule, ensureWalletStack]);

  const bootstrap = useMemo<WalletBootstrapValue>(
    () => ({
      isStackReady: stackModule !== null,
      isStackLoading,
      ensureWalletStack,
    }),
    [stackModule, isStackLoading, ensureWalletStack],
  );

  const stubWallet = useMemo(
    () => createStubWallet(ensureWalletStack),
    [ensureWalletStack],
  );

  if (!stackModule) {
    return (
      <WalletBootstrapContext.Provider value={bootstrap}>
        <WalletApiContext.Provider value={stubWallet}>
          {children}
        </WalletApiContext.Provider>
      </WalletBootstrapContext.Provider>
    );
  }

  const { WalletStack, useLiveWalletContext } = stackModule;

  return (
    <WalletBootstrapContext.Provider value={bootstrap}>
      <WalletStack>
        <LiveWalletApiBridge useLiveWalletContext={useLiveWalletContext} fallback={stubWallet}>
          {children}
        </LiveWalletApiBridge>
      </WalletStack>
    </WalletBootstrapContext.Provider>
  );
}

/**
 * Reads live wallet from WalletStack and re-exports on WalletApiContext
 * so useWallet() is a single stable hook regardless of stack state.
 */
function LiveWalletApiBridge({
  children,
  useLiveWalletContext,
  fallback,
}: {
  children: ReactNode;
  useLiveWalletContext: () => WalletContextValue | null;
  fallback: WalletContextValue;
}): ReactElement {
  const live = useLiveWalletContext();
  return (
    <WalletApiContext.Provider value={live ?? fallback}>
      {children}
    </WalletApiContext.Provider>
  );
}
