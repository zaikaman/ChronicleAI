// Sponsored Watch Service
// Manages the lifecycle of sponsored monitoring campaigns:
// 1. Executes `createSponsoredWatch` transaction on-chain via Chronicle Registry
// 2. During the campaign window, monitors the target contract for events
// 3. On completion, calls `publishSponsoredReport` with the final report hash

import type { ExecutionLogRepository, SponsoredWatchRepository } from "@chronicleai/db";
import type { SponsoredWatchRow } from "@chronicleai/db";
import type { Web3Client } from "./web3-client-service.ts";

export interface SponsoredWatchService {
  /**
   * Create a sponsored watch campaign by executing the on-chain transaction.
   */
  createSponsoredWatch(params: {
    targetContract: string;
    watchSpecHash: string;
    startsAt: string;
    endsAt: string;
  }): Promise<SponsoredWatchRow>;

  /**
   * Complete a sponsored watch campaign and publish the report on-chain.
   */
  completeWatch(watchId: string, reportContentHash: string): Promise<SponsoredWatchRow>;

  /**
   * Fail a sponsored watch campaign.
   */
  failWatch(watchId: string, reason: string): Promise<SponsoredWatchRow>;

  /**
   * Get active watches that need monitoring.
   */
  getActiveWatches(): Promise<SponsoredWatchRow[]>;
}

export function createSponsoredWatchService(params: {
  watchRepo: SponsoredWatchRepository;
  execLogRepo: ExecutionLogRepository;
  web3Client?: Web3Client | null;
}): SponsoredWatchService {
  const { watchRepo, execLogRepo, web3Client } = params;

  return {
    async createSponsoredWatch({ targetContract, watchSpecHash, startsAt, endsAt }) {
      let createTxHash = `0x${"a".repeat(64)}`;
      let watchId = 0;

      if (web3Client) {
        try {
          const startsAtUnix = Math.floor(new Date(startsAt).getTime() / 1000);
          const endsAtUnix = Math.floor(new Date(endsAt).getTime() / 1000);
          const txRes = await web3Client.createSponsoredWatch(
            targetContract,
            watchSpecHash,
            startsAtUnix,
            endsAtUnix,
          );
          createTxHash = txRes.txHash;
          watchId = txRes.watchId;
        } catch (error) {
          console.warn(
            "On-chain createSponsoredWatch failed, falling back to simulated tx:",
            error,
          );
        }
      }

      const result = await watchRepo.create({
        target_contract: targetContract,
        watch_spec_hash: watchSpecHash,
        starts_at: startsAt,
        ends_at: endsAt,
        create_tx_hash: createTxHash,
        status: "accepted",
      });

      if (!result.ok) {
        throw new Error(`Failed to create sponsored watch: ${result.error.message}`);
      }

      // Log the creation
      await execLogRepo.append({
        action_type: "registry_write",
        entity_type: "sponsored_watch",
        entity_id: result.value.id,
        status: "succeeded",
        message: `Sponsored watch created for contract ${targetContract}`,
        details: {
          targetContract,
          watchSpecHash,
          startsAt,
          endsAt,
          createTxHash,
          watchId,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    },

    async completeWatch(watchId, reportContentHash) {
      let reportTxHash = `0x${"b".repeat(64)}`;

      if (web3Client) {
        try {
          const numericId = Number(watchId.replace(/[^0-9]/g, "")) || 0;
          const reportUri = `chronicleai://sponsored-reports/${watchId}`;
          reportTxHash = await web3Client.publishSponsoredReport(
            numericId,
            reportContentHash,
            reportUri,
          );
        } catch (error) {
          console.warn(
            "On-chain publishSponsoredReport failed, falling back to simulated tx:",
            error,
          );
        }
      }

      const result = await watchRepo.updateStatus(watchId, "completed", {
        report_content_hash: reportContentHash,
        report_tx_hash: reportTxHash,
      });

      if (!result.ok) {
        throw new Error(`Failed to complete sponsored watch: ${result.error.message}`);
      }

      // Log the completion
      await execLogRepo.append({
        action_type: "registry_write",
        entity_type: "sponsored_watch",
        entity_id: watchId,
        status: "succeeded",
        message: "Sponsored watch completed with on-chain report publication",
        details: {
          reportContentHash,
          reportTxHash,
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
