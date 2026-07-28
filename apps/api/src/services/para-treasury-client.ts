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
import {
  type Address,
  type Hex,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { chainFromId } from "../lib/viem-chain.ts";
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
  /** Native balance in ETH (parsed float) for the configured chain (gas). */
  getNativeBalanceEth(): Promise<number>;
  /**
   * USDC ERC-20 balance (human units) for the treasury wallet on the configured chain.
   * Requires `rpcUrl` + `usdcAddress`.
   */
  getUsdcBalance(): Promise<number>;
  /**
   * Broadcast a USDC ERC-20 transfer from the Para MPC wallet.
   * @param amountUsdc Human USDC units (e.g. 12.5), not base units.
   */
  sendTransfer(to: string, amountUsdc: number): Promise<OnChainWriteReceipt>;
  /** Chain ID used for Para EVM operations. */
  getChainId(): number;
}

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

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
   * Also required for USDC ERC-20 transfers via signTransaction.
   */
  rpcUrl?: string;
  /** Circle (or demo) USDC contract for treasury payouts. */
  usdcAddress: string;
  /** USDC decimals (default 6). */
  usdcDecimals?: number;
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
  if (chainId === 84_532 || networkLabel === "base-sepolia") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  if (chainId === 1) {
    return `https://etherscan.io/tx/${txHash}`;
  }
  // Ethereum Sepolia default for product settlement / desk
  return `https://sepolia.etherscan.io/tx/${txHash}`;
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

function publicClientFor(rpcUrl: string, chainId: number) {
  return createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcUrl.trim()),
  });
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
          return Number(formatEther(BigInt(balance.rawBalance)));
        }
        return 0;
      } catch (error) {
        // Production fallback: read native balance directly from the chain.
        if (config.rpcUrl?.trim()) {
          try {
            const pc = publicClientFor(config.rpcUrl, chainId);
            const wei = await pc.getBalance({
              address: wallet.address as Address,
            });
            return Number(formatEther(wei));
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

    async getUsdcBalance() {
      const usdcAddress = config.usdcAddress?.trim();
      if (!usdcAddress || !ADDRESS_RE.test(usdcAddress)) {
        throw new Error(
          "Para USDC balance requires a valid usdcAddress (DESK_USDC_ADDRESS)",
        );
      }
      const rpcUrl = config.rpcUrl?.trim();
      if (!rpcUrl) {
        throw new Error("Para USDC balance requires RPC_URL for balanceOf reads");
      }

      const wallet = await this.ensureWallet();
      const pc = publicClientFor(rpcUrl, chainId);
      const decimals = config.usdcDecimals ?? 6;
      const data = encodeFunctionData({
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [getAddress(wallet.address) as Address],
      });
      const raw = await pc.call({
        to: getAddress(usdcAddress) as Address,
        data,
      });
      if (!raw.data || raw.data === "0x") {
        throw new Error("Empty balanceOf result for USDC");
      }
      const amount = decodeFunctionResult({
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        data: raw.data as Hex,
      });
      return Number(formatUnits(amount, decimals));
    },

    async sendTransfer(to: string, amountUsdc: number) {
      if (!ADDRESS_RE.test(to)) {
        throw new Error(`Invalid transfer recipient address: ${to}`);
      }
      if (!(amountUsdc > 0) || !Number.isFinite(amountUsdc)) {
        throw new Error(`Invalid USDC transfer amount: ${amountUsdc}`);
      }

      const usdcAddress = config.usdcAddress?.trim();
      if (!usdcAddress || !ADDRESS_RE.test(usdcAddress)) {
        throw new Error(
          "Para USDC transfer requires a valid usdcAddress (DESK_USDC_ADDRESS)",
        );
      }

      const wallet = await this.ensureWallet();
      const checksumTo = getAddress(to);
      const checksumUsdc = getAddress(usdcAddress);
      const decimals = config.usdcDecimals ?? 6;
      const amountRaw = parseUnits(String(amountUsdc), decimals);
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [checksumTo as Address, amountRaw],
      });

      // Prefer signTransaction with full EIP-1559 fields + broadcast.
      // Para BETA's high-level /transfer endpoint is flaky; signTransaction is proven.
      if (config.rpcUrl?.trim()) {
        const pc = publicClientFor(config.rpcUrl, chainId);
        const [nonce, fees] = await Promise.all([
          pc.getTransactionCount({
            address: wallet.address as Address,
            blockTag: "pending",
          }),
          pc.estimateFeesPerGas(),
        ]);

        const maxPriority =
          fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > 0n
            ? fees.maxPriorityFeePerGas
            : 1_000_000n;
        const maxFee =
          fees.maxFeePerGas && fees.maxFeePerGas > maxPriority
            ? fees.maxFeePerGas
            : maxPriority * 2n;

        const result = await client.signTransaction(
          wallet.walletId,
          {
            transaction: {
              to: checksumUsdc,
              chainId,
              type: 2,
              value: "0",
              data,
              nonce,
              gasLimit: "120000",
              maxFeePerGas: maxFee.toString(),
              maxPriorityFeePerGas: maxPriority.toString(),
            },
            broadcast: true,
          },
          {
            idempotencyKey: `usdc-${wallet.walletId}-${checksumTo}-${amountRaw.toString()}-${nonce}`,
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

      // ERC-20 transfers need calldata encoding; require RPC for that path.
      throw new Error(
        "Para USDC transfer requires RPC_URL so Chronicle can build ERC-20 transfer calldata via signTransaction",
      );
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

  // Para treasury client signs desk/ops USDC on Ethereum Sepolia (not Base x402).
  const chainId = mapNetworkToChainId(env.keeperhubNetwork, 11_155_111);

  return createParaTreasuryClient({
    apiKey: env.paraApiKey as string,
    environment: env.paraEnvironment,
    userIdentifier: env.paraTreasuryUserIdentifier,
    userIdentifierType: env.paraTreasuryUserIdentifierType,
    ...(env.paraWalletId?.trim() ? { walletId: env.paraWalletId.trim() } : {}),
    chainId,
    networkLabel: env.keeperhubNetwork,
    usdcAddress: env.deskUsdcAddress,
    usdcDecimals: 6,
    ...(env.rpcUrl?.trim() ? { rpcUrl: env.rpcUrl.trim() } : {}),
  });
}
