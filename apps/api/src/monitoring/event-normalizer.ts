// Normalize KeeperHub Event Tracker payloads into Chronicle EventIngestionPayload

import {
  lookupProtocolContract,
  type ProtocolContract,
  type TokenMeta,
} from "@chronicleai/config";
import type {
  EventIngestionPayload,
  EventType,
  RawOnChainEventPayload,
} from "@chronicleai/schemas";
import { EVENT_TYPES } from "@chronicleai/schemas";
import { absBigInt, argAsBigInt, argAsString, scaleTokenAmount } from "./arg-utils.ts";
import type { PriceOracle } from "./price-oracle-service.ts";

export interface EventNormalizer {
  /**
   * Accept either a fully-classified Chronicle event or a raw on-chain event
   * payload from KeeperHub Event Tracker / workflow expansion.
   */
  normalize(
    body: Record<string, unknown>,
  ): Promise<{ ok: true; payload: EventIngestionPayload } | { ok: false; error: string }>;
}

const STABLE_DECIMALS: Record<string, { symbol: string; decimals: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18 },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 }, // Base USDC
};

const WETH_ADDRESSES = new Set([
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  "0x7b79995e5f793a07bc00c21412e50ecae098e7f9", // Sepolia WETH
  "0x4200000000000000000000000000000000000006", // OP/Base WETH
]);

function isClassifiedEvent(body: Record<string, unknown>): boolean {
  return typeof body.eventType === "string" && EVENT_TYPES.includes(body.eventType as EventType);
}

function isRawOnChainEvent(body: Record<string, unknown>): boolean {
  return typeof body.eventName === "string" && body.chainId !== undefined;
}

function parseChainId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildSourceEventId(raw: RawOnChainEventPayload): string {
  if (raw.sourceEventId) return raw.sourceEventId;
  const tx = raw.transactionHash ?? "unknown-tx";
  const log = raw.logIndex !== undefined ? String(raw.logIndex) : "0";
  const name = raw.eventName;
  return `${raw.chainId}-${tx}-${log}-${name}`;
}

async function usdFromTokenAmount(
  amountRaw: bigint,
  token: TokenMeta | undefined,
  tokenAddress: string | undefined,
  ethUsd: number | null,
): Promise<{ usd: number; symbols: string[] } | null> {
  if (token) {
    const human = scaleTokenAmount(amountRaw, token.decimals);
    if (token.isStableUsd) {
      return { usd: human, symbols: [token.symbol] };
    }
    if (ethUsd && !token.isStableUsd) {
      return { usd: human * ethUsd, symbols: [token.symbol] };
    }
  }

  if (tokenAddress) {
    const lower = tokenAddress.toLowerCase();
    const stable = STABLE_DECIMALS[lower];
    if (stable) {
      return { usd: scaleTokenAmount(amountRaw, stable.decimals), symbols: [stable.symbol] };
    }
    if (WETH_ADDRESSES.has(lower) && ethUsd) {
      return { usd: scaleTokenAmount(amountRaw, 18) * ethUsd, symbols: ["WETH"] };
    }
  }

  return null;
}

async function normalizeSwap(
  raw: RawOnChainEventPayload,
  contract: ProtocolContract | undefined,
  ethUsd: number | null,
): Promise<EventIngestionPayload | null> {
  const args = raw.args ?? {};
  const amount0 = argAsBigInt(args.amount0);
  const amount1 = argAsBigInt(args.amount1);

  let bestUsd = 0;
  const symbols: string[] = [];

  if (amount0 !== undefined) {
    const r0 = await usdFromTokenAmount(
      absBigInt(amount0),
      contract?.token0,
      contract?.token0?.address,
      ethUsd,
    );
    if (r0 && r0.usd > bestUsd) {
      bestUsd = r0.usd;
      symbols.length = 0;
      symbols.push(...r0.symbols);
    }
  }

  if (amount1 !== undefined) {
    const r1 = await usdFromTokenAmount(
      absBigInt(amount1),
      contract?.token1,
      contract?.token1?.address,
      ethUsd,
    );
    if (r1) {
      if (r1.usd > bestUsd) bestUsd = r1.usd;
      for (const s of r1.symbols) {
        if (!symbols.includes(s)) symbols.push(s);
      }
    }
  }

  // CoW Trade path: sellAmount / buyAmount
  if (amount0 === undefined && amount1 === undefined) {
    const sellAmount = argAsBigInt(args.sellAmount);
    const buyAmount = argAsBigInt(args.buyAmount);
    const sellToken = argAsString(args.sellToken);
    const buyToken = argAsString(args.buyToken);

    if (sellAmount !== undefined) {
      const r = await usdFromTokenAmount(sellAmount, undefined, sellToken, ethUsd);
      if (r && r.usd > bestUsd) {
        bestUsd = r.usd;
        symbols.length = 0;
        symbols.push(...r.symbols);
      }
    }
    if (buyAmount !== undefined) {
      const r = await usdFromTokenAmount(buyAmount, undefined, buyToken, ethUsd);
      if (r) {
        if (r.usd > bestUsd) bestUsd = r.usd;
        for (const s of r.symbols) {
          if (!symbols.includes(s)) symbols.push(s);
        }
      }
    }
  }

  if (contract?.token0?.symbol && !symbols.includes(contract.token0.symbol)) {
    symbols.push(contract.token0.symbol);
  }
  if (contract?.token1?.symbol && !symbols.includes(contract.token1.symbol)) {
    symbols.push(contract.token1.symbol);
  }

  return {
    sourceEventId: buildSourceEventId(raw),
    eventType: "large_swap",
    chainId: raw.chainId,
    protocol: contract?.protocol ?? raw.protocol ?? "DEX",
    ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
    ...(symbols.length > 0 ? { assetSymbols: symbols } : {}),
    ...(bestUsd > 0 ? { magnitude: { value: bestUsd, unit: "USD" } } : {}),
    capturedAt: raw.capturedAt ?? nowIso(),
    rawPayload: (raw.rawPayload ?? (raw as unknown as Record<string, unknown>)) as Record<
      string,
      unknown
    >,
  };
}

async function normalizeLiquidation(
  raw: RawOnChainEventPayload,
  contract: ProtocolContract | undefined,
  ethUsd: number | null,
): Promise<EventIngestionPayload> {
  const args = raw.args ?? {};
  const debtToCover = argAsBigInt(args.debtToCover);
  const debtAsset = argAsString(args.debtAsset);
  const collateralAsset = argAsString(args.collateralAsset);

  let usd = 0;
  const symbols: string[] = [];

  if (debtToCover !== undefined) {
    const r = await usdFromTokenAmount(debtToCover, undefined, debtAsset, ethUsd);
    if (r) {
      usd = r.usd;
      symbols.push(...r.symbols);
    }
  }

  if (collateralAsset) {
    const stable = STABLE_DECIMALS[collateralAsset.toLowerCase()];
    if (stable && !symbols.includes(stable.symbol)) symbols.push(stable.symbol);
    if (WETH_ADDRESSES.has(collateralAsset.toLowerCase()) && !symbols.includes("WETH")) {
      symbols.push("WETH");
    }
  }

  return {
    sourceEventId: buildSourceEventId(raw),
    eventType: "liquidation",
    chainId: raw.chainId,
    protocol: contract?.protocol ?? raw.protocol ?? "Aave V3",
    ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
    ...(symbols.length > 0 ? { assetSymbols: symbols } : {}),
    ...(usd > 0 ? { magnitude: { value: usd, unit: "USD" } } : {}),
    capturedAt: raw.capturedAt ?? nowIso(),
    rawPayload: (raw.rawPayload ?? (raw as unknown as Record<string, unknown>)) as Record<
      string,
      unknown
    >,
  };
}

function normalizeDeployment(
  raw: RawOnChainEventPayload,
  contract: ProtocolContract | undefined,
): EventIngestionPayload {
  const args = raw.args ?? {};
  const pool = argAsString(args.pool);
  return {
    sourceEventId: buildSourceEventId(raw),
    eventType: "contract_deployment",
    chainId: raw.chainId,
    protocol: contract?.protocol ?? raw.protocol ?? "Factory",
    ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
    ...(pool ? { assetSymbols: [pool] } : {}),
    magnitude: { value: 0, unit: "any" },
    capturedAt: raw.capturedAt ?? nowIso(),
    rawPayload: (raw.rawPayload ?? (raw as unknown as Record<string, unknown>)) as Record<
      string,
      unknown
    >,
  };
}

function toClassifiedPayload(body: Record<string, unknown>): EventIngestionPayload {
  return {
    sourceEventId: String(body.sourceEventId),
    eventType: body.eventType as EventType,
    chainId: Number(body.chainId),
    capturedAt: String(body.capturedAt ?? nowIso()),
    rawPayload: (body.rawPayload ?? body) as Record<string, unknown>,
    ...(body.protocol ? { protocol: String(body.protocol) } : {}),
    ...(body.transactionHash ? { transactionHash: String(body.transactionHash) } : {}),
    ...(body.assetSymbols ? { assetSymbols: body.assetSymbols as string[] } : {}),
    ...(body.magnitude ? { magnitude: body.magnitude as { value: number; unit: string } } : {}),
  };
}

function toRawPayload(body: Record<string, unknown>): RawOnChainEventPayload | null {
  const chainId = parseChainId(body.chainId);
  if (chainId === null) return null;
  if (typeof body.eventName !== "string") return null;

  return {
    chainId,
    eventName: body.eventName,
    ...(typeof body.sourceEventId === "string" ? { sourceEventId: body.sourceEventId } : {}),
    ...(typeof body.address === "string"
      ? { address: body.address }
      : typeof body.contractAddress === "string"
        ? { address: body.contractAddress }
        : {}),
    ...(typeof body.transactionHash === "string" ? { transactionHash: body.transactionHash } : {}),
    ...(body.blockNumber !== undefined ? { blockNumber: body.blockNumber as number | string } : {}),
    ...(typeof body.blockHash === "string" ? { blockHash: body.blockHash } : {}),
    ...(body.logIndex !== undefined ? { logIndex: body.logIndex as number | string } : {}),
    ...(typeof body.capturedAt === "string" ? { capturedAt: body.capturedAt } : {}),
    ...(body.args && typeof body.args === "object"
      ? { args: body.args as Record<string, unknown> }
      : {}),
    ...(body.rawPayload && typeof body.rawPayload === "object"
      ? { rawPayload: body.rawPayload as Record<string, unknown> }
      : {}),
    ...(typeof body.protocol === "string" ? { protocol: body.protocol } : {}),
    ...(body.magnitude && typeof body.magnitude === "object"
      ? { magnitude: body.magnitude as { value: number; unit: string } }
      : {}),
  };
}

export function createEventNormalizer(priceOracle: PriceOracle): EventNormalizer {
  return {
    async normalize(body) {
      if (!body || typeof body !== "object") {
        return { ok: false, error: "Request body must be a JSON object" };
      }

      // Path A: already-classified Chronicle event
      if (isClassifiedEvent(body)) {
        if (!body.sourceEventId || typeof body.sourceEventId !== "string") {
          return { ok: false, error: "sourceEventId is required and must be a string" };
        }
        if (body.chainId === undefined || Number.isNaN(Number(body.chainId))) {
          return { ok: false, error: "chainId is required and must be a number" };
        }
        return { ok: true, payload: toClassifiedPayload(body) };
      }

      // Path B: raw Event Tracker / workflow payload
      if (!isRawOnChainEvent(body)) {
        return {
          ok: false,
          error:
            "Payload must include eventType (classified) or eventName+chainId (raw on-chain event)",
        };
      }

      const raw = toRawPayload(body);
      if (!raw) {
        return { ok: false, error: "Invalid raw on-chain event payload" };
      }

      const contract = lookupProtocolContract(raw.chainId, raw.address);
      const ethUsd = await priceOracle.getEthUsdPrice(raw.chainId);
      const eventName = raw.eventName;

      let payload: EventIngestionPayload | null = null;

      if (eventName === "Swap" || eventName === "Trade") {
        payload = await normalizeSwap(raw, contract, ethUsd);
      } else if (eventName === "LiquidationCall") {
        payload = await normalizeLiquidation(raw, contract, ethUsd);
      } else if (
        eventName === "PoolCreated" ||
        eventName === "ContractCreated" ||
        eventName === "ProxyCreated" ||
        eventName === "NewContract"
      ) {
        payload = normalizeDeployment(raw, contract);
      } else if (contract?.kind === "uniswap_v3_factory") {
        payload = normalizeDeployment(raw, contract);
      } else {
        // Unknown event: if magnitude was supplied by upstream workflow, accept as large_swap fallback
        if (raw.magnitude) {
          payload = {
            sourceEventId: buildSourceEventId(raw),
            eventType: "large_swap",
            chainId: raw.chainId,
            protocol: contract?.protocol ?? raw.protocol,
            ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
            magnitude: raw.magnitude,
            capturedAt: raw.capturedAt ?? nowIso(),
            rawPayload: (raw.rawPayload ?? body) as Record<string, unknown>,
          };
        } else {
          return {
            ok: false,
            error: `Unsupported eventName "${eventName}" for address ${raw.address ?? "unknown"} — configure a known protocol or supply magnitude`,
          };
        }
      }

      if (!payload) {
        return { ok: false, error: "Failed to normalize on-chain event" };
      }

      // Honour explicit magnitude override from upstream workflow
      if (raw.magnitude) {
        payload = { ...payload, magnitude: raw.magnitude };
      }

      return { ok: true, payload };
    },
  };
}

