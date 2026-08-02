// Normalize KeeperHub Event Tracker payloads into Chronicle EventIngestionPayload

import {
  type ProtocolContract,
  type TokenMeta,
  isExchangeAddress,
  lookupEntity,
  lookupProtocolContract,
} from "@chronicleai/config";
import type {
  EventIngestionPayload,
  EventType,
  FlowContext,
  RawOnChainEventPayload,
} from "@chronicleai/schemas";
import { EVENT_TYPES } from "@chronicleai/schemas";
import { absBigInt, argAsBigInt, argAsString, scaleTokenAmount } from "./arg-utils.ts";
import { attachFlowContextToRawPayload, enrichFlowContext } from "./flow-enrichment.ts";
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const STABLE_DECIMALS: Record<string, { symbol: string; decimals: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18 },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 }, // Base mainnet USDC
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": { symbol: "USDC", decimals: 6 }, // Ethereum Sepolia USDC (Circle)
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 }, // Base Sepolia USDC (legacy)
  "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f": { symbol: "USDC", decimals: 6 }, // Base Sepolia Aave USDC (legacy)
};

const WETH_ADDRESSES = new Set([
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // Ethereum mainnet WETH
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", // Ethereum Sepolia WETH
  "0x4200000000000000000000000000000000000006", // OP / Base / Base Sepolia WETH
]);

const USDC_CONTRACTS = new Set([
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
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

function numberField(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseArrayLength(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function arrayLengthValidationError(body: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, "arrayLength")) return null;
  return parseArrayLength(body.arrayLength) === undefined
    ? "arrayLength is present but must be a numeric integer greater than or equal to 0"
    : null;
}

function attachCanonicalEvidence(
  payload: EventIngestionPayload,
  raw: RawOnChainEventPayload,
): EventIngestionPayload {
  const sourceEventId = payload.sourceEventId;
  const sourceDedupeKey = `${payload.chainId}:${payload.eventType}:${sourceEventId}`;
  return {
    ...payload,
    ...(numberField(raw.blockNumber) !== undefined
      ? { blockNumber: numberField(raw.blockNumber) }
      : {}),
    ...(raw.blockHash ? { blockHash: raw.blockHash } : {}),
    ...(numberField(raw.logIndex) !== undefined ? { logIndex: numberField(raw.logIndex) } : {}),
    ...(raw.address ? { sourceContract: raw.address } : {}),
    ...(parseArrayLength(raw.arrayLength) !== undefined
      ? { arrayLength: parseArrayLength(raw.arrayLength) }
      : {}),
    sourceDedupeKey,
    normalizedFeatures: {
      ...(payload.normalizedFeatures ?? {}),
      sourceEventId,
      eventType: payload.eventType,
      chainId: payload.chainId,
      protocol: payload.protocol ?? null,
      transactionHash: payload.transactionHash ?? null,
      blockNumber: numberField(raw.blockNumber) ?? null,
      blockHash: raw.blockHash ?? null,
      logIndex: numberField(raw.logIndex) ?? null,
      sourceContract: raw.address ?? null,
      ...(raw.arrayLength !== undefined ? { arrayLength: raw.arrayLength } : {}),
    },
  };
}

function withFlow(payload: EventIngestionPayload, flowContext: FlowContext): EventIngestionPayload {
  return {
    ...payload,
    flowContext,
    rawPayload: attachFlowContextToRawPayload(payload.rawPayload, flowContext),
  };
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

function symbolForTokenAddress(tokenAddress: string | undefined): string | undefined {
  if (!tokenAddress) return undefined;
  const lower = tokenAddress.toLowerCase();
  const stable = STABLE_DECIMALS[lower];
  if (stable) return stable.symbol;
  if (WETH_ADDRESSES.has(lower)) return "WETH";
  return undefined;
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
  let sellSymbol: string | undefined;
  let buySymbol: string | undefined;
  let fromAddress = argAsString(args.sender) ?? argAsString(args.owner);
  let toAddress = argAsString(args.recipient);

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
    // Negative amount0 means pool receives token0 (user sold token0)
    if (contract?.token0?.symbol) {
      if (amount0 < 0n) sellSymbol = contract.token0.symbol;
      else if (amount0 > 0n) buySymbol = contract.token0.symbol;
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
    if (contract?.token1?.symbol) {
      if (amount1 < 0n) sellSymbol = contract.token1.symbol;
      else if (amount1 > 0n) buySymbol = contract.token1.symbol;
    }
  }

  // CoW Trade path: sellAmount / buyAmount
  if (amount0 === undefined && amount1 === undefined) {
    const sellAmount = argAsBigInt(args.sellAmount);
    const buyAmount = argAsBigInt(args.buyAmount);
    const sellToken = argAsString(args.sellToken);
    const buyToken = argAsString(args.buyToken);
    sellSymbol = symbolForTokenAddress(sellToken);
    buySymbol = symbolForTokenAddress(buyToken);
    fromAddress = argAsString(args.owner) ?? fromAddress;
    toAddress = undefined;

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

  const base: EventIngestionPayload = {
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

  const flow = enrichFlowContext({
    eventType: "large_swap",
    chainId: raw.chainId,
    protocol: base.protocol,
    assetSymbols: base.assetSymbols,
    fromAddress,
    toAddress,
    sellSymbol,
    buySymbol,
    subjectAddress: fromAddress,
    venue: base.protocol,
  });

  return withFlow(base, flow);
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
  const user = argAsString(args.user);
  const liquidator = argAsString(args.liquidator);

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

  const base: EventIngestionPayload = {
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

  const flow = enrichFlowContext({
    eventType: "liquidation",
    chainId: raw.chainId,
    protocol: base.protocol,
    assetSymbols: base.assetSymbols,
    fromAddress: user,
    toAddress: liquidator,
    subjectAddress: user,
    counterpartyAddress: liquidator,
    venue: base.protocol,
  });

  return withFlow(base, flow);
}

function normalizeDeployment(
  raw: RawOnChainEventPayload,
  contract: ProtocolContract | undefined,
): EventIngestionPayload {
  const args = raw.args ?? {};
  const pool = argAsString(args.pool);
  const base: EventIngestionPayload = {
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

  const flow = enrichFlowContext({
    eventType: "contract_deployment",
    chainId: raw.chainId,
    protocol: base.protocol,
    venue: base.protocol,
  });

  return withFlow(base, flow);
}

/**
 * ERC-20 Transfer involving a labeled CEX wallet → cex_inflow / cex_outflow.
 * Unknown transfers are not classified (return null).
 */
async function normalizeCexTransfer(
  raw: RawOnChainEventPayload,
  ethUsd: number | null,
): Promise<EventIngestionPayload | null> {
  const args = raw.args ?? {};
  const from = argAsString(args.from);
  const to = argAsString(args.to);
  const value = argAsBigInt(args.value) ?? argAsBigInt(args.amount);

  if (!from || !to || value === undefined) return null;

  const fromIsCex = isExchangeAddress(from, raw.chainId);
  const toIsCex = isExchangeAddress(to, raw.chainId);

  if (!fromIsCex && !toIsCex) return null;
  // Internal CEX hop — skip
  if (fromIsCex && toIsCex) return null;

  const tokenAddress = raw.address?.toLowerCase();
  const priced = await usdFromTokenAmount(value, undefined, tokenAddress, ethUsd);
  if (!priced) return null;

  const eventType: EventType = toIsCex ? "cex_inflow" : "cex_outflow";
  const cexEntity = lookupEntity(toIsCex ? to : from, raw.chainId);

  const base: EventIngestionPayload = {
    sourceEventId: buildSourceEventId(raw),
    eventType,
    chainId: raw.chainId,
    protocol: cexEntity?.label ?? "CEX",
    ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
    assetSymbols: priced.symbols,
    magnitude: { value: priced.usd, unit: "USD" },
    capturedAt: raw.capturedAt ?? nowIso(),
    rawPayload: (raw.rawPayload ?? (raw as unknown as Record<string, unknown>)) as Record<
      string,
      unknown
    >,
  };

  const flow = enrichFlowContext({
    eventType,
    chainId: raw.chainId,
    protocol: base.protocol,
    assetSymbols: base.assetSymbols,
    fromAddress: from,
    toAddress: to,
    subjectAddress: toIsCex ? from : to,
    counterpartyAddress: toIsCex ? to : from,
    venue: cexEntity?.label ?? "CEX",
  });

  return withFlow(base, flow);
}

/**
 * Circle FiatToken Mint / Burn (or Transfer from/to zero address on USDC).
 */
async function normalizeStablecoinSupply(
  raw: RawOnChainEventPayload,
  eventName: string,
): Promise<EventIngestionPayload | null> {
  const tokenAddress = raw.address?.toLowerCase();
  if (!tokenAddress || !USDC_CONTRACTS.has(tokenAddress)) {
    // Also accept when protocol says Circle / USDC
    const protocol = (raw.protocol ?? "").toLowerCase();
    if (!protocol.includes("circle") && !protocol.includes("usdc")) {
      // Still allow if we can price via STABLE_DECIMALS
      if (!tokenAddress || !STABLE_DECIMALS[tokenAddress]) return null;
    }
  }

  const args = raw.args ?? {};
  let amount = argAsBigInt(args.amount) ?? argAsBigInt(args.value);
  let eventType: EventType | null = null;
  let toAddress: string | undefined;
  let fromAddress: string | undefined;

  if (eventName === "Mint") {
    eventType = "stablecoin_mint";
    amount = amount ?? argAsBigInt(args.amount);
    toAddress = argAsString(args.to);
    fromAddress = argAsString(args.minter);
  } else if (eventName === "Burn") {
    eventType = "stablecoin_burn";
    amount = amount ?? argAsBigInt(args.amount);
    fromAddress = argAsString(args.burner);
  } else if (eventName === "Transfer") {
    const from = argAsString(args.from)?.toLowerCase();
    const to = argAsString(args.to)?.toLowerCase();
    if (from === ZERO_ADDRESS && to && to !== ZERO_ADDRESS) {
      eventType = "stablecoin_mint";
      toAddress = to;
      fromAddress = ZERO_ADDRESS;
      amount = argAsBigInt(args.value);
    } else if (to === ZERO_ADDRESS && from && from !== ZERO_ADDRESS) {
      eventType = "stablecoin_burn";
      fromAddress = from;
      toAddress = ZERO_ADDRESS;
      amount = argAsBigInt(args.value);
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!eventType || amount === undefined) return null;

  const priced = await usdFromTokenAmount(amount, undefined, tokenAddress, null);
  // USDC is 1:1 USD with 6 decimals even without oracle
  let usd = priced?.usd ?? 0;
  const symbols = priced?.symbols ?? ["USDC"];
  const stableMeta = tokenAddress ? STABLE_DECIMALS[tokenAddress] : undefined;
  if (!priced && stableMeta) {
    const meta = stableMeta;
    usd = scaleTokenAmount(amount, meta.decimals);
    symbols[0] = meta.symbol;
  }
  if (usd <= 0) return null;

  const base: EventIngestionPayload = {
    sourceEventId: buildSourceEventId(raw),
    eventType,
    chainId: raw.chainId,
    protocol: "Circle",
    ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
    assetSymbols: symbols,
    magnitude: { value: usd, unit: "USD" },
    capturedAt: raw.capturedAt ?? nowIso(),
    rawPayload: (raw.rawPayload ?? (raw as unknown as Record<string, unknown>)) as Record<
      string,
      unknown
    >,
  };

  const flow = enrichFlowContext({
    eventType,
    chainId: raw.chainId,
    protocol: "Circle",
    assetSymbols: symbols,
    fromAddress,
    toAddress,
    venue: "Circle",
  });

  return withFlow(base, flow);
}

/**
 * Aave V3 Supply / Withdraw → protocol_deposit / protocol_withdraw.
 */
async function normalizeProtocolFlow(
  raw: RawOnChainEventPayload,
  contract: ProtocolContract | undefined,
  eventName: "Supply" | "Withdraw" | "Deposit",
  ethUsd: number | null,
): Promise<EventIngestionPayload | null> {
  const args = raw.args ?? {};
  const reserve = argAsString(args.reserve) ?? argAsString(args.asset);
  const amount = argAsBigInt(args.amount);
  const user = argAsString(args.user) ?? argAsString(args.onBehalfOf) ?? argAsString(args.to);

  if (amount === undefined) return null;

  const priced = await usdFromTokenAmount(amount, undefined, reserve, ethUsd);
  if (!priced) return null;

  const eventType: EventType = eventName === "Withdraw" ? "protocol_withdraw" : "protocol_deposit";

  const protocol = contract?.protocol ?? raw.protocol ?? "Aave V3";
  const poolAddress = raw.address;

  const base: EventIngestionPayload = {
    sourceEventId: buildSourceEventId(raw),
    eventType,
    chainId: raw.chainId,
    protocol,
    ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
    assetSymbols: priced.symbols,
    magnitude: { value: priced.usd, unit: "USD" },
    capturedAt: raw.capturedAt ?? nowIso(),
    rawPayload: (raw.rawPayload ?? (raw as unknown as Record<string, unknown>)) as Record<
      string,
      unknown
    >,
  };

  const flow = enrichFlowContext({
    eventType,
    chainId: raw.chainId,
    protocol,
    assetSymbols: priced.symbols,
    fromAddress: eventType === "protocol_deposit" ? user : poolAddress,
    toAddress: eventType === "protocol_deposit" ? poolAddress : user,
    subjectAddress: user,
    counterpartyAddress: poolAddress,
    venue: protocol,
  });

  return withFlow(base, flow);
}

function toClassifiedPayload(body: Record<string, unknown>): EventIngestionPayload {
  const base: EventIngestionPayload = {
    sourceEventId: String(body.sourceEventId),
    eventType: body.eventType as EventType,
    chainId: Number(body.chainId),
    capturedAt: String(body.capturedAt ?? nowIso()),
    rawPayload: (body.rawPayload ?? body) as Record<string, unknown>,
    ...(body.protocol ? { protocol: String(body.protocol) } : {}),
    ...(body.transactionHash ? { transactionHash: String(body.transactionHash) } : {}),
    ...(body.assetSymbols ? { assetSymbols: body.assetSymbols as string[] } : {}),
    ...(body.magnitude ? { magnitude: body.magnitude as { value: number; unit: string } } : {}),
    ...(numberField(body.blockNumber as number | string | undefined) !== undefined
      ? { blockNumber: numberField(body.blockNumber as number | string | undefined) }
      : {}),
    ...(typeof body.blockHash === "string" ? { blockHash: body.blockHash } : {}),
    ...(numberField(body.logIndex as number | string | undefined) !== undefined
      ? { logIndex: numberField(body.logIndex as number | string | undefined) }
      : {}),
    ...(typeof body.sourceContract === "string"
      ? { sourceContract: body.sourceContract }
      : typeof body.address === "string"
        ? { sourceContract: body.address }
        : {}),
    ...(body.normalizedFeatures && typeof body.normalizedFeatures === "object"
      ? { normalizedFeatures: body.normalizedFeatures as Record<string, unknown> }
      : {}),
    sourceDedupeKey:
      typeof body.sourceDedupeKey === "string"
        ? body.sourceDedupeKey
        : `${Number(body.chainId)}:${String(body.eventType)}:${String(body.sourceEventId)}`,
    ...(parseArrayLength(body.arrayLength) !== undefined
      ? { arrayLength: parseArrayLength(body.arrayLength) }
      : {}),
  };

  // Honour pre-attached flowContext on classified path; else enrich lightly.
  if (body.flowContext && typeof body.flowContext === "object") {
    const fc = body.flowContext as FlowContext;
    return withFlow(base, fc);
  }

  const existing = base.rawPayload.flowContext;
  if (existing && typeof existing === "object") {
    return { ...base, flowContext: existing as FlowContext };
  }

  const flow = enrichFlowContext({
    eventType: base.eventType,
    chainId: base.chainId,
    protocol: base.protocol,
    assetSymbols: base.assetSymbols,
    venue: base.protocol,
  });
  return withFlow(base, flow);
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
    ...(parseArrayLength(body.arrayLength) !== undefined
      ? { arrayLength: parseArrayLength(body.arrayLength) }
      : {}),
  };
}

export function createEventNormalizer(priceOracle: PriceOracle): EventNormalizer {
  return {
    async normalize(body) {
      if (!body || typeof body !== "object") {
        return { ok: false, error: "Request body must be a JSON object" };
      }

      const arrayLengthError = arrayLengthValidationError(body);
      if (arrayLengthError) return { ok: false, error: arrayLengthError };

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
      } else if (eventName === "Supply" || eventName === "Deposit" || eventName === "Withdraw") {
        payload = await normalizeProtocolFlow(
          raw,
          contract,
          eventName === "Withdraw" ? "Withdraw" : eventName === "Deposit" ? "Deposit" : "Supply",
          ethUsd,
        );
      } else if (eventName === "Mint" || eventName === "Burn") {
        payload = await normalizeStablecoinSupply(raw, eventName);
      } else if (eventName === "Transfer") {
        // Prefer mint/burn zero-address rules on known stable contracts
        const mintBurn = await normalizeStablecoinSupply(raw, "Transfer");
        if (mintBurn) {
          payload = mintBurn;
        } else {
          payload = await normalizeCexTransfer(raw, ethUsd);
        }
      } else if (contract?.kind === "uniswap_v3_factory") {
        payload = normalizeDeployment(raw, contract);
      } else {
        // Unknown event: if magnitude was supplied by upstream workflow, accept as large_swap fallback
        if (raw.magnitude) {
          const protocol = contract?.protocol ?? raw.protocol;
          const base: EventIngestionPayload = {
            sourceEventId: buildSourceEventId(raw),
            eventType: "large_swap",
            chainId: raw.chainId,
            ...(protocol !== undefined ? { protocol } : {}),
            ...(raw.transactionHash ? { transactionHash: raw.transactionHash } : {}),
            magnitude: raw.magnitude,
            capturedAt: raw.capturedAt ?? nowIso(),
            rawPayload: (raw.rawPayload ?? body) as Record<string, unknown>,
          };
          const flow = enrichFlowContext({
            eventType: "large_swap",
            chainId: raw.chainId,
            protocol,
            venue: protocol,
          });
          payload = withFlow(base, flow);
        } else {
          return {
            ok: false,
            error: `Unsupported eventName "${eventName}" for address ${raw.address ?? "unknown"} — configure a known protocol or supply magnitude`,
          };
        }
      }

      if (!payload) {
        return {
          ok: false,
          error: `Unable to classify eventName "${eventName}" (missing labels, magnitude, or unsupported shape)`,
        };
      }

      // Honour explicit magnitude override from upstream workflow
      if (raw.magnitude) {
        payload = { ...payload, magnitude: raw.magnitude };
      }

      payload = attachCanonicalEvidence(payload, raw);

      return { ok: true, payload };
    },
  };
}
