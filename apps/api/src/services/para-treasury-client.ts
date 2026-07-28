// Production Para MPC treasury client.
//
// Uses @getpara/rest-sdk (API-key-backed programmatic wallets) — the supported
// server path for autonomous agent treasuries. No private key material is held
// in-process; Para performs 2-of-2 MPC signing behind the REST API.
//
// Wallet lifecycle:
// 1. PARA_WALLET_ID set → load that wallet
// 2. Else list by PARA_TREASURY_USER_IDENTIFIER → reuse ready EVM wallet
// 3. Else create EVM wallet under that identifier (idempotent-friendly)

import type { ServerEnv } from "@chronicleai/config";
import {
  ParaRestClient,
  ParaRestError,
  type ParaRestEnvironment,
  type RestWallet,
  type UserIdentifierType,
  type WalletType,
} from "@getpara/rest-sdk";
import { ethers } from "ethers";
import type { OnChainWriteReceipt } from "./on-chain-write-receipt.ts";

export interface ParaTreasuryWallet {
  walletId: string;
  address: string;
  userIdentifier: string;
  userIdentifierType: string;
}

export interface ParaTreasuryClient {
  /** Ensure the agent treasury wallet exists and return its identity. */
  ensureWallet(): Promise<ParaTreasuryWallet>;
  /** Native balance in ETH (parsed float) for the configured chain. */
  getNativeBalanceEth(): Promise<number>;
  /** Broadcast a native transfer from the Para MPC wallet. */
  sendTransfer(to: string, amountEth: number): Promise<OnChainWriteReceipt>;
  /** Chain ID used for Para EVM operations. */
  getChainId(): number;
}

export interface ParaTreasuryClientConfig {
  apiKey: string;
  environment: ParaRestEnvironment;
  userIdentifier: string;
  userIdentifierType: string;
  walletId?: string;
  chainId: number;
  networkLabel?: string;
  /**
   * Optional JSON-RPC URL. Used as a balance fallback when Para's
   * getWalletBalance endpoint fails (seen on BETA with bad Alchemy hosts).
   */
  rpcUrl?: string;
  /** Optional injected client for unit tests. */
  restClient?: ParaRestClient;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isParaTreasuryConfigured(
  env: Pick<ServerEnv, "paraApiKey">,
): boolean {
  return typeof env.paraApiKey === "string" && env.paraApiKey.trim().length > 0;
}

export function mapNetworkToChainId(network: string, fallbackChainId: number): number {
  const n = network.trim().toLowerCase();
  if (n === "base" || n === "8453") return 8453;
  if (n === "base-sepolia" || n === "84532") return 84_532;
  if (n === "sepolia" || n === "11155111") return 11_155_111;
  if (n === "ethereum" || n === "mainnet" || n === "1") return 1;
  return fallbackChainId;
}

function explorerUrlFor(txHash: string, chainId: number, networkLabel?: string): string {
  if (chainId === 8453 || networkLabel === "base") {
    return `https://basescan.org/tx/${txHash}`;
  }
  if (chainId === 11_155_111) {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (chainId === 1) {
    return `https://etherscan.io/tx/${txHash}`;
  }
  // Base Sepolia default for hackathon
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

function asIdentifierType(raw: string): UserIdentifierType {
  // Runtime validates against Para; cast keeps types without pulling shared enums.
  return raw as UserIdentifierType;
}

function requireReadyAddress(wallet: RestWallet): string {
  if (!wallet.address || !ADDRESS_RE.test(wallet.address)) {
    throw new Error(
      `Para wallet ${wallet.id} is not ready (status=${wallet.status}, missing EVM address). Retry after wallet finishes creating.`,
    );
  }
  return wallet.address;
}

export function createParaTreasuryClient(config: ParaTreasuryClientConfig): ParaTreasuryClient {
  const client =
    config.restClient ??
    new ParaRestClient({
      apiKey: config.apiKey,
      env: config.environment,
    });

  const userIdentifier = config.userIdentifier.trim();
  const userIdentifierType = asIdentifierType(config.userIdentifierType.trim());
  const chainId = config.chainId;

  let cached: ParaTreasuryWallet | undefined;
  let ensurePromise: Promise<ParaTreasuryWallet> | undefined;

  async function loadById(walletId: string): Promise<ParaTreasuryWallet> {
    const wallet = await client.getWallet(walletId, {
      signal: AbortSignal.timeout(15_000),
    });
    if (wallet.type !== "EVM") {
      throw new Error(`Para wallet ${walletId} is type ${wallet.type}; expected EVM for treasury`);
    }
    return {
      walletId: wallet.id,
      address: requireReadyAddress(wallet),
      userIdentifier: wallet.userIdentifier ?? userIdentifier,
      userIdentifierType: wallet.userIdentifierType ?? userIdentifierType,
    };
  }

  async function findExisting(): Promise<RestWallet | undefined> {
    const listed = await client.listWallets(
      {
        userIdentifier,
        userIdentifierType,
        type: "EVM" as WalletType,
        status: "ready",
        limit: 10,
      },
      { signal: AbortSignal.timeout(15_000) },
    );
    return listed.data.find((w) => w.type === "EVM" && w.address) ?? listed.data[0];
  }

  async function createNew(): Promise<RestWallet> {
    try {
      return await client.createWallet(
        {
          type: "EVM" as WalletType,
          userIdentifier,
          userIdentifierType,
        },
        {
          idempotencyKey: `chronicleai-treasury-${userIdentifier}`,
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error) {
      // Race: another process created the wallet — recover via list/get.
      if (error instanceof ParaRestError && error.status === 409) {
        const body = error.body as { walletId?: string } | null;
        if (body && typeof body.walletId === "string" && body.walletId.length > 0) {
          return await client.getWallet(body.walletId, {
            signal: AbortSignal.timeout(15_000),
          });
        }
        const existing = await findExisting();
        if (existing) return existing;
      }
      throw error;
    }
  }

  async function ensureWalletInternal(): Promise<ParaTreasuryWallet> {
    if (cached) return cached;

    if (config.walletId?.trim()) {
      cached = await loadById(config.walletId.trim());
      return cached;
    }

    const existing = await findExisting();
    const wallet = existing ?? (await createNew());

    // Wallet may still be in "creating" — poll getWallet briefly.
    let ready = wallet;
    if (ready.status !== "ready" || !ready.address) {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        ready = await client.getWallet(wallet.id, {
          signal: AbortSignal.timeout(15_000),
        });
        if (ready.status === "ready" && ready.address) break;
      }
    }

    cached = {
      walletId: ready.id,
      address: requireReadyAddress(ready),
      userIdentifier: ready.userIdentifier ?? userIdentifier,
      userIdentifierType: ready.userIdentifierType ?? userIdentifierType,
    };
    return cached;
  }

  return {
    getChainId() {
      return chainId;
    },

    async ensureWallet() {
      if (!ensurePromise) {
        ensurePromise = ensureWalletInternal().catch((error) => {
          ensurePromise = undefined;
          throw error;
        });
      }
      return ensurePromise;
    },

    async getNativeBalanceEth() {
      const wallet = await this.ensureWallet();
      try {
        const balance = await client.getWalletBalance(
          wallet.walletId,
          { chainId },
          { signal: AbortSignal.timeout(15_000) },
        );
        // Prefer human balance; fall back to raw wei string.
        if (balance.balance && Number.isFinite(Number(balance.balance))) {
          return Number(balance.balance);
        }
        if (balance.rawBalance) {
          return Number(ethers.formatEther(BigInt(balance.rawBalance)));
        }
        return 0;
      } catch (error) {
        // Production fallback: read native balance directly from the chain.
        if (config.rpcUrl?.trim()) {
          try {
            const provider = new ethers.JsonRpcProvider(config.rpcUrl.trim());
            const wei = await provider.getBalance(wallet.address);
            return Number(ethers.formatEther(wei));
          } catch (rpcError) {
            const paraMsg = error instanceof Error ? error.message : String(error);
            const rpcMsg = rpcError instanceof Error ? rpcError.message : String(rpcError);
            throw new Error(
              `Para getWalletBalance failed (${paraMsg}); RPC fallback also failed (${rpcMsg})`,
            );
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Para getWalletBalance failed for ${wallet.walletId}: ${message}`);
      }
    },

    async sendTransfer(to: string, amountEth: number) {
      if (!ADDRESS_RE.test(to)) {
        throw new Error(`Invalid transfer recipient address: ${to}`);
      }
      if (!(amountEth > 0) || !Number.isFinite(amountEth)) {
        throw new Error(`Invalid transfer amountEth: ${amountEth}`);
      }

      const wallet = await this.ensureWallet();
      const valueWei = ethers.parseEther(String(amountEth)).toString();
      const checksumTo = ethers.getAddress(to);

      // Prefer signTransaction with full EIP-1559 fields + broadcast.
      // Para BETA's high-level /transfer endpoint currently returns INTERNAL_ERROR;
      // signTransaction is proven for Base Sepolia MPC spends.
      if (config.rpcUrl?.trim()) {
        const provider = new ethers.JsonRpcProvider(config.rpcUrl.trim());
        const [nonce, feeData] = await Promise.all([
          provider.getTransactionCount(wallet.address, "pending"),
          provider.getFeeData(),
        ]);

        const maxPriority =
          feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > 0n
            ? feeData.maxPriorityFeePerGas
            : 1_000_000n;
        const maxFee =
          feeData.maxFeePerGas && feeData.maxFeePerGas > maxPriority
            ? feeData.maxFeePerGas
            : maxPriority * 2n;

        const result = await client.signTransaction(
          wallet.walletId,
          {
            transaction: {
              to: checksumTo,
              chainId,
              type: 2,
              value: valueWei,
              data: "0x",
              nonce,
              gasLimit: "21000",
              maxFeePerGas: maxFee.toString(),
              maxPriorityFeePerGas: maxPriority.toString(),
            },
            broadcast: true,
          },
          {
            idempotencyKey: `tx-${wallet.walletId}-${checksumTo}-${valueWei}-${nonce}`,
            signal: AbortSignal.timeout(60_000),
          },
        );

        const txHash = result.txHash;
        if (!txHash || typeof txHash !== "string") {
          throw new Error(
            `Para signTransaction did not return txHash (wallet=${wallet.walletId}, transactionId=${result.transactionId ?? "n/a"})`,
          );
        }

        const receipt: OnChainWriteReceipt = {
          txHash,
          explorerUrl: explorerUrlFor(txHash, chainId, config.networkLabel),
        };
        if (result.transactionId) {
          receipt.keeperHubRunId = `para:${result.transactionId}`;
        }
        return receipt;
      }

      // Fallback when RPC_URL is unavailable: high-level transfer API.
      const result = await client.transfer(
        wallet.walletId,
        {
          to: checksumTo,
          value: valueWei,
          chainId,
          kind: "NATIVE",
          broadcast: true,
          type: 2,
        },
        {
          idempotencyKey: `transfer-${wallet.walletId}-${checksumTo}-${valueWei}-${Date.now()}`,
          signal: AbortSignal.timeout(60_000),
        },
      );

      const txHash = result.txHash;
      if (!txHash || typeof txHash !== "string") {
        throw new Error(
          `Para transfer did not return txHash (wallet=${wallet.walletId}, transactionId=${result.transactionId ?? "n/a"})`,
        );
      }

      const receipt: OnChainWriteReceipt = {
        txHash,
        explorerUrl: explorerUrlFor(txHash, chainId, config.networkLabel),
      };
      if (result.transactionId) {
        receipt.keeperHubRunId = `para:${result.transactionId}`;
      }
      return receipt;
    },
  };
}

/**
 * Build a production Para treasury client from server env, or null if not configured.
 */
export function createParaTreasuryClientFromEnv(env: ServerEnv): ParaTreasuryClient | null {
  if (!isParaTreasuryConfigured(env)) {
    return null;
  }

  const chainId = mapNetworkToChainId(env.keeperhubNetwork, env.x402ChainId);

  return createParaTreasuryClient({
    apiKey: env.paraApiKey as string,
    environment: env.paraEnvironment,
    userIdentifier: env.paraTreasuryUserIdentifier,
    userIdentifierType: env.paraTreasuryUserIdentifierType,
    ...(env.paraWalletId?.trim() ? { walletId: env.paraWalletId.trim() } : {}),
    chainId,
    networkLabel: env.keeperhubNetwork,
    ...(env.rpcUrl?.trim() ? { rpcUrl: env.rpcUrl.trim() } : {}),
  });
}
