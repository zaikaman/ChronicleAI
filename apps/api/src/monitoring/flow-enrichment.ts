// Pure flow-enrichment helpers: entity roles + capital direction heuristics.
// No LLM — deterministic only. Unknown stays unknown.

import { lookupEntity } from "@chronicleai/config";
import type {
  EntityRole,
  EventType,
  FlowContext,
  FlowDirection,
} from "@chronicleai/schemas";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "FRAX",
  "TUSD",
  "BUSD",
  "GUSD",
  "USDP",
  "LUSD",
  "crvUSD",
  "GHO",
]);

const VOLATILE_SYMBOLS = new Set([
  "WETH",
  "ETH",
  "WBTC",
  "BTC",
  "LINK",
  "UNI",
  "AAVE",
  "stETH",
  "wstETH",
  "cbETH",
  "rETH",
]);

export interface FlowEnrichmentInput {
  eventType: EventType;
  chainId: number;
  protocol?: string | null | undefined;
  assetSymbols?: string[] | null | undefined;
  fromAddress?: string | null | undefined;
  toAddress?: string | null | undefined;
  /** Sell/token-in for swaps (token address or symbol). */
  sellToken?: string | null | undefined;
  buyToken?: string | null | undefined;
  sellSymbol?: string | null | undefined;
  buySymbol?: string | null | undefined;
  subjectAddress?: string | null | undefined;
  counterpartyAddress?: string | null | undefined;
  venue?: string | null | undefined;
  /** Optional override when classification already knows direction. */
  directionHint?: FlowDirection | null | undefined;
}

function normalizeAddr(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  const trimmed = address.trim().toLowerCase();
  if (!trimmed.startsWith("0x") || trimmed.length < 10) return undefined;
  return trimmed;
}

function isStableSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return STABLE_SYMBOLS.has(symbol) || STABLE_SYMBOLS.has(symbol.toUpperCase());
}

function isVolatileSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  return (
    VOLATILE_SYMBOLS.has(symbol) ||
    VOLATILE_SYMBOLS.has(upper) ||
    upper === "ETH" ||
    upper === "WETH" ||
    upper === "BTC" ||
    upper === "WBTC"
  );
}

function classifyAssetClass(
  symbol: string | null | undefined,
): "stable" | "volatile" | "unknown" {
  if (isStableSymbol(symbol)) return "stable";
  if (isVolatileSymbol(symbol)) return "volatile";
  return "unknown";
}

function roleFor(
  address: string | undefined,
  chainId: number,
): { role: EntityRole; label?: string } {
  if (!address || address === ZERO_ADDRESS) {
    return { role: "unknown" };
  }
  const entity = lookupEntity(address, chainId);
  if (!entity) return { role: "unknown" };
  return { role: entity.role, label: entity.label };
}

function swapDirection(
  sellSymbol: string | null | undefined,
  buySymbol: string | null | undefined,
  assetSymbols: string[] | null | undefined,
): FlowDirection {
  let sell = sellSymbol;
  let buy = buySymbol;

  // Uniswap amount0/amount1 path often only has pair symbols ordered.
  if (!sell && !buy && assetSymbols?.length) {
    // Heuristic: if both stable and volatile present, treat stable→volatile as risk_on
    // when we cannot know which side was sold. Prefer unknown over wrong.
    const classes = assetSymbols.map(classifyAssetClass);
    const hasStable = classes.includes("stable");
    const hasVolatile = classes.includes("volatile");
    if (hasStable && hasVolatile) return "unknown";
    if (hasStable && !hasVolatile) return "rebalance";
    return "unknown";
  }

  const sellClass = classifyAssetClass(sell);
  const buyClass = classifyAssetClass(buy);

  if (sellClass === "stable" && buyClass === "volatile") return "risk_on";
  if (sellClass === "volatile" && buyClass === "stable") return "de_risk";
  if (sellClass === "stable" && buyClass === "stable") return "rebalance";
  if (sellClass === "volatile" && buyClass === "volatile") return "rebalance";
  return "unknown";
}

function cexDirection(
  eventType: "cex_inflow" | "cex_outflow",
  assetSymbols: string[] | null | undefined,
): FlowDirection {
  const primary = assetSymbols?.[0];
  const assetClass = classifyAssetClass(primary);
  if (eventType === "cex_inflow") {
    // Tokens to exchange — sell pressure bias for volatile; stables unknown
    if (assetClass === "volatile") return "de_risk";
    return "unknown";
  }
  // Tokens from exchange — accumulation bias for volatile
  if (assetClass === "volatile") return "risk_on";
  return "unknown";
}

function buildClusterKey(parts: Array<string | undefined>): string | undefined {
  const cleaned = parts.filter((p): p is string => Boolean(p && p.length > 0));
  if (cleaned.length === 0) return undefined;
  return cleaned.join("|");
}

/**
 * Build deterministic FlowContext for a classified event.
 * Never invents labels — unknown addresses stay role "unknown".
 */
export function enrichFlowContext(input: FlowEnrichmentInput): FlowContext {
  const fromAddr = normalizeAddr(input.fromAddress);
  const toAddr = normalizeAddr(input.toAddress);
  const from = roleFor(fromAddr, input.chainId);
  const to = roleFor(toAddr, input.chainId);

  let direction: FlowDirection = input.directionHint ?? "unknown";
  let venue = input.venue ?? input.protocol ?? undefined;

  switch (input.eventType) {
    case "large_swap": {
      direction = swapDirection(
        input.sellSymbol,
        input.buySymbol,
        input.assetSymbols,
      );
      venue = venue ?? "DEX";
      break;
    }
    case "cex_inflow":
    case "cex_outflow": {
      direction = cexDirection(input.eventType, input.assetSymbols);
      venue = venue ?? from.label ?? to.label ?? "CEX";
      break;
    }
    case "protocol_deposit": {
      direction = "rebalance";
      venue = venue ?? "Aave V3";
      break;
    }
    case "protocol_withdraw": {
      direction = "de_risk";
      venue = venue ?? "Aave V3";
      break;
    }
    case "stablecoin_mint": {
      direction = "supply_expand";
      venue = venue ?? "Circle";
      break;
    }
    case "stablecoin_burn": {
      direction = "supply_contract";
      venue = venue ?? "Circle";
      break;
    }
    case "liquidation":
    case "liquidation_cluster": {
      direction = "de_risk";
      venue = venue ?? "Aave V3";
      break;
    }
    default:
      break;
  }

  const subject =
    normalizeAddr(input.subjectAddress) ??
    (input.eventType === "cex_inflow" ? fromAddr : undefined) ??
    (input.eventType === "cex_outflow" ? toAddr : undefined);

  const counterparty =
    normalizeAddr(input.counterpartyAddress) ??
    (input.eventType === "cex_inflow" ? toAddr : undefined) ??
    (input.eventType === "cex_outflow" ? fromAddr : undefined);

  const pairKey =
    input.assetSymbols?.filter(Boolean).join("/") ||
    [input.sellSymbol, input.buySymbol].filter(Boolean).join("/") ||
    undefined;

  const clusterKey = buildClusterKey([
    input.eventType,
    subject,
    pairKey,
    counterparty,
  ]);

  const ctx: FlowContext = {
    fromRole: from.role,
    toRole: to.role,
    direction,
  };

  if (from.label) ctx.fromLabel = from.label;
  if (to.label) ctx.toLabel = to.label;
  if (venue) ctx.venue = venue;
  if (clusterKey) ctx.clusterKey = clusterKey;
  if (subject) ctx.subjectAddress = subject;
  if (counterparty) ctx.counterpartyAddress = counterparty;

  return ctx;
}

/**
 * Merge flowContext into rawPayload without clobbering other fields.
 */
export function attachFlowContextToRawPayload(
  rawPayload: Record<string, unknown>,
  flowContext: FlowContext,
): Record<string, unknown> {
  return {
    ...rawPayload,
    flowContext,
  };
}

/**
 * Extract FlowContext from a stored raw_payload if present and well-formed.
 */
export function extractFlowContext(
  rawPayload: Record<string, unknown> | null | undefined,
): FlowContext | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const fc = rawPayload.flowContext;
  if (!fc || typeof fc !== "object") return null;
  const obj = fc as Record<string, unknown>;
  if (
    typeof obj.fromRole !== "string" ||
    typeof obj.toRole !== "string" ||
    typeof obj.direction !== "string"
  ) {
    return null;
  }
  return {
    fromRole: obj.fromRole as EntityRole,
    toRole: obj.toRole as EntityRole,
    direction: obj.direction as FlowDirection,
    ...(typeof obj.fromLabel === "string" ? { fromLabel: obj.fromLabel } : {}),
    ...(typeof obj.toLabel === "string" ? { toLabel: obj.toLabel } : {}),
    ...(typeof obj.venue === "string" ? { venue: obj.venue } : {}),
    ...(typeof obj.clusterKey === "string" ? { clusterKey: obj.clusterKey } : {}),
    ...(typeof obj.counterpartyAddress === "string"
      ? { counterpartyAddress: obj.counterpartyAddress }
      : {}),
    ...(typeof obj.subjectAddress === "string"
      ? { subjectAddress: obj.subjectAddress }
      : {}),
  };
}

/** Human-readable direction phrase for prompts (never used as a hard-coded title). */
export function directionPlainLanguage(direction: FlowDirection): string {
  switch (direction) {
    case "risk_on":
      return "risk-on / accumulation";
    case "de_risk":
      return "de-risking";
    case "rebalance":
      return "rebalancing / same-class transfer";
    case "supply_expand":
      return "stablecoin supply expanded";
    case "supply_contract":
      return "stablecoin supply contracted";
    default:
      return "no strong directional read";
  }
}
