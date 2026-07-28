// Lightweight wallet-proof for affiliate dashboard + agent routes.
// Message format is fixed so the web client can sign deterministically.

import { type Hex, recoverMessageAddress } from "viem";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Max age of a signed auth message (15 minutes). */
export const AFFILIATE_AUTH_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Canonical message the wallet must sign.
 * Clients should call buildAffiliateAuthMessage(wallet) then personal_sign.
 */
export function buildAffiliateAuthMessage(
  walletAddress: string,
  issuedAtIso: string,
): string {
  const wallet = walletAddress.trim().toLowerCase();
  return [
    "ChronicleAI Affiliate Session",
    `Wallet: ${wallet}`,
    `Issued-At: ${issuedAtIso}`,
    "Purpose: Access affiliate dashboard and payout agent",
  ].join("\n");
}

export interface AffiliateAuthPayload {
  walletAddress: string;
  issuedAt: string;
  signature: string;
}

export type AffiliateAuthResult =
  | { ok: true; walletAddress: string }
  | { ok: false; error: string };

export async function verifyAffiliateAuth(
  payload: AffiliateAuthPayload,
): Promise<AffiliateAuthResult> {
  const wallet = payload.walletAddress?.trim().toLowerCase() ?? "";
  if (!EVM_ADDRESS_RE.test(wallet)) {
    return { ok: false, error: "Invalid walletAddress" };
  }

  const issuedAt = payload.issuedAt?.trim() ?? "";
  const issuedMs = Date.parse(issuedAt);
  if (!issuedAt || Number.isNaN(issuedMs)) {
    return { ok: false, error: "Invalid issuedAt timestamp" };
  }

  const age = Date.now() - issuedMs;
  if (age < -60_000) {
    return { ok: false, error: "Auth message issued in the future" };
  }
  if (age > AFFILIATE_AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Auth signature expired — please sign again" };
  }

  const signature = payload.signature?.trim() ?? "";
  if (!signature.startsWith("0x") || signature.length < 130) {
    return { ok: false, error: "Invalid signature" };
  }

  const message = buildAffiliateAuthMessage(wallet, issuedAt);
  let recovered: string;
  try {
    recovered = (
      await recoverMessageAddress({
        message,
        signature: signature as Hex,
      })
    ).toLowerCase();
  } catch {
    return { ok: false, error: "Could not verify signature" };
  }

  if (recovered !== wallet) {
    return { ok: false, error: "Signature does not match walletAddress" };
  }

  return { ok: true, walletAddress: wallet };
}
