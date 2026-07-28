// Loop 3 utility metrics audit
// Derives generation / transaction cost estimates and operational counters
// from settled payments + recent execution logs so low-balance warnings
// include a real utility audit (IDEA Loop 3 step 3).

import type {
  ExecutionLogRepository,
  ExecutionLogRow,
  TreasurySnapshotRepository,
} from "@chronicleai/db";

export interface TreasuryUtilityMetrics {
  /** Estimated LLM / synthesis cost (USDC-equivalent units). */
  estimatedGenerationCost: number;
  /** Estimated gas / registry write cost (USDC-equivalent units). */
  estimatedTransactionCost: number;
  /** Settled paid request count (all-time from aggregates when available). */
  paidRequestCount: number;
  /** Settled revenue total (USDC). */
  revenueTotal: number;
  /** Successful generate_alert / generate_digest / generate logs in the sample window. */
  generationActionCount: number;
  /** Successful registry_write logs in the sample window. */
  registryWriteCount: number;
  /** Failed registry_write logs (includes treasury-gated suspensions). */
  failedRegistryWriteCount: number;
  /** Successful treasury_check logs in the sample. */
  treasuryCheckCount: number;
  /** ISO window used for log sampling. */
  sampleFrom: string;
  sampleTo: string;
  /** Human-readable audit lines for Activity / notifications. */
  auditLines: string[];
}

export interface UtilityMetricsCostConfig {
  costPerGenerationUsdc: number;
  costPerRegistryWriteUsdc: number;
}

export interface TreasuryUtilityMetricsProvider {
  collect(): Promise<TreasuryUtilityMetrics>;
}

const GENERATION_ACTIONS = new Set([
  "generate_alert",
  "generate_digest",
  "generate",
]);

function isSucceeded(log: ExecutionLogRow): boolean {
  return log.status === "succeeded";
}

/**
 * Build utility metrics from payment aggregates and recent execution logs.
 */
export function createTreasuryUtilityMetricsProvider(deps: {
  treasuryRepo: TreasurySnapshotRepository;
  execLogRepo: ExecutionLogRepository;
  costs: UtilityMetricsCostConfig;
  /** How many recent execution logs to sample (default 200). */
  logSampleLimit?: number;
}): TreasuryUtilityMetricsProvider {
  const sampleLimit = deps.logSampleLimit ?? 200;

  return {
    async collect() {
      const now = new Date();
      const sampleTo = now.toISOString();

      const aggregates = await deps.treasuryRepo.getAggregates();
      const revenueTotal = aggregates.ok ? aggregates.value.totalRevenue : 0;
      const paidRequestCount = aggregates.ok ? aggregates.value.totalPaidRequests : 0;

      const logsResult = await deps.execLogRepo.listRecent(sampleLimit);
      const logs = logsResult.ok ? logsResult.value : [];

      let generationActionCount = 0;
      let registryWriteCount = 0;
      let failedRegistryWriteCount = 0;
      let treasuryCheckCount = 0;
      let oldest = sampleTo;

      for (const log of logs) {
        if (log.created_at && log.created_at < oldest) {
          oldest = log.created_at;
        }

        if (GENERATION_ACTIONS.has(log.action_type) && isSucceeded(log)) {
          generationActionCount += 1;
        }

        if (log.action_type === "registry_write") {
          if (isSucceeded(log)) {
            registryWriteCount += 1;
          } else if (log.status === "failed") {
            failedRegistryWriteCount += 1;
          }
        }

        if (log.action_type === "treasury_check" && isSucceeded(log)) {
          treasuryCheckCount += 1;
        }
      }

      const estimatedGenerationCost =
        Math.round(generationActionCount * deps.costs.costPerGenerationUsdc * 1_000_000) /
        1_000_000;
      const estimatedTransactionCost =
        Math.round(registryWriteCount * deps.costs.costPerRegistryWriteUsdc * 1_000_000) /
        1_000_000;

      const sampleFrom = logs.length > 0 ? oldest : sampleTo;

      const auditLines = [
        `Settled revenue: ${revenueTotal} USDC across ${paidRequestCount} paid request(s).`,
        `Estimated generation cost: ${estimatedGenerationCost} USDC (${generationActionCount} LLM/synthesis action(s) @ ${deps.costs.costPerGenerationUsdc} USDC each).`,
        `Estimated transaction cost: ${estimatedTransactionCost} USDC (${registryWriteCount} successful registry write(s) @ ${deps.costs.costPerRegistryWriteUsdc} USDC each).`,
        `Failed / suspended registry writes in sample: ${failedRegistryWriteCount}.`,
        `Execution log sample window: ${sampleFrom} → ${sampleTo} (n=${logs.length}).`,
      ];

      return {
        estimatedGenerationCost,
        estimatedTransactionCost,
        paidRequestCount,
        revenueTotal,
        generationActionCount,
        registryWriteCount,
        failedRegistryWriteCount,
        treasuryCheckCount,
        sampleFrom,
        sampleTo,
        auditLines,
      };
    },
  };
}
