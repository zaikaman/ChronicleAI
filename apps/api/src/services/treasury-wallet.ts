// Resolve the agent treasury wallet used for inbound x402 payments and outbound
// revenue splits.
//
// Production priority:
// 1. Para MPC (PARA_API_KEY) — address from ensureWallet(); spends via Para REST
// 2. KeeperHub-backed address-only (TREASURY_WALLET_ADDRESS) — spends via KeeperHub
// 3. Local EOA (TREASURY_WALLET_PRIVATE_KEY) — test path only
//
// Synchronous resolve covers env-based identity. Para address is resolved
// asynchronously via resolveTreasuryWalletAsync / ParaTreasuryClient.ensureWallet.

import type { ServerEnv } from "@chronicleai/config";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createParaTreasuryClientFromEnv,
  isParaTreasuryConfigured,
  type ParaTreasuryClient,
} from "./para-treasury-client.ts";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_RE = /^(0x)?[a-fA-F0-9]{64}$/;

/**
 * How outbound treasury spends are expected to be authorized.
 */
export type TreasurySpendMode = "para" | "keeperhub" | "eoa" | "none";

/**
 * Human-readable provider label for logs and public activity surfaces.
 */
export type TreasuryProvider = "para-mpc" | "keeperhub" | "eoa" | "unconfigured";

export interface ResolvedTreasuryWallet {
  /** Public address used as x402 `to` and as the sender identity for splits. */
  address: string | undefined;
  /**
   * Spending key for revenue routing transfers.
   * Present only in direct-EOA (test) mode; production uses Para MPC or KeeperHub.
   */
  privateKey: string | undefined;
  /** How outbound spends should be authorized. */
  spendMode: TreasurySpendMode;
  /** Honest provider label for logs and public activity surfaces. */
  provider: TreasuryProvider;
  /** Para wallet id when provider is para-mpc and already resolved. */
  paraWalletId?: string;
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
    return privateKeyToAccount(normalized as Hex).address;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid key";
    throw new Error(`TREASURY_WALLET_PRIVATE_KEY is invalid: ${message}`);
  }
}

/**
 * Synchronous resolve from env (no Para network calls).
 *
 * When PARA_API_KEY is set, returns provider=para-mpc with address from
 * TREASURY_WALLET_ADDRESS if provided (optional cache). Call
 * `resolveTreasuryWalletAsync` at startup / first spend to load the live address.
 */
export function resolveTreasuryWallet(
  env: Pick<
    ServerEnv,
    | "treasuryWalletAddress"
    | "treasuryWalletPrivateKey"
    | "paraApiKey"
    | "paraWalletId"
  >,
  options?: {
    /**
     * When true (and Para not configured), address-only treasuries are labeled
     * as KeeperHub-backed. Defaults to true.
     */
    keeperHubBacked?: boolean;
  },
): ResolvedTreasuryWallet {
  const rawKey = env.treasuryWalletPrivateKey?.trim();
  const rawAddress = env.treasuryWalletAddress?.trim();
  const keeperHubBacked = options?.keeperHubBacked !== false;
  const paraConfigured = isParaTreasuryConfigured(env);

  // Production: Para MPC takes priority over EOA keys when API key is present.
  if (paraConfigured) {
    if (rawAddress && !ADDRESS_RE.test(rawAddress)) {
      throw new Error(
        "TREASURY_WALLET_ADDRESS must be a valid EIP-55 / hex address (0x + 40 hex chars)",
      );
    }
    return {
      address: rawAddress && ADDRESS_RE.test(rawAddress) ? rawAddress : undefined,
      privateKey: undefined,
      spendMode: "para",
      provider: "para-mpc",
      ...(env.paraWalletId?.trim() ? { paraWalletId: env.paraWalletId.trim() } : {}),
    };
  }

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
    return {
      address,
      privateKey: normalizedKey,
      spendMode: "eoa",
      provider: "eoa",
    };
  }

  if (rawAddress) {
    if (!ADDRESS_RE.test(rawAddress)) {
      throw new Error(
        "TREASURY_WALLET_ADDRESS must be a valid EIP-55 / hex address (0x + 40 hex chars)",
      );
    }
    if (keeperHubBacked) {
      return {
        address: rawAddress,
        privateKey: undefined,
        spendMode: "keeperhub",
        provider: "keeperhub",
      };
    }
    return {
      address: rawAddress,
      privateKey: undefined,
      spendMode: "none",
      provider: "unconfigured",
    };
  }

  return {
    address: undefined,
    privateKey: undefined,
    spendMode: "none",
    provider: "unconfigured",
  };
}

/**
 * Async resolve that enrolls/loads the Para MPC treasury wallet when configured.
 * Falls back to synchronous env resolution otherwise.
 */
export async function resolveTreasuryWalletAsync(
  env: ServerEnv,
  options?: {
    keeperHubBacked?: boolean;
    paraClient?: ParaTreasuryClient | null;
  },
): Promise<ResolvedTreasuryWallet> {
  const paraClient = options?.paraClient ?? createParaTreasuryClientFromEnv(env);

  if (paraClient) {
    const wallet = await paraClient.ensureWallet();
    const sync = resolveTreasuryWallet(env, options);
    if (
      sync.address &&
      sync.address.toLowerCase() !== wallet.address.toLowerCase()
    ) {
      throw new Error(
        `TREASURY_WALLET_ADDRESS (${sync.address}) does not match Para MPC wallet address (${wallet.address}). ` +
          "Update TREASURY_WALLET_ADDRESS to the Para address or remove it so it is derived from Para.",
      );
    }
    return {
      address: wallet.address,
      privateKey: undefined,
      spendMode: "para",
      provider: "para-mpc",
      paraWalletId: wallet.walletId,
    };
  }

  return resolveTreasuryWallet(env, options);
}
