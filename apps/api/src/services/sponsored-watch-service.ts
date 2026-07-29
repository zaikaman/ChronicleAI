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
  SponsoredWatchRepository,
  SponsoredWatchRow,
} from "@chronicleai/db";
import { buildSponsoredReportContentUri } from "./content-uri.ts";
import {
  createSponsoredWatchReportService,
  eventMatchesTargetContract,
  type SponsoredWatchReportService,
} from "./sponsored-watch-report-service.ts";
import type { Web3Client } from "./web3-client-service.ts";

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

  function requireWeb3(): Web3Client {
    if (!web3Client) {
      throw new Error(
        "Web3 client not configured — sponsored watch requires KeeperHub (KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS) or ALLOW_DIRECT_ETHERS_WRITES for local tests",
      );
    }
    return web3Client;
  }

  async function collectMatchingEvents(watch: SponsoredWatchRow) {
    if (!eventRepo) {
      return [];
    }
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
    // Fallback: If DB contains no events for custom contract, attempt RPC log query if available
    try {
      const rpcUrl = process.env.RPC_URL || "https://1rpc.io/sepolia";
      const { createPublicClient, http } = await import("viem");
      const { sepolia } = await import("viem/chains");
      const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 8000 }) });
      const block = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: watch.target_contract as `0x${string}`,
        fromBlock: block > 100n ? block - 100n : 0n,
        toBlock: block,
      });
      if (logs.length > 0) {
        // Construct transient MonitoredEventRows for report generation
        return logs.map((log, idx) => ({
          id: `rpc-event-${watch.id}-${idx}`,
          source: "rpc_direct",
          source_event_id: `rpc-${log.transactionHash.slice(0, 10)}-${log.logIndex}`,
          event_type: "large_swap" as const,
          chain_id: 11155111,
          protocol: "Ethereum Sepolia",
          asset_symbols: null,
          magnitude: null,
          transaction_hash: log.transactionHash,
          observed_at: watch.starts_at,
          captured_at: new Date().toISOString(),
          significance_score: 0.9,
          raw_payload: { address: watch.target_contract, logIndex: log.logIndex, topics: log.topics },
          status: "qualified" as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
      }
    } catch {
      // Ignore RPC fallback failures and return empty list
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
    const sourceEventIds = matching.map((e) => e.id);
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

  async function completeEndedWatch(watch: SponsoredWatchRow): Promise<SponsoredWatchRow> {
    const matching = await collectMatchingEvents(watch);
    const watchRaw = watch as unknown as Record<string, unknown>;
    const watchSpecObj =
      typeof watchRaw.watch_spec === "object" && watchRaw.watch_spec !== null
        ? (watchRaw.watch_spec as Record<string, unknown>)
        : {};
    const report = await reportService.generateReport({
      watchId: watch.id,
      targetContract: watch.target_contract,
      watchSpecHash: watch.watch_spec_hash,
      startsAt: watch.starts_at,
      endsAt: watch.ends_at,
      events: matching,
      eventSignature: typeof watchSpecObj.eventSignature === "string" ? watchSpecObj.eventSignature : null,
      description: typeof watchSpecObj.description === "string" ? watchSpecObj.description : null,
    });

    await execLogRepo.append({
      action_type: "generate_digest",
      entity_type: "sponsored_watch",
      entity_id: watch.id,
      status: "succeeded",
      message: `Sponsored watch report generated (${matching.length} source event(s))`,
      details: {
        reportContentHash: report.reportContentHash,
        sourceEventRoot: report.sourceEventRoot,
        sourceEventIds: report.sourceEventIds,
        title: report.title,
        confidence: report.confidence,
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

    const result = await watchRepo.updateStatus(watchId, "completed", {
      report_content_hash: reportContentHash,
      report_tx_hash: reportTxHash,
      report_keeper_hub_run_id: reportKeeperHubRunId ?? null,
      report_explorer_url: reportExplorerUrl ?? null,
      content_uri: reportUri,
      source_event_root: sourceEventRoot,
      source_event_ids: sourceEventIds ?? watch.source_event_ids ?? [],
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
      const nowIso = now.toISOString();
      const cycle: CampaignCycleResult = {
        activated: 0,
        monitored: 0,
        completed: 0,
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

      return cycle;
    },
  };
}
