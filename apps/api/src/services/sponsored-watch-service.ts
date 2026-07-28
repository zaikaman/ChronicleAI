// Sponsored Watch Service
// Manages the lifecycle of sponsored monitoring campaigns:
// 1. Executes `createSponsoredWatch` via KeeperHub (or gated direct ethers in tests)
// 2. During the campaign window, monitors the target contract for events
// 3. On completion, calls `publishSponsoredReport` with the final report hash

import type { ExecutionLogRepository, SponsoredWatchRepository } from "@chronicleai/db";
import type { SponsoredWatchRow } from "@chronicleai/db";
import { buildSponsoredReportContentUri } from "./content-uri.ts";
import type { Web3Client } from "./web3-client-service.ts";

export interface SponsoredWatchService {
  createSponsoredWatch(params: {
    targetContract: string;
    watchSpecHash: string;
    startsAt: string;
    endsAt: string;
  }): Promise<SponsoredWatchRow>;

  completeWatch(watchId: string, reportContentHash: string): Promise<SponsoredWatchRow>;

  failWatch(watchId: string, reason: string): Promise<SponsoredWatchRow>;

  getActiveWatches(): Promise<SponsoredWatchRow[]>;
}

export function createSponsoredWatchService(params: {
  watchRepo: SponsoredWatchRepository;
  execLogRepo: ExecutionLogRepository;
  web3Client?: Web3Client | null;
  /** Public SPA origin (FRONTEND_ORIGIN) for HTTPS report content URIs. */
  frontendOrigin?: string;
}): SponsoredWatchService {
  const { watchRepo, execLogRepo, web3Client, frontendOrigin } = params;

  function requireWeb3(): Web3Client {
    if (!web3Client) {
      throw new Error(
        "Web3 client not configured — sponsored watch requires KeeperHub (KEEPERHUB_API_KEY + KEEPERHUB_API_BASE_URL + CHRONICLE_REGISTRY_ADDRESS) or ALLOW_DIRECT_ETHERS_WRITES for local tests",
      );
    }
    return web3Client;
  }

  return {
    async createSponsoredWatch({ targetContract, watchSpecHash, startsAt, endsAt }) {
      const client = requireWeb3();

      const startsAtUnix = Math.floor(new Date(startsAt).getTime() / 1000);
      const endsAtUnix = Math.floor(new Date(endsAt).getTime() / 1000);

      let createTxHash: string;
      let createKeeperHubRunId: string | undefined;
      let createExplorerUrl: string | undefined;
      let watchId: number;
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
        watchId = txRes.watchId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown on-chain error";
        await execLogRepo.append({
          action_type: "registry_write",
          entity_type: "sponsored_watch",
          entity_id: null,
          status: "failed",
          message: `On-chain createSponsoredWatch failed: ${message}`,
          details: { targetContract, watchSpecHash, startsAt, endsAt },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        throw new Error(`On-chain createSponsoredWatch failed: ${message}`);
      }

      const result = await watchRepo.create({
        target_contract: targetContract,
        watch_spec_hash: watchSpecHash,
        starts_at: startsAt,
        ends_at: endsAt,
        create_tx_hash: createTxHash,
        create_keeper_hub_run_id: createKeeperHubRunId ?? null,
        create_explorer_url: createExplorerUrl ?? null,
        status: "accepted",
      });

      if (!result.ok) {
        throw new Error(`Failed to create sponsored watch: ${result.error.message}`);
      }

      await execLogRepo.append({
        action_type: "registry_write",
        entity_type: "sponsored_watch",
        entity_id: result.value.id,
        status: "succeeded",
        message: createKeeperHubRunId
          ? `Executed via KeeperHub (run ${createKeeperHubRunId}): sponsored watch created for ${targetContract}`
          : `Sponsored watch created for contract ${targetContract}`,
        details: {
          targetContract,
          watchSpecHash,
          startsAt,
          endsAt,
          createTxHash,
          createKeeperHubRunId,
          createExplorerUrl,
          watchId,
          executedViaKeeperHub: Boolean(createKeeperHubRunId || client.isKeeperHubBacked()),
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    },

    async completeWatch(watchId, reportContentHash) {
      const client = requireWeb3();

      let reportTxHash: string;
      let reportKeeperHubRunId: string | undefined;
      let reportExplorerUrl: string | undefined;
      if (!frontendOrigin) {
        throw new Error(
          "FRONTEND_ORIGIN is required to publish sponsored report content URIs as resolvable HTTPS links",
        );
      }

      const reportUri = buildSponsoredReportContentUri(frontendOrigin, watchId);

      try {
        const numericId = Number(watchId.replace(/[^0-9]/g, "")) || 0;
        const receipt = await client.publishSponsoredReport(
          numericId,
          reportContentHash,
          reportUri,
        );
        reportTxHash = receipt.txHash;
        reportKeeperHubRunId = receipt.keeperHubRunId;
        reportExplorerUrl = receipt.explorerUrl;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown on-chain error";
        await execLogRepo.append({
          action_type: "registry_write",
          entity_type: "sponsored_watch",
          entity_id: watchId,
          status: "failed",
          message: `On-chain publishSponsoredReport failed: ${message}`,
          details: { reportContentHash, reportUri },
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
      });

      if (!result.ok) {
        throw new Error(`Failed to complete sponsored watch: ${result.error.message}`);
      }

      await execLogRepo.append({
        action_type: "registry_write",
        entity_type: "sponsored_watch",
        entity_id: watchId,
        status: "succeeded",
        message: reportKeeperHubRunId
          ? `Executed via KeeperHub (run ${reportKeeperHubRunId}): sponsored report published`
          : "Sponsored watch completed with on-chain report publication",
        details: {
          reportContentHash,
          reportUri,
          reportTxHash,
          reportKeeperHubRunId,
          reportExplorerUrl,
          executedViaKeeperHub: Boolean(reportKeeperHubRunId || client.isKeeperHubBacked()),
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    },

    async failWatch(watchId, reason) {
      const result = await watchRepo.updateStatus(watchId, "failed");

      if (!result.ok) {
        throw new Error(`Failed to update sponsored watch: ${result.error.message}`);
      }

      await execLogRepo.append({
        action_type: "registry_write",
        entity_type: "sponsored_watch",
        entity_id: watchId,
        status: "failed",
        message: `Sponsored watch failed: ${reason}`,
        details: { reason },
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
  };
}
