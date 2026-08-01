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
  SponsoredWatchRepository,
  SponsoredWatchRow,
} from "@chronicleai/db";
import { buildSponsoredReportContentUri } from "./content-uri.ts";
import {
  createSponsoredWatchReportService,
  eventMatchesTargetContract,
  isPlaceholderSponsoredReport,
  type SponsoredWatchReportService,
} from "./sponsored-watch-report-service.ts";
import type { Web3Client } from "./web3-client-service.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** In-process single-flight so concurrent 60s ticks cannot double-publish one watch. */
const completionInFlight = new Set<string>();

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
}): SponsoredWatchService {
  const {
    watchRepo,
    execLogRepo,
    web3Client,
    eventRepo = null,
    frontendOrigin,
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

  async function collectRpcLogsForWindow(watch: SponsoredWatchRow): Promise<MonitoredEventRow[]> {
    const startsMs = new Date(watch.starts_at).getTime();
    const endsMs = new Date(watch.ends_at).getTime();
    if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs) || startsMs >= endsMs) {
      return [];
    }

    const nowIso = new Date().toISOString();
    const apiKey = process.env.ETHERSCAN_API_KEY?.trim();

    // 1. Try Etherscan V2 API first (Sepolia chainId 11155111) for fast & complete log retrieval
    if (apiKey) {
      try {
        const urlV2 = `https://api.etherscan.io/v2/api?chainid=11155111&module=logs&action=getLogs&address=${watch.target_contract}&page=1&offset=500&sort=desc&apikey=${apiKey}`;
        const res = await fetch(urlV2, { signal: AbortSignal.timeout(10_000) });
        const data: any = await res.json();
        if (data && (data.status === "1" || data.message === "OK") && Array.isArray(data.result) && data.result.length > 0) {
          const allEvents: MonitoredEventRow[] = [];
          const windowEvents: MonitoredEventRow[] = [];

          for (const item of data.result) {
            const timeStampSec = parseInt(item.timeStamp, 16) || parseInt(item.timeStamp, 10);
            const itemMs = timeStampSec * 1000;
            const inWindow = Number.isFinite(itemMs) && itemMs >= startsMs - 3600_000 && itemMs <= endsMs + 3600_000;
            const txHash = item.transactionHash;
            const logIndex = parseInt(item.logIndex, 16) || parseInt(item.logIndex, 10) || 0;
            const blockNumber = item.blockNumber ? String(parseInt(item.blockNumber, 16) || item.blockNumber) : null;
            const observedAt = Number.isFinite(itemMs) ? new Date(itemMs).toISOString() : watch.starts_at;
            const id = deterministicRpcEventId(txHash, logIndex);

            const ev: MonitoredEventRow = {
              id,
              source: "etherscan_v2",
              source_event_id: `eth-${txHash}-${logIndex}`,
              event_type: "large_swap",
              chain_id: 11155111,
              protocol: "Ethereum Sepolia",
              asset_symbols: null,
              magnitude: null,
              transaction_hash: txHash,
              observed_at: observedAt,
              captured_at: nowIso,
              significance_score: 0.75,
              raw_payload: {
                address: watch.target_contract,
                logIndex,
                topics: [item.topic0, item.topic1, item.topic2, item.topic3].filter(Boolean),
                data: item.data,
                blockNumber,
                source: "etherscan_v2",
              },
              status: "qualified",
              created_at: nowIso,
              updated_at: nowIso,
            };

            allEvents.push(ev);
            if (inWindow) {
              windowEvents.push(ev);
            }
          }

          if (windowEvents.length > 0) {
            return windowEvents;
          }
          if (allEvents.length > 0) {
            return allEvents.slice(0, 500);
          }
        }
      } catch (etherscanErr) {
        console.warn(
          `[sponsored-watch] Etherscan V2 log fetch failed for ${watch.id}, falling back to chunked RPC:`,
          etherscanErr instanceof Error ? etherscanErr.message : etherscanErr,
        );
      }
    }

    // 2. Fallback to Viem RPC with <=45 block chunking across multi-RPC providers
    const { createPublicClient, http } = await import("viem");
    const { sepolia } = await import("viem/chains");
    const rpcUrls = [
      process.env.RPC_URL,
      "https://1rpc.io/sepolia",
      "https://sepolia.drpc.org",
    ].filter((u): u is string => Boolean(u));

    const CHUNK_SIZE = 45n;
    let rawLogs: any[] = [];

    for (const rpcUrl of rpcUrls) {
      try {
        const client = createPublicClient({
          chain: sepolia,
          transport: http(rpcUrl, { timeout: 10_000 }),
        });
        const latest = await client.getBlock();
        const latestTs = Number(latest.timestamp);
        const latestBlock = latest.number;
        const SEPOLIA_BLOCK_SECONDS = 12;
        const MAX_SPAN = 2_000n;
        const blocksFromEnd = BigInt(
          Math.max(0, Math.ceil((latestTs - endsMs / 1000) / SEPOLIA_BLOCK_SECONDS)),
        );
        const blocksFromStart = BigInt(
          Math.max(0, Math.ceil((latestTs - startsMs / 1000) / SEPOLIA_BLOCK_SECONDS)),
        );
        let toBlock = latestBlock > blocksFromEnd ? latestBlock - blocksFromEnd : 0n;
        let fromBlock = latestBlock > blocksFromStart ? latestBlock - blocksFromStart : 0n;
        if (toBlock < fromBlock) {
          const tmp = fromBlock;
          fromBlock = toBlock;
          toBlock = tmp;
        }
        if (toBlock - fromBlock > MAX_SPAN) {
          fromBlock = toBlock - MAX_SPAN;
        }

        const chunkLogs: any[] = [];
        for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += CHUNK_SIZE) {
          const chunkTo = chunkFrom + CHUNK_SIZE - 1n > toBlock ? toBlock : chunkFrom + CHUNK_SIZE - 1n;
          try {
            const fetched = await client.getLogs({
              address: watch.target_contract as `0x${string}`,
              fromBlock: chunkFrom,
              toBlock: chunkTo,
            });
            chunkLogs.push(...fetched);
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

    return rawLogs.map((log) => {
      const id = deterministicRpcEventId(log.transactionHash, log.logIndex);
      return {
        id,
        source: "rpc_direct" as const,
        source_event_id: `rpc-${log.transactionHash}-${log.logIndex}`,
        event_type: "large_swap" as const,
        chain_id: 11155111,
        protocol: "Ethereum Sepolia",
        asset_symbols: null,
        magnitude: null,
        transaction_hash: log.transactionHash,
        observed_at: watch.starts_at,
        captured_at: nowIso,
        significance_score: 0.75,
        raw_payload: {
          address: watch.target_contract,
          logIndex: log.logIndex,
          topics: log.topics,
          blockNumber: log.blockNumber?.toString?.() ?? String(log.blockNumber),
          source: "rpc_direct",
        },
        status: "qualified" as const,
        created_at: nowIso,
        updated_at: nowIso,
      };
    });
  }

  async function collectMatchingEvents(watch: SponsoredWatchRow) {
    if (!eventRepo) {
      return [];
    }

    // 1) Reload previously correlated rows by id (survives across ticks when they are real DB rows).
    const priorIds = (watch.source_event_ids ?? []).filter((id) => UUID_RE.test(id)).slice(0, 500);
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
        const matchedPrior = loaded.filter((event) =>
          eventMatchesTargetContract(event, watch.target_contract),
        );
        if (matchedPrior.length > 0) {
          return matchedPrior;
        }
      }
    }

    // 2) Window scan of Event Tracker / block-dispatcher rows in DB.
    const result = await eventRepo.listInWindow({
      periodStart: watch.starts_at,
      periodEnd: watch.ends_at,
      limit: 1000,
    });
    if (!result.ok) {
      throw new Error(`Failed to load campaign events: ${result.error.message}`);
    }
    const dbMatched = result.value.filter((event) =>
      eventMatchesTargetContract(event, watch.target_contract),
    );
    if (dbMatched.length > 0) {
      return dbMatched;
    }

    // 3) Etherscan / RPC fallback: fetch on-chain logs and persist discovered events to monitored_events table.
    try {
      const rpcMatched = await collectRpcLogsForWindow(watch);
      if (rpcMatched.length > 0) {
        const persisted: MonitoredEventRow[] = [];
        const candidates = rpcMatched.slice(0, 500);
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
        if (persisted.length > 0) {
          return persisted;
        }
        return rpcMatched;
      }
    } catch (error) {
      console.warn(
        `[sponsored-watch] RPC/Etherscan fallback failed for ${watch.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return dbMatched;
  }

  async function activateWatch(watch: SponsoredWatchRow): Promise<SponsoredWatchRow> {
    const result = await watchRepo.updateStatus(watch.id, "monitoring", {
      last_monitored_at: new Date().toISOString(),
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

  async function refreshMonitoring(watch: SponsoredWatchRow): Promise<SponsoredWatchRow> {
    const matching = await collectMatchingEvents(watch);
    const sourceEventIds = matching.map((e) => e.id).filter((id) => UUID_RE.test(id));
    const now = new Date().toISOString();

    const result = await watchRepo.update(watch.id, {
      source_event_ids: sourceEventIds,
      monitored_event_count: matching.length,
      last_monitored_at: now,
      status: "monitoring",
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
        matchedEventCount: matching.length,
        sourceEventIds: sourceEventIds.slice(0, 50),
        window: { startsAt: watch.starts_at, endsAt: watch.ends_at },
      },
      started_at: now,
      completed_at: now,
    });

    return result.value;
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
    const matching = await collectMatchingEvents(watch);
    const spec = watchSpecFields(watch);
    const report = await reportService.generateReport({
      watchId: watch.id,
      targetContract: watch.target_contract,
      watchSpecHash: watch.watch_spec_hash,
      startsAt: watch.starts_at,
      endsAt: watch.ends_at,
      events: matching,
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
    async createSponsoredWatch({ targetContract, watchSpecHash, startsAt, endsAt }) {
      const client = requireWeb3();

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
        last_monitored_at: initialStatus === "monitoring" ? new Date().toISOString() : null,
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
          ? `Executed via KeeperHub (run ${createKeeperHubRunId}): sponsored watch created for ${targetContract}`
          : `Sponsored watch created for contract ${targetContract}`,
        details: {
          method: "createSponsoredWatch",
          targetContract,
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
          await refreshMonitoring(watch);
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
