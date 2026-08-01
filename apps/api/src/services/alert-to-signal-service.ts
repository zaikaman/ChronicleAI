import { ACTIVE_INTELLIGENCE_CHAIN_ID } from "@chronicleai/config";
import type { MonitoredEventRow, PublicAlertRepository, PublicAlertRow } from "@chronicleai/db";
import type { DeskPolicyVerdict, DeskSignalType, EventType } from "@chronicleai/schemas";
import type { SignalEngine } from "../desk/signal-engine.ts";
import type { DeskSignalFeatures } from "../desk/types.ts";

export interface AlertToSignalResult {
  status: "not_eligible" | "created" | "failed";
  signalId?: string;
  signalType?: DeskSignalType;
  policyVerdict?: DeskPolicyVerdict;
  actionStatus: "not_created" | "pending" | "deferred" | "ignored" | "failed";
  reason: string;
}

export interface AlertToSignalService {
  project(params: {
    alert: PublicAlertRow;
    event: MonitoredEventRow;
  }): Promise<AlertToSignalResult>;
}

type Projection = {
  signalType: DeskSignalType;
  defaultActionStatus: AlertToSignalResult["actionStatus"];
};

const EVENT_SIGNAL_PROJECTIONS: Partial<Record<EventType, Projection>> = {
  large_swap: { signalType: "event_flow", defaultActionStatus: "deferred" },
  volume_anomaly: { signalType: "event_flow", defaultActionStatus: "deferred" },
  stablecoin_mint: { signalType: "event_supply", defaultActionStatus: "ignored" },
  stablecoin_burn: { signalType: "event_supply", defaultActionStatus: "ignored" },
  protocol_deposit: {
    signalType: "event_protocol_flow",
    defaultActionStatus: "ignored",
  },
  protocol_withdraw: {
    signalType: "event_protocol_flow",
    defaultActionStatus: "ignored",
  },
  liquidation: { signalType: "liquidation_cluster", defaultActionStatus: "pending" },
  liquidation_cluster: {
    signalType: "liquidation_cluster",
    defaultActionStatus: "pending",
  },
  gas_spike: { signalType: "gas_regime", defaultActionStatus: "deferred" },
};

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function deterministicEvidence(
  event: MonitoredEventRow,
  sourceDedupeKey?: string,
): Record<string, unknown> {
  const raw = event.raw_payload;
  const rawRecord = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    eventType: event.event_type,
    chainId: event.chain_id,
    sourceEventId: event.source_event_id,
    transactionHash: event.transaction_hash,
    blockNumber: event.block_number,
    blockHash: event.block_hash,
    logIndex: event.log_index,
    sourceContract: event.source_contract,
    protocol: event.protocol,
    sourceDedupeKey: sourceDedupeKey ?? event.source_dedupe_key,
    assetSymbols: event.asset_symbols,
    magnitude: event.magnitude,
    normalizedFeatures:
      event.normalized_evidence ??
      (rawRecord.normalizedFeatures as Record<string, unknown> | undefined) ??
      {},
  };
}

function featuresFromEvent(event: MonitoredEventRow): DeskSignalFeatures {
  const evidence = deterministicEvidence(event);
  const normalized =
    evidence.normalizedFeatures && typeof evidence.normalizedFeatures === "object"
      ? (evidence.normalizedFeatures as Record<string, unknown>)
      : {};
  const magnitude = event.magnitude;
  const magnitudeValue =
    magnitude && typeof magnitude.value === "number" ? magnitude.value : undefined;
  const gasGwei =
    asFiniteNumber(normalized.gasGwei) ??
    asFiniteNumber((event.raw_payload as Record<string, unknown> | null)?.gasGwei);

  return {
    ...normalized,
    eventType: event.event_type,
    sourceEventId: event.source_event_id,
    transactionHash: event.transaction_hash,
    blockNumber: event.block_number,
    blockHash: event.block_hash,
    logIndex: event.log_index,
    sourceContract: event.source_contract,
    protocol: event.protocol,
    assetSymbols: event.asset_symbols,
    magnitude: magnitudeValue,
    magnitudeUnit: magnitude && typeof magnitude.unit === "string" ? magnitude.unit : undefined,
    ...(gasGwei !== undefined ? { gasGwei } : {}),
    severity: event.significance_score ?? undefined,
  };
}

function actionStatusFor(
  projection: Projection,
  policyVerdict: DeskPolicyVerdict,
): AlertToSignalResult["actionStatus"] {
  if (policyVerdict === "ignore") return "ignored";
  if (policyVerdict === "defer") return "deferred";
  if (policyVerdict === "defend" || policyVerdict === "trade") {
    return projection.defaultActionStatus === "ignored"
      ? "pending"
      : projection.defaultActionStatus;
  }
  return projection.defaultActionStatus;
}

export function createAlertToSignalService(deps: {
  alertRepo: PublicAlertRepository;
  signalEngine: SignalEngine;
}): AlertToSignalService {
  return {
    async project({ alert, event }) {
      const updateAlert = (
        metadata: Parameters<NonNullable<PublicAlertRepository["updateCausalMetadata"]>>[1],
      ) =>
        deps.alertRepo.updateCausalMetadata
          ? deps.alertRepo.updateCausalMetadata.call(deps.alertRepo, alert.id, metadata)
          : Promise.resolve(null);

      if (event.chain_id !== ACTIVE_INTELLIGENCE_CHAIN_ID) {
        await updateAlert({
          signalStatus: "not_eligible",
          actionStatus: "ignored",
        });
        return {
          status: "not_eligible",
          actionStatus: "ignored",
          reason: "Only Ethereum Sepolia observations can create desk signals",
        };
      }

      const projection = EVENT_SIGNAL_PROJECTIONS[event.event_type];
      if (!projection) {
        await updateAlert({
          signalStatus: "not_eligible",
          actionStatus: "ignored",
        });
        return {
          status: "not_eligible",
          actionStatus: "ignored",
          reason: `Event type ${event.event_type} is public-alert-only`,
        };
      }

      const features = featuresFromEvent(event);
      const sourceDedupeKey =
        event.source_dedupe_key ?? alert.source_dedupe_key ?? alert.dedupe_key ?? alert.id;
      try {
        const ingested = await deps.signalEngine.ingest({
          signalType: projection.signalType,
          chainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
          features,
          sources: {
            sourceAlertId: alert.id,
            sourceEventId: event.source_event_id,
            eventType: event.event_type,
            chainId: event.chain_id,
            transactionHash: event.transaction_hash,
            blockNumber: event.block_number,
            blockHash: event.block_hash,
            logIndex: event.log_index,
            sourceContract: event.source_contract,
            protocol: event.protocol,
          },
          dedupeKey: `alert:${alert.id}`,
          sourceAlertId: alert.id,
          sourceEventId: event.source_event_id,
          signalOrigin: "alert",
          sourceDedupeKey,
          sourceEvidence: deterministicEvidence(event, sourceDedupeKey),
        });
        const actionStatus = actionStatusFor(projection, ingested.signal.policyVerdict);
        const updated = await updateAlert({
          deskSignalId: ingested.row.id,
          signalType: projection.signalType,
          signalStatus: "created",
          policyVerdict: ingested.signal.policyVerdict,
          actionStatus,
        });
        if (!updated || !updated.ok) {
          return {
            status: "failed",
            signalId: ingested.row.id,
            signalType: projection.signalType,
            policyVerdict: ingested.signal.policyVerdict,
            actionStatus: "failed",
            reason: `Signal created but Alert linkage failed: ${updated?.error.message ?? "repository method unavailable"}`,
          };
        }
        return {
          status: "created",
          signalId: ingested.row.id,
          signalType: projection.signalType,
          policyVerdict: ingested.signal.policyVerdict,
          actionStatus,
          reason: ingested.deduped ? "Existing Alert-backed signal reused" : "Signal created",
        };
      } catch (error) {
        await updateAlert({
          signalType: projection.signalType,
          signalStatus: "failed",
          actionStatus: "failed",
        });
        return {
          status: "failed",
          signalType: projection.signalType,
          actionStatus: "failed",
          reason: error instanceof Error ? error.message : "Signal projection failed",
        };
      }
    },
  };
}

export function alertSignalProjectionForEvent(eventType: EventType): Projection | null {
  return EVENT_SIGNAL_PROJECTIONS[eventType] ?? null;
}
