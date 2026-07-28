// KeeperHub treasury check handler
// Records treasury snapshots and creates low-balance warning logs (Loop 3).
// When a live Para MPC balance provider is configured, the on-chain/Para
// balance overrides the payload figure for production accuracy.
// Utility metrics (generation + transaction cost estimates) are collected
// and stored on the snapshot for the public Activity audit trail.

import type { TreasuryCheckPayload } from "@chronicleai/schemas";
import type {
  ExecutionLogRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import type { TreasuryStatusService } from "../services/treasury-status-service.ts";
import type { NotificationService } from "../services/notification-service.ts";
import type {
  TreasuryUtilityMetrics,
  TreasuryUtilityMetricsProvider,
} from "../services/treasury-utility-metrics.ts";

export interface LiveTreasuryBalance {
  availableBalance: number;
  currency: string;
  source: "para-mpc" | "rpc";
}

export interface TreasuryCheckResult {
  accepted: boolean;
  statusCode: number;
  snapshotId: string | undefined;
  message: string;
  utilityMetrics?: TreasuryUtilityMetrics;
}

export class TreasuryCheckHandler {
  private readonly treasuryRepo: TreasurySnapshotRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly treasuryService: TreasuryStatusService;
  private readonly notificationService: NotificationService;
  private readonly liveBalanceProvider:
    | (() => Promise<LiveTreasuryBalance | undefined>)
    | undefined;
  /** Authoritative safety buffer from TREASURY_SAFETY_BUFFER (default 0.01). */
  private readonly configuredSafetyBuffer: number | undefined;
  private readonly utilityMetricsProvider: TreasuryUtilityMetricsProvider | undefined;

  constructor(deps: {
    treasuryRepo: TreasurySnapshotRepository;
    execLogRepo: ExecutionLogRepository;
    treasuryService: TreasuryStatusService;
    notificationService: NotificationService;
    /** Optional production live balance (Para MPC getWalletBalance). */
    liveBalanceProvider?: () => Promise<LiveTreasuryBalance | undefined>;
    /**
     * Configured minimum balance (TREASURY_SAFETY_BUFFER). When set, overrides
     * payload.safetyBuffer so KeeperHub cannot re-introduce an oversized floor.
     */
    safetyBuffer?: number;
    /** Optional Loop 3 utility metrics collector. */
    utilityMetricsProvider?: TreasuryUtilityMetricsProvider;
  }) {
    this.treasuryRepo = deps.treasuryRepo;
    this.execLogRepo = deps.execLogRepo;
    this.treasuryService = deps.treasuryService;
    this.notificationService = deps.notificationService;
    this.liveBalanceProvider = deps.liveBalanceProvider;
    this.configuredSafetyBuffer = deps.safetyBuffer;
    this.utilityMetricsProvider = deps.utilityMetricsProvider;
  }

  async check(payload: TreasuryCheckPayload, source = "keeperhub"): Promise<TreasuryCheckResult> {
    try {
      // 1. Get previous status for transition detection
      const latestResult = await this.treasuryRepo.findLatest();
      const previousStatus = latestResult.ok && latestResult.value
        ? latestResult.value.status
        : undefined;

      // Prefer live Para/RPC balance when available (production Loop 3).
      let availableBalance = payload.availableBalance;
      let currency = payload.currency;
      let balanceSource: "payload" | "para-mpc" | "rpc" = "payload";
      if (this.liveBalanceProvider) {
        try {
          const live = await this.liveBalanceProvider();
          if (live && Number.isFinite(live.availableBalance)) {
            availableBalance = live.availableBalance;
            currency = live.currency;
            balanceSource = live.source;
          }
        } catch (error) {
          console.warn(
            "[treasury] Live balance provider failed; using payload balance:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      // Authoritative floor: env TREASURY_SAFETY_BUFFER > payload > 0.01
      const safetyBuffer =
        this.configuredSafetyBuffer ??
        (Number.isFinite(payload.safetyBuffer) ? payload.safetyBuffer : 0.01);

      // 2. Evaluate treasury health
      const evaluation = this.treasuryService.evaluate({
        availableBalance,
        safetyBuffer,
        ...(previousStatus ? { previousStatus: previousStatus as "healthy" | "warning" | "critical" } : {}),
      });

      const deficitPct = evaluation.deficitPercentage ?? 0;

      // 3. Collect utility metrics (generation + gas cost audit)
      let utilityMetrics: TreasuryUtilityMetrics | undefined;
      if (this.utilityMetricsProvider) {
        try {
          utilityMetrics = await this.utilityMetricsProvider.collect();
        } catch (error) {
          console.warn(
            "[treasury] Utility metrics collection failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      // 4. Record snapshot (including utility cost estimates when available)
      const snapshotResult = await this.treasuryRepo.create({
        available_balance: availableBalance,
        currency,
        safety_buffer: safetyBuffer,
        revenue_total:
          utilityMetrics?.revenueTotal ??
          (latestResult.ok ? (latestResult.value?.revenue_total ?? null) : null),
        estimated_generation_cost: utilityMetrics?.estimatedGenerationCost ?? null,
        estimated_transaction_cost: utilityMetrics?.estimatedTransactionCost ?? null,
        paid_request_count:
          utilityMetrics?.paidRequestCount ??
          (latestResult.ok ? (latestResult.value?.paid_request_count ?? null) : null),
        status: evaluation.status,
        captured_at: payload.capturedAt,
      });

      if (!snapshotResult.ok) {
        return {
          accepted: false,
          statusCode: 500,
          snapshotId: undefined,
          message: `Failed to record treasury snapshot: ${snapshotResult.error.message}`,
        };
      }

      const snapshot = snapshotResult.value;

      // 5. Log treasury check received
      await this.execLogRepo.append({
        action_type: "treasury_check",
        entity_type: "treasury_snapshot",
        entity_id: snapshot.id,
        status: "succeeded",
        message: `Treasury check: ${evaluation.status} (${availableBalance} ${currency} available, buffer ${safetyBuffer}, source=${balanceSource}, trigger=${source})`,
        details: {
          available_balance: availableBalance,
          safety_buffer: safetyBuffer,
          currency,
          balance_source: balanceSource,
          status: evaluation.status,
          previous_status: evaluation.previousStatus,
          status_changed: evaluation.changed,
          trigger: source,
          utility_metrics: utilityMetrics
            ? {
                estimated_generation_cost: utilityMetrics.estimatedGenerationCost,
                estimated_transaction_cost: utilityMetrics.estimatedTransactionCost,
                paid_request_count: utilityMetrics.paidRequestCount,
                revenue_total: utilityMetrics.revenueTotal,
                generation_action_count: utilityMetrics.generationActionCount,
                registry_write_count: utilityMetrics.registryWriteCount,
                failed_registry_write_count: utilityMetrics.failedRegistryWriteCount,
                audit_lines: utilityMetrics.auditLines,
              }
            : null,
        },
      });

      // 6. Low-balance: emit public warning + utility metrics audit report
      if (evaluation.status !== "healthy" && deficitPct > 0) {
        await this.notificationService.sendLowBalanceWarning({
          availableBalance,
          safetyBuffer,
          deficitPercentage: deficitPct,
          status: evaluation.status,
        });

        await this.execLogRepo.append({
          action_type: "notification",
          entity_type: "treasury_snapshot",
          entity_id: snapshot.id,
          status: "succeeded",
          message: `Warning emitted: ${evaluation.status} status`,
          details: {
            notification_type: "low_balance_warning",
            deficit_percentage: deficitPct,
          },
        });

        // IDEA Loop 3: public utility metrics audit when below threshold
        await this.execLogRepo.append({
          action_type: "treasury_audit",
          entity_type: "treasury_snapshot",
          entity_id: snapshot.id,
          status: "succeeded",
          message: `Low-balance utility audit (${evaluation.status}): balance ${availableBalance} ${currency} vs buffer ${safetyBuffer}`,
          details: {
            audit_type: "utility_metrics",
            available_balance: availableBalance,
            safety_buffer: safetyBuffer,
            currency,
            status: evaluation.status,
            deficit_percentage: deficitPct,
            estimated_generation_cost: utilityMetrics?.estimatedGenerationCost ?? null,
            estimated_transaction_cost: utilityMetrics?.estimatedTransactionCost ?? null,
            paid_request_count: utilityMetrics?.paidRequestCount ?? null,
            revenue_total: utilityMetrics?.revenueTotal ?? null,
            generation_action_count: utilityMetrics?.generationActionCount ?? null,
            registry_write_count: utilityMetrics?.registryWriteCount ?? null,
            failed_registry_write_count: utilityMetrics?.failedRegistryWriteCount ?? null,
            audit_lines: utilityMetrics?.auditLines ?? [],
            public: true,
          },
        });
      }

      return {
        accepted: true,
        statusCode: 201,
        snapshotId: snapshot.id,
        message: evaluation.changed
          ? `Treasury snapshot recorded: ${evaluation.previousStatus} -> ${evaluation.status}`
          : `Treasury snapshot recorded: ${evaluation.status}`,
        ...(utilityMetrics ? { utilityMetrics } : {}),
      };
    } catch (error) {
      return {
        accepted: false,
        statusCode: 500,
        snapshotId: undefined,
        message: `Treasury check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}
