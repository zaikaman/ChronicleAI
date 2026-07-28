// Agent Activity Repository
// Aggregates public activity data for the Live Agent Activity page

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

export interface AgentActivityData {
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

export interface AgentActivityRepository {
  getActivityData(limitParam?: number): Promise<Result<AgentActivityData>>;
}

export function createAgentActivityRepository(supabase: SupabaseClient): AgentActivityRepository {
  return {
    async getActivityData(limitParam = 10) {
      const limit = Math.min(50, Math.max(1, limitParam));

      try {
        const { data: alerts, error: alertsError } = await supabase
          .from("public_alerts")
          .select(
            `
            *,
            monitored_events (
              event_type,
              chain_id,
              protocol
            )
          `,
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (alertsError) return failure(mapPostgrestError(alertsError));

        const mappedAlerts = ((alerts ?? []) as Array<Record<string, unknown>>).map((row) => {
          const joined = row.monitored_events as
            | { event_type?: string; chain_id?: number; protocol?: string | null }
            | Array<{ event_type?: string; chain_id?: number; protocol?: string | null }>
            | null
            | undefined;
          const event = Array.isArray(joined) ? joined[0] : joined;
          const { monitored_events: _ignored, ...rest } = row;
          return {
            ...(rest as unknown as PublicAlertRow),
            event_type: event?.event_type ?? null,
            chain_id: typeof event?.chain_id === "number" ? event.chain_id : null,
            protocol: event?.protocol ?? null,
          } as PublicAlertRow;
        });

        const { data: digests, error: digestsError } = await supabase
          .from("daily_digests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (digestsError) return failure(mapPostgrestError(digestsError));

        const { data: payments, error: paymentsError } = await supabase
          .from("payment_records")
          .select("*")
          .order("requested_at", { ascending: false })
          .limit(limit);

        if (paymentsError) return failure(mapPostgrestError(paymentsError));

        const { data: snapshots, error: snapshotsError } = await supabase
          .from("treasury_snapshots")
          .select("*")
          .order("captured_at", { ascending: false })
          .limit(limit);

        if (snapshotsError) return failure(mapPostgrestError(snapshotsError));

        const { data: watches, error: watchesError } = await supabase
          .from("sponsored_watches")
          .select("*")
          .in("status", ["accepted", "monitoring"])
          .order("created_at", { ascending: false });

        if (watchesError) return failure(mapPostgrestError(watchesError));

        const { data: payouts, error: payoutsError } = await supabase
          .from("payout_records")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (payoutsError) return failure(mapPostgrestError(payoutsError));

        const { data: logs, error: logsError } = await supabase
          .from("execution_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit * 3);

        if (logsError) return failure(mapPostgrestError(logsError));

        const { count: totalEvents, error: countError } = await supabase
          .from("monitored_events")
          .select("*", { count: "exact", head: true });

        if (countError) return failure(mapPostgrestError(countError));

        const { count: qualifiedEvents, error: qualifiedError } = await supabase
          .from("monitored_events")
          .select("*", { count: "exact", head: true })
          .eq("status", "qualified");

        if (qualifiedError) return failure(mapPostgrestError(qualifiedError));

        return success({
          recentAlerts: mappedAlerts,
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
          error instanceof Error ? error.message : "Unknown error fetching activity data";
        return failure(new PersistenceError(message));
      }
    },
  };
}
