// Live dual-asset treasury balances for public activity surfaces.
// ETH = gas runway for KeeperHub registry writes.
// USDC = revenue float for payouts / affiliate withdrawals.

import {
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  decodeFunctionResult,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { chainFromId } from "../lib/viem-chain.ts";
import type { ParaTreasuryClient } from "./para-treasury-client.ts";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export interface LiveTreasuryBalances {
  /** Native gas balance in ETH. */
  ethBalance: number;
  /** USDC ERC-20 balance in human units (6 decimals). */
  usdcBalance: number;
  /** Treasury wallet address used for the reads. */
  walletAddress: string;
  ethSource: "para-mpc" | "rpc";
  usdcSource: "rpc";
}

export interface TreasuryBalancesProviderConfig {
  rpcUrl?: string;
  usdcAddress: string;
  usdcDecimals?: number;
  /** Fallback address when Para is unavailable. */
  treasuryAddress?: string;
  paraTreasury?: ParaTreasuryClient | null;
  /** Optional chain id for the RPC (default Sepolia). */
  chainId?: number;
}

function publicClientFor(rpcUrl: string, chainId = 11_155_111) {
  return createPublicClient({
    chain: chainFromId(chainId),
    transport: http(rpcUrl.trim()),
  });
}

/**
 * Read ERC-20 balanceOf as human units via JSON-RPC.
 */
export async function readErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  holder: string,
  decimals = 6,
  chainId = 11_155_111,
): Promise<number> {
  if (!ADDRESS_RE.test(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }
  if (!ADDRESS_RE.test(holder)) {
    throw new Error(`Invalid holder address: ${holder}`);
  }

  const client = publicClientFor(rpcUrl, chainId);
  const data = encodeFunctionData({
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [getAddress(holder) as Address],
  });
  const raw = await client.call({
    to: getAddress(tokenAddress) as Address,
    data,
  });
  if (!raw.data || raw.data === "0x") {
    throw new Error(`Empty balanceOf result for token ${tokenAddress}`);
  }
  const amount = decodeFunctionResult({
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    data: raw.data as Hex,
  });
  return Number(formatUnits(amount, decimals));
}

/**
 * Load live ETH + USDC for the agent treasury wallet.
 * Prefer Para for address + ETH; always read USDC via RPC (ERC-20).
 * Returns null when address or RPC is unavailable (caller falls back to snapshot).
 */
export async function loadLiveTreasuryBalances(
  config: TreasuryBalancesProviderConfig,
): Promise<LiveTreasuryBalances | null> {
  const rpcUrl = config.rpcUrl?.trim();
  const usdcAddress = config.usdcAddress?.trim();
  const decimals = config.usdcDecimals ?? 6;
  const chainId = config.chainId ?? 11_155_111;

  let walletAddress: string | undefined;
  let ethBalance: number | undefined;
  let ethSource: "para-mpc" | "rpc" = "rpc";

  if (config.paraTreasury) {
    try {
      const wallet = await config.paraTreasury.ensureWallet();
      walletAddress = wallet.address;
      ethBalance = await config.paraTreasury.getNativeBalanceEth();
      ethSource = "para-mpc";
    } catch (error) {
      console.warn(
        "[treasury] Para balance load failed; trying RPC:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!walletAddress) {
    const fallback = config.treasuryAddress?.trim();
    if (fallback && ADDRESS_RE.test(fallback)) {
      walletAddress = getAddress(fallback);
    }
  }

  if (!walletAddress || !rpcUrl) {
    if (walletAddress && ethBalance !== undefined) {
      // ETH known from Para but cannot read USDC without RPC.
      return null;
    }
    return null;
  }

  if (!usdcAddress || !ADDRESS_RE.test(usdcAddress)) {
    return null;
  }

  try {
    const client = publicClientFor(rpcUrl, chainId);

    if (ethBalance === undefined) {
      const wei = await client.getBalance({
        address: getAddress(walletAddress) as Address,
      });
      ethBalance = Number(formatEther(wei));
      ethSource = "rpc";
    }

    const usdcBalance = await readErc20Balance(
      rpcUrl,
      usdcAddress,
      walletAddress,
      decimals,
      chainId,
    );

    return {
      ethBalance,
      usdcBalance,
      walletAddress,
      ethSource,
      usdcSource: "rpc",
    };
  } catch (error) {
    console.warn(
      "[treasury] Live dual-balance fetch failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
