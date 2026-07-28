/**
 * Multi-chain CCTP executor: approve / depositForBurn / receiveMessage.
 *
 * Legacy path: CCTP operator key (env CCTP_OPERATOR_PRIVATE_KEY) for multi-chain
 * approve/burn/mint. Prefer {@link createParaChainExecutor} so USDC is burned
 * from the Para treasury pocket (same address as mint recipient).
 *
 * Mint recipient is always the treasury address (never the operator).
 */

import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  formatUnits,
  getAddress,
  getContract,
  http,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
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
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_V2_ABI,
  addressToBytes32,
  encodeDepositForBurn,
  encodeReceiveMessage,
} from "./cctp-contracts.ts";
import type {
  CctpChainExecutor,
  CctpChainWriteResult,
  DepositForBurnParams,
} from "./types.ts";
import { cctpExplorerUrls } from "./explorers.ts";

export interface OperatorExecutorConfig {
  privateKey: string;
  baseRpcUrl: string;
  sepoliaRpcUrl: string;
  tokenMessenger?: string;
  messageTransmitter?: string;
  baseUsdc?: string;
  sepoliaUsdc?: string;
  /** Optional confirmations to wait (default 1). */
  confirmations?: number;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

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

function normalizePrivateKey(key: string): Hex {
  const trimmed = key.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

/**
 * Create a real multi-chain executor backed by an operator EOA.
 * Requires RPC URLs for Base Sepolia and Ethereum Sepolia.
 */
export function createOperatorChainExecutor(
  config: OperatorExecutorConfig,
): CctpChainExecutor {
  const key = config.privateKey.trim();
  if (!key) {
    throw new Error("CCTP operator private key is empty");
  }
  const baseRpc = config.baseRpcUrl.trim();
  const sepoliaRpc = config.sepoliaRpcUrl.trim();
  if (!baseRpc || !sepoliaRpc) {
    throw new Error("CCTP operator executor requires baseRpcUrl and sepoliaRpcUrl");
  }

  const tokenMessenger = (
    config.tokenMessenger ?? CCTP_TOKEN_MESSENGER_V2
  ).trim();
  const messageTransmitter = (
    config.messageTransmitter ?? CCTP_MESSAGE_TRANSMITTER_V2
  ).trim();
  const baseUsdc = (config.baseUsdc ?? CCTP_BASE_USDC).trim();
  const sepoliaUsdc = (config.sepoliaUsdc ?? CCTP_SEPOLIA_USDC).trim();
  const confirmations = config.confirmations ?? 1;

  const account: PrivateKeyAccount = privateKeyToAccount(normalizePrivateKey(key));

  function publicClient(chainId: number) {
    return createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcForChain(chainId, baseRpc, sepoliaRpc)),
    });
  }

  function walletClient(chainId: number) {
    const chain = chainFromId(chainId);
    return createWalletClient({
      account,
      chain,
      transport: http(rpcForChain(chainId, baseRpc, sepoliaRpc)),
    });
  }

  async function waitReceipt(
    chainId: number,
    txHash: Hash,
  ): Promise<CctpChainWriteResult> {
    const pc = publicClient(chainId);
    const receipt = await pc.waitForTransactionReceipt({
      hash: txHash,
      confirmations,
    });
    if (receipt.status === "reverted") {
      throw new Error(
        `Transaction reverted: ${txHash} on chain ${chainId}`,
      );
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

  return {
    async getOperatorAddress() {
      return account.address;
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
      const wc = walletClient(chainId);
      const hash = await wc.writeContract({
        address: getAddress(usdc) as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [getAddress(spender) as Address, amountAtomic],
        chain: chainFromId(chainId),
        account,
      });
      return waitReceipt(chainId, hash);
    },

    async depositForBurn(chainId, params: DepositForBurnParams) {
      if (chainId !== CCTP_SOURCE_CHAIN_ID) {
        throw new Error("depositForBurn is only valid on Base Sepolia (source)");
      }
      // Encode via helper for parity with unit tests; send as contract call.
      const data = encodeDepositForBurn(params);
      const wc = walletClient(chainId);
      const hash = await wc.sendTransaction({
        to: getAddress(tokenMessenger) as Address,
        data: data as Hex,
        chain: chainFromId(chainId),
        account,
      });
      return waitReceipt(chainId, hash);
    },

    async receiveMessage(chainId, message, attestation) {
      if (chainId !== CCTP_DEST_CHAIN_ID) {
        throw new Error("receiveMessage is only valid on Ethereum Sepolia (dest)");
      }
      const data = encodeReceiveMessage(message, attestation);
      const wc = walletClient(chainId);
      const hash = await wc.sendTransaction({
        to: getAddress(messageTransmitter) as Address,
        data: data as Hex,
        chain: chainFromId(chainId),
        account,
      });
      return waitReceipt(chainId, hash);
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
 * Whether operator executor can be constructed from env-like fields.
 */
export function isOperatorExecutorConfigured(args: {
  privateKey?: string | undefined;
  baseRpcUrl?: string | undefined;
  sepoliaRpcUrl?: string | undefined;
}): boolean {
  return Boolean(
    args.privateKey?.trim() &&
      args.baseRpcUrl?.trim() &&
      args.sepoliaRpcUrl?.trim(),
  );
}

// Re-export ABI constants for consumers that need typed contracts.
export {
  ERC20_ABI,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  addressToBytes32,
};
