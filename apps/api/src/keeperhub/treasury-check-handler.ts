// KeeperHub treasury check handler
// Records treasury snapshots and creates low-balance warning logs (Loop 3).
// When a live Para MPC balance provider is configured, the on-chain/Para
// balance overrides the payload figure for production accuracy.

import type { TreasuryCheckPayload } from "@chronicleai/schemas";
import type {
  ExecutionLogRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import type { TreasuryStatusService } from "../services/treasury-status-service.ts";
import type { NotificationService } from "../services/notification-service.ts";

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
}

export class TreasuryCheckHandler {
  private readonly treasuryRepo: TreasurySnapshotRepository;
  private readonly execLogRepo: ExecutionLogRepository;
  private readonly treasuryService: TreasuryStatusService;
  private readonly notificationService: NotificationService;
  private readonly liveBalanceProvider:
    | (() => Promise<LiveTreasuryBalance | undefined>)
    | undefined;

  constructor(deps: {
    treasuryRepo: TreasurySnapshotRepository;
    execLogRepo: ExecutionLogRepository;
    treasuryService: TreasuryStatusService;
    notificationService: NotificationService;
    /** Optional production live balance (Para MPC getWalletBalance). */
    liveBalanceProvider?: () => Promise<LiveTreasuryBalance | undefined>;
  }) {
    this.treasuryRepo = deps.treasuryRepo;
    this.execLogRepo = deps.execLogRepo;
    this.treasuryService = deps.treasuryService;
    this.notificationService = deps.notificationService;
    this.liveBalanceProvider = deps.liveBalanceProvider;
  }

  async check(payload: TreasuryCheckPayload, _source = "keeperhub"): Promise<TreasuryCheckResult> {
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

      // 2. Evaluate treasury health
      const evaluation = this.treasuryService.evaluate({
        availableBalance,
        safetyBuffer: payload.safetyBuffer,
        ...(previousStatus ? { previousStatus: previousStatus as "healthy" | "warning" | "critical" } : {}),
      });

      const deficitPct = evaluation.deficitPercentage ?? 0;

      // 3. Record snapshot
      const snapshotResult = await this.treasuryRepo.create({
        available_balance: availableBalance,
        currency,
        safety_buffer: payload.safetyBuffer,
        revenue_total: latestResult.ok ? (latestResult.value?.revenue_total ?? null) : null,
        estimated_generation_cost: null,
        estimated_transaction_cost: null,
        paid_request_count: latestResult.ok ? (latestResult.value?.paid_request_count ?? null) : null,
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

      // 4. Log treasury check received
      await this.execLogRepo.append({
        action_type: "treasury_check",
        entity_type: "treasury_snapshot",
        entity_id: snapshot.id,
        status: "succeeded",
        message: `Treasury check: ${evaluation.status} (${availableBalance} ${currency} available, buffer ${payload.safetyBuffer}, source=${balanceSource})`,
        details: {
          available_balance: availableBalance,
          safety_buffer: payload.safetyBuffer,
          currency,
          balance_source: balanceSource,
          status: evaluation.status,
          previous_status: evaluation.previousStatus,
          status_changed: evaluation.changed,
        },
      });

      // 5. Send low-balance warning if status is warning or critical
      if (evaluation.status !== "healthy" && deficitPct > 0) {
        await this.notificationService.sendLowBalanceWarning({
          availableBalance,
          safetyBuffer: payload.safetyBuffer,
          deficitPercentage: deficitPct,
          status: evaluation.status,
        });

        // Log warning emission
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
      }

      return {
        accepted: true,
        statusCode: 201,
        snapshotId: snapshot.id,
        message: evaluation.changed
          ? `Treasury snapshot recorded: ${evaluation.previousStatus} -> ${evaluation.status}`
          : `Treasury snapshot recorded: ${evaluation.status}`,
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
