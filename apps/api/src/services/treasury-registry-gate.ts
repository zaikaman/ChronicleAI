// Treasury-gated registry writes (FR-026 / IDEA Loop 3)
// Registry writes only proceed when the latest Para wallet snapshot is at or
// above the safety buffer. Publication services consult this gate before any
// on-chain Chronicle Registry write.

import type { TreasurySnapshotRepository } from "@chronicleai/db";
import type { TreasuryStatus } from "@chronicleai/schemas";
import type { TreasuryStatusService } from "./treasury-status-service.ts";

export interface TreasuryRegistryGateDecision {
  /** When false, callers MUST skip the on-chain registry write. */
  allowRegistryWrite: boolean;
  reason: string;
  availableBalance?: number;
  safetyBuffer?: number;
  status?: TreasuryStatus;
  deficitPercentage?: number;
  snapshotId?: string;
}

export interface TreasuryRegistryGate {
  /**
   * Evaluate whether registry writes may proceed based on the latest treasury
   * snapshot. Fail-open when no snapshot exists or lookup fails so bootstrap
   * and transient DB errors do not permanently block publication.
   */
  evaluate(): Promise<TreasuryRegistryGateDecision>;
}

export function createTreasuryRegistryGate(
  treasuryRepo: TreasurySnapshotRepository,
  treasuryService: TreasuryStatusService,
): TreasuryRegistryGate {
  return {
    async evaluate() {
      const latest = await treasuryRepo.findLatest();

      if (!latest.ok) {
        return {
          allowRegistryWrite: true,
          reason: `Treasury snapshot lookup failed (${latest.error.message}); allowing registry write`,
        };
      }

      if (!latest.value) {
        return {
          allowRegistryWrite: true,
          reason: "No treasury snapshot yet; allowing registry write",
        };
      }

      const snap = latest.value;
      const availableBalance = snap.available_balance;
      const safetyBuffer = snap.safety_buffer;
      const evaluation = treasuryService.evaluate({
        availableBalance,
        safetyBuffer,
        previousStatus: snap.status,
      });

      if (treasuryService.shouldSuspendRegistryWrites(availableBalance, safetyBuffer)) {
        return {
          allowRegistryWrite: false,
          reason: `Available balance (${availableBalance}) is below safety buffer (${safetyBuffer})`,
          availableBalance,
          safetyBuffer,
          status: evaluation.status,
          deficitPercentage: evaluation.deficitPercentage ?? 0,
          snapshotId: snap.id,
        };
      }

      return {
        allowRegistryWrite: true,
        reason: `Treasury allows registry write (balance ${availableBalance}, buffer ${safetyBuffer})`,
        availableBalance,
        safetyBuffer,
        status: evaluation.status,
        snapshotId: snap.id,
      };
    },
  };
}
