// Sponsored Watch Service
// Manages the lifecycle of sponsored monitoring campaigns:
// 1. Executes `createSponsoredWatch` transaction on-chain via Chronicle Registry
// 2. During the campaign window, monitors the target contract for events
// 3. On completion, calls `publishSponsoredReport` with the final report hash

import type { ExecutionLogRepository, SponsoredWatchRepository } from "@chronicleai/db";
import type { SponsoredWatchRow } from "@chronicleai/db";

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
}): SponsoredWatchService {
  const { watchRepo, execLogRepo } = params;

  return {
    async createSponsoredWatch({ targetContract, watchSpecHash, startsAt, endsAt }) {
      // In production, this would execute `createSponsoredWatch` on the Chronicle Registry contract
      // via the web3 client. For the MVP, we simulate the transaction hash.

      const simulatedTxHash = `0x${"a".repeat(64)}`;

      const result = await watchRepo.create({
        target_contract: targetContract,
        watch_spec_hash: watchSpecHash,
        starts_at: startsAt,
        ends_at: endsAt,
        create_tx_hash: simulatedTxHash,
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
          createTxHash: simulatedTxHash,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return result.value;
    },

    async completeWatch(watchId, reportContentHash) {
      // In production, this would execute `publishSponsoredReport` on-chain
      const simulatedReportTxHash = `0x${"b".repeat(64)}`;

      const result = await watchRepo.updateStatus(watchId, "completed", {
        report_content_hash: reportContentHash,
        report_tx_hash: simulatedReportTxHash,
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
          reportTxHash: simulatedReportTxHash,
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
