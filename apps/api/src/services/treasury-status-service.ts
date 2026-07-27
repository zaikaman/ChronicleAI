// Treasury Status Service
// Evaluates treasury health based on available balance vs safety buffer
// Implements healthy -> warning -> critical transitions (Loop 3)

import type { TreasuryStatus } from "@chronicleai/schemas";

export interface TreasuryEvaluation {
  status: TreasuryStatus;
  previousStatus: TreasuryStatus;
  changed: boolean;
  availableBalance: number;
  safetyBuffer: number;
  deficitPercentage: number | undefined;
}

export interface TreasuryStatusService {
  /**
   * Evaluate treasury status based on available balance and safety buffer.
   */
  evaluate(params: {
    availableBalance: number;
    safetyBuffer: number;
    previousStatus?: TreasuryStatus;
  }): TreasuryEvaluation;

  /**
   * Check if registry writes should be suspended due to low balance.
   */
  shouldSuspendRegistryWrites(availableBalance: number, safetyBuffer: number): boolean;

  /**
   * Check if revenue routing should proceed.
   */
  shouldRouteRevenue(
    availableBalance: number,
    safetyBuffer: number,
    estimatedRevenue: number,
  ): { canRoute: boolean; reason?: string };
}

const CRITICAL_THRESHOLD_RATIO = 0.5; // Below 50% of safety buffer = critical

export function createTreasuryStatusService(): TreasuryStatusService {
  return {
    evaluate({ availableBalance, safetyBuffer, previousStatus }) {
      let status: TreasuryStatus;

      if (availableBalance <= 0) {
        status = "critical";
      } else if (availableBalance < safetyBuffer * CRITICAL_THRESHOLD_RATIO) {
        status = "critical";
      } else if (availableBalance < safetyBuffer) {
        status = "warning";
      } else {
        status = "healthy";
      }

      const deficitPercentage = safetyBuffer > 0
        ? Math.max(0, ((safetyBuffer - availableBalance) / safetyBuffer) * 100)
        : 0;

      const changed = previousStatus !== undefined && previousStatus !== status;

      return {
        status,
        previousStatus: previousStatus ?? status,
        changed,
        availableBalance,
        safetyBuffer,
        deficitPercentage: status !== "healthy" ? deficitPercentage : undefined,
      };
    },

    shouldSuspendRegistryWrites(availableBalance, safetyBuffer) {
      return availableBalance < safetyBuffer;
    },

    shouldRouteRevenue(availableBalance, safetyBuffer, estimatedRevenue) {
      const availableAfterBuffer = availableBalance - safetyBuffer;
      const netRevenue = estimatedRevenue;

      if (availableAfterBuffer <= 0) {
        return {
          canRoute: false,
          reason: `Available balance (${availableBalance}) is below safety buffer (${safetyBuffer})`,
        };
      }

      if (netRevenue <= 0) {
        return { canRoute: false, reason: "No positive revenue to route" };
      }

      return { canRoute: true };
    },
  };
}
