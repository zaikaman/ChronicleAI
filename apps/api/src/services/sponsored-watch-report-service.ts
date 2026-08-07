// Sponsored watch report generator
// Builds a campaign-end intelligence report from events observed on the
// target contract during the paid monitoring window (Loop 4 step 4).
// Prefers multi-provider LLM narrative when keys are configured; falls back
// to a deterministic template so on-chain hashing always succeeds.

import { getAddress, isAddress, keccak256, stringToBytes } from "viem";
import type { MonitoredEventRow } from "@chronicleai/db";
import { ALERT_GENERATION_TIMEOUT_MS } from "@chronicleai/config";
import {
  estimateTokens,
  GROQ_EFFECTIVE_INPUT_BUDGET,
  GROQ_MAX_INPUT_TOKENS,
} from "../agents/langchain/token-budget.ts";
import {
  extractJsonObject,
  LLM_PROVIDER_CALLERS,
  type LLMProviderMap,
} from "./llm-provider-client.ts";

export interface SponsoredWatchReportContent {
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  sourceEventIds: string[];
  /** Deterministic commitment over source event ids (empty-root when none). */
  sourceEventRoot: string;
  /** keccak256 of the canonical report body used as on-chain reportContentHash. */
  reportContentHash: string;
  confidence: "high" | "medium" | "low";
  /** Which path produced the narrative (template always available as fallback). */
  generationSource?: "llm" | "template";
  generationProvider?: string;
}

export interface SponsoredWatchReportInput {
  watchId: string;
  targetContract: string;
  watchSpecHash: string;
  startsAt: string;
  endsAt: string;
  events: MonitoredEventRow[];
  /** Whether the campaign watched a wallet (Transfer activity) or a contract (logs). */
  targetKind?: "contract" | "wallet";
  eventSignature?: string | null;
  description?: string | null;
  /**
   * When live re-query returns 0 rows but the campaign previously correlated
   * N observations (e.g. synthetic RPC ids never persisted), keep that count
   * so the template does not falsely claim an empty campaign.
   */
  priorMonitoredCount?: number;
  priorSourceEventIdCount?: number;
}

export interface SponsoredWatchReportService {
  generateReport(input: SponsoredWatchReportInput): Promise<SponsoredWatchReportContent>;
}

export function formatEventLine(event: MonitoredEventRow): string {
  const parts: string[] = [event.event_type.replace(/_/g, " ")];
  if (event.protocol) parts.push(`on ${event.protocol}`);
  if (event.asset_symbols?.length) parts.push(`(${event.asset_symbols.join("/")})`);
  if (event.magnitude && typeof event.magnitude === "object") {
    const mag = event.magnitude as Record<string, unknown>;
    if (typeof mag.value === "number" && typeof mag.unit === "string") {
      // Never print a fabricated "0 tokens" placeholder (legacy rows from
      // native transfers that were misclassified as unknown tokens).
      const placeholder =
        mag.unit.toLowerCase() === "tokens" && Math.abs(mag.value) < 1e-9;
      if (!placeholder) parts.push(`${mag.value.toLocaleString()} ${mag.unit}`);
    }
  }
  if (event.transaction_hash) {
    parts.push(`tx ${event.transaction_hash.slice(0, 10)}…`);
  }
  return parts.join(" ");
}

/**
 * ERC-20 token metadata used to pretty-print sponsored-watch amounts.
 * Monitoring is Ethereum Mainnet (chainId 1) — see WATCH_MONITOR_CHAIN_ID.
 * Only tokens verified in this repo (event-normalizer.ts) are listed; unknown
 * tokens fall back to a short-address label so the alert never fabricates a
 * symbol.
 */
export const WATCH_TOKEN_META: Record<
  string,
  { symbol: string; decimals: number; isStableUsd?: boolean }
> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6, isStableUsd: true },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6, isStableUsd: true },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18, isStableUsd: true },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 },
};

/** Chain the sponsored-watch on-chain log scanner targets (Ethereum Mainnet). */
export const WATCH_MONITOR_CHAIN_ID = 1;

/**
 * Decode the 32-byte `data` field of an ERC-20 Transfer log into a bigint.
 * Returns null when the payload is not a clean 32-byte hex amount.
 */
export function decodeTransferAmount(data: unknown): bigint | null {
  if (typeof data !== "string") return null;
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  try {
    return BigInt(`0x${hex}`);
  } catch {
    return null;
  }
}

/** Format a raw token amount (smallest unit) as a human string with commas. */
export function humanizeTokenAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = abs / scale;
  const frac = abs % scale;
  if (frac === 0n) {
    return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}`;
  }
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${fracStr.slice(0, 6)}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function eventLogIndex(event: MonitoredEventRow): string | null {
  if (event.log_index != null && Number.isFinite(event.log_index)) {
    return String(event.log_index);
  }
  const payload = (event.raw_payload ?? {}) as Record<string, unknown>;
  const rawLogIndex = payload.logIndex ?? payload.log_index;
  if (typeof rawLogIndex === "number" && Number.isFinite(rawLogIndex)) {
    return String(rawLogIndex);
  }
  if (typeof rawLogIndex === "string" && rawLogIndex.trim()) {
    return rawLogIndex.trim();
  }
  return null;
}

/**
 * Stable event identity for sponsored watches.
 *
 * Etherscan and direct RPC can describe the same chain log with different
 * source prefixes, so transaction hash + log index is the canonical key when
 * available. This prevents one Transfer log from becoming two report rows or
 * two Telegram details after a provider fallback.
 */
export function sponsoredWatchEventIdentity(event: MonitoredEventRow): string {
  const txHash = event.transaction_hash?.trim().toLowerCase();
  const logIndex = eventLogIndex(event);
  if (txHash && logIndex !== null) {
    return `${event.chain_id}:${txHash}:${logIndex}`;
  }
  if (event.source_event_id) {
    return `${event.source}:${event.source_event_id}`;
  }
  return event.id;
}

export function dedupeSponsoredWatchEvents(
  events: MonitoredEventRow[],
): MonitoredEventRow[] {
  const seen = new Set<string>();
  const unique: MonitoredEventRow[] = [];
  for (const event of events) {
    const identity = sponsoredWatchEventIdentity(event);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(event);
  }
  return unique;
}

function shortTransactionHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const CAMPAIGN_WINDOW_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Deterministic, human-friendly UTC timestamp.
 * Hand-rolled (no locale APIs) so the string is byte-identical on every
 * host — it feeds on-chain report hashes and must never drift.
 */
function formatCampaignWindowTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mm = String(parsed.getUTCMinutes()).padStart(2, "0");
  const month = CAMPAIGN_WINDOW_MONTHS[parsed.getUTCMonth()];
  return `${month} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/**
 * Compress a same-day campaign window into a single readable label, e.g.
 * "Aug 7, 2026, 05:48–06:48 UTC". Cross-day windows fall back to two full
 * timestamps. Deterministic for the same reasons as formatCampaignWindowTimestamp.
 */
function formatCampaignWindowLabel(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const sameDay =
      start.getUTCFullYear() === end.getUTCFullYear() &&
      start.getUTCMonth() === end.getUTCMonth() &&
      start.getUTCDate() === end.getUTCDate();
    if (sameDay) {
      const hhS = String(start.getUTCHours()).padStart(2, "0");
      const mmS = String(start.getUTCMinutes()).padStart(2, "0");
      const hhE = String(end.getUTCHours()).padStart(2, "0");
      const mmE = String(end.getUTCMinutes()).padStart(2, "0");
      const month = CAMPAIGN_WINDOW_MONTHS[start.getUTCMonth()];
      return `${month} ${start.getUTCDate()}, ${start.getUTCFullYear()}, ${hhS}:${mmS}–${hhE}:${mmE} UTC`;
    }
  }
  return `${formatCampaignWindowTimestamp(startsAt)} → ${formatCampaignWindowTimestamp(endsAt)}`;
}

function reportEventPayload(event: MonitoredEventRow): Record<string, unknown> {
  return (event.raw_payload ?? {}) as Record<string, unknown>;
}

function reportEventAddress(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function reportEventTimestamp(event: MonitoredEventRow): number | null {
  const observed = event.observed_at ? Date.parse(event.observed_at) : Number.NaN;
  if (Number.isFinite(observed)) return observed;
  const captured = Date.parse(event.captured_at);
  return Number.isFinite(captured) ? captured : null;
}

interface ReportSignalSummary {
  uniqueTransactions: number;
  eventTypes: string[];
  protocols: string[];
  verifiedAssets: string[];
  unknownAssetCount: number;
  outbound: number;
  inbound: number;
  unresolvedDirection: number;
  counterparties: number;
  firstObserved: string | null;
  lastObserved: string | null;
}

function summarizeReportSignals(
  events: MonitoredEventRow[],
  targetContract: string,
): ReportSignalSummary {
  const transactions = new Set<string>();
  const eventTypes = new Set<string>();
  const protocols = new Set<string>();
  const verifiedAssets = new Set<string>();
  const unknownAssets = new Set<string>();
  const counterparties = new Set<string>();
  const target = targetContract.toLowerCase();
  let outbound = 0;
  let inbound = 0;
  let unresolvedDirection = 0;
  let firstObservedMs = Number.POSITIVE_INFINITY;
  let lastObservedMs = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    if (event.transaction_hash) transactions.add(event.transaction_hash.toLowerCase());
    eventTypes.add(event.event_type.replace(/_/g, " "));
    if (event.protocol) protocols.add(event.protocol);

    const payload = reportEventPayload(event);
    const tokenAddress = reportEventAddress(payload, "address");
    if (event.asset_symbols?.length) {
      for (const symbol of event.asset_symbols) verifiedAssets.add(symbol);
    } else if (tokenAddress) {
      if (WATCH_TOKEN_META[tokenAddress]) {
        verifiedAssets.add(WATCH_TOKEN_META[tokenAddress].symbol);
      } else {
        unknownAssets.add(tokenAddress);
      }
    }

    const isWalletTransfer =
      event.event_type === "wallet_transfer" || payload.targetKind === "wallet";
    if (isWalletTransfer) {
      const from = reportEventAddress(payload, "from");
      const to = reportEventAddress(payload, "to");
      if (from === target) {
        outbound += 1;
        if (to && to !== target) counterparties.add(to);
      } else if (to === target) {
        inbound += 1;
        if (from && from !== target) counterparties.add(from);
      } else {
        unresolvedDirection += 1;
        if (from && from !== target) counterparties.add(from);
        if (to && to !== target) counterparties.add(to);
      }
    }

    const observedMs = reportEventTimestamp(event);
    if (observedMs !== null) {
      firstObservedMs = Math.min(firstObservedMs, observedMs);
      lastObservedMs = Math.max(lastObservedMs, observedMs);
    }
  }

  return {
    uniqueTransactions: transactions.size,
    eventTypes: [...eventTypes],
    protocols: [...protocols],
    verifiedAssets: [...verifiedAssets],
    unknownAssetCount: unknownAssets.size,
    outbound,
    inbound,
    unresolvedDirection,
    counterparties: counterparties.size,
    firstObserved:
      Number.isFinite(firstObservedMs) ? new Date(firstObservedMs).toISOString() : null,
    lastObserved:
      Number.isFinite(lastObservedMs) ? new Date(lastObservedMs).toISOString() : null,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

/**
 * Human-readable one-line description of a watch event.
 *
 * Wallet/transfer-shaped events (decoded from raw Transfer logs) render as
 * "Transfer 12,500 USDC sent from 0x1a2b…c3d4 → 0x5e6f…7a8b". Contract events
 * that arrived through the enriched ingestion pipeline fall back to
 * formatEventLine (event type + protocol + assets + USD magnitude).
 */
export function describeWatchEvent(
  event: MonitoredEventRow,
  targetKind: "contract" | "wallet" = "contract",
  targetAddress?: string,
): string {
  const payload = (event.raw_payload ?? {}) as Record<string, unknown>;
  const from = typeof payload.from === "string" ? payload.from : null;
  const to = typeof payload.to === "string" ? payload.to : null;
  const amountRaw = typeof payload.amountRaw === "string" ? payload.amountRaw : null;
  const tokenAddress =
    typeof payload.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(payload.address)
      ? payload.address
      : null;

  // Native ETH transfer (decoded from the wallet's tx list — no token contract).
  if (from && to && amountRaw && payload.isNative === true) {
    const target = targetAddress?.toLowerCase();
    const isWallet = targetKind === "wallet" && target !== undefined;
    const parties = `${shortAddress(from)} → ${shortAddress(to)}`;
    let amountText: string;
    try {
      amountText = humanizeTokenAmount(BigInt(amountRaw), 18);
    } catch {
      amountText = amountRaw;
    }
    let flow: string;
    if (isWallet) {
      if (from.toLowerCase() === target) {
        flow = `${amountText} ETH sent to ${shortAddress(to)}`;
      } else if (to.toLowerCase() === target) {
        flow = `${amountText} ETH received from ${shortAddress(from)}`;
      } else {
        flow = `Transfer ${amountText} ETH · ${parties}`;
      }
    } else {
      flow = `Transfer ${amountText} ETH · ${parties}`;
    }
    return `${flow}${event.transaction_hash ? ` · tx ${shortTransactionHash(event.transaction_hash)}` : ""}`;
  }

  if (from && to && amountRaw && tokenAddress) {
    const meta = WATCH_TOKEN_META[tokenAddress.toLowerCase()];
    const target = targetAddress?.toLowerCase();
    const isWallet = targetKind === "wallet" && target !== undefined;
    const parties = `${shortAddress(from)} → ${shortAddress(to)}`;
    if (!meta) {
      // Unknown token: never fabricate a symbol or decimals — show direction only.
      return `Transfer · ${parties}${event.transaction_hash ? ` · tx ${shortTransactionHash(event.transaction_hash)}` : ""}`;
    }
    let amountText: string;
    try {
      amountText = humanizeTokenAmount(BigInt(amountRaw), meta.decimals);
    } catch {
      amountText = amountRaw;
    }
    let flow: string;
    if (isWallet) {
      if (from.toLowerCase() === target) {
        flow = `${amountText} ${meta.symbol} sent to ${shortAddress(to)}`;
      } else if (to.toLowerCase() === target) {
        flow = `${amountText} ${meta.symbol} received from ${shortAddress(from)}`;
      } else {
        flow = `${amountText} ${meta.symbol} · ${parties}`;
      }
    } else {
      flow = `${amountText} ${meta.symbol} · ${parties}`;
    }
    return `Transfer ${flow}${event.transaction_hash ? ` · tx ${shortTransactionHash(event.transaction_hash)}` : ""}`;
  }

  return formatEventLine(event);
}

/**
 * Build a stable source-event root commitment.
 * Sorted event ids joined, then keccak256 — same family as digest roots
 * (string commitment hashed again by the web3 client before the bytes32 write).
 */
export function buildSourceEventRoot(sourceEventIds: string[]): string {
  if (sourceEventIds.length === 0) {
    return keccak256(stringToBytes("empty-sponsored-watch-root"));
  }
  const sorted = [...sourceEventIds].sort();
  return keccak256(stringToBytes(sorted.join(",")));
}

function buildReportContentHash(body: {
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  sourceEventIds: string[];
  sourceEventRoot: string;
  targetContract: string;
  startsAt: string;
  endsAt: string;
}): string {
  const canonical = JSON.stringify({
    analysis: body.analysis,
    endsAt: body.endsAt,
    highlights: body.highlights,
    sourceEventIds: [...body.sourceEventIds].sort(),
    sourceEventRoot: body.sourceEventRoot,
    startsAt: body.startsAt,
    summary: body.summary,
    targetContract: body.targetContract.toLowerCase(),
    title: body.title,
  });
  return keccak256(stringToBytes(canonical));
}

function finalizeReport(
  narrative: {
    title: string;
    summary: string;
    highlights: string[];
    analysis: string;
    confidence: "high" | "medium" | "low";
  },
  meta: {
    sourceEventIds: string[];
    sourceEventRoot: string;
    targetContract: string;
    startsAt: string;
    endsAt: string;
    generationSource: "llm" | "template";
    generationProvider?: string;
  },
): SponsoredWatchReportContent {
  return {
    ...narrative,
    sourceEventIds: meta.sourceEventIds,
    sourceEventRoot: meta.sourceEventRoot,
    reportContentHash: buildReportContentHash({
      title: narrative.title,
      summary: narrative.summary,
      highlights: narrative.highlights,
      analysis: narrative.analysis,
      sourceEventIds: meta.sourceEventIds,
      sourceEventRoot: meta.sourceEventRoot,
      targetContract: meta.targetContract,
      startsAt: meta.startsAt,
      endsAt: meta.endsAt,
    }),
    generationSource: meta.generationSource,
    ...(meta.generationProvider ? { generationProvider: meta.generationProvider } : {}),
  };
}

function buildTemplateReport(input: SponsoredWatchReportInput): SponsoredWatchReportContent {
  const { events, targetContract, startsAt, endsAt, watchId } = input;
  const sourceEventIds = events.map((e) => e.id);
  const sourceEventRoot = buildSourceEventRoot(sourceEventIds);

  const windowLabel = formatCampaignWindowLabel(startsAt, endsAt);
  const targetKindLabel = input.targetKind === "wallet" ? "wallet" : "contract";
  const shortTarget = `${targetContract.slice(0, 8)}…${targetContract.slice(-6)}`;

  if (events.length === 0) {
    const title = `Sponsored Watch Report — ${shortTarget}`;
    const priorCount = Math.max(
      input.priorMonitoredCount ?? 0,
      input.priorSourceEventIdCount ?? 0,
    );

    // Campaign ticks previously correlated observations, but rows are gone
    // (synthetic RPC UUIDs never written to monitored_events, or retention).
    if (priorCount > 0) {
      const summary =
        `Campaign monitoring correlated ${priorCount} observation(s) on ${targetKindLabel} ${targetContract} ` +
        `during ${windowLabel}. The live event store no longer holds those rows ` +
        `(common when an earlier RPC fallback used ephemeral ids), so this report ` +
        `reconstructs from the campaign audit trail rather than a full event replay.`;
      const highlights = [
        `${priorCount} observation(s) were recorded on the sponsored watch during the paid window.`,
        "Underlying monitored_events rows are no longer loadable — narrative is audit-trail based.",
        "On-chain create + publishSponsoredReport receipts remain the verifiable dual audit trail.",
        ...(input.eventSignature
          ? [`Filtered by requested event signature: ${input.eventSignature}`]
          : []),
        ...(input.description ? [`Campaign instructions: "${input.description}"`] : []),
      ];
      const analysis =
        `Campaign ${watchId} monitored ${targetKindLabel} ${targetContract} during ${windowLabel}. ` +
        (input.description ? `Watch instructions: "${input.description}". ` : "") +
        (input.eventSignature ? `Event filter: ${input.eventSignature}. ` : "") +
        `Monitoring ticks recorded ${priorCount} matched observation(s). ` +
        "A later regenerate could not reload those rows from monitored_events " +
        "(orphan source_event_ids from a non-persisted RPC path, or retention). " +
        "Treat the on-chain report tx + source-event root as the canonical completeness proof; " +
        "this HTTPS body is a best-effort narrative backfill.";

      return finalizeReport(
        { title, summary, highlights, analysis, confidence: "medium" },
        {
          sourceEventIds,
          sourceEventRoot,
          targetContract,
          startsAt,
          endsAt,
          generationSource: "template",
        },
      );
    }

    const summary = `No qualifying on-chain events were observed on ${targetKindLabel} ${targetContract} during the campaign window (${windowLabel}). The monitoring job completed with an empty source set.`;
    const highlights = [
      `Zero events matched the sponsored target ${targetKindLabel} in the campaign window.`,
      "On-chain create and report receipts still form the paid campaign audit trail.",
      ...(input.eventSignature ? [`Filtered by requested event signature: ${input.eventSignature}`] : []),
      ...(input.description ? [`Campaign instructions: "${input.description}"`] : []),
    ];
    const analysis =
      `Campaign ${watchId} monitored ${targetKindLabel} ${targetContract} during ${windowLabel}. ` +
      (input.description ? `Watch instructions: "${input.description}". ` : "") +
      (input.eventSignature ? `Event filter: ${input.eventSignature}. ` : "") +
      `No Event Tracker / block-dispatcher events referenced this ${targetKindLabel} address in the window. ` +
      "The empty source-event root is committed on-chain for verifiable completeness.";

    return finalizeReport(
      { title, summary, highlights, analysis, confidence: "high" },
      {
        sourceEventIds,
        sourceEventRoot,
        targetContract,
        startsAt,
        endsAt,
        generationSource: "template",
      },
    );
  }

  const ranked = [...events].sort(
    (a, b) => (b.significance_score ?? 0) - (a.significance_score ?? 0),
  );
  const signals = summarizeReportSignals(events, targetContract);
  const protocols = signals.protocols;
  const campaignDurationMs = Date.parse(endsAt) - Date.parse(startsAt);
  const campaignHours = Number.isFinite(campaignDurationMs) && campaignDurationMs > 0
    ? campaignDurationMs / 3_600_000
    : null;
  const averagePerHour = campaignHours ? events.length / campaignHours : null;
  const transactionSummary = signals.uniqueTransactions > 0
    ? pluralize(signals.uniqueTransactions, "unique transaction")
    : "transaction hashes were not available";
  const flowSummary = signals.outbound + signals.inbound + signals.unresolvedDirection > 0
    ? `${pluralize(signals.outbound, "outbound transfer")} · ${pluralize(signals.inbound, "inbound transfer")} · ${pluralize(signals.unresolvedDirection, "undecoded direction")}`
    : "Transfer direction was not decoded for these events.";
  const assetSummary = signals.verifiedAssets.length > 0 || signals.unknownAssetCount > 0
    ? `${signals.verifiedAssets.length > 0 ? signals.verifiedAssets.join(", ") : "No verified asset symbols"}` +
      `${signals.unknownAssetCount > 0 ? ` · ${pluralize(signals.unknownAssetCount, "unverified token contract")}` : ""}`
    : "Asset metadata was not available.";
  const observationRange = signals.firstObserved && signals.lastObserved
    ? `${formatCampaignWindowTimestamp(signals.firstObserved)} to ${formatCampaignWindowTimestamp(signals.lastObserved)}`
    : "Observation timestamps were not available.";

  const title = `Sponsored Watch Report — ${shortTarget}`;
  const summary =
    `ChronicleAI observed ${pluralize(events.length, "qualifying on-chain event")} across ${transactionSummary} ` +
    `on ${shortTarget} via ${signals.protocols.join(", ") || "the monitored chain"} during ${windowLabel}. ` +
    "The report focuses on activity shape and source-backed evidence, not a raw event dump.";

  const topEvent = ranked[0];
  const highlights = [
    `Activity: ${pluralize(events.length, "qualifying event")} across ${transactionSummary}.`,
    `Cadence: ${averagePerHour !== null ? `${averagePerHour.toLocaleString("en-US", { maximumFractionDigits: 1 })} observations per hour` : "campaign rate unavailable"}; observed from ${observationRange}.`,
    `Flow: ${flowSummary}.`,
    `Assets: ${assetSummary}.`,
    `Network context: ${signals.protocols.join(", ") || "protocol metadata unavailable"}; ${pluralize(signals.counterparties, "unique counterparty")}.`,
    ...(topEvent
      ? [`Notable source event: ${describeWatchEvent(topEvent, topEvent.event_type === "wallet_transfer" ? "wallet" : "contract", targetContract)}.`]
      : []),
  ];

  const analysisParts: string[] = [
    `Campaign ${watchId} monitored ${targetKindLabel} ${targetContract} (spec ${input.watchSpecHash.slice(0, 18)}…) during ${windowLabel}.`,
    ...(input.description ? [`Watch instructions: "${input.description}".`] : []),
    ...(input.eventSignature ? [`Event filter signature: ${input.eventSignature}.`] : []),
    `Source set size: ${events.length} event(s) across chain id(s) ${[...new Set(events.map((e) => e.chain_id))].join(", ")}.`,
  ];
  if (protocols.length > 0) {
    analysisParts.push(`Protocols observed: ${protocols.join(", ")}.`);
  }
  const top = ranked[0];
  if (top) {
    analysisParts.push(`Highest-significance observation: ${formatEventLine(top)}.`);
  }
  const usefulAnalysis = [
    `Readout\n${summary}`,
    `Coverage\nCampaign ${watchId} monitored ${targetKindLabel} ${targetContract} during ${windowLabel}. The source set contains ${pluralize(events.length, "event")} across chain id(s) ${[...new Set(events.map((e) => e.chain_id))].join(", ")}.`,
    `Observed pattern\n${flowSummary}. ${assetSummary}. ${pluralize(signals.counterparties, "unique counterparty")} were identified from decoded transfer parties.`,
    `Audit\nThe source-event root ${sourceEventRoot.slice(0, 18)}... commits the event id set used for this report. The narrative is deterministic and source-backed; it does not infer USD value where token metadata is unavailable.`,
    ...(input.description ? [`Watch instructions\n${input.description}`] : []),
    ...(input.eventSignature ? [`Event filter\n${input.eventSignature}`] : []),
  ];
  analysisParts.push(
    `Source-event root ${sourceEventRoot.slice(0, 18)}… commits the ordered event id set for on-chain verification.`,
  );

  return finalizeReport(
    {
      title,
      summary,
      highlights,
      analysis: usefulAnalysis.join("\n\n"),
      confidence: events.length >= 3 ? "high" : "medium",
    },
    {
      sourceEventIds,
      sourceEventRoot,
      targetContract,
      startsAt,
      endsAt,
      generationSource: "template",
    },
  );
}

/**
 * Groq free/dev tiers cap ~8k input tokens. Shared hard cap lives in
 * token-budget.ts; this re-export keeps call-site imports stable.
 */
export const GROQ_INPUT_TOKEN_BUDGET = GROQ_MAX_INPUT_TOKENS;
/**
 * Tokens reserved inside the user prompt builder for the separate system
 * instruction that callGroq attaches. Effective event/header budget uses
 * GROQ_EFFECTIVE_INPUT_BUDGET minus this reserve.
 */
const LLM_PROMPT_RESERVED_TOKENS = 1_500;
/** Soft ceiling on event lines even when the budget still has room. */
const LLM_MAX_EVENT_LINES = 24;
const MIN_TITLE_CHARS = 12;
const MIN_SUMMARY_CHARS = 40;
const MIN_ANALYSIS_CHARS = 60;

/**
 * Report narrative LLM provider: OpenAI only. Unlike the shared
 * LLM_FALLBACK_ORDER (groq → openai) used by digest/alert pipelines, the
 * paid watch report always uses OpenAI when an API key is configured, and
 * falls back to the deterministic template otherwise. Scoped locally so the
 * global fallback order stays untouched.
 */
const WATCH_REPORT_LLM_PROVIDERS = ["openai"] as const;

function isPlaceholderText(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  // Models sometimes emit ellipsis / "..." / "…" when the context window blows up.
  if (/^[.…]{1,10}$/u.test(t)) return true;
  if (/^(n\/?a|none|null|undefined|tbd|todo|placeholder)$/i.test(t)) return true;
  return false;
}

/**
 * True when a persisted campaign report is missing or is LLM junk
 * (e.g. title/summary/analysis literally "...").
 */
export function isPlaceholderSponsoredReport(fields: {
  reportTitle?: string | null;
  reportSummary?: string | null;
  reportAnalysis?: string | null;
  reportHighlights?: string[] | null;
}): boolean {
  const title = fields.reportTitle?.trim() ?? "";
  const summary = fields.reportSummary?.trim() ?? "";
  const analysis = fields.reportAnalysis?.trim() ?? "";
  const highlights = (fields.reportHighlights ?? []).map((h) => h.trim()).filter(Boolean);

  if (!title || !summary) return true;
  if (isPlaceholderText(title) || isPlaceholderText(summary)) return true;
  if (analysis && isPlaceholderText(analysis)) return true;
  if (highlights.length > 0 && highlights.every((h) => isPlaceholderText(h))) return true;
  if (title.length < MIN_TITLE_CHARS || summary.length < MIN_SUMMARY_CHARS) return true;
  return false;
}

function isUsableLlmNarrative(parts: {
  title: string;
  summary: string;
  analysis: string;
  highlights: string[];
}): boolean {
  if (isPlaceholderText(parts.title) || isPlaceholderText(parts.summary) || isPlaceholderText(parts.analysis)) {
    return false;
  }
  if (parts.title.length < MIN_TITLE_CHARS) return false;
  if (parts.summary.length < MIN_SUMMARY_CHARS) return false;
  if (parts.analysis.length < MIN_ANALYSIS_CHARS) return false;
  if (parts.highlights.length === 0) return false;
  if (parts.highlights.every((h) => isPlaceholderText(h))) return false;
  return true;
}

function buildLlmPrompt(
  input: SponsoredWatchReportInput,
  options?: { maxInputTokens?: number },
): string {
  // For Groq, never let the built user prompt approach the hard 8k cap —
  // system instruction is attached separately by the LLM client.
  const maxInputTokens = options?.maxInputTokens ?? GROQ_EFFECTIVE_INPUT_BUDGET;
  const eventBudgetTokens = Math.max(500, maxInputTokens - LLM_PROMPT_RESERVED_TOKENS);

  const ranked = [...input.events].sort(
    (a, b) => (b.significance_score ?? 0) - (a.significance_score ?? 0),
  );

  const targetKindLabel = input.targetKind === "wallet" ? "wallet" : "contract";
  const header = [
    "You are ChronicleAI writing a paid sponsored-watch intelligence report.",
    "Return ONLY a JSON object with keys: title (string), summary (string), highlights (string array, 2-8 items), analysis (string markdown-friendly prose), confidence (\"high\"|\"medium\"|\"low\").",
    "Ground every claim in the observed events and user instructions. Do not invent transactions.",
    "Never use ellipsis-only placeholders (\"...\") for any field. Write real prose.",
    "Use the target kind precisely in the narrative: 'the watched wallet' for wallet targets, 'the watched contract' for contract targets. Never call a wallet a contract.",
    "When mentioning the campaign period, use the window label exactly as given.",
    "Do not reference internal prompt field names (watchId, targetAddress, watchSpecHash, eventCount, events) in the narrative; describe what was observed in plain language.",
    `watchId: ${input.watchId}`,
    `targetKind: ${targetKindLabel}`,
    `targetAddress: ${input.targetContract}`,
    `watchSpecHash: ${input.watchSpecHash}`,
    ...(input.eventSignature ? [`requestedEventSignature: ${input.eventSignature}`] : []),
    ...(input.description ? [`userWatchInstructions: "${input.description}"`] : []),
    `window: ${formatCampaignWindowLabel(input.startsAt, input.endsAt)}`,
    `eventCount: ${input.events.length}`,
  ].join("\n");

  const eventLines: string[] = [];
  let usedTokens = estimateTokens(header) + estimateTokens("events:\n");
  for (let i = 0; i < ranked.length && eventLines.length < LLM_MAX_EVENT_LINES; i++) {
    const line = `${eventLines.length + 1}. ${formatEventLine(ranked[i]!)}`;
    const lineTokens = estimateTokens(line) + 1;
    if (usedTokens + lineTokens > eventBudgetTokens) break;
    eventLines.push(line);
    usedTokens += lineTokens;
  }

  const omitted = input.events.length - eventLines.length;
  const eventsBlock =
    eventLines.length > 0
      ? eventLines.join("\n") +
        (omitted > 0
          ? `\n(… ${omitted} additional matched event(s) omitted for token budget; rank by significance above.)`
          : "")
      : "(none)";

  return `${header}\nevents:\n${eventsBlock}`;
}

async function tryLlmNarrative(
  input: SponsoredWatchReportInput,
  providerConfigs: LLMProviderMap,
): Promise<{
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  confidence: "high" | "medium" | "low";
  provider: string;
} | null> {
  const system =
    "You write precise Web3 market intelligence for paid monitoring campaigns. Respond with JSON only. Never emit ellipsis-only placeholder fields.";

  for (const provider of WATCH_REPORT_LLM_PROVIDERS) {
    const config = providerConfigs[provider];
    if (!config?.apiKey) continue;

    // OpenAI path can take the larger prompt budget (no Groq 8k cap).
    const maxInputTokens = 24_000;
    const prompt = buildLlmPrompt(input, { maxInputTokens });

    const caller = LLM_PROVIDER_CALLERS[provider];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ALERT_GENERATION_TIMEOUT_MS);
    try {
      const raw = await caller(config, prompt, controller.signal, system);
      const jsonText = extractJsonObject(raw);
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const analysis = typeof parsed.analysis === "string" ? parsed.analysis.trim() : "";
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights
            .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
            .map((h) => h.trim())
        : [];
      const confidenceRaw = parsed.confidence;
      const confidence =
        confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
          ? confidenceRaw
          : input.events.length >= 3
            ? "high"
            : "medium";

      const candidate = {
        title,
        summary,
        analysis,
        highlights: highlights.length > 0 ? highlights.slice(0, 8) : summary ? [summary] : [],
      };
      // Reject junk ("...", too-short) so we fall through to the deterministic template.
      if (!isUsableLlmNarrative(candidate)) continue;

      return {
        ...candidate,
        confidence,
        provider,
      };
    } catch {
      // Try next provider (timeout, 8k overflow, parse error, …)
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return null;
}

export function createSponsoredWatchReportService(options?: {
  providerConfigs?: LLMProviderMap;
}): SponsoredWatchReportService {
  const providerConfigs = options?.providerConfigs;

  return {
    async generateReport(input) {
      const normalizedInput = {
        ...input,
        events: dedupeSponsoredWatchEvents(input.events),
      };
      const sourceEventIds = normalizedInput.events.map((e) => e.id);
      const sourceEventRoot = buildSourceEventRoot(sourceEventIds);

      if (providerConfigs) {
        const llm = await tryLlmNarrative(normalizedInput, providerConfigs);
        if (llm) {
          return finalizeReport(
            {
              title: llm.title,
              summary: llm.summary,
              highlights: llm.highlights,
              analysis: llm.analysis,
              confidence: llm.confidence,
            },
            {
              sourceEventIds,
              sourceEventRoot,
              targetContract: normalizedInput.targetContract,
              startsAt: normalizedInput.startsAt,
              endsAt: normalizedInput.endsAt,
              generationSource: "llm",
              generationProvider: llm.provider,
            },
          );
        }
      }

      return buildTemplateReport(normalizedInput);
    },
  };
}

/** ERC-20 / ERC-721 Transfer(address,address,uint256) topic0. */
export const TRANSFER_EVENT_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Decode a 32-byte indexed topic into a checksummed EVM address (last 20 bytes).
 */
export function addressFromTopic(topic: string | null | undefined): string | null {
  if (!topic || typeof topic !== "string") return null;
  const hex = topic.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 64) return null;
  const addr = `0x${hex.slice(24)}`;
  if (!isAddress(addr, { strict: false })) return null;
  return getAddress(addr).toLowerCase();
}

/**
 * Extract contract / wallet addresses from a monitored event's raw payload for
 * campaign matching (Event Tracker address / contractAddress / Transfer topics).
 */
export function extractEventContractAddresses(event: MonitoredEventRow): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (isAddress(value, { strict: false })) {
        found.add(getAddress(value).toLowerCase());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["address", "contractAddress", "targetContract", "to", "from"]) {
        if (
          typeof obj[key] === "string" &&
          isAddress(obj[key] as string, { strict: false })
        ) {
          found.add(getAddress(obj[key] as string).toLowerCase());
        }
      }
      // Decode Transfer topics when present (wallet-mode matching).
      if (Array.isArray(obj.topics)) {
        const topics = obj.topics as unknown[];
        const t0 = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
        if (t0 === TRANSFER_EVENT_TOPIC0 || t0 === TRANSFER_EVENT_TOPIC0.slice(2)) {
          const from = addressFromTopic(typeof topics[1] === "string" ? topics[1] : null);
          const to = addressFromTopic(typeof topics[2] === "string" ? topics[2] : null);
          if (from) found.add(from);
          if (to) found.add(to);
        }
      }
      // Nested rawPayload from Event Tracker expansion
      if (obj.rawPayload && typeof obj.rawPayload === "object") {
        visit(obj.rawPayload, depth + 1);
      }
      if (obj.args && typeof obj.args === "object") {
        visit(obj.args, depth + 1);
      }
    }
  };

  visit(event.raw_payload);
  return [...found];
}

export function eventMatchesTargetContract(
  event: MonitoredEventRow,
  targetContract: string,
): boolean {
  if (!isAddress(targetContract, { strict: false })) return false;
  const target = getAddress(targetContract).toLowerCase();
  return extractEventContractAddresses(event).includes(target);
}

/**
 * Match Transfer rows whose decoded from/to equals the watched wallet.
 * Wallets never emit events, so matching reuses the same address extraction
 * as contract matching: raw_payload carries the decoded Transfer from/to
 * (and the emitting contract), and the wallet appearing in any of them
 * qualifies the row as a watch event.
 */
export function eventMatchesWallet(
  event: MonitoredEventRow,
  walletAddress: string,
): boolean {
  return eventMatchesTargetContract(event, walletAddress);
}

/** Route event matching by watch target kind. */
export function eventMatchesWatchTarget(
  event: MonitoredEventRow,
  targetAddress: string,
  targetKind: "contract" | "wallet" = "contract",
): boolean {
  return targetKind === "wallet"
    ? eventMatchesWallet(event, targetAddress)
    : eventMatchesTargetContract(event, targetAddress);
}
