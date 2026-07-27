// Resolve the treasury wallet used for inbound x402 payments and outbound revenue splits.
// Address is derived from TREASURY_WALLET_PRIVATE_KEY when set so the spend key always
// matches the payment destination.

import type { ServerEnv } from "@chronicleai/config";
import { ethers } from "ethers";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_RE = /^(0x)?[a-fA-F0-9]{64}$/;

export interface ResolvedTreasuryWallet {
  /** Public address used as x402 `to` and as the sender identity for splits. */
  address: string | undefined;
  /** Spending key for revenue routing transfers. */
  privateKey: string | undefined;
}

/**
 * Normalize a private key to 0x-prefixed form and derive its address.
 * Throws if the key is present but malformed.
 */
export function deriveAddressFromPrivateKey(privateKey: string): string {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!PRIVATE_KEY_RE.test(normalized)) {
    throw new Error(
      "TREASURY_WALLET_PRIVATE_KEY must be a 32-byte hex private key (64 hex chars, optional 0x prefix)",
    );
  }
  try {
    return new ethers.Wallet(normalized).address;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid key";
    throw new Error(`TREASURY_WALLET_PRIVATE_KEY is invalid: ${message}`);
  }
}

/**
 * Resolve treasury address + private key from env.
 *
 * Rules:
 * - Private key present → address is always derived from the key (source of truth).
 * - If TREASURY_WALLET_ADDRESS is also set, it must match the derived address.
 * - Address-only (legacy) is still allowed for x402 challenges, but sendTransfer
 *   will fail until TREASURY_WALLET_PRIVATE_KEY is configured.
 */
export function resolveTreasuryWallet(env: Pick<
  ServerEnv,
  "treasuryWalletAddress" | "treasuryWalletPrivateKey"
>): ResolvedTreasuryWallet {
  const rawKey = env.treasuryWalletPrivateKey?.trim();
  const rawAddress = env.treasuryWalletAddress?.trim();

  if (rawKey) {
    const address = deriveAddressFromPrivateKey(rawKey);
    if (rawAddress) {
      if (!ADDRESS_RE.test(rawAddress)) {
        throw new Error(
          "TREASURY_WALLET_ADDRESS must be a valid EIP-55 / hex address (0x + 40 hex chars)",
        );
      }
      if (rawAddress.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          `TREASURY_WALLET_ADDRESS (${rawAddress}) does not match the address derived from TREASURY_WALLET_PRIVATE_KEY (${address}). ` +
            "Either remove TREASURY_WALLET_ADDRESS (it will be derived) or use the matching key/address pair.",
        );
      }
    }
    const normalizedKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
    return { address, privateKey: normalizedKey };
  }

  if (rawAddress) {
    if (!ADDRESS_RE.test(rawAddress)) {
      throw new Error(
        "TREASURY_WALLET_ADDRESS must be a valid EIP-55 / hex address (0x + 40 hex chars)",
      );
    }
    return { address: rawAddress, privateKey: undefined };
  }

  return { address: undefined, privateKey: undefined };
}
