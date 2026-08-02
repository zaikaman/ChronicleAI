// Synthesize liquidation_cluster events from recent liquidation windows.
// Triggered inline after each liquidation ingest. Idempotent via sourceEventId.

import { LIQUIDATION_CLUSTER } from "@chronicleai/config";
import type { MonitoredEventRepository, MonitoredEventRow } from "@chronicleai/db";
import type { EventIngestionPayload, FlowContext } from "@chronicleai/schemas";
import {
  attachFlowContextToRawPayload,
  enrichFlowContext,
} from "../monitoring/flow-enrichment.ts";

export interface LiquidationClusterCandidate {
  payload: EventIngestionPayload;
  /** Liquidation events that contributed to this window. */
  memberEventIds: string[];
  windowStartIso: string;
  count: number;
  totalUsd: number;
}

export interface LiquidationClusterService {
  /**
   * After a liquidation is persisted, evaluate whether the rolling window
   * meets cluster thresholds. Returns a synthetic classified payload or null.
   */
  maybeSynthesize(params: {
    chainId: number;
    protocol?: string | null;
    capturedAt: string;
  }): Promise<LiquidationClusterCandidate | null>;
}

function magnitudeUsd(event: MonitoredEventRow): number {
  const mag = event.magnitude;
  if (!mag || typeof mag !== "object") return 0;
  const value = (mag as { value?: unknown }).value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function floorToWindowStart(capturedAtMs: number, windowMinutes: number): number {
  const windowMs = windowMinutes * 60_000;
  return Math.floor(capturedAtMs / windowMs) * windowMs;
}

function chainQualifiedSourceEventId(chainId: number, sourceEventId: string): string {
  const prefix = `${chainId}:`;
  return sourceEventId.startsWith(prefix) ? sourceEventId : `${prefix}${sourceEventId}`;
}

export function buildLiquidationClusterSourceEventId(
  chainId: number,
  windowStartIso: string,
  protocol: string,
): string {
  const protoKey = protocol.toLowerCase().replace(/\s+/g, "-");
  return chainQualifiedSourceEventId(
    chainId,
    `liq-cluster-${chainId}-${protoKey}-${windowStartIso}`,
  );
}

export function createLiquidationClusterService(
  eventRepo: MonitoredEventRepository,
): LiquidationClusterService {
  return {
    async maybeSynthesize({ chainId, protocol, capturedAt }) {
      const windowMinutes = LIQUIDATION_CLUSTER.windowMinutes;
      const minCount = LIQUIDATION_CLUSTER.minCount;
      const minNotional = LIQUIDATION_CLUSTER.minNotionalUsd;

      const capturedMs = new Date(capturedAt).getTime();
      if (!Number.isFinite(capturedMs)) return null;

      const windowStartMs = floorToWindowStart(capturedMs, windowMinutes);
      const windowEndMs = windowStartMs + windowMinutes * 60_000;
      const windowStartIso = new Date(windowStartMs).toISOString();
      const windowEndIso = new Date(windowEndMs).toISOString();

      // Look slightly wider than the aligned bucket to catch late arrivals,
      // then filter to the floor-aligned window.
      const lookbackStart = new Date(windowStartMs - windowMinutes * 60_000).toISOString();
      const lookbackEnd = new Date(Math.max(windowEndMs, capturedMs) + 60_000).toISOString();

      const result = await eventRepo.listInWindow({
        periodStart: lookbackStart,
        periodEnd: lookbackEnd,
        limit: 500,
      });

      if (!result.ok) return null;

      const protocolLabel = protocol?.trim() || "Aave V3";
      const liquidations = result.value.filter((e) => {
        if (e.event_type !== "liquidation") return false;
        if (e.chain_id !== chainId) return false;
        if (e.status === "failed") return false;
        const eventProtocol = (e.protocol ?? "Aave V3").trim();
        if (eventProtocol.toLowerCase() !== protocolLabel.toLowerCase()) return false;
        const t = new Date(e.captured_at).getTime();
        return t >= windowStartMs && t < windowEndMs;
      });

      if (liquidations.length < minCount) return null;

      const totalUsd = liquidations.reduce((sum, e) => sum + magnitudeUsd(e), 0);
      if (totalUsd < minNotional) return null;

      // Idempotency: if synthetic event already stored for this window, skip.
      const sourceEventId = buildLiquidationClusterSourceEventId(
        chainId,
        windowStartIso,
        protocolLabel,
      );
      const legacySourceEventId = sourceEventId.slice(`${chainId}:`.length);
      for (const candidateSourceEventId of [sourceEventId, legacySourceEventId]) {
        const existing = await eventRepo.findBySourceAndEventId(
          "chronicle",
          candidateSourceEventId,
          chainId,
        );
        if (existing) return null;
        // Also check keeperhub source in case it was ingested under another source label
        const existingKh = await eventRepo.findBySourceAndEventId(
          "keeperhub",
          candidateSourceEventId,
          chainId,
        );
        if (existingKh) return null;
      }

      const assetSet = new Set<string>();
      for (const e of liquidations) {
        for (const s of e.asset_symbols ?? []) {
          if (s) assetSet.add(s);
        }
      }

      const flow: FlowContext = enrichFlowContext({
        eventType: "liquidation_cluster",
        chainId,
        protocol: protocolLabel,
        assetSymbols: [...assetSet],
        venue: protocolLabel,
        directionHint: "de_risk",
      });

      const rawPayload = attachFlowContextToRawPayload(
        {
          cluster: true,
          windowStart: windowStartIso,
          windowEnd: windowEndIso,
          windowMinutes,
          count: liquidations.length,
          memberSourceEventIds: liquidations.map((e) => e.source_event_id),
          memberEventIds: liquidations.map((e) => e.id),
          totalUsd,
        },
        flow,
      );

      const payload: EventIngestionPayload = {
        sourceEventId,
        eventType: "liquidation_cluster",
        chainId,
        protocol: protocolLabel,
        assetSymbols: [...assetSet],
        magnitude: { value: totalUsd, unit: "USD" },
        capturedAt: new Date(Math.min(capturedMs, windowEndMs - 1)).toISOString(),
        rawPayload,
        flowContext: flow,
      };

      return {
        payload,
        memberEventIds: liquidations.map((e) => e.id),
        windowStartIso,
        count: liquidations.length,
        totalUsd,
      };
    },
  };
}
