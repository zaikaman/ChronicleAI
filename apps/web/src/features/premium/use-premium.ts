// Premium data fetching hooks

import type { PremiumItemTeaserResponse } from "@chronicleai/schemas";
import { useCallback, useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

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
  const [items, setItems] = useState<PremiumItemTeaserResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeasers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/premium/items`);

      if (!response.ok) {
        throw new Error(`Failed to fetch premium items: ${response.statusText}`);
      }

      const data = (await response.json()) as { items: PremiumItemTeaserResponse[] };
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load premium items");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeasers();
  }, [fetchTeasers]);

  return { items, isLoading, error, refetch: fetchTeasers };
}

/**
 * Hook to access a premium item with payment gating.
 * Handles the 402 -> challenge -> settle -> receipt flow.
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
        // Stale/invalid receipt should not stick around
        if (receipt) {
          clearPremiumAccessReceipt(itemId);
        }
        const body = await response.json();
        setIsPaymentRequired(true);
        setPaymentChallenge({
          premiumItemId: body.premiumItemId ?? itemId,
          paymentRoute: body.paymentRoute ?? "x402",
          amountRequested: body.item?.priceAmount ?? 0,
          currency: body.item?.priceCurrency ?? "USDC",
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
}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${API_BASE}/payments/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorBody.error ?? "Failed to create challenge");
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    throw err;
  }
}

/**
 * Settle a payment challenge. On success, returns accessReceipt for content unlock.
 */
export async function settlePayment(params: {
  challengeReference: string;
  settlementReference: string;
  paymentRoute: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${API_BASE}/payments/settlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorBody.error ?? "Settlement failed");
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    throw err;
  }
}

/**
 * Hook to fetch active sponsored watches.
 */
export function useSponsoredWatches() {
  const [watches, setWatches] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/premium/watches`);

      if (!response.ok) {
        throw new Error(`Failed to fetch sponsored watches: ${response.statusText}`);
      }

      const data = (await response.json()) as { watches: any[] };
      setWatches(data.watches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sponsored watches");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatches();
  }, [fetchWatches]);

  return { watches, isLoading, error, refetch: fetchWatches };
}
