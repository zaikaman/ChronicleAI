/**
 * Desk position service: mark equity via RPC (ERC-20 balances + Aave account data).
 * No mocked fills — failed RPC reads surface as errors.
 */

import { SEPOLIA_DESK } from "@chronicleai/config";
import type { DeskPositionRepository, DeskPositionRow } from "@chronicleai/db";
import { DESK_POSITION_RETAIN_COUNT } from "@chronicleai/db";
import {
  type Address,
  createPublicClient,
  formatUnits,
  getAddress,
  getContract,
  http,
  parseAbi,
} from "viem";
import { deskLog } from "../lib/logger.ts";
import { chainFromId } from "../lib/viem-chain.ts";
import { readErc20Balance } from "../services/treasury-balances.ts";
import type { PriceOracle } from "../monitoring/price-oracle-service.ts";
import type { AaveAccountSnapshot, DeskPositionMark } from "./types.ts";
import { DESK_CHAIN_ID } from "./types.ts";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const AAVE_POOL_ABI = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

/** Aave V3 base currency is USD with 8 decimals. */
const AAVE_BASE_DECIMALS = 8;
/** Health factor is a ray (1e18). Max uint256 means no debt. */
const HF_RAY = 10n ** 18n;
const HF_MAX_NO_DEBT = 2n ** 128n; // practical "infinite" cutover
/** JSON-safe finite sentinel for Aave's infinite/no-debt health factor. */
export const NO_DEBT_HEALTH_FACTOR = 999;

export interface PositionService {
  /** Live mark for desk wallet; optionally persist snapshot. */
  mark(options?: { persist?: boolean; deskAddress?: string }): Promise<DeskPositionMark>;
  getLatest(deskAddress?: string): Promise<DeskPositionRow | null>;
  readAaveAccount(deskAddress: string): Promise<AaveAccountSnapshot>;
  readTokenBalances(deskAddress: string): Promise<{
    usdc: number;
    weth: number;
    link: number;
  }>;
}

export interface PositionServiceConfig {
  rpcUrl: string;
  deskWalletAddress: string;
  usdcAddress?: string;
  wethAddress?: string;
  linkAddress?: string;
  aavePoolAddress?: string;
  chainId?: number;
  usdcDecimals?: number;
  /** Optional LINK/USD for equity mark when no dedicated feed. */
  linkUsdFallback?: number;
}

export function parseHealthFactor(hfRay: bigint): number {
  if (hfRay === 0n) return 0;
  if (hfRay > HF_MAX_NO_DEBT) return NO_DEBT_HEALTH_FACTOR;
  const asNumber = Number(hfRay) / Number(HF_RAY);
  if (!Number.isFinite(asNumber)) return NO_DEBT_HEALTH_FACTOR;
  return asNumber;
}

function baseToUsd(base: bigint): number {
  return Number(formatUnits(base, AAVE_BASE_DECIMALS));
}

export function createPositionService(deps: {
  config: PositionServiceConfig;
  positions: DeskPositionRepository;
  priceOracle?: PriceOracle | null;
}): PositionService {
  const { config, positions, priceOracle } = deps;
  const rpcUrl = config.rpcUrl.trim();
  const deskDefault = config.deskWalletAddress.trim().toLowerCase();
  const usdcAddress = (config.usdcAddress ?? SEPOLIA_DESK.usdc).trim();
  const wethAddress = (config.wethAddress ?? SEPOLIA_DESK.weth).trim();
  const linkAddress = (config.linkAddress ?? SEPOLIA_DESK.link).trim();
  const aLinkAddress = (SEPOLIA_DESK.aaveV3ALink).trim();
  const aavePool = (config.aavePoolAddress ?? SEPOLIA_DESK.aaveV3Pool).trim();
  const chainId = config.chainId ?? DESK_CHAIN_ID;
  const usdcDecimals = config.usdcDecimals ?? 6;
  /** P2-9: prune at most every N persisted marks. */
  let persistsSincePrune = 0;
  const PRUNE_EVERY_PERSISTS = 25;

  function requireAddress(label: string, value: string): string {
    if (!ADDRESS_RE.test(value)) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
    return getAddress(value);
  }

  async function readTokenBalances(deskAddress: string) {
    const holder = requireAddress("deskAddress", deskAddress);
    if (!rpcUrl) {
      throw new Error("RPC_URL is required to mark desk positions");
    }

    const [usdc, weth, link] = await Promise.all([
      readErc20Balance(rpcUrl, usdcAddress, holder, usdcDecimals, chainId),
      readErc20Balance(rpcUrl, wethAddress, holder, 18, chainId),
      readErc20Balance(rpcUrl, linkAddress, holder, 18, chainId),
    ]);

    return { usdc, weth, link };
  }

  async function readAaveAccount(deskAddress: string): Promise<AaveAccountSnapshot> {
    const holder = requireAddress("deskAddress", deskAddress);
    if (!rpcUrl) {
      throw new Error("RPC_URL is required for Aave account data");
    }

    const client = createPublicClient({
      chain: chainFromId(chainId),
      transport: http(rpcUrl),
    });
    const pool = getContract({
      address: getAddress(aavePool) as Address,
      abi: AAVE_POOL_ABI,
      client,
    });
    // Parallel: account health + exact aEthLINK (aToken) balance for withdraw sizing.
    const [result, aLinkHuman] = await Promise.all([
      pool.read.getUserAccountData([holder as Address]),
      readErc20Balance(rpcUrl, aLinkAddress, holder, 18, chainId).catch(() => 0),
    ]);

    const [
      totalCollateralBase,
      totalDebtBase,
      availableBorrowsBase,
      currentLiquidationThreshold,
      ltv,
      healthFactorRay,
    ] = result;

    const totalDebtUsd = baseToUsd(totalDebtBase);
    const hf =
      totalDebtUsd <= 0 ? NO_DEBT_HEALTH_FACTOR : parseHealthFactor(healthFactorRay);

    const aLinkSupplied =
      Number.isFinite(aLinkHuman) && aLinkHuman > 0 ? aLinkHuman : undefined;

    return {
      totalCollateralUsd: baseToUsd(totalCollateralBase),
      totalDebtUsd,
      availableBorrowsUsd: baseToUsd(availableBorrowsBase),
      currentLiquidationThreshold: Number(currentLiquidationThreshold) / 100,
      ltv: Number(ltv) / 100,
      healthFactor: hf,
      ...(aLinkSupplied != null ? { aLinkSupplied } : {}),
      raw: {
        totalCollateralBase: totalCollateralBase.toString(),
        totalDebtBase: totalDebtBase.toString(),
        healthFactorRay: healthFactorRay.toString(),
        ...(aLinkSupplied != null
          ? { aLinkSuppliedBase: String(Math.floor(aLinkSupplied * 1e18)) }
          : {}),
      },
    };
  }

  async function mark(options?: {
    persist?: boolean;
    deskAddress?: string;
  }): Promise<DeskPositionMark> {
    const deskAddress = (options?.deskAddress ?? deskDefault).toLowerCase();
    if (!ADDRESS_RE.test(deskAddress)) {
      throw new Error(
        `DESK_WALLET_ADDRESS is required to mark positions (got ${deskAddress})`,
      );
    }
    if (!rpcUrl) {
      throw new Error("RPC_URL is required to mark desk positions");
    }

    const asOf = new Date().toISOString();
    const [balances, aave] = await Promise.all([
      readTokenBalances(deskAddress),
      readAaveAccount(deskAddress),
    ]);

    let ethUsd: number | null = null;
    let linkUsd: number | null = config.linkUsdFallback ?? null;
    if (priceOracle) {
      const [eth, link] = await Promise.all([
        priceOracle.getEthUsdPrice(chainId),
        priceOracle.getLinkUsdPrice(chainId),
      ]);
      ethUsd = eth;
      // Prefer live Chainlink over static fallback (testnet + mainnet).
      if (link != null && link > 0) {
        linkUsd = link;
      }
    }

    const wethUsdc =
      ethUsd != null && ethUsd > 0 ? balances.weth * ethUsd : 0;
    const linkUsdc =
      linkUsd != null && linkUsd > 0 ? balances.link * linkUsd : 0;

    // Equity ≈ free inventory + aave net (collateral − debt). Unpriced LINK stays at 0 mark.
    const aaveNet = aave.totalCollateralUsd - aave.totalDebtUsd;
    const equityUsdc =
      Math.round((balances.usdc + wethUsdc + linkUsdc + aaveNet) * 1e6) / 1e6;

    const markResult: DeskPositionMark = {
      asOf,
      deskAddress,
      usdc: balances.usdc,
      weth: balances.weth,
      link: balances.link,
      aave,
      morpho: null,
      lido: null,
      equityUsdc,
      ethUsd,
      linkUsd,
      raw: {
        chainId,
        aavePool,
        usdcAddress,
        wethAddress,
        linkAddress,
      },
    };

    if (options?.persist) {
      const inserted = await positions.create({
        as_of: asOf,
        desk_address: deskAddress,
        usdc: balances.usdc,
        weth: balances.weth,
        link: balances.link,
        aave: aave as unknown as Record<string, unknown>,
        morpho: null,
        lido: null,
        equity_usdc: equityUsdc,
        raw: markResult.raw ?? {},
      });
      if (!inserted.ok) throw inserted.error;

      persistsSincePrune += 1;
      if (persistsSincePrune >= PRUNE_EVERY_PERSISTS) {
        persistsSincePrune = 0;
        void positions.pruneKeepLatest(DESK_POSITION_RETAIN_COUNT).then((pruned) => {
          if (pruned.ok && pruned.value > 0) {
            deskLog.debug("position prune", { deleted: pruned.value });
          }
        });
      }
    }

    return markResult;
  }

  return {
    mark,
    readAaveAccount,
    readTokenBalances,
    async getLatest(deskAddress?) {
      const result = await positions.findLatest(deskAddress);
      if (!result.ok) throw result.error;
      return result.value;
    },
  };
}
