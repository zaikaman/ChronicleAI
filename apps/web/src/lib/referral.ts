// Client-side referral capture (?ref=code) + first-touch wallet attribution.

import { signAffiliateAuth } from "./affiliate-auth.ts";
import { API_BASE, fetchWithTimeout } from "./api.ts";

const STORAGE_KEY = "chronicle_referral_ref";
const ATTRIBUTED_KEY = "chronicle_referral_attributed_wallet";

/**
 * Persist ?ref= from the URL (first non-empty wins until cleared).
 * Call once on app boot and when the location search changes.
 */
export function captureReferralFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
    const ref = (params.get("ref") ?? params.get("referral") ?? "").trim();
    if (!ref) return getStoredReferralRef();

    const existing = getStoredReferralRef();
    // First-touch: do not overwrite a stored ref with a later one.
    if (!existing) {
      localStorage.setItem(STORAGE_KEY, ref);
    }
    return existing ?? ref;
  } catch {
    return null;
  }
}

export function getStoredReferralRef(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v?.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function clearStoredReferralRef(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ATTRIBUTED_KEY);
  } catch {
    // ignore
  }
}

/**
 * When a visitor connects a wallet and we have a stored ref, attribute them
 * to that affiliate (server enforces first-touch + approved affiliate).
 */
export async function attributeReferralOnConnect(
  walletAddress: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ created: boolean; affiliateWallet?: string } | null> {
  const ref = getStoredReferralRef();
  if (!ref || !walletAddress) return null;

  const wallet = walletAddress.trim().toLowerCase();
  try {
    const already = localStorage.getItem(ATTRIBUTED_KEY);
    if (already === wallet) {
      return { created: false };
    }
  } catch {
    // continue
  }

  try {
    const auth = await signAffiliateAuth(wallet, signMessage);
    const response = await fetchWithTimeout(`${API_BASE}/affiliates/attribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referredWallet: wallet,
        ref,
        auth,
      }),
    });

    if (!response.ok) {
      // Self-referral or invalid ref — clear so we don't spam.
      if (response.status === 400 || response.status === 404) {
        try {
          localStorage.setItem(ATTRIBUTED_KEY, wallet);
        } catch {
          // ignore
        }
      }
      return null;
    }

    const body = (await response.json()) as {
      created?: boolean;
      attribution?: { affiliateWallet?: string };
    };

    try {
      localStorage.setItem(ATTRIBUTED_KEY, wallet);
    } catch {
      // ignore
    }

    return {
      created: body.created === true,
      ...(body.attribution?.affiliateWallet
        ? { affiliateWallet: body.attribution.affiliateWallet }
        : {}),
    };
  } catch {
    return null;
  }
}
