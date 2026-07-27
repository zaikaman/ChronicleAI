// Operator Audit Repository
// Aggregates data for the operator dashboard across multiple tables

import type { SupabaseClient } from "@supabase/supabase-js";
import { PersistenceError, type Result, failure, success } from "./errors.ts";
import { mapPostgrestError } from "./repository-utils.ts";
import type {
  DailyDigestRow,
  ExecutionLogRow,
  PaymentRecordRow,
  PublicAlertRow,
  RevenuePayoutRow,
  SponsoredWatchRow,
  TreasurySnapshotRow,
} from "./types.ts";

export interface OperatorAuditData {
  recentAlerts: PublicAlertRow[];
  recentDigests: DailyDigestRow[];
  recentPayments: PaymentRecordRow[];
  treasurySnapshots: TreasurySnapshotRow[];
  activeSponsoredWatches: SponsoredWatchRow[];
  recentPayouts: RevenuePayoutRow[];
  recentLogs: ExecutionLogRow[];
  totalMonitoredEvents: number;
  totalQualifiedEvents: number;
}

export interface OperatorAuditRepository {
  getAuditData(limitParam?: number): Promise<Result<OperatorAuditData>>;
}

export function createOperatorAuditRepository(supabase: SupabaseClient): OperatorAuditRepository {
  return {
    async getAuditData(limitParam = 10) {
      const limit = Math.min(50, Math.max(1, limitParam));

      try {
        // Fetch recent alerts
        const { data: alerts, error: alertsError } = await supabase
          .from("public_alerts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (alertsError) return failure(mapPostgrestError(alertsError));

        // Fetch recent digests
        const { data: digests, error: digestsError } = await supabase
          .from("daily_digests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (digestsError) return failure(mapPostgrestError(digestsError));

        // Fetch recent payments
        const { data: payments, error: paymentsError } = await supabase
          .from("payment_records")
          .select("*")
          .order("requested_at", { ascending: false })
          .limit(limit);

        if (paymentsError) return failure(mapPostgrestError(paymentsError));

        // Fetch latest treasury snapshots
        const { data: snapshots, error: snapshotsError } = await supabase
          .from("treasury_snapshots")
          .select("*")
          .order("captured_at", { ascending: false })
          .limit(limit);

        if (snapshotsError) return failure(mapPostgrestError(snapshotsError));

        // Fetch active sponsored watches
        const { data: watches, error: watchesError } = await supabase
          .from("sponsored_watches")
          .select("*")
          .in("status", ["accepted", "monitoring"])
          .order("created_at", { ascending: false });

        if (watchesError) return failure(mapPostgrestError(watchesError));

        // Fetch recent payout records
        const { data: payouts, error: payoutsError } = await supabase
          .from("payout_records")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (payoutsError) return failure(mapPostgrestError(payoutsError));

        // Fetch recent execution logs
        const { data: logs, error: logsError } = await supabase
          .from("execution_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit * 3);

        if (logsError) return failure(mapPostgrestError(logsError));

        // Count monitored events
        const { count: totalEvents, error: countError } = await supabase
          .from("monitored_events")
          .select("*", { count: "exact", head: true });

        if (countError) return failure(mapPostgrestError(countError));

        // Count qualified events
        const { count: qualifiedEvents, error: qualifiedError } = await supabase
          .from("monitored_events")
          .select("*", { count: "exact", head: true })
          .eq("status", "qualified");

        if (qualifiedError) return failure(mapPostgrestError(qualifiedError));

        return success({
          recentAlerts: (alerts ?? []) as unknown as PublicAlertRow[],
          recentDigests: (digests ?? []) as unknown as DailyDigestRow[],
          recentPayments: (payments ?? []) as unknown as PaymentRecordRow[],
          treasurySnapshots: (snapshots ?? []) as unknown as TreasurySnapshotRow[],
          activeSponsoredWatches: (watches ?? []) as unknown as SponsoredWatchRow[],
          recentPayouts: (payouts ?? []) as unknown as RevenuePayoutRow[],
          recentLogs: (logs ?? []) as unknown as ExecutionLogRow[],
          totalMonitoredEvents: totalEvents ?? 0,
          totalQualifiedEvents: qualifiedEvents ?? 0,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error fetching audit data";
        return failure(new PersistenceError(message));
      }
    },
  };
}
