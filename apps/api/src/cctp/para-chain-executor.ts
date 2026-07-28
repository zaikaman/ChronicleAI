/**
 * Multi-chain CCTP executor backed by Para MPC treasury wallet.
 *
 * Burns Base Sepolia USDC and mints Ethereum Sepolia USDC from the same
 * Para wallet address (treasury pocket) — no separate operator EOA holding
 * USDC is required. Gas for approve/burn/mint is paid from treasury ETH on
 * each chain.
 *
 * Signing: Para REST `signTransaction` + broadcast (same proven path as
 * ParaTreasuryClient USDC transfers). Avoids AbstractSigner path which
 * can surface `transaction.to is required` with legacy signers.
 */

import type { ServerEnv } from "@chronicleai/config";
import {
  ParaRestClient,
  type ParaRestEnvironment,
  type UserIdentifierType,
  type WalletType,
} from "@getpara/rest-sdk";
import {
  type Address,
  type Hash,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  getContract,
  http,
} from "viem";
import {
  isParaTreasuryConfigured,
  type ParaTreasuryWallet,
} from "../services/para-treasury-client.ts";
import { chainFromId } from "../lib/viem-chain.ts";
import {
  CCTP_BASE_USDC,
  CCTP_DEST_CHAIN_ID,
  CCTP_MESSAGE_TRANSMITTER_V2,
  CCTP_SEPOLIA_USDC,
  CCTP_SOURCE_CHAIN_ID,
  CCTP_TOKEN_MESSENGER_V2,
  CCTP_USDC_DECIMALS,
} from "./constants.ts";
import {
  ERC20_ABI,
  encodeDepositForBurn,
  encodeReceiveMessage,
} from "./cctp-contracts.ts";
import { cctpExplorerUrls } from "./explorers.ts";
import type {
  CctpChainExecutor,
  CctpChainWriteResult,
  DepositForBurnParams,
} from "./types.ts";

export interface ParaChainExecutorConfig {
  apiKey: string;
  environment: ParaRestEnvironment;
  userIdentifier: string;
  userIdentifierType: string;
  walletId?: string | undefined;
  baseRpcUrl: string;
  sepoliaRpcUrl: string;
  tokenMessenger?: string | undefined;
  messageTransmitter?: string | undefined;
  baseUsdc?: string | undefined;
  sepoliaUsdc?: string | undefined;
  /** Optional confirmations to wait (default 1). */
  confirmations?: number | undefined;
  /** Injected REST client for tests. */
  restClient?: ParaRestClient | undefined;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Gas ceilings for CCTP steps (Para requires explicit gasLimit as decimal string). */
const GAS_APPROVE = "120000";
const GAS_DEPOSIT_FOR_BURN = "350000";
const GAS_RECEIVE_MESSAGE = "350000";

/** Poll interval while waiting for broadcast receipt (ms). */
const RECEIPT_POLL_MS = 2_000;
/** Max wait for a mined receipt after Para broadcast (ms). */
const RECEIPT_TIMEOUT_MS = 180_000;

function rpcForChain(
  chainId: number,
  baseRpc: string,
  sepoliaRpc: string,
): string {
  if (chainId === CCTP_SOURCE_CHAIN_ID) return baseRpc;
  if (chainId === CCTP_DEST_CHAIN_ID) return sepoliaRpc;
  throw new Error(`Unsupported CCTP chainId: ${chainId}`);
}

function usdcForChain(
  chainId: number,
  baseUsdc: string,
  sepoliaUsdc: string,
): string {
  if (chainId === CCTP_SOURCE_CHAIN_ID) return baseUsdc;
  if (chainId === CCTP_DEST_CHAIN_ID) return sepoliaUsdc;
  throw new Error(`Unsupported CCTP chainId for USDC: ${chainId}`);
}

/**
 * Create a real multi-chain executor that signs via Para MPC treasury.
 * Same wallet address on Base Sepolia (burn) and Ethereum Sepolia (mint).
 */
export function createParaChainExecutor(
  config: ParaChainExecutorConfig,
): CctpChainExecutor {
  const baseRpc = config.baseRpcUrl.trim();
  const sepoliaRpc = config.sepoliaRpcUrl.trim();
  if (!baseRpc || !sepoliaRpc) {
    throw new Error(
      "Para CCTP executor requires baseRpcUrl and sepoliaRpcUrl",
    );
  }
  if (!config.apiKey.trim()) {
    throw new Error("Para CCTP executor requires apiKey");
  }

  const client =
    config.restClient ??
    new ParaRestClient({
      apiKey: config.apiKey,
      env: config.environment,
    });

  const userIdentifier = config.userIdentifier.trim();
  const userIdentifierType = config.userIdentifierType.trim() as UserIdentifierType;
  const tokenMessenger = (
    config.tokenMessenger ?? CCTP_TOKEN_MESSENGER_V2
  ).trim();
  const messageTransmitter = (
    config.messageTransmitter ?? CCTP_MESSAGE_TRANSMITTER_V2
  ).trim();
  const baseUsdc = (config.baseUsdc ?? CCTP_BASE_USDC).trim();
  const sepoliaUsdc = (config.sepoliaUsdc ?? CCTP_SEPOLIA_USDC).trim();
  const confirmations = config.confirmations ?? 1;

  let cachedWallet: ParaTreasuryWallet | undefined;
  let ensurePromise: Promise<ParaTreasuryWallet> | undefined;

  function publicClient(chainId: number) {
    return createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId, baseRpc, sepoliaRpc)),
    });
  }

  async function ensureWallet(): Promise<ParaTreasuryWallet> {
    if (cachedWallet) return cachedWallet;
    if (!ensurePromise) {
      ensurePromise = (async () => {
        if (config.walletId?.trim()) {
          const wallet = await client.getWallet(config.walletId.trim(), {
            signal: AbortSignal.timeout(15_000),
          });
          if (wallet.type !== "EVM") {
            throw new Error(
              `Para wallet ${wallet.id} is type ${wallet.type}; expected EVM for CCTP treasury`,
            );
          }
          if (!wallet.address || !ADDRESS_RE.test(wallet.address)) {
            throw new Error(
              `Para wallet ${wallet.id} is not ready (missing EVM address)`,
            );
          }
          cachedWallet = {
            walletId: wallet.id,
            address: wallet.address,
            userIdentifier: wallet.userIdentifier ?? userIdentifier,
            userIdentifierType:
              wallet.userIdentifierType ?? userIdentifierType,
          };
          return cachedWallet;
        }

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
        const found =
          listed.data.find((w) => w.type === "EVM" && w.address) ??
          listed.data[0];
        if (!found?.address || !ADDRESS_RE.test(found.address)) {
          throw new Error(
            `No ready Para EVM treasury wallet for identifier ${userIdentifier}. Enroll treasury first.`,
          );
        }
        cachedWallet = {
          walletId: found.id,
          address: found.address,
          userIdentifier: found.userIdentifier ?? userIdentifier,
          userIdentifierType: found.userIdentifierType ?? userIdentifierType,
        };
        return cachedWallet;
      })().catch((error) => {
        ensurePromise = undefined;
        throw error;
      });
    }
    return ensurePromise;
  }

  async function waitReceiptByHash(
    chainId: number,
    txHash: string,
  ): Promise<CctpChainWriteResult> {
    const pc = publicClient(chainId);
    const started = Date.now();
    let receipt: Awaited<ReturnType<typeof pc.getTransactionReceipt>> | null =
      null;

    while (Date.now() - started < RECEIPT_TIMEOUT_MS) {
      try {
        receipt = await pc.getTransactionReceipt({ hash: txHash as Hash });
        break;
      } catch {
        // not mined yet
      }
      await new Promise((r) => setTimeout(r, RECEIPT_POLL_MS));
    }

    if (!receipt) {
      throw new Error(
        `No receipt for tx ${txHash} on chain ${chainId} after ${RECEIPT_TIMEOUT_MS}ms`,
      );
    }
    if (confirmations > 1) {
      const target = Number(receipt.blockNumber) + confirmations - 1;
      while (Number(await pc.getBlockNumber()) < target) {
        await new Promise((r) => setTimeout(r, RECEIPT_POLL_MS));
      }
    }
    if (receipt.status === "reverted") {
      throw new Error(`Transaction reverted: ${txHash} on chain ${chainId}`);
    }
    const explorers = cctpExplorerUrls({
      burnTxHash: chainId === CCTP_SOURCE_CHAIN_ID ? txHash : undefined,
      mintTxHash: chainId === CCTP_DEST_CHAIN_ID ? txHash : undefined,
    });
    return {
      txHash,
      gasUsed: receipt.gasUsed?.toString(),
      explorerUrl:
        chainId === CCTP_SOURCE_CHAIN_ID
          ? explorers.burnExplorerUrl ?? undefined
          : explorers.mintExplorerUrl ?? undefined,
    };
  }

  /**
   * Sign + broadcast arbitrary calldata via Para REST (EIP-1559).
   * Mirrors ParaTreasuryClient.sendTransfer — proven on Sepolia/Base.
   */
  async function sendCalldata(
    chainId: number,
    to: string,
    data: string,
    gasLimit: string,
    opLabel: string,
  ): Promise<CctpChainWriteResult> {
    const wallet = await ensureWallet();
    const checksumTo = getAddress(to);
    if (!data.startsWith("0x")) {
      throw new Error(`Calldata for ${opLabel} must be 0x-prefixed hex`);
    }
    const pc = publicClient(chainId);
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
          to: checksumTo,
          chainId,
          type: 2,
          value: "0",
          data,
          nonce,
          gasLimit,
          maxFeePerGas: maxFee.toString(),
          maxPriorityFeePerGas: maxPriority.toString(),
        },
        broadcast: true,
      },
      {
        idempotencyKey: `cctp-${opLabel}-${wallet.walletId}-${chainId}-${checksumTo}-${nonce}`,
        signal: AbortSignal.timeout(90_000),
      },
    );

    const txHash = result.txHash;
    if (!txHash || typeof txHash !== "string") {
      throw new Error(
        `Para signTransaction (${opLabel}) did not return txHash ` +
          `(wallet=${wallet.walletId}, transactionId=${result.transactionId ?? "n/a"})`,
      );
    }
    return waitReceiptByHash(chainId, txHash);
  }

  return {
    async getOperatorAddress() {
      const wallet = await ensureWallet();
      return wallet.address;
    },

    async getUsdcBalance(chainId, holder) {
      if (!ADDRESS_RE.test(holder)) {
        throw new Error(`Invalid holder address: ${holder}`);
      }
      const usdc = usdcForChain(chainId, baseUsdc, sepoliaUsdc);
      const contract = getContract({
        address: getAddress(usdc) as Address,
        abi: ERC20_ABI,
        client: publicClient(chainId),
      });
      const raw = await contract.read.balanceOf([
        getAddress(holder) as Address,
      ]);
      return Number(formatUnits(raw, CCTP_USDC_DECIMALS));
    },

    async getNativeBalanceEth(chainId, holder) {
      if (!ADDRESS_RE.test(holder)) {
        throw new Error(`Invalid holder address: ${holder}`);
      }
      const wei = await publicClient(chainId).getBalance({
        address: getAddress(holder) as Address,
      });
      return Number(formatEther(wei));
    },

    async getUsdcAllowance(chainId, owner, spender) {
      const usdc = usdcForChain(chainId, baseUsdc, sepoliaUsdc);
      const contract = getContract({
        address: getAddress(usdc) as Address,
        abi: ERC20_ABI,
        client: publicClient(chainId),
      });
      return contract.read.allowance([
        getAddress(owner) as Address,
        getAddress(spender) as Address,
      ]);
    },

    async approveUsdc(chainId, spender, amountAtomic) {
      if (chainId !== CCTP_SOURCE_CHAIN_ID) {
        throw new Error("USDC approve for CCTP burn is only on Base Sepolia");
      }
      const usdc = usdcForChain(chainId, baseUsdc, sepoliaUsdc);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [getAddress(spender) as Address, amountAtomic],
      });
      return sendCalldata(chainId, usdc, data, GAS_APPROVE, "approve");
    },

    async depositForBurn(chainId, params: DepositForBurnParams) {
      if (chainId !== CCTP_SOURCE_CHAIN_ID) {
        throw new Error("depositForBurn is only valid on Base Sepolia (source)");
      }
      const data = encodeDepositForBurn(params);
      return sendCalldata(
        chainId,
        tokenMessenger,
        data,
        GAS_DEPOSIT_FOR_BURN,
        "depositForBurn",
      );
    },

    async receiveMessage(chainId, message, attestation) {
      if (chainId !== CCTP_DEST_CHAIN_ID) {
        throw new Error(
          "receiveMessage is only valid on Ethereum Sepolia (dest)",
        );
      }
      const data = encodeReceiveMessage(message, attestation);
      return sendCalldata(
        chainId,
        messageTransmitter,
        data,
        GAS_RECEIVE_MESSAGE,
        "receiveMessage",
      );
    },

    async verifyMintTransfer(chainId, mintTxHash, recipient, minAmountAtomic) {
      if (chainId !== CCTP_DEST_CHAIN_ID) return false;
      let receipt: Awaited<
        ReturnType<ReturnType<typeof publicClient>["getTransactionReceipt"]>
      >;
      try {
        receipt = await publicClient(chainId).getTransactionReceipt({
          hash: mintTxHash as Hash,
        });
      } catch {
        return false;
      }
      if (receipt.status !== "success") return false;

      const usdc = usdcForChain(chainId, baseUsdc, sepoliaUsdc);
      const toAddr = getAddress(recipient).toLowerCase();
      let total = 0n;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== usdc.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({
            abi: ERC20_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (parsed.eventName !== "Transfer") continue;
          const args = parsed.args as { to?: Address; value?: bigint };
          const to = String(args.to).toLowerCase();
          if (to !== toAddr) continue;
          total += BigInt(args.value ?? 0n);
        } catch {
          // not a Transfer
        }
      }
      return total >= minAmountAtomic;
    },
  };
}

/**
 * Whether Para multi-chain CCTP executor can be constructed from server env.
 */
export function isParaChainExecutorConfigured(
  env: Pick<
    ServerEnv,
    | "paraApiKey"
    | "x402RpcUrl"
    | "rpcUrl"
    | "paraTreasuryUserIdentifier"
  >,
): boolean {
  return (
    isParaTreasuryConfigured(env) &&
    Boolean(env.x402RpcUrl?.trim()) &&
    Boolean(env.rpcUrl?.trim()) &&
    Boolean(env.paraTreasuryUserIdentifier?.trim())
  );
}

/**
 * Build Para CCTP executor from server env (caller must check configured).
 */
export function createParaChainExecutorFromEnv(
  env: ServerEnv,
): CctpChainExecutor {
  if (!isParaChainExecutorConfigured(env)) {
    throw new Error(
      "Para CCTP executor not configured (need PARA_API_KEY, treasury identifier, Base + Sepolia RPCs)",
    );
  }
  return createParaChainExecutor({
    apiKey: env.paraApiKey as string,
    environment: env.paraEnvironment,
    userIdentifier: env.paraTreasuryUserIdentifier,
    userIdentifierType: env.paraTreasuryUserIdentifierType,
    ...(env.paraWalletId?.trim()
      ? { walletId: env.paraWalletId.trim() }
      : {}),
    baseRpcUrl: env.x402RpcUrl as string,
    sepoliaRpcUrl: env.rpcUrl as string,
    tokenMessenger: env.cctpTokenMessenger,
    messageTransmitter: env.cctpMessageTransmitter,
    baseUsdc: env.x402UsdcAddress,
    sepoliaUsdc: env.deskUsdcAddress,
  });
}
