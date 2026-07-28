// Premium data hooks — React Query for lists; imperative access for payment gating

import type { PremiumItemTeaserResponse } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { API_BASE, apiGetJson, apiPostJson, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";

const RECEIPT_STORAGE_PREFIX = "chronicle_premium_receipt:";

export function storePremiumAccessReceipt(itemId: string, receipt: string): void {
  try {
    sessionStorage.setItem(`${RECEIPT_STORAGE_PREFIX}${itemId}`, receipt);
  } catch {
    // sessionStorage may be unavailable (private mode / SSR) — ignore
  }
}

export function loadPremiumAccessReceipt(itemId: string): string | null {
  try {
    return sessionStorage.getItem(`${RECEIPT_STORAGE_PREFIX}${itemId}`);
  } catch {
    return null;
  }
}

export function clearPremiumAccessReceipt(itemId: string): void {
  try {
    sessionStorage.removeItem(`${RECEIPT_STORAGE_PREFIX}${itemId}`);
  } catch {
    // ignore
  }
}

export interface PremiumTeasersState {
  items: PremiumItemTeaserResponse[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface PremiumItemAccessResult {
  isLoading: boolean;
  error: string | null;
  data: Record<string, unknown> | null;
  /**
   * Access premium content. Uses a stored HMAC access receipt when available
   * (from a prior settlement). Bare payer references are not used for unlock.
   */
  accessItem: (itemId: string, accessReceipt?: string) => Promise<void>;
  isPaymentRequired: boolean;
  paymentChallenge: {
    premiumItemId: string;
    paymentRoute: string;
    amountRequested: number;
    currency: string;
  } | null;
}

/**
 * Hook to fetch premium item teasers.
 */
export function usePremiumTeasers(): PremiumTeasersState {
  const query = useQuery({
    queryKey: queryKeys.premium.teasers,
    queryFn: async ({ signal }) => {
      const data = await apiGetJson<{ items: PremiumItemTeaserResponse[] }>(
        "/premium/items",
        { signal },
      );
      return data.items ?? [];
    },
    staleTime: 30_000,
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error ? toErrorMessage(query.error, "Failed to load premium items") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Hook to access a premium item with payment gating.
 * Handles the 402 -> challenge -> settle -> receipt flow.
 * Kept imperative (not a pure query) because of multi-step payment UX.
 */
export function usePremiumItemAccess(): PremiumItemAccessResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [isPaymentRequired, setIsPaymentRequired] = useState(false);
  const [paymentChallenge, setPaymentChallenge] = useState<{
    premiumItemId: string;
    paymentRoute: string;
    amountRequested: number;
    currency: string;
  } | null>(null);

  const accessItem = useCallback(async (itemId: string, accessReceipt?: string) => {
    setIsLoading(true);
    setError(null);
    setData(null);
    setIsPaymentRequired(false);
    setPaymentChallenge(null);

    try {
      const receipt = accessReceipt?.trim() || loadPremiumAccessReceipt(itemId) || undefined;

      const headers: Record<string, string> = {};
      if (receipt) {
        headers.Authorization = `Bearer ${receipt}`;
        headers["X-Premium-Access-Receipt"] = receipt;
      }

      const response = await fetch(`${API_BASE}/premium/items/${itemId}`, {
        headers,
        credentials: "include",
      });

      if (response.status === 200) {
        const itemData = (await response.json()) as Record<string, unknown>;
        setData(itemData);
        return;
      }

      if (response.status === 402) {
        if (receipt) {
          clearPremiumAccessReceipt(itemId);
        }
        const body = (await response.json()) as {
          premiumItemId?: string;
          paymentRoute?: string;
          amountRequested?: number;
          currency?: string;
          item?: {
            priceAmount?: number;
            priceCurrency?: string;
            price_amount?: number;
            price_currency?: string;
          };
        };

        const rawAmount =
          body.item?.priceAmount ??
          body.amountRequested ??
          body.item?.price_amount ??
          0;
        const amountRequested =
          typeof rawAmount === "number" && Number.isFinite(rawAmount)
            ? rawAmount
            : Number(rawAmount) || 0;

        setIsPaymentRequired(true);
        setPaymentChallenge({
          premiumItemId: body.premiumItemId ?? itemId,
          paymentRoute: body.paymentRoute ?? "x402",
          amountRequested,
          currency:
            body.item?.priceCurrency ??
            body.currency ??
            body.item?.price_currency ??
            "USDC",
        });
        return;
      }

      if (response.status === 404) {
        setError("Premium item not found");
        return;
      }

      throw new Error(`Unexpected response: ${response.statusText}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to access premium item");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    error,
    data,
    accessItem,
    isPaymentRequired,
    paymentChallenge,
  };
}

/**
 * Create a payment challenge.
 */
export async function createPaymentChallenge(params: {
  premiumItemId: string;
  paymentRoute: string;
  payerReference?: string;
  /** Optional explicit affiliate; server also resolves first-touch wallet attribution. */
  referralAddress?: string;
}): Promise<Record<string, unknown> | null> {
  return apiPostJson<Record<string, unknown>>("/payments/challenges", params);
}

/**
 * Settle a payment challenge. On success, returns accessReceipt for content unlock.
 */
export async function settlePayment(params: {
  challengeReference: string;
  settlementReference: string;
  paymentRoute: string;
}): Promise<Record<string, unknown> | null> {
  return apiPostJson<Record<string, unknown>>("/payments/settlements", params, {
    credentials: "include",
  });
}

export interface SponsoredWatchSummary {
  id: string;
  targetContract: string;
  status: string;
  createTxHash?: string;
  reportTxHash?: string;
  createExplorerUrl?: string;
  reportExplorerUrl?: string;
  sourceEventRoot?: string;
  startsAt: string;
  endsAt: string;
  [key: string]: unknown;
}

/**
 * Hook to fetch active sponsored watches.
 */
export function useSponsoredWatches(): {
  watches: SponsoredWatchSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: queryKeys.premium.watches,
    queryFn: async ({ signal }) => {
      const data = await apiGetJson<{ watches: SponsoredWatchSummary[] }>(
        "/premium/watches",
        { signal },
      );
      return data.watches ?? [];
    },
    staleTime: 30_000,
  });

  return {
    watches: query.data ?? [],
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error
      ? toErrorMessage(query.error, "Failed to load sponsored watches")
      : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
