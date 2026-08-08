// Chronicle Pass web hook — wallet-authenticated subscription management.
// Auth: challenge → signMessage → verify (HttpOnly session cookie).
// Data: session, status, payment history. Actions: prefs, cancel, resume, renew/settle.

import type {
  ChroniclePassPaymentHistoryItem,
  ChroniclePassRenewResponse,
  ChroniclePassStatusResponse,
  SubscriptionSessionResponse,
} from "@chronicleai/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, fetchWithTimeout, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { isEvmAddress, signX402Settlement, useWallet } from "../wallet";

/** Display default; the server is authoritative for challenge amounts. */
export const CHRONICLE_PASS_PRICE_USDC = 4.99;

export type SubscriptionActionStatus = "idle" | "running" | "success" | "error";

export interface SubscriptionActionResult {
  status: SubscriptionActionStatus;
  message: string | null;
}

export interface UseSubscriptionResult {
  session: SubscriptionSessionResponse | null;
  isSessionLoading: boolean;
  isAuthenticated: boolean;
  walletAddress: string | null;
  status: ChroniclePassStatusResponse | null;
  isStatusLoading: boolean;
  statusError: string | null;
  payments: ChroniclePassPaymentHistoryItem[];
  isPaymentsLoading: boolean;
  authenticate: () => Promise<SubscriptionActionResult>;
  logout: () => Promise<void>;
  refresh: () => void;
  updatePreferences: (input: {
    email?: string;
    receivesDigests?: boolean;
    receivesAlerts?: boolean;
  }) => Promise<SubscriptionActionResult>;
  cancel: () => Promise<SubscriptionActionResult>;
  resume: () => Promise<SubscriptionActionResult>;
  renew: () => Promise<SubscriptionActionResult>;
  settleRenewal: (input: {
    challengeReference: string;
    settlementReference: string;
  }) => Promise<SubscriptionActionResult>;
  subscribe: (email: string) => Promise<SubscriptionActionResult>;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(apiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return body;
}

export function useSubscription(): UseSubscriptionResult {
  const wallet = useWallet();
  // Always read the latest wallet context (stub → live) from a ref so async
  // closures created before the wallet stack loads can still sign afterwards.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SubscriptionSessionResponse | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [authenticatedWallet, setAuthenticatedWallet] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  // Guards the wallet-mismatch re-check so loadSession (which sets a fresh
  // session object) can never trigger the effect in a loop.
  const lastWalletCheckedRef = useRef<string | null>(null);

  const loadSession = useCallback(async () => {
    setIsSessionLoading(true);
    try {
      const result = await requestJson<SubscriptionSessionResponse>("/subscriptions/auth/session");
      setSession(result);
      setAuthenticatedWallet(result.authenticated ? (result.wallet?.toLowerCase() ?? null) : null);
      return result;
    } catch {
      setSession({ authenticated: false, wallet: null, expiresAt: null });
      setAuthenticatedWallet(null);
      return { authenticated: false, wallet: null, expiresAt: null } as const;
    } finally {
      setIsSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Session expires (or wallet switches) → re-check and invalidate cached data.
  useEffect(() => {
    if (!session?.authenticated) return;
    const connected = wallet.address?.toLowerCase() ?? null;
    if (!connected) {
      lastWalletCheckedRef.current = null;
      return;
    }
    if (!authenticatedWallet || connected === authenticatedWallet) return;
    if (lastWalletCheckedRef.current === connected) return;
    lastWalletCheckedRef.current = connected;
    void loadSession();
  }, [wallet.address, session, authenticatedWallet, loadSession]);

  const sessionQuery = useQuery({
    queryKey: queryKeys.subscription.session,
    queryFn: loadSession,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const isAuthenticated =
    sessionQuery.data?.authenticated === true || session?.authenticated === true;

  const statusQuery = useQuery({
    queryKey: queryKeys.subscription.status(authenticatedWallet),
    queryFn: () => requestJson<ChroniclePassStatusResponse>("/subscriptions/me"),
    enabled: isAuthenticated,
    staleTime: 15_000,
  });

  const paymentsQuery = useQuery({
    queryKey: queryKeys.subscription.payments(authenticatedWallet),
    queryFn: () =>
      requestJson<{ items: ChroniclePassPaymentHistoryItem[] }>(
        "/subscriptions/me/payments?limit=20",
      ),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    void loadSession();
    void queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all });
  }, [loadSession, queryClient]);

  const authenticate = useCallback(async (): Promise<SubscriptionActionResult> => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      let address =
        walletRef.current.address && isEvmAddress(walletRef.current.address)
          ? walletRef.current.address
          : null;
      if (!address) {
        const connected = await walletRef.current.connect();
        if (!isEvmAddress(connected)) {
          return { status: "error", message: "Wallet connection was rejected or failed." };
        }
        address = connected;
      }

      const challenge = await requestJson<{
        nonce: string;
        message: string;
        chainId: number;
      }>("/subscriptions/auth/challenge", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ wallet: address }),
      });

      // walletRef.current is re-read here: after connect() resolves, the wallet
      // stack has mounted and the ref now points at the live (signing) wallet.
      const signature = await walletRef.current.signMessage(challenge.message);

      await requestJson<SubscriptionSessionResponse>("/subscriptions/auth/verify", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          wallet: address,
          nonce: challenge.nonce,
          message: challenge.message,
          signature,
          chainId: challenge.chainId,
        }),
      });

      setAuthenticatedWallet(address.toLowerCase());
      // Success is only real when the session cookie round-trips: the server
      // accepted the signature, but a blocked / cross-site cookie would still
      // leave the gate stuck — surface that instead of a fake success.
      const sessionResult = await loadSession();
      if (sessionResult.authenticated !== true) {
        return {
          status: "error",
          message:
            "Your wallet signed in, but the session could not be confirmed. Make sure cookies are enabled for this site, then try again.",
        };
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all });
      return { status: "success", message: null };
    } catch (err) {
      return {
        status: "error",
        message: toErrorMessage(err, "Wallet sign-in failed. Please try again."),
      };
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, [loadSession, queryClient]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await requestJson<SubscriptionSessionResponse>("/subscriptions/auth/logout", {
        method: "POST",
      });
    } catch {
      // Session may already be gone — clear local state regardless.
    }
    setSession({ authenticated: false, wallet: null, expiresAt: null });
    setAuthenticatedWallet(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all });
  }, [queryClient]);

  const updatePreferences = useCallback(
    async (input: {
      email?: string;
      receivesDigests?: boolean;
      receivesAlerts?: boolean;
    }): Promise<SubscriptionActionResult> => {
      try {
        await requestJson<ChroniclePassStatusResponse>("/subscriptions/me", {
          method: "PATCH",
          body: JSON.stringify(input),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.subscription.status(authenticatedWallet),
        });
        return { status: "success", message: "Delivery preferences updated." };
      } catch (err) {
        return {
          status: "error",
          message: toErrorMessage(err, "Could not update preferences."),
        };
      }
    },
    [authenticatedWallet, queryClient],
  );

  const cancel = useCallback(async (): Promise<SubscriptionActionResult> => {
    try {
      await requestJson<ChroniclePassStatusResponse>("/subscriptions/me/cancel", {
        method: "POST",
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.subscription.status(authenticatedWallet),
      });
      return {
        status: "success",
        message:
          "Cancellation scheduled for the end of your current period. You keep access until then.",
      };
    } catch (err) {
      return {
        status: "error",
        message: toErrorMessage(err, "Could not cancel the subscription."),
      };
    }
  }, [authenticatedWallet, queryClient]);

  const resume = useCallback(async (): Promise<SubscriptionActionResult> => {
    try {
      await requestJson<ChroniclePassStatusResponse>("/subscriptions/me/resume", {
        method: "POST",
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.subscription.status(authenticatedWallet),
      });
      return { status: "success", message: "Subscription resumed — renewals will continue." };
    } catch (err) {
      return {
        status: "error",
        message: toErrorMessage(err, "Could not resume the subscription."),
      };
    }
  }, [authenticatedWallet, queryClient]);

  /**
   * Renew flow: issue a wallet-authorized x402 challenge and sign it.
   * Returns the challenge + signature so the page can call settleRenewal
   * after wallet confirmation (no silent automatic charges).
   */
  const renew = useCallback(async (): Promise<SubscriptionActionResult> => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const challenge = await requestJson<ChroniclePassRenewResponse>("/subscriptions/me/renew", {
        method: "POST",
        signal: controller.signal,
      });
      const nestedChallenge = challenge.challengeData;
      if (!nestedChallenge?.domain || !nestedChallenge.types || !nestedChallenge.message) {
        return { status: "error", message: "Server returned an incomplete renewal challenge." };
      }

      await walletRef.current.ensureChain();
      const settlementReference = await signX402Settlement(nestedChallenge, walletRef.current);

      const settleResult = await requestJson<{ settled: boolean; error?: string }>(
        "/subscriptions/me/settle",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            challengeReference: challenge.challengeReference,
            settlementReference,
          }),
        },
      );
      if (!settleResult.settled) {
        return { status: "error", message: settleResult.error ?? "Renewal settlement failed." };
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all });
      const periodDays = statusQuery.data?.billingPeriodDays ?? 30;
      return {
        status: "success",
        message: `Renewed — your next period is active through ${new Date(
          Date.now() + periodDays * 24 * 60 * 60 * 1000,
        ).toLocaleDateString()}.`,
      };
    } catch (err) {
      return {
        status: "error",
        message: toErrorMessage(err, "Renewal failed. Please try again."),
      };
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, [queryClient, statusQuery.data]);

  const settleRenewal = useCallback(
    async (input: {
      challengeReference: string;
      settlementReference: string;
    }): Promise<SubscriptionActionResult> => {
      try {
        await requestJson<{ settled: boolean; error?: string }>("/subscriptions/me/settle", {
          method: "POST",
          body: JSON.stringify(input),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all });
        return { status: "success", message: "Renewal period activated." };
      } catch (err) {
        return { status: "error", message: toErrorMessage(err, "Settlement failed.") };
      }
    },
    [queryClient],
  );

  /**
   * Start a new Chronicle Pass: challenge (initial period) → sign → settle.
   * Wallet-authorized and user initiated — no silent charges.
   */
  const subscribe = useCallback(
    async (email: string): Promise<SubscriptionActionResult> => {
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;

      try {
        let address =
          walletRef.current.address && isEvmAddress(walletRef.current.address)
            ? walletRef.current.address
            : null;
        if (!address) {
          const connected = await walletRef.current.connect();
          if (!isEvmAddress(connected)) {
            return { status: "error", message: "Wallet did not return a valid account." };
          }
          address = connected;
        }

        const challenge = await requestJson<ChroniclePassRenewResponse>(
          "/subscribers/newsletter/subscribe",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({ email, payerReference: address }),
          },
        );
        const nestedChallenge = challenge.challengeData;
        if (!nestedChallenge?.domain || !nestedChallenge.types || !nestedChallenge.message) {
          return {
            status: "error",
            message: "Server returned an incomplete payment challenge.",
          };
        }

        await walletRef.current.ensureChain();
        const settlementReference = await signX402Settlement(nestedChallenge, walletRef.current);

        const settleResult = await requestJson<{ settled: boolean; error?: string }>(
          "/subscribers/newsletter/settlements",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              challengeReference: challenge.challengeReference,
              settlementReference,
            }),
          },
        );
        if (!settleResult.settled) {
          return {
            status: "error",
            message: settleResult.error ?? "Payment settlement failed.",
          };
        }

        setAuthenticatedWallet(address.toLowerCase());
        void queryClient.invalidateQueries({ queryKey: queryKeys.subscription.all });
        // Establish the pass session (challenge → sign → verify) so the page
        // shows the active pass immediately instead of the wallet gate. The
        // user just authorized the settlement, so this is the linking step.
        const authResult = await authenticate();
        const activatedMessage = `Chronicle Pass activated — ${challenge.amountRequested} ${challenge.currency}/month.`;
        return authResult.status === "success"
          ? { status: "success", message: activatedMessage }
          : {
              status: "success",
              message: `${activatedMessage} Sign in with your wallet to manage it.`,
            };
      } catch (err) {
        return {
          status: "error",
          message: toErrorMessage(err, "Subscription failed. Please try again."),
        };
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
        }
      }
    },
    [authenticate, queryClient],
  );

  return {
    session: sessionQuery.data ?? session,
    isSessionLoading,
    isAuthenticated,
    walletAddress: authenticatedWallet,
    status: statusQuery.data ?? null,
    isStatusLoading: statusQuery.isLoading,
    statusError: statusQuery.error ? toErrorMessage(statusQuery.error) : null,
    payments: paymentsQuery.data?.items ?? [],
    isPaymentsLoading: paymentsQuery.isLoading,
    authenticate,
    logout,
    refresh,
    updatePreferences,
    cancel,
    resume,
    renew,
    settleRenewal,
    subscribe,
  };
}
