// Sponsored Watch Service
// Full Loop 4 lifecycle:
// 1. Execute createSponsoredWatch via KeeperHub (or gated direct ethers in tests)
// 2. Activate + monitor the target contract during the campaign window
// 3. At ends_at, generate a report from observed events
// 4. Execute publishSponsoredReport with report hash + sourceEventRoot
// 5. Persist both create/report tx hashes for the dual on-chain audit trail

import type {
  ExecutionLogRepository,
  MonitoredEventRepository,
  MonitoredEventRow,
  PublicAlertRepository,
  SponsoredWatchRepository,
  SponsoredWatchRow,
  SponsoredWatchTargetKind,
  SponsoredWatchVisibility,
} from "@chronicleai/db";
import { getAddress, isAddress, pad } from "viem";
import type { AlertPublicationService } from "./alert-publication-service.ts";
import { buildSponsoredReportContentUri } from "./content-uri.ts";
import type { NotificationService } from "./notification-service.ts";
import {
  createSponsoredWatchReportService,
  dedupeSponsoredWatchEvents,
  decodeTransferAmount,
  describeWatchEvent,
  eventMatchesWatchTarget,
  humanizeTokenAmount,
  isPlaceholderSponsoredReport,
  TRANSFER_EVENT_TOPIC0,
  WATCH_MONITOR_CHAIN_ID,
  WATCH_TOKEN_META,
  type SponsoredWatchReportService,
} from "./sponsored-watch-report-service.ts";
import type { Web3Client } from "./web3-client-service.ts";

function walletTopic(address: string): `0x${string}` {
  return pad(getAddress(address) as `0x${string}`, { size: 32 });
}

function decodeTransferParties(topics: unknown[]): {
  from: string | null;
  to: string | null;
} {
  const t1 = typeof topics[1] === "string" ? topics[1] : null;
  const t2 = typeof topics[2] === "string" ? topics[2] : null;
  const fromHex = t1?.toLowerCase().replace(/^0x/, "") ?? "";
  const toHex = t2?.toLowerCase().replace(/^0x/, "") ?? "";
  const from =
    fromHex.length === 64 && isAddress(`0x${fromHex.slice(24)}`, { strict: false })
      ? getAddress(`0x${fromHex.slice(24)}`)
      : null;
  const to =
    toHex.length === 64 && isAddress(`0x${toHex.slice(24)}`, { strict: false })
      ? getAddress(`0x${toHex.slice(24)}`)
      : null;
  return { from, to };
}

function watchTargetKind(watch: SponsoredWatchRow): SponsoredWatchTargetKind {
  return watch.target_kind === "wallet" ? "wallet" : "contract";
}

function watchVisibility(watch: SponsoredWatchRow): SponsoredWatchVisibility {
  return watch.visibility === "private" ? "private" : "public";
}

/**
 * Build the Telegram DM body for a watch alert. Private watches use the
 * "Private Watch" heading; public watches that carry a binding code use a
 * neutral heading (the alert is also broadcast to the community channel).
 */
function buildWatchDmText(params: {
  visibility: SponsoredWatchVisibility;
  title: string;
  summary: string;
  detailLines: string[];
  sourceExplorer: string | null;
  auditTrailUrl: string | null;
}): string {
  const heading =
    params.visibility === "private"
      ? "🔔 <b>ChronicleAI Private Watch</b>"
      : "🔔 <b>ChronicleAI Watch Alert</b>";
  return [
    heading,
    `<b>${params.title.replace(/</g, "&lt;")}</b>`,
    "",
    params.summary.replace(/</g, "&lt;"),
    "",
    "Details:",
    ...params.detailLines.map((line) => `• ${line.replace(/</g, "&lt;")}`),
    params.sourceExplorer ? `Source: ${params.sourceExplorer}` : "",
    params.auditTrailUrl ? `Audit trail: ${params.auditTrailUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep a fallback scan bounded even when a provider returns no logs. */
const RPC_LOG_CHUNK_SIZE = 45n;
// Budget large enough to fully cover a 1-hour Mainnet window (~300 blocks):
// wallet watches need 2 log calls per 45-block chunk (from + to), so ~7 chunks
// need 14 calls, plus 1 reserved eth_getBlock.
const MAX_RPC_CALLS_PER_WATCH = 16;
const MAX_RPC_LOG_CALLS_PER_WATCH = MAX_RPC_CALLS_PER_WATCH - 1; // reserve one call for eth_getBlock
const MAX_RPC_BLOCK_SPAN = RPC_LOG_CHUNK_SIZE * BigInt(MAX_RPC_LOG_CALLS_PER_WATCH) - 1n;
// Re-scan on-chain at most once per ~45s so the 60s campaign cycle effectively
// rescans every tick — new wallet txs / contract logs are only visible via a
// fresh scan, so this drives the near-realtime alert cadence.
const MAX_RPC_EVENTS_PER_WATCH = 500;

/** Max Etherscan pages walked backward per endpoint until the window is covered. */
const MAX_ETHERSCAN_PAGES = 10;

/** Minimum gap between alert deliveries per watch (registry gas + DM calm). */
const WATCH_ALERT_THROTTLE_MS = 15 * 60_000;

/** In-process single-flight so concurrent 60s ticks cannot double-publish one watch. */
const completionInFlight = new Set<string>();

function parseProviderInteger(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = /^0x/i.test(trimmed)
    ? Number.parseInt(trimmed, 16)
    : Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventObservedAtMs(event: MonitoredEventRow): number {
  const observed = event.observed_at ? Date.parse(event.observed_at) : Number.NaN;
  if (Number.isFinite(observed)) return observed;
  const captured = Date.parse(event.captured_at);
  return Number.isFinite(captured) ? captured : Number.NaN;
}

function eventIsInCampaignWindow(event: MonitoredEventRow, watch: SponsoredWatchRow): boolean {
  const startsMs = Date.parse(watch.starts_at);
  const endsMs = Date.parse(watch.ends_at);
  const observedMs = eventObservedAtMs(event);
  return (
    Number.isFinite(startsMs) &&
    Number.isFinite(endsMs) &&
    Number.isFinite(observedMs) &&
    observedMs >= startsMs &&
    observedMs <= endsMs
  );
}

export interface CompleteWatchParams {
  reportContentHash: string;
  sourceEventRoot: string;
  sourceEventIds?: string[];
  reportTitle?: string;
  reportSummary?: string;
  reportHighlights?: string[];
  reportAnalysis?: string;
  monitoredEventCount?: number;
}

export interface CampaignCycleResult {
  activated: number;
  monitored: number;
  completed: number;
  /** Completed watches whose narrative was junk/empty and got template/LLM backfill. */
  repaired: number;
  failed: number;
  errors: string[];
}

export interface SponsoredWatchService {
  createSponsoredWatch(params: {
    targetContract: string;
    watchSpecHash: string;
    startsAt: string;
    endsAt: string;
    targetKind?: SponsoredWatchTargetKind;
    visibility?: SponsoredWatchVisibility;
    telegramChatId?: string | null;
  }): Promise<SponsoredWatchRow>;

  completeWatch(watchId: string, params: CompleteWatchParams): Promise<SponsoredWatchRow>;

  failWatch(watchId: string, reason: string): Promise<SponsoredWatchRow>;

  getActiveWatches(): Promise<SponsoredWatchRow[]>;

  /**
   * Periodic Loop 4 driver:
   * - accepted → monitoring when starts_at has arrived
   * - refresh matching events for in-window campaigns
   * - ended campaigns → generate report + publishSponsoredReport
   */
  processCampaignCycle(now?: Date): Promise<CampaignCycleResult>;
}

export function createSponsoredWatchService(params: {
  watchRepo: SponsoredWatchRepository;
  execLogRepo: ExecutionLogRepository;
  web3Client?: Web3Client | null;
  /** Required for campaign monitoring / auto-complete. Optional only for create/complete unit tests. */
  eventRepo?: MonitoredEventRepository | null;
  reportService?: SponsoredWatchReportService;
  /** Public SPA origin (FRONTEND_ORIGIN) for HTTPS report content URIs. */
  frontendOrigin?: string;
  /** Private watch Telegram DMs + public alert community fan-out. */
  notificationService?: NotificationService | null;
  /** Create public_alert rows for public watch alerts. */
  alertRepo?: PublicAlertRepository | null;
  /** Publish public watch alerts onchain + Telegram community. */
  alertPublicationService?: AlertPublicationService | null;
}): SponsoredWatchService {
  const {
    watchRepo,
    execLogRepo,
    web3Client,
    eventRepo = null,
    frontendOrigin,
    notificationService = null,
    alertRepo = null,
    alertPublicationService = null,
  } = params;
  const reportService = params.reportService ?? createSponsoredWatchReportService();
  /** Coalesces timer/webhook callers so the full campaign scan stays single-flight. */
  let campaignCycleInFlight: Promise<CampaignCycleResult> | null = null;

  function requireWeb3(): Web3Client {
    if (!web3Client) {
      throw new Error(
        "Web3 client not configured — sponsored watch requires KeeperHub (KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS) or ALLOW_DIRECT_ETHERS_WRITES for local tests",
      );
    }
    return web3Client;
  }

  /**
   * Stable UUID derived from tx+logIndex so RPC observations can be re-derived
   * across ticks without inventing fresh random ids each minute (which previously
   * filled source_event_ids with 400+ orphans that never existed in monitored_events).
   */
  function deterministicRpcEventId(txHash: string, logIndex: number): string {
    const hex = Array.from(
      new TextEncoder().encode(`${txHash.toLowerCase()}:${logIndex}`),
    )
      .reduce((acc, b) => acc + b.toString(16).padStart(2, "0"), "")
      .padEnd(32, "0")
      .slice(0, 32);
    // Prefer crypto digest when available for better distribution.
    try {
      // Node 22+: sync not available for subtle; use a simple FNV-ish mix on hex chars.
      let h = 2166136261;
      const key = `${txHash.toLowerCase()}:${logIndex}`;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const h2 = (h >>> 0).toString(16).padStart(8, "0");
      const base = (h2 + hex).replace(/[^0-9a-f]/gi, "0").padEnd(32, "0").slice(0, 32);
      return `${base.slice(0, 8)}-${base.slice(8, 12)}-5${base.slice(13, 16)}-a${base.slice(17, 20)}-${base.slice(20, 32)}`;
    } catch {
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-${hex.slice(16, 28)}`;
    }
  }

  function mapLogItemToEvent(
    item: {
      transactionHash?: string;
      logIndex?: string | number;
      blockNumber?: string | number;
      timeStamp?: string | number;
      topic0?: string;
      topic1?: string;
      topic2?: string;
      topic3?: string;
      topics?: unknown[];
      data?: string;
      address?: string;
    },
    watch: SponsoredWatchRow,
    source: "etherscan_v2" | "rpc_direct",
    nowIso: string,
    startsMs: number,
    endsMs: number,
  ): { event: MonitoredEventRow; inWindow: boolean } | null {
    const txHash = item.transactionHash;
    if (!txHash || typeof txHash !== "string") return null;

    const logIndexRaw = item.logIndex;
    const logIndex = parseProviderInteger(logIndexRaw) ?? 0;

    // Etherscan returns decimal strings (for example "1562684042"). Treating
    // every string as hexadecimal moves those events thousands of years away,
    // causing the no-match fallback to accept an arbitrary 500-row history.
    const timeStampSec = parseProviderInteger(item.timeStamp);
    const itemMs = timeStampSec !== null ? timeStampSec * 1000 : Number.NaN;
    const inWindow =
      Number.isFinite(itemMs) &&
      itemMs >= startsMs &&
      itemMs <= endsMs;
    const observedAt = Number.isFinite(itemMs) ? new Date(itemMs).toISOString() : watch.starts_at;

    const topics: string[] = Array.isArray(item.topics)
      ? (item.topics.filter((t): t is string => typeof t === "string") as string[])
      : ([item.topic0, item.topic1, item.topic2, item.topic3].filter(
          (t): t is string => typeof t === "string" && Boolean(t),
        ) as string[]);

    const { from, to } = decodeTransferParties(topics);
    const contractAddress =
      typeof item.address === "string" && isAddress(item.address, { strict: false })
        ? getAddress(item.address)
        : watch.target_contract;
    const blockNumber =
      item.blockNumber != null
        ? String(
            typeof item.blockNumber === "string"
              ? parseProviderInteger(item.blockNumber) ?? item.blockNumber
              : item.blockNumber,
          )
        : null;
    const id = deterministicRpcEventId(txHash, logIndex);
    const kind = watchTargetKind(watch);

    const amount = decodeTransferAmount(item.data);
    const tokenMeta = contractAddress
      ? WATCH_TOKEN_META[contractAddress.toLowerCase()]
      : undefined;
    let assetSymbols: string[] | null = null;
    let magnitude: Record<string, unknown> | null = null;
    if (amount !== null && tokenMeta) {
      assetSymbols = [tokenMeta.symbol];
      // Derive the human amount from the exact humanized string so WETH-scale
      // values (10^18+) never lose precision through Number(bigint).
      const human = parseFloat(
        humanizeTokenAmount(amount, tokenMeta.decimals).replace(/,/g, ""),
      );
      magnitude = {
        value: Number.isFinite(human) ? Math.round(human * 100) / 100 : 0,
        unit: tokenMeta.isStableUsd ? "USD" : tokenMeta.symbol,
      };
    }

    const event: MonitoredEventRow = {
      id,
      source,
      source_event_id: `${source === "etherscan_v2" ? "eth" : "rpc"}-${txHash}-${logIndex}`,
      event_type: kind === "wallet" ? "wallet_transfer" : "large_swap",
      chain_id: WATCH_MONITOR_CHAIN_ID,
      protocol: "Ethereum Mainnet",
      asset_symbols: assetSymbols,
      magnitude: magnitude,
      transaction_hash: txHash,
      observed_at: observedAt,
      captured_at: nowIso,
      significance_score: 0.75,
      raw_payload: {
        address: kind === "wallet" ? contractAddress : watch.target_contract,
        logIndex,
        topics,
        data: item.data,
        blockNumber,
        source,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        targetKind: kind,
        ...(amount !== null ? { amountRaw: amount.toString() } : {}),
      },
      status: "qualified",
      created_at: nowIso,
      updated_at: nowIso,
    };
    return { event, inWindow };
  }

  /**
   * Map an Etherscan account-endpoint row to a wallet watch event.
   * Handles `txlist` (native ETH transfers + value-bearing calls) and `tokentx`
   * (ERC-20/721/1155 transfers). Wallets emit no logs, so this is the primary
   * capture path for wallet watches — Transfer-log queries alone miss native
   * ETH sends, which never emit an ERC-20 Transfer log.
   */
  function mapWalletAccountItemToEvent(
    item: {
      hash?: string;
      from?: string;
      to?: string;
      value?: string | number;
      timeStamp?: string | number;
      blockNumber?: string | number;
      isError?: string;
      txreceipt_status?: string;
      contractAddress?: string;
      tokenSymbol?: string;
      tokenName?: string;
      tokenDecimal?: string | number;
    },
    watch: SponsoredWatchRow,
    nowIso: string,
    startsMs: number,
    endsMs: number,
  ): { event: MonitoredEventRow; inWindow: boolean } | null {
    const txHash = item.hash;
    if (!txHash || typeof txHash !== "string") return null;

    const timeStampSec = parseProviderInteger(item.timeStamp);
    const itemMs = timeStampSec !== null ? timeStampSec * 1000 : Number.NaN;
    const inWindow = Number.isFinite(itemMs) && itemMs >= startsMs && itemMs <= endsMs;
    const observedAt = Number.isFinite(itemMs) ? new Date(itemMs).toISOString() : watch.starts_at;

    const from =
      typeof item.from === "string" && isAddress(item.from, { strict: false })
        ? getAddress(item.from)
        : null;
    const to =
      typeof item.to === "string" && isAddress(item.to, { strict: false })
        ? getAddress(item.to)
        : null;
    if (!from || !to) return null;

    const blockNumber =
      item.blockNumber != null
        ? String(
            typeof item.blockNumber === "string"
              ? parseProviderInteger(item.blockNumber) ?? item.blockNumber
              : item.blockNumber,
          )
        : null;

    // Native ETH transfer (txlist row, or a tokentx row Etherscan returns
    // with an EMPTY contractAddress for native sends — both are native and
    // must not be misclassified as a token transfer). Skip failed / zero-value
    // txs — zero value means a token or contract call, which tokentx covers.
    if (item.contractAddress == null || String(item.contractAddress).trim() === "") {
      const isError = String(item.isError ?? "0");
      const receiptStatus = String(item.txreceipt_status ?? "1");
      if (isError !== "0" || receiptStatus !== "1") return null;
      const valueRaw =
        typeof item.value === "string" || typeof item.value === "number"
          ? String(item.value)
          : null;
      if (!valueRaw || !/^\d+$/.test(valueRaw)) return null;
      let amount: bigint;
      try {
        amount = BigInt(valueRaw);
      } catch {
        return null;
      }
      if (amount <= 0n) return null;

      const human = parseFloat(humanizeTokenAmount(amount, 18).replace(/,/g, ""));
      return {
        event: {
          id: deterministicRpcEventId(`${txHash}:native`, 0),
          source: "etherscan_v2",
          source_event_id: `native-${txHash}`,
          event_type: "wallet_transfer",
          chain_id: WATCH_MONITOR_CHAIN_ID,
          protocol: "Ethereum Mainnet",
          asset_symbols: ["ETH"],
          magnitude: Number.isFinite(human)
            ? { value: Math.round(human * 1_000_000) / 1_000_000, unit: "ETH" }
            : null,
          transaction_hash: txHash,
          observed_at: observedAt,
          captured_at: nowIso,
          significance_score: 0.75,
          raw_payload: {
            address: null,
            topics: [],
            data: null,
            blockNumber,
            source: "etherscan_v2",
            from,
            to,
            amountRaw: valueRaw,
            isNative: true,
            symbol: "ETH",
            decimals: 18,
            targetKind: "wallet",
          },
          status: "qualified",
          created_at: nowIso,
          updated_at: nowIso,
        },
        inWindow,
      };
    }

    // Token transfer (tokentx row).
    const isError = String(item.isError ?? "0");
    const receiptStatus = String(item.txreceipt_status ?? "1");
    if (isError !== "0" || receiptStatus !== "1") return null;
    const tokenAddress = isAddress(item.contractAddress, { strict: false })
      ? getAddress(item.contractAddress)
      : null;
    const decimalsRaw = parseProviderInteger(item.tokenDecimal);
    const decimals =
      decimalsRaw !== null && decimalsRaw >= 0 && decimalsRaw <= 36 ? decimalsRaw : 18;
    const valueRaw =
      typeof item.value === "string" || typeof item.value === "number"
        ? String(item.value)
        : null;
    if (!valueRaw || !/^\d+$/.test(valueRaw)) return null;
    let amount: bigint;
    try {
      amount = BigInt(valueRaw);
    } catch {
      return null;
    }
    if (amount <= 0n) return null;

    const knownMeta = tokenAddress ? WATCH_TOKEN_META[tokenAddress.toLowerCase()] : undefined;
    const symbol =
      typeof item.tokenSymbol === "string" && item.tokenSymbol.trim()
        ? item.tokenSymbol.trim()
        : knownMeta?.symbol ?? null;
    const human = parseFloat(humanizeTokenAmount(amount, decimals).replace(/,/g, ""));
    // Never fabricate an unknown-token event: without a valid token contract
    // this row cannot be attributed to any token, so it must be a native
    // transfer (handled above) or an unusable row.
    if (!tokenAddress) return null;
    return {
      event: {
        id: deterministicRpcEventId(
          `${txHash}:${tokenAddress ?? "?"}:${from}:${to}:${valueRaw}`,
          0,
        ),
        source: "etherscan_v2",
        source_event_id: `tokentx-${txHash}-${(tokenAddress ?? "?").toLowerCase()}-${from.toLowerCase()}-${to.toLowerCase()}-${valueRaw}`,
        event_type: "wallet_transfer",
        chain_id: WATCH_MONITOR_CHAIN_ID,
        protocol: "Ethereum Mainnet",
        asset_symbols: symbol ? [symbol] : knownMeta ? [knownMeta.symbol] : null,
        magnitude: Number.isFinite(human)
          ? {
              // 6-decimal rounding keeps tiny amounts (e.g. 0.0044) visible
              // instead of collapsing to 0 in the alert text.
              value: Math.round(human * 1_000_000) / 1_000_000,
              unit: knownMeta?.isStableUsd ? "USD" : symbol ?? "tokens",
            }
          : null,
        transaction_hash: txHash,
        observed_at: observedAt,
        captured_at: nowIso,
        significance_score: 0.75,
        raw_payload: {
          address: tokenAddress,
          topics: [],
          data: null,
          blockNumber,
          source: "etherscan_v2",
          from,
          to,
          amountRaw: valueRaw,
          tokenAddress,
          tokenSymbol: symbol,
          tokenName: typeof item.tokenName === "string" ? item.tokenName : null,
          decimals,
          targetKind: "wallet",
        },
        status: "qualified",
        created_at: nowIso,
        updated_at: nowIso,
      },
      inWindow,
    };
  }

  async function collectRpcLogsForWindow(watch: SponsoredWatchRow): Promise<MonitoredEventRow[]> {
    const startsMs = new Date(watch.starts_at).getTime();
    const endsMs = new Date(watch.ends_at).getTime();
    if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs) || startsMs >= endsMs) {
      return [];
    }

    const nowIso = new Date().toISOString();
    const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
    const kind = watchTargetKind(watch);
    const isWallet = kind === "wallet";

    // 1. Try Etherscan V2 API first (Ethereum Mainnet chainId 1)
    if (apiKey) {
      try {
        // Wallets emit no logs of their own. A wallet's activity is the set of
        // transactions where it is `from` or `to`:
        //   - txlist  → normal transactions (native ETH transfers, contract calls)
        //   - tokentx → ERC-20 / ERC-721 / ERC-1155 transfers
        // Transfer-log queries alone miss native ETH sends (no ERC-20 log is
        // emitted), which is why a busy wallet previously reported zero events.
        //
        // Pages are walked newest-first until a page is older than the campaign
        // window (or the page cap is hit), so an active address can never push
        // its window off page 1 — the failure mode that produced "0 events" on
        // a wallet that was clearly moving funds.
        const windowEvents: MonitoredEventRow[] = [];
        const seen = new Set<string>();
        let failedResponses = 0;
        let coveredWindow = true;

        const fetchPage = async (
          url: string,
        ): Promise<Array<Record<string, unknown>> | null> => {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
            const data = (await res.json()) as {
              status?: string;
              message?: string;
              result?: Array<Record<string, unknown>>;
            };
            if (
              !(data && (data.status === "1" || data.message === "OK") && Array.isArray(data.result))
            ) {
              return null;
            }
            return data.result;
          } catch {
            return null;
          }
        };

        const collectPage = (items: Array<Record<string, unknown>>): void => {
          for (const item of items) {
            const mapped = isWallet
              ? mapWalletAccountItemToEvent(
                  item as Parameters<typeof mapWalletAccountItemToEvent>[0],
                  watch,
                  nowIso,
                  startsMs,
                  endsMs,
                )
              : mapLogItemToEvent(
                  item as Parameters<typeof mapLogItemToEvent>[0],
                  watch,
                  "etherscan_v2",
                  nowIso,
                  startsMs,
                  endsMs,
                );
            if (!mapped) continue;
            const key = `${mapped.event.source}:${mapped.event.source_event_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (mapped.inWindow) windowEvents.push(mapped.event);
          }
        };

        const oldestItemMs = (items: Array<Record<string, unknown>>): number => {
          let oldestMs = Number.POSITIVE_INFINITY;
          for (const item of items) {
            const rawTs = item.timeStamp;
            const tsSec = parseProviderInteger(
              typeof rawTs === "string" || typeof rawTs === "number" ? rawTs : undefined,
            );
            if (tsSec !== null) oldestMs = Math.min(oldestMs, tsSec * 1000);
          }
          return oldestMs;
        };

        const endpointActions = isWallet ? (["txlist", "tokentx"] as const) : (["getLogs"] as const);

        for (const action of endpointActions) {
          let endpointOk = false;
          for (let page = 1; page <= MAX_ETHERSCAN_PAGES; page++) {
            const url =
              action === "getLogs"
                ? `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs&address=${watch.target_contract}&page=${page}&offset=1000&sort=desc&apikey=${apiKey}`
                : `https://api.etherscan.io/v2/api?chainid=1&module=account&action=${action}&address=${watch.target_contract}&page=${page}&offset=1000&sort=desc&apikey=${apiKey}`;
            const items = await fetchPage(url);
            if (!items) {
              failedResponses += 1;
              coveredWindow = false;
              break;
            }
            endpointOk = true;
            collectPage(items);
            // Walked past the window start (or no more rows): this endpoint
            // provably covered the campaign window.
            if (items.length === 0 || oldestItemMs(items) <= startsMs) break;
            if (page >= MAX_ETHERSCAN_PAGES) coveredWindow = false;
          }
          if (!endpointOk) coveredWindow = false;
        }

        if (windowEvents.length > 0 || (failedResponses === 0 && coveredWindow)) {
          // In-window matches, or every endpoint answered with valid pages that
          // covered the campaign window. Never substitute unrelated logs.
          return dedupeSponsoredWatchEvents(windowEvents).slice(0, MAX_RPC_EVENTS_PER_WATCH);
        }
      } catch (etherscanErr) {
        console.warn(
          `[sponsored-watch] Etherscan V2 fetch failed for ${watch.id}, falling back to chunked RPC:`,
          etherscanErr instanceof Error ? etherscanErr.message : etherscanErr,
        );
      }
    }

    // 2. Fallback to Viem RPC with <=45 block chunking across multi-RPC providers
    // Mainnet only: MAINNET_RPC_URL must never fall back to the Sepolia RPC_URL.
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");
    const rpcUrls = [
      process.env.MAINNET_RPC_URL,
      "https://1rpc.io/eth",
      "https://eth.drpc.org",
    ].filter((u): u is string => Boolean(u));

    type NormalizedRpcLog = {
      transactionHash: string;
      logIndex: number;
      blockNumber?: bigint | number;
      topics: readonly string[] | string[];
      data?: string;
      address?: string;
      blockTimestamp?: number;
    };

    function normalizeRpcLog(log: {
      transactionHash?: string | null;
      logIndex?: number | null;
      blockNumber?: bigint | number | null;
      topics?: readonly string[] | string[] | null;
      data?: string | null;
      address?: string | null;
    }): NormalizedRpcLog | null {
      if (!log.transactionHash || log.logIndex == null) return null;
      return {
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        ...(log.blockNumber != null ? { blockNumber: log.blockNumber } : {}),
        topics: log.topics ?? [],
        ...(log.data ? { data: log.data } : {}),
        ...(log.address ? { address: log.address } : {}),
      };
    }

    let rawLogs: NormalizedRpcLog[] = [];
    let rpcCalls = 0;

    for (const rpcUrl of rpcUrls) {
      if (rpcCalls >= MAX_RPC_CALLS_PER_WATCH) break;
      try {
        const client = createPublicClient({
          chain: mainnet,
          transport: http(rpcUrl, { timeout: 10_000 }),
        });
        rpcCalls += 1;
        const latest = await client.getBlock();
        const latestTs = Number(latest.timestamp);
        const latestBlock = latest.number;
        const MAINNET_BLOCK_SECONDS = 12;
        const blocksFromEnd = BigInt(
          Math.max(0, Math.ceil((latestTs - endsMs / 1000) / MAINNET_BLOCK_SECONDS)),
        );
        const blocksFromStart = BigInt(
          Math.max(0, Math.ceil((latestTs - startsMs / 1000) / MAINNET_BLOCK_SECONDS)),
        );
        let toBlock = latestBlock > blocksFromEnd ? latestBlock - blocksFromEnd : 0n;
        let fromBlock = latestBlock > blocksFromStart ? latestBlock - blocksFromStart : 0n;
        if (toBlock < fromBlock) {
          const tmp = fromBlock;
          fromBlock = toBlock;
          toBlock = tmp;
        }
        if (toBlock - fromBlock > MAX_RPC_BLOCK_SPAN) {
          fromBlock = toBlock - MAX_RPC_BLOCK_SPAN;
        }

        const chunkLogs: NormalizedRpcLog[] = [];
        const seenLog = new Set<string>();
        const pushLog = (log: Parameters<typeof normalizeRpcLog>[0]): void => {
          const normalized = normalizeRpcLog(log);
          if (!normalized) return;
          const key = `${normalized.transactionHash}:${normalized.logIndex}`;
          if (seenLog.has(key)) return;
          seenLog.add(key);
          const estimatedTimestamp =
            normalized.blockNumber != null
              ? latestTs - Number(latestBlock - BigInt(normalized.blockNumber)) * 12
              : null;
          chunkLogs.push({
            ...normalized,
            ...(estimatedTimestamp !== null && Number.isFinite(estimatedTimestamp)
              ? { blockTimestamp: Math.floor(estimatedTimestamp) }
              : {}),
          });
        };

        // Scan newest-first: if the call budget ever runs out, the tail of the
        // window (the most recent activity) is always covered.
        for (
          let chunkTo = toBlock;
          chunkTo >= fromBlock && rpcCalls < MAX_RPC_CALLS_PER_WATCH;
          chunkTo -= RPC_LOG_CHUNK_SIZE
        ) {
          const chunkFrom =
            chunkTo - RPC_LOG_CHUNK_SIZE + 1n < fromBlock
              ? fromBlock
              : chunkTo - RPC_LOG_CHUNK_SIZE + 1n;
          try {
            if (isWallet) {
              // Two queries: Transfer from wallet + Transfer to wallet.
              // Cast filter: viem's getLogs overload for raw topic filters is narrow.
              const topicWallet = walletTopic(watch.target_contract);
              const transferTopic = TRANSFER_EVENT_TOPIC0 as `0x${string}`;
              rpcCalls += 1;
              const fromLogs = await client.getLogs({
                fromBlock: chunkFrom,
                toBlock: chunkTo,
                topics: [transferTopic, topicWallet],
              } as Parameters<typeof client.getLogs>[0]);
              for (const log of fromLogs) pushLog(log);
              if (rpcCalls < MAX_RPC_CALLS_PER_WATCH) {
                rpcCalls += 1;
                const toLogs = await client.getLogs({
                  fromBlock: chunkFrom,
                  toBlock: chunkTo,
                  topics: [transferTopic, null, topicWallet],
                } as Parameters<typeof client.getLogs>[0]);
                for (const log of toLogs) pushLog(log);
              }
            } else {
              rpcCalls += 1;
              const fetched = await client.getLogs({
                address: watch.target_contract as `0x${string}`,
                fromBlock: chunkFrom,
                toBlock: chunkTo,
              });
              for (const log of fetched) pushLog(log);
            }
          } catch {
            // Ignore single chunk failure and continue
          }
        }
        if (chunkLogs.length > 0) {
          rawLogs = chunkLogs;
          break;
        }
      } catch {
        continue;
      }
    }

    return rawLogs
      .slice(0, MAX_RPC_EVENTS_PER_WATCH)
      .map((log) => {
        const mapped = mapLogItemToEvent(
          {
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber != null ? String(log.blockNumber) : undefined,
            timeStamp: log.blockTimestamp,
            topics: [...log.topics],
            data: log.data,
            address: log.address,
          },
          watch,
          "rpc_direct",
          nowIso,
          startsMs,
          endsMs,
        );
        return mapped?.inWindow ? mapped.event : null;
      })
      .filter((e): e is MonitoredEventRow => e != null);
  }

  async function collectMatchingEvents(
    watch: SponsoredWatchRow,
    options: { forceRpcScan?: boolean } = {},
  ) {
    if (!eventRepo) {
      return [];
    }
    const kind = watchTargetKind(watch);

    // 1) Reload previously correlated rows by id (they are real DB rows once
    //    persisted, so this keeps the campaign source set across ticks).
    const priorIds = (watch.source_event_ids ?? []).filter((id) => UUID_RE.test(id)).slice(0, 500);
    const known: MonitoredEventRow[] = [];
    if (priorIds.length > 0) {
      const loaded: MonitoredEventRow[] = [];
      const probe = priorIds.slice(0, 25);
      const probeRows = await Promise.all(probe.map((id) => eventRepo.findById(id)));
      let probeHits = 0;
      for (const row of probeRows) {
        if (row.ok) {
          loaded.push(row.value);
          probeHits += 1;
        }
      }
      if (probeHits > 0) {
        for (let i = 25; i < priorIds.length; i += 50) {
          const chunk = priorIds.slice(i, i + 50);
          const rows = await Promise.all(chunk.map((id) => eventRepo.findById(id)));
          for (const row of rows) {
            if (row.ok) loaded.push(row.value);
          }
        }
        known.push(
          ...dedupeSponsoredWatchEvents(
            loaded.filter(
              (event) =>
                eventIsInCampaignWindow(event, watch) &&
                eventMatchesWatchTarget(event, watch.target_contract, kind),
            ),
          ),
        );
      }
    }

    // 2) Window scan of Event Tracker / block-dispatcher rows in DB. Runs on
    //    every tick (cheap) so tracker-ingested events keep alerting at the 60s
    //    cadence. Merged with the reloaded set instead of short-circuiting —
    //    returning early here froze the source set after the first scan and
    //    silently stopped delivering new events for the rest of the campaign.
    const result = await eventRepo.listInWindow({
      periodStart: watch.starts_at,
      periodEnd: watch.ends_at,
      limit: 1000,
    });
    if (!result.ok) {
      throw new Error(`Failed to load campaign events: ${result.error.message}`);
    }
    const dbMatched = dedupeSponsoredWatchEvents(
      result.value.filter(
        (event) =>
          eventIsInCampaignWindow(event, watch) &&
          eventMatchesWatchTarget(event, watch.target_contract, kind),
      ),
    );
    const allSoFar = dedupeSponsoredWatchEvents([...known, ...dbMatched]);

    // No time-based rescan throttle here. Every tick re-scans on-chain for
    // watches that need it (wallets and contracts without tracker coverage):
    // those events only surface via a fresh scan, and last_monitored_at is
    // stamped every tick, so a wall/campaign-clock interval would skip the
    // scan on every tick of a sub-interval cycle and silently drop events
    // (observed in production: a ~30s cycle + 45s throttle => zero matches
    // forever after the first scan).
    //
    // The only skip is a purely *coverage* check, which never drops events:
    // tracker-owned contract watches receive every event through the
    // ingestion pipeline into monitored_events (step 2 picks new ones up next
    // tick), so a live re-scan adds nothing. Everything else — wallets,
    // contracts without tracker coverage, and any forced (completion/repair)
    // scan — falls through to the on-chain scan and merges its results.
    const scanSourcedRows = allSoFar.filter(
      (event) => event.source === "etherscan_v2" || event.source === "rpc_direct",
    );
    if (
      !options.forceRpcScan &&
      kind === "contract" &&
      allSoFar.length > 0 &&
      scanSourcedRows.length === 0
    ) {
      return allSoFar;
    }

    // 3) Etherscan / RPC fallback: fetch on-chain logs/transactions, persist
    //    newly discovered events, and merge them into the DB-backed set so the
    //    next tick can diff against the cursor and alert on exactly what is new.
    try {
      const rpcMatched = await collectRpcLogsForWindow(watch);
      if (rpcMatched.length > 0) {
        const persisted: MonitoredEventRow[] = [];
        const candidates = dedupeSponsoredWatchEvents(rpcMatched)
          .filter((event) => eventIsInCampaignWindow(event, watch))
          .slice(0, MAX_RPC_EVENTS_PER_WATCH);
        for (let i = 0; i < candidates.length; i += 25) {
          const chunk = candidates.slice(i, i + 25);
          const chunkResults = await Promise.all(
            chunk.map(async (ev) => {
              const existing = await eventRepo.findBySourceAndEventId(ev.source, ev.source_event_id!);
              if (existing) return existing;
              const res = await eventRepo.create({
                source: ev.source,
                source_event_id: ev.source_event_id,
                event_type: ev.event_type,
                chain_id: ev.chain_id,
                protocol: ev.protocol ?? null,
                asset_symbols: ev.asset_symbols ?? null,
                magnitude: ev.magnitude ?? null,
                transaction_hash: ev.transaction_hash ?? null,
                observed_at: ev.observed_at,
                captured_at: ev.captured_at,
                significance_score: ev.significance_score,
                raw_payload: ev.raw_payload,
                status: ev.status,
              });
              return res.ok ? res.value : ev;
            }),
          );
          for (const item of chunkResults) {
            if (item) persisted.push(item);
          }
        }
        return dedupeSponsoredWatchEvents([...allSoFar, ...persisted]);
      }
    } catch (error) {
      console.warn(
        `[sponsored-watch] RPC/Etherscan fallback failed for ${watch.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return allSoFar;
  }

  async function activateWatch(watch: SponsoredWatchRow): Promise<SponsoredWatchRow> {
    // Activation is not a scan. Leave last_monitored_at empty so the first
    // monitoring pass performs one bounded fallback lookup.
    const result = await watchRepo.updateStatus(watch.id, "monitoring", {
      last_monitored_at: null,
    });
    if (!result.ok) {
      throw new Error(`Failed to activate sponsored watch: ${result.error.message}`);
    }

    await execLogRepo.append({
      action_type: "monitor",
      entity_type: "sponsored_watch",
      entity_id: watch.id,
      status: "started",
      message: `Sponsored watch monitoring started for ${watch.target_contract}`,
      details: {
        targetContract: watch.target_contract,
        startsAt: watch.starts_at,
        endsAt: watch.ends_at,
        onChainWatchId: watch.on_chain_watch_id,
        createTxHash: watch.create_tx_hash,
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    return result.value;
  }

  /**
   * Send a watch alert as a Telegram DM to the bound chat (private watches
   * and public watches that carry a binding code). Appends the audit log.
   * For private watches this is the primary delivery and gates the alert
   * cursor; for public watches it is best-effort — the registry/community
   * path decides cursor advancement so a failed DM never re-writes the
   * registry for the same alert.
   */
  async function deliverWatchDm(params: {
    watch: SponsoredWatchRow;
    newEvents: MonitoredEventRow[];
    title: string;
    summary: string;
    detailLines: string[];
    sourceExplorer: string | null;
    now: string;
  }): Promise<{ delivered: boolean }> {
    const { watch, newEvents, title, summary, detailLines, sourceExplorer, now } = params;
    if (!notificationService) {
      return { delivered: false };
    }
    const visibility = watchVisibility(watch);
    const chatId = watch.telegram_chat_id?.trim() ?? "";
    const auditTrailUrl = frontendOrigin
      ? `${frontendOrigin.replace(/\/$/, "")}/watch/${watch.id}`
      : null;
    const text = buildWatchDmText({
      visibility,
      title,
      summary,
      detailLines,
      sourceExplorer,
      auditTrailUrl,
    });
    const delivery = await notificationService.sendTelegramToChat({
      chatId,
      text,
      entityType: "sponsored_watch",
      entityId: watch.id,
    });
    const label = visibility === "private" ? "Private watch alert" : "Watch alert DM";
    await execLogRepo.append({
      action_type: "generate_alert",
      entity_type: "sponsored_watch",
      entity_id: watch.id,
      status: delivery.delivered ? "succeeded" : "failed",
      message: delivery.delivered
        ? `${label} delivered to Telegram (${newEvents.length} new event(s))`
        : `${label} failed: ${delivery.failures.join("; ") || "unknown"}`,
      details: {
        visibility,
        deliveryMode: "telegram_dm",
        chatId,
        matchedEventCount: newEvents.length,
        sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
        destinations: delivery.destinations,
        failures: delivery.failures,
        // The DM itself never performs a registry write; public watches get
        // their registry tx via the separate publish_alert path.
        registryWrite: false,
      },
      started_at: now,
      completed_at: now,
    });
    return { delivered: delivery.delivered };
  }

  /**
   * Near-realtime alert delivery (~60s cycle). Fires when a monitor tick finds
   * new matched events vs prior source_event_ids.
   * - private: Telegram DM to watch.telegram_chat_id only (no registry write)
   * - public: create public_alert → publishAlert (registry + community
   *   Telegram); when a binding code is stored on the watch it ALSO DMs the
   *   owner (best-effort, before the throttle check)
   *
   * Returns true when the alert is considered delivered (or legitimately
   * throttled) — the caller then commits the new source_event_ids cursor.
   * Returns false on delivery failure so the caller keeps the old cursor and
   * the next tick retries the same events.
   */
  async function deliverWatchAlert(
    watch: SponsoredWatchRow,
    newEvents: MonitoredEventRow[],
    now = new Date(),
  ): Promise<boolean> {
    if (newEvents.length === 0) return true;

    const visibility = watchVisibility(watch);
    const kind = watchTargetKind(watch);
    const primary = newEvents[0]!;
    const nowIso = now.toISOString();

    const shortTarget = `${watch.target_contract.slice(0, 8)}…${watch.target_contract.slice(-6)}`;
    const title =
      kind === "wallet"
        ? `Wallet watch alert — ${shortTarget}`
        : `Contract watch alert — ${shortTarget}`;
    const detailLines = newEvents
      .slice(0, 5)
      .map((e) => describeWatchEvent(e, kind, watch.target_contract));
    const summaryDetail =
      detailLines.length === 1 ? detailLines[0] : detailLines.join(" · ");
    const summary =
      newEvents.length === 1
        ? `Matched 1 new event on ${kind} ${shortTarget}: ${summaryDetail}`
        : `Matched ${newEvents.length} new events on ${kind} ${shortTarget}: ${summaryDetail}${
            newEvents.length > 5 ? ` (+${newEvents.length - 5} more)` : ""
          }`;
    const sourceTx = primary.transaction_hash ?? null;
    const sourceExplorer = sourceTx
      ? `https://etherscan.io/tx/${sourceTx}`
      : null;

    if (visibility === "private") {
      const chatId = watch.telegram_chat_id?.trim();
      if (!chatId || !notificationService) {
        await execLogRepo.append({
          action_type: "generate_alert",
          entity_type: "sponsored_watch",
          entity_id: watch.id,
          status: "failed",
          message: chatId
            ? "Private watch alert skipped: Telegram send bot not configured"
            : "Private watch alert skipped: no telegram_chat_id on watch",
          details: {
            visibility,
            matchedEventCount: newEvents.length,
            sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
          },
          started_at: nowIso,
          completed_at: nowIso,
        });
        return false;
      }
      const dm = await deliverWatchDm({
        watch,
        newEvents,
        title,
        summary,
        detailLines,
        sourceExplorer,
        now: nowIso,
      });
      return dm.delivered;
    }

    // Public path. When the buyer entered a Telegram binding code, the watch
    // carries telegram_chat_id and we ALSO DM them — sent before the throttle
    // check so DMs keep flowing while the registry broadcast is throttled
    // (DMs have no gas cost; users opted in per-event). The DM result gates
    // the cursor only inside a throttle window (below); otherwise the registry
    // path decides, so a failed DM never re-writes the registry for the same
    // alert. Note the deliberate trade-off: if the DM succeeds but the
    // registry path fails, the cursor stays and the same events are DM'd again
    // on the next tick — registry correctness is prioritized over DM dedup,
    // because retrying is what eventually commits the on-chain write.
    const publicChatId = watch.telegram_chat_id?.trim();
    let publicDmDelivered = true;
    if (publicChatId && notificationService) {
      const dm = await deliverWatchDm({
        watch,
        newEvents,
        title,
        summary,
        detailLines,
        sourceExplorer,
        now: nowIso,
      });
      publicDmDelivered = dm.delivered;
    } else if (publicChatId && !notificationService) {
      publicDmDelivered = false;
      await execLogRepo.append({
        action_type: "generate_alert",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "failed",
        message: "Public watch alert DM skipped: Telegram send bot not configured",
        details: {
          visibility: "public",
          deliveryMode: "telegram_dm",
          matchedEventCount: newEvents.length,
          sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
        },
        started_at: nowIso,
        completed_at: nowIso,
      });
    }

    // Throttle: one delivery per watch per window — protects registry gas on
    // busy wallets and keeps the community channel calm. Only the public path
    // is throttled (private DMs have no gas cost and users opt in per-event).
    // A failed delivery leaves last_alert_sent_at stale, so the throttle never
    // blocks a retry.
    const lastSentMs = watch.last_alert_sent_at
      ? Date.parse(watch.last_alert_sent_at)
      : Number.NaN;
    if (Number.isFinite(lastSentMs) && now.getTime() - lastSentMs < WATCH_ALERT_THROTTLE_MS) {
      await execLogRepo.append({
        action_type: "generate_alert",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "succeeded",
        message: `Public watch alert throttled (last alert < ${WATCH_ALERT_THROTTLE_MS / 60_000} min ago); ${newEvents.length} new event(s) folded into the next delivery`,
        details: {
          visibility,
          throttled: true,
          matchedEventCount: newEvents.length,
          sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
        },
        started_at: nowIso,
        completed_at: nowIso,
      });
      // Inside a throttle window the DM is the delivery the buyer opted into:
      // only fold events into the cursor when it went out. A failed DM keeps
      // the cursor so the next tick retries it — the broadcast is throttled
      // anyway, so this never re-writes the registry. When no chat is bound
      // the throttle still counts as delivered (legacy behavior).
      if (publicChatId) {
        return publicDmDelivered;
      }
      return true;
    }

    if (kind === "wallet" || primary.event_type === "wallet_transfer") {
      await execLogRepo.append({
        action_type: "publish_alert",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "succeeded",
        message: `Public wallet watch alert publication skipped (wallet watch alerts excluded from public Alerts feed; ${newEvents.length} new event(s))`,
        details: {
          visibility: "public",
          deliveryMode: "wallet_watch_skipped",
          matchedEventCount: newEvents.length,
          sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
        },
        started_at: nowIso,
        completed_at: nowIso,
      });
      return publicChatId ? publicDmDelivered : true;
    }

    if (!alertRepo || !alertPublicationService) {
      // Soft fallback: community broadcast only when full pipeline is unavailable.
      if (notificationService) {
        await notificationService.sendAlertBroadcast({
          alertId: watch.id,
          title,
          summary,
          eventType: "contract_event",
          sourceChainLabel: "Ethereum Mainnet",
          sourceExplorerUrl: sourceExplorer,
          contentUri: frontendOrigin
            ? `${frontendOrigin.replace(/\/$/, "")}/watch/${watch.id}`
            : undefined,
        });
      }
      await execLogRepo.append({
        action_type: "publish_alert",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "succeeded",
        message: `Public watch alert broadcast (no alertRepo pipeline; ${newEvents.length} new event(s))`,
        details: {
          visibility: "public",
          deliveryMode: "broadcast_only",
          matchedEventCount: newEvents.length,
          sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
        },
        started_at: nowIso,
        completed_at: nowIso,
      });
      return true;
    }

    const dedupeKey = `sponsored-watch-alert:${watch.id}:${primary.id}`;
    // Idempotent retry: a previous attempt may have created the alert row
    // before publication failed. Reuse it (dedupe_key has a unique index)
    // instead of re-inserting and hitting a unique violation forever.
    const existingByKey =
      typeof alertRepo.findByDedupeKey === "function"
        ? await alertRepo.findByDedupeKey(dedupeKey)
        : null;
    const alertResult = existingByKey
      ? { ok: true as const, value: existingByKey }
      : await alertRepo.create({
          monitored_event_id: UUID_RE.test(primary.id) ? primary.id : null,
          title,
          summary,
          source_references: [
            ...(sourceTx ? [sourceTx] : []),
            `sponsored_watch:${watch.id}`,
            ...newEvents
              .slice(0, 5)
              .map((e) => e.transaction_hash)
              .filter((h): h is string => Boolean(h)),
          ],
          audience: "public",
          delivery_status: "queued",
          alert_kind: "market_event",
          event_type: primary.event_type,
          chain_id: primary.chain_id ?? WATCH_MONITOR_CHAIN_ID,
          publication_chain_id: WATCH_MONITOR_CHAIN_ID,
          transaction_hash: sourceTx,
          confidence: "medium",
          dedupe_key: dedupeKey,
        });

    if (!alertResult.ok) {
      await execLogRepo.append({
        action_type: "generate_alert",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "failed",
        message: `Public watch alert create failed: ${alertResult.error.message}`,
        details: { visibility: "public", error: alertResult.error.message },
        started_at: nowIso,
        completed_at: nowIso,
      });
      return false;
    }

    const publication = await alertPublicationService.publishAlert(
      alertResult.value.id,
      primary.id,
    );

    await execLogRepo.append({
      action_type: "publish_alert",
      entity_type: "sponsored_watch",
      entity_id: watch.id,
      status: publication.success ? "succeeded" : "failed",
      message: publication.success
        ? `Public watch alert published (${newEvents.length} new event(s))`
        : `Public watch alert publish failed: ${publication.message}`,
      details: {
        visibility: "public",
        deliveryMode: "registry_and_broadcast",
        alertId: alertResult.value.id,
        registryTxHash: publication.registryTxHash ?? null,
        explorerUrl: publication.explorerUrl ?? null,
        matchedEventCount: newEvents.length,
        sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
        registrySuspended: publication.registrySuspended ?? false,
      },
      started_at: nowIso,
      completed_at: nowIso,
    });
    return publication.success;
  }

  async function refreshMonitoring(
    watch: SponsoredWatchRow,
    now = new Date(),
  ): Promise<SponsoredWatchRow> {
    const matching = dedupeSponsoredWatchEvents(await collectMatchingEvents(watch));
    const sourceEventIds = matching.map((e) => e.id).filter((id) => UUID_RE.test(id));
    const priorIds = new Set((watch.source_event_ids ?? []).filter((id) => UUID_RE.test(id)));
    const newEvents = matching.filter((e) => UUID_RE.test(e.id) && !priorIds.has(e.id));
    const nowIso = now.toISOString();

    // Deliver-then-commit: only advance the alert cursor (source_event_ids +
    // last_alert_sent_at) once delivery succeeds. On a transient Telegram or
    // registry failure the old cursor is kept, so the next tick recomputes the
    // same newEvents and retries instead of permanently dropping the alert.
    let deliveryOk = true;
    if (newEvents.length > 0) {
      try {
        deliveryOk = await deliverWatchAlert(watch, newEvents, now);
      } catch (alertError) {
        deliveryOk = false;
        console.warn(
          `[sponsored-watch] Alert delivery failed for ${watch.id}:`,
          alertError instanceof Error ? alertError.message : alertError,
        );
        await execLogRepo.append({
          action_type: "generate_alert",
          entity_type: "sponsored_watch",
          entity_id: watch.id,
          status: "failed",
          message: `Watch alert delivery error: ${
            alertError instanceof Error ? alertError.message : String(alertError)
          }`,
          details: {
            matchedEventCount: newEvents.length,
            sourceEventIds: newEvents.map((e) => e.id).slice(0, 20),
          },
          started_at: nowIso,
          completed_at: new Date().toISOString(),
        });
      }
    }

    const result = await watchRepo.update(watch.id, {
      source_event_ids: deliveryOk ? sourceEventIds : [...priorIds],
      monitored_event_count: matching.length,
      last_monitored_at: nowIso,
      status: "monitoring",
      ...(newEvents.length > 0 && deliveryOk ? { last_alert_sent_at: nowIso } : {}),
    });
    if (!result.ok) {
      throw new Error(`Failed to update monitoring state: ${result.error.message}`);
    }

    await execLogRepo.append({
      action_type: "monitor",
      entity_type: "sponsored_watch",
      entity_id: watch.id,
      status: "succeeded",
      message: `Campaign monitor tick: ${matching.length} event(s) matched ${watch.target_contract}`,
      details: {
        targetContract: watch.target_contract,
        targetKind: watchTargetKind(watch),
        visibility: watchVisibility(watch),
        matchedEventCount: matching.length,
        newEventCount: newEvents.length,
        alertDelivered: newEvents.length > 0 ? deliveryOk : null,
        sourceEventIds: sourceEventIds.slice(0, 50),
        window: { startsAt: watch.starts_at, endsAt: watch.ends_at },
      },
      started_at: nowIso,
      completed_at: nowIso,
    });

    // Re-read so last_alert_sent_at (if set) is returned.
    const refreshed = await watchRepo.findById(watch.id);
    return refreshed.ok && refreshed.value ? refreshed.value : result.value;
  }

  function watchSpecFields(watch: SponsoredWatchRow): {
    eventSignature: string | null;
    description: string | null;
  } {
    const watchRaw = watch as unknown as Record<string, unknown>;
    const watchSpecObj =
      typeof watchRaw.watch_spec === "object" && watchRaw.watch_spec !== null
        ? (watchRaw.watch_spec as Record<string, unknown>)
        : {};
    return {
      eventSignature:
        typeof watchSpecObj.eventSignature === "string" ? watchSpecObj.eventSignature : null,
      description: typeof watchSpecObj.description === "string" ? watchSpecObj.description : null,
    };
  }

  async function generateReportForWatch(watch: SponsoredWatchRow) {
    const matching = await collectMatchingEvents(watch, { forceRpcScan: true });
    const spec = watchSpecFields(watch);
    const report = await reportService.generateReport({
      watchId: watch.id,
      targetContract: watch.target_contract,
      watchSpecHash: watch.watch_spec_hash,
      startsAt: watch.starts_at,
      endsAt: watch.ends_at,
      events: matching,
      targetKind: watchTargetKind(watch),
      eventSignature: spec.eventSignature,
      description: spec.description,
      priorMonitoredCount: watch.monitored_event_count ?? 0,
      priorSourceEventIdCount: watch.source_event_ids?.length ?? 0,
    });
    return { report, matching };
  }

  async function completeEndedWatch(watch: SponsoredWatchRow): Promise<SponsoredWatchRow> {
    if (completionInFlight.has(watch.id)) {
      throw new Error(`Sponsored watch ${watch.id} completion already in flight`);
    }
    completionInFlight.add(watch.id);
    try {
      const { report, matching } = await generateReportForWatch(watch);

      // Never publish placeholder junk on-chain — fall back should already be template,
      // but guard the dual-audit path explicitly.
      if (
        isPlaceholderSponsoredReport({
          reportTitle: report.title,
          reportSummary: report.summary,
          reportAnalysis: report.analysis,
          reportHighlights: report.highlights,
        })
      ) {
        throw new Error(
          `Generated report for ${watch.id} failed quality checks (placeholder/empty narrative)`,
        );
      }

      await execLogRepo.append({
        action_type: "generate_digest",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "succeeded",
        message: `Sponsored watch report generated (${matching.length} source event(s), source=${report.generationSource ?? "unknown"})`,
        details: {
          reportContentHash: report.reportContentHash,
          sourceEventRoot: report.sourceEventRoot,
          sourceEventIds: report.sourceEventIds.slice(0, 50),
          title: report.title,
          confidence: report.confidence,
          generationSource: report.generationSource ?? null,
          generationProvider: report.generationProvider ?? null,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return completeWatchInternal(watch.id, {
        reportContentHash: report.reportContentHash,
        sourceEventRoot: report.sourceEventRoot,
        sourceEventIds: report.sourceEventIds,
        reportTitle: report.title,
        reportSummary: report.summary,
        reportHighlights: report.highlights,
        reportAnalysis: report.analysis,
        monitoredEventCount: matching.length,
      });
    } finally {
      completionInFlight.delete(watch.id);
    }
  }

  /**
   * Backfill narrative for completed watches stuck with empty/"..." copy.
   * Keeps existing on-chain report tx + content hash (already committed);
   * only repairs the HTTPS content-URI body the dashboard reads.
   */
  async function repairPlaceholderReport(watch: SponsoredWatchRow): Promise<SponsoredWatchRow> {
    if (completionInFlight.has(watch.id)) {
      throw new Error(`Sponsored watch ${watch.id} repair already in flight`);
    }
    completionInFlight.add(watch.id);
    try {
      const { report, matching } = await generateReportForWatch(watch);
      if (
        isPlaceholderSponsoredReport({
          reportTitle: report.title,
          reportSummary: report.summary,
          reportAnalysis: report.analysis,
          reportHighlights: report.highlights,
        })
      ) {
        throw new Error(`Repair for ${watch.id} still produced placeholder narrative`);
      }

      // Keep the higher of live re-query vs historically recorded count so a
      // failed RPC replay does not wipe a real campaign down to zero.
      const monitoredCount = Math.max(
        matching.length,
        watch.monitored_event_count ?? 0,
        watch.source_event_ids?.length ?? 0,
      );
      const result = await watchRepo.update(watch.id, {
        report_title: report.title,
        report_summary: report.summary,
        report_highlights: report.highlights,
        report_analysis: report.analysis,
        // Do not clobber historical source_event_ids with an empty re-query.
        ...(matching.length > 0
          ? { source_event_ids: report.sourceEventIds.filter((id) => UUID_RE.test(id)) }
          : {}),
        monitored_event_count: monitoredCount,
        last_monitored_at: new Date().toISOString(),
        // Preserve on-chain commitments; narrative backfill is off-chain content URI only.
      });
      if (!result.ok) {
        throw new Error(`Failed to repair sponsored watch report: ${result.error.message}`);
      }

      await execLogRepo.append({
        action_type: "generate_digest",
        entity_type: "sponsored_watch",
        entity_id: watch.id,
        status: "succeeded",
        message: `Sponsored watch report narrative repaired (${matching.length} source event(s), source=${report.generationSource ?? "unknown"})`,
        details: {
          method: "repairPlaceholderReport",
          title: report.title,
          confidence: report.confidence,
          generationSource: report.generationSource ?? null,
          generationProvider: report.generationProvider ?? null,
          preservedReportTxHash: watch.report_tx_hash,
          preservedReportContentHash: watch.report_content_hash,
          note: "On-chain report hash left unchanged; dashboard body backfilled after placeholder LLM output",
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    } finally {
      completionInFlight.delete(watch.id);
    }
  }

  async function completeWatchInternal(
    watchId: string,
    completeParams: CompleteWatchParams,
  ): Promise<SponsoredWatchRow> {
    const client = requireWeb3();

    if (!frontendOrigin) {
      throw new Error(
        "FRONTEND_ORIGIN is required to publish sponsored report content URIs as resolvable HTTPS links",
      );
    }

    const existing = await watchRepo.findById(watchId);
    if (!existing.ok) {
      throw new Error(`Failed to load sponsored watch: ${existing.error.message}`);
    }
    if (!existing.value) {
      throw new Error(`Sponsored watch not found: ${watchId}`);
    }
    const watch = existing.value;
    if (watch.status === "completed") {
      return watch;
    }
    if (watch.status === "failed") {
      throw new Error(`Cannot complete a failed sponsored watch: ${watchId}`);
    }

    const onChainWatchId = watch.on_chain_watch_id;
    // Require a finite non-negative integer decoded at create time — never re-parse
    // string UUIDs or strip digits (that historically mapped garbage → 0 / wrong id).
    if (
      onChainWatchId == null ||
      typeof onChainWatchId !== "number" ||
      !Number.isFinite(onChainWatchId) ||
      !Number.isInteger(onChainWatchId) ||
      onChainWatchId < 0
    ) {
      throw new Error(
        `Sponsored watch ${watchId} has invalid on_chain_watch_id (${String(onChainWatchId)}) — cannot publishSponsoredReport; recreate the campaign so createSponsoredWatch returns a decoded watch id`,
      );
    }

    const reportUri = buildSponsoredReportContentUri(frontendOrigin, watchId);
    const {
      reportContentHash,
      sourceEventRoot,
      sourceEventIds,
      reportTitle,
      reportSummary,
      reportHighlights,
      reportAnalysis,
      monitoredEventCount,
    } = completeParams;

    let reportTxHash: string;
    let reportKeeperHubRunId: string | undefined;
    let reportExplorerUrl: string | undefined;

    try {
      const receipt = await client.publishSponsoredReport(
        onChainWatchId,
        reportContentHash,
        sourceEventRoot,
        reportUri,
      );
      reportTxHash = receipt.txHash;
      reportKeeperHubRunId = receipt.keeperHubRunId;
      reportExplorerUrl = receipt.explorerUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown on-chain error";
      const isAlreadyPublished =
        message.toLowerCase().includes("already published") ||
        message.toLowerCase().includes("report already published") ||
        message.toLowerCase().includes("without a transaction hash");

      if (isAlreadyPublished) {
        console.warn(
          `[sponsored-watch] Watch ${watchId} (onChainWatchId ${onChainWatchId}) report publish notice (${message}): proceeding with DB completion.`,
        );
        reportTxHash = watch.report_tx_hash || watch.create_tx_hash || "0x0000000000000000000000000000000000000000000000000000000000000000";
        reportKeeperHubRunId = watch.report_keeper_hub_run_id ?? undefined;
        reportExplorerUrl = watch.report_explorer_url ?? undefined;
      } else {
        await execLogRepo.append({
          action_type: "sponsored_watch",
          entity_type: "sponsored_watch",
          entity_id: watchId,
          status: "failed",
          message: `On-chain publishSponsoredReport failed: ${message}`,
          details: {
            method: "publishSponsoredReport",
            reportContentHash,
            sourceEventRoot,
            reportUri,
            onChainWatchId,
            createTxHash: watch.create_tx_hash,
            error_message: message,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        throw new Error(`On-chain publishSponsoredReport failed: ${message}`);
      }
    }

    const result = await watchRepo.updateStatus(watchId, "completed", {
      report_content_hash: reportContentHash,
      report_tx_hash: reportTxHash,
      report_keeper_hub_run_id: reportKeeperHubRunId ?? null,
      report_explorer_url: reportExplorerUrl ?? null,
      content_uri: reportUri,
      source_event_root: sourceEventRoot,
      source_event_ids: (sourceEventIds ?? watch.source_event_ids ?? []).filter((id) =>
        UUID_RE.test(id),
      ),
      report_title: reportTitle ?? null,
      report_summary: reportSummary ?? null,
      report_highlights: reportHighlights ?? [],
      report_analysis: reportAnalysis ?? null,
      monitored_event_count: monitoredEventCount ?? sourceEventIds?.length ?? 0,
      last_monitored_at: new Date().toISOString(),
    });

    if (!result.ok) {
      throw new Error(`Failed to complete sponsored watch: ${result.error.message}`);
    }

    await execLogRepo.append({
      action_type: "sponsored_watch",
      entity_type: "sponsored_watch",
      entity_id: watchId,
      status: "succeeded",
      message: reportKeeperHubRunId
        ? `Executed via KeeperHub (run ${reportKeeperHubRunId}): sponsored report published`
        : "Sponsored watch completed with on-chain report publication",
      details: {
        method: "publishSponsoredReport",
        reportContentHash,
        sourceEventRoot,
        reportUri,
        reportTxHash,
        reportKeeperHubRunId,
        reportExplorerUrl,
        createTxHash: watch.create_tx_hash,
        createExplorerUrl: watch.create_explorer_url,
        onChainWatchId,
        dualAuditTrail: {
          createTxHash: watch.create_tx_hash,
          reportTxHash,
        },
        keeper_hub_run_id: reportKeeperHubRunId ?? null,
        tx_hash: reportTxHash,
        explorer_url: reportExplorerUrl ?? null,
        executedViaKeeperHub: Boolean(reportKeeperHubRunId || client.isKeeperHubBacked()),
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    return result.value;
  }

  return {
    async createSponsoredWatch({
      targetContract,
      watchSpecHash,
      startsAt,
      endsAt,
      targetKind = "contract",
      visibility = "public",
      telegramChatId = null,
    }) {
      const client = requireWeb3();
      const resolvedKind: SponsoredWatchTargetKind =
        targetKind === "wallet" ? "wallet" : "contract";
      const resolvedVisibility: SponsoredWatchVisibility =
        visibility === "private" ? "private" : "public";

      if (resolvedVisibility === "private" && !telegramChatId?.trim()) {
        throw new Error("Private sponsored watches require a resolved telegram_chat_id");
      }

      const startsAtUnix = Math.floor(new Date(startsAt).getTime() / 1000);
      const endsAtUnix = Math.floor(new Date(endsAt).getTime() / 1000);
      if (!Number.isFinite(startsAtUnix) || !Number.isFinite(endsAtUnix) || startsAtUnix >= endsAtUnix) {
        throw new Error("Sponsored watch requires startsAt < endsAt as valid ISO timestamps");
      }

      let createTxHash: string;
      let createKeeperHubRunId: string | undefined;
      let createExplorerUrl: string | undefined;
      let onChainWatchId: number;
      try {
        const txRes = await client.createSponsoredWatch(
          targetContract,
          watchSpecHash,
          startsAtUnix,
          endsAtUnix,
        );
        createTxHash = txRes.txHash;
        createKeeperHubRunId = txRes.keeperHubRunId;
        createExplorerUrl = txRes.explorerUrl;
        onChainWatchId = txRes.watchId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown on-chain error";
        await execLogRepo.append({
          action_type: "sponsored_watch",
          entity_type: "sponsored_watch",
          entity_id: null,
          status: "failed",
          message: `On-chain createSponsoredWatch failed: ${message}`,
          details: {
            method: "createSponsoredWatch",
            targetContract,
            watchSpecHash,
            startsAt,
            endsAt,
            targetKind: resolvedKind,
            visibility: resolvedVisibility,
            error_message: message,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        throw new Error(`On-chain createSponsoredWatch failed: ${message}`);
      }

      const now = Date.now();
      const startsMs = new Date(startsAt).getTime();
      const endsMs = new Date(endsAt).getTime();
      // Enter monitoring immediately when the campaign window already covers now.
      const initialStatus =
        Number.isFinite(startsMs) && Number.isFinite(endsMs) && startsMs <= now && now < endsMs
          ? "monitoring"
          : "accepted";

      const result = await watchRepo.create({
        target_contract: targetContract,
        watch_spec_hash: watchSpecHash,
        starts_at: startsAt,
        ends_at: endsAt,
        create_tx_hash: createTxHash,
        create_keeper_hub_run_id: createKeeperHubRunId ?? null,
        create_explorer_url: createExplorerUrl ?? null,
        on_chain_watch_id: onChainWatchId,
        status: initialStatus,
        source_event_ids: [],
        monitored_event_count: 0,
        // Creation/activation is not a scan; the first cycle owns the initial lookup.
        last_monitored_at: null,
        target_kind: resolvedKind,
        visibility: resolvedVisibility,
        telegram_chat_id: telegramChatId?.trim() || null,
      });

      if (!result.ok) {
        throw new Error(`Failed to create sponsored watch: ${result.error.message}`);
      }

      await execLogRepo.append({
        action_type: "sponsored_watch",
        entity_type: "sponsored_watch",
        entity_id: result.value.id,
        status: "succeeded",
        message: createKeeperHubRunId
          ? `Executed via KeeperHub (run ${createKeeperHubRunId}): sponsored watch created for ${resolvedKind} ${targetContract}`
          : `Sponsored watch created for ${resolvedKind} ${targetContract}`,
        details: {
          method: "createSponsoredWatch",
          targetContract,
          targetKind: resolvedKind,
          visibility: resolvedVisibility,
          hasTelegramChatId: Boolean(telegramChatId?.trim()),
          watchSpecHash,
          startsAt,
          endsAt,
          createTxHash,
          createKeeperHubRunId,
          createExplorerUrl,
          onChainWatchId,
          status: initialStatus,
          keeper_hub_run_id: createKeeperHubRunId ?? null,
          tx_hash: createTxHash,
          explorer_url: createExplorerUrl ?? null,
          executedViaKeeperHub: Boolean(createKeeperHubRunId || client.isKeeperHubBacked()),
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    },

    async completeWatch(watchId, completeParams) {
      return completeWatchInternal(watchId, completeParams);
    },

    async failWatch(watchId, reason) {
      const result = await watchRepo.updateStatus(watchId, "failed");

      if (!result.ok) {
        throw new Error(`Failed to update sponsored watch: ${result.error.message}`);
      }

      await execLogRepo.append({
        action_type: "sponsored_watch",
        entity_type: "sponsored_watch",
        entity_id: watchId,
        status: "failed",
        message: `Sponsored watch failed: ${reason}`,
        details: { reason, method: "failWatch" },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    },

    async getActiveWatches() {
      const result = await watchRepo.listActive();
      if (!result.ok) {
        throw new Error(`Failed to list active watches: ${result.error.message}`);
      }
      return result.value;
    },

    async processCampaignCycle(now = new Date()) {
      if (campaignCycleInFlight) {
        return campaignCycleInFlight;
      }

      const cyclePromise = runCampaignCycle(now);
      campaignCycleInFlight = cyclePromise;
      try {
        return await cyclePromise;
      } finally {
        if (campaignCycleInFlight === cyclePromise) {
          campaignCycleInFlight = null;
        }
      }
    },
  };

  async function runCampaignCycle(now: Date): Promise<CampaignCycleResult> {
    const nowIso = now.toISOString();
    const cycle: CampaignCycleResult = {
      activated: 0,
      monitored: 0,
      completed: 0,
      repaired: 0,
      failed: 0,
      errors: [],
    };

    // 1. Activate accepted campaigns whose window has started
    const dueActivation = await watchRepo.listDueForActivation(nowIso);
    if (!dueActivation.ok) {
      cycle.errors.push(`listDueForActivation: ${dueActivation.error.message}`);
    } else {
      for (const watch of dueActivation.value) {
        try {
          await activateWatch(watch);
          cycle.activated += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          cycle.errors.push(`activate ${watch.id}: ${message}`);
          cycle.failed += 1;
        }
      }
    }

    // 2. Monitor in-window campaigns (Event Tracker correlation)
    const inWindow = await watchRepo.listInMonitoringWindow(nowIso);
    if (!inWindow.ok) {
      cycle.errors.push(`listInMonitoringWindow: ${inWindow.error.message}`);
    } else {
      for (const watch of inWindow.value) {
        try {
          await refreshMonitoring(watch, now);
          cycle.monitored += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          cycle.errors.push(`monitor ${watch.id}: ${message}`);
          cycle.failed += 1;
        }
      }
    }

    // 3. Complete ended campaigns: generate report + publishSponsoredReport
    const dueComplete = await watchRepo.listDueForCompletion(nowIso);
    if (!dueComplete.ok) {
      cycle.errors.push(`listDueForCompletion: ${dueComplete.error.message}`);
    } else {
      for (const watch of dueComplete.value) {
        if (completionInFlight.has(watch.id)) continue;
        try {
          await completeEndedWatch(watch);
          cycle.completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          cycle.errors.push(`complete ${watch.id}: ${message}`);
          cycle.failed += 1;
          // Do not mark failed permanently on transient registry/LLM errors —
          // next cycle retries. Permanent product failures use failWatch explicitly.
          await execLogRepo.append({
            action_type: "sponsored_watch",
            entity_type: "sponsored_watch",
            entity_id: watch.id,
            status: "failed",
            message: `End-of-campaign completion attempt failed (will retry): ${message}`,
            details: {
              method: "publishSponsoredReport",
              reason: "completion_retryable",
              createTxHash: watch.create_tx_hash,
              onChainWatchId: watch.on_chain_watch_id,
              endsAt: watch.ends_at,
              error_message: message,
            },
            started_at: nowIso,
            completed_at: new Date().toISOString(),
          });
        }
      }
    }

    // 4. Repair completed campaigns stuck with empty / "..." narrative
    //    (e.g. Groq 8k overflow accepted as placeholder before quality gates).
    const maybeRepair = await watchRepo.listCompletedNeedingReportRepair(25);
    if (!maybeRepair.ok) {
      cycle.errors.push(`listCompletedNeedingReportRepair: ${maybeRepair.error.message}`);
    } else {
      for (const watch of maybeRepair.value) {
        if (
          !isPlaceholderSponsoredReport({
            reportTitle: watch.report_title,
            reportSummary: watch.report_summary,
            reportAnalysis: watch.report_analysis,
            reportHighlights: watch.report_highlights,
          })
        ) {
          continue;
        }
        if (completionInFlight.has(watch.id)) continue;
        try {
          await repairPlaceholderReport(watch);
          cycle.repaired += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          cycle.errors.push(`repair ${watch.id}: ${message}`);
          cycle.failed += 1;
        }
      }
    }

    return cycle;
  }
}
