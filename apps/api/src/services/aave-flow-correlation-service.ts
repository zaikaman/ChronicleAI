// Correlates genuine Aave withdraw/redeposit pairs before public-alert creation.
// Raw monitored events remain durable; only the redundant public projection is suppressed.

import {
  AAVE_FLOW_CORRELATION_LOOKAROUND_MS,
  AAVE_FLOW_CORRELATION_MAGNITUDE_TOLERANCE,
  AAVE_FLOW_CORRELATION_MAX_CANDIDATES,
  AAVE_FLOW_CORRELATION_TIME_WINDOW_MS,
} from "@chronicleai/config";
import type {
  MonitoredEventRepository,
  MonitoredEventRow,
  PublicAlertRepository,
  PublicAlertRow,
} from "@chronicleai/db";
import type { EventType } from "@chronicleai/schemas";
import { argAsBigInt, argAsString } from "../monitoring/arg-utils.ts";
import { extractFlowContext } from "../monitoring/flow-enrichment.ts";

const AAVE_FLOW_TYPES = new Set<EventType>([
  "protocol_deposit",
  "protocol_withdraw",
]);

type AaveFlowEventType = "protocol_deposit" | "protocol_withdraw";

export interface AaveFlowIdentity {
  eventType: AaveFlowEventType;
  chainId: number;
  source: string;
  protocol: string;
  sourceContract: string;
  subjectAddress: string;
  assetKey: string;
  amountAtomic: string | null;
  magnitudeUsd: number | null;
  blockNumber: number | null;
  capturedAtMs: number | null;
}

export interface AaveFlowCorrelation {
  currentEvent: MonitoredEventRow;
  counterpartEvent: MonitoredEventRow;
  counterpartAlert: PublicAlertRow;
  matchKind: "same_block" | "time_window";
}

export interface AaveFlowCorrelationService {
  findPair(event: MonitoredEventRow): Promise<AaveFlowCorrelation | null>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function normalizeAddress(value: string | null | undefined): string | undefined {
  const normalized = normalizeValue(value);
  return normalized?.startsWith("0x") ? normalized : undefined;
}

function isAaveProtocol(protocol: string | null | undefined): boolean {
  return typeof protocol === "string" && protocol.toLowerCase().includes("aave");
}

function eventTypeIsAaveFlow(eventType: EventType): eventType is AaveFlowEventType {
  return AAVE_FLOW_TYPES.has(eventType);
}

function magnitudeUsd(event: MonitoredEventRow): number | null {
  const magnitude = asRecord(event.magnitude);
  const value = magnitude?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assetKeyFor(
  reserve: string | undefined,
  assetSymbols: string[] | null,
): string | undefined {
  const normalizedReserve = normalizeAddress(reserve);
  if (normalizedReserve) return `reserve:${normalizedReserve}`;

  const symbols = (assetSymbols ?? [])
    .map((symbol) => normalizeValue(symbol))
    .filter((symbol): symbol is string => Boolean(symbol))
    .sort();
  return symbols.length > 0 ? `symbols:${symbols.join(",")}` : undefined;
}

/** Extracts the stable identity fields used to match a supply/withdraw pair. */
export function extractAaveFlowIdentity(
  event: MonitoredEventRow,
): AaveFlowIdentity | null {
  if (!eventTypeIsAaveFlow(event.event_type) || !isAaveProtocol(event.protocol)) {
    return null;
  }

  const raw = asRecord(event.raw_payload);
  const args = asRecord(raw?.args);
  const flowContext = extractFlowContext(raw);
  const reserve = argAsString(args?.reserve) ?? argAsString(args?.asset);
  const subjectAddress =
    normalizeAddress(flowContext?.subjectAddress) ??
    normalizeAddress(argAsString(args?.user)) ??
    normalizeAddress(argAsString(args?.onBehalfOf)) ??
    normalizeAddress(argAsString(args?.to));
  const sourceContract = normalizeAddress(event.source_contract);
  const assetKey = assetKeyFor(reserve, event.asset_symbols);

  if (!subjectAddress || !sourceContract || !assetKey) return null;

  const amount = argAsBigInt(args?.amount);
  const capturedAtMs = Date.parse(event.captured_at);

  return {
    eventType: event.event_type,
    chainId: event.chain_id,
    source: event.source,
    protocol: event.protocol?.trim().toLowerCase() ?? "",
    sourceContract,
    subjectAddress,
    assetKey,
    amountAtomic: amount !== undefined ? amount.toString() : null,
    magnitudeUsd: magnitudeUsd(event),
    blockNumber: event.block_number ?? null,
    capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : null,
  };
}

function magnitudesMatch(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return false;
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / denominator <= AAVE_FLOW_CORRELATION_MAGNITUDE_TOLERANCE;
}

function amountsMatch(left: AaveFlowIdentity, right: AaveFlowIdentity): boolean {
  if (left.amountAtomic !== null && right.amountAtomic !== null) {
    return left.amountAtomic === right.amountAtomic;
  }
  return magnitudesMatch(left.magnitudeUsd, right.magnitudeUsd);
}

function timeDifferenceMs(left: AaveFlowIdentity, right: AaveFlowIdentity): number | null {
  if (left.capturedAtMs === null || right.capturedAtMs === null) return null;
  return Math.abs(left.capturedAtMs - right.capturedAtMs);
}

/**
 * Returns true only for the narrowly defined same-wallet, same-reserve,
 * same-pool opposite-flow pair. This intentionally does not correlate by
 * amount or event type alone.
 */
export function isAaveFlowPair(
  current: MonitoredEventRow,
  candidate: MonitoredEventRow,
): boolean {
  const left = extractAaveFlowIdentity(current);
  const right = extractAaveFlowIdentity(candidate);
  if (!left || !right) return false;
  if (left.eventType === right.eventType) return false;
  if (left.chainId !== right.chainId || left.source !== right.source) return false;
  if (left.protocol !== right.protocol) return false;
  if (left.sourceContract !== right.sourceContract) return false;
  if (left.subjectAddress !== right.subjectAddress) return false;
  if (left.assetKey !== right.assetKey) return false;
  if (!amountsMatch(left, right)) return false;

  const sameBlock =
    left.blockNumber !== null &&
    right.blockNumber !== null &&
    left.blockNumber === right.blockNumber;
  if (sameBlock) return true;
  if (left.blockNumber !== null && right.blockNumber !== null) return false;

  const difference = timeDifferenceMs(left, right);
  return difference !== null && difference <= AAVE_FLOW_CORRELATION_TIME_WINDOW_MS;
}

function pairRank(current: MonitoredEventRow, candidate: MonitoredEventRow): number {
  const left = extractAaveFlowIdentity(current);
  const right = extractAaveFlowIdentity(candidate);
  if (!left || !right) return Number.POSITIVE_INFINITY;

  const sameBlock =
    left.blockNumber !== null &&
    right.blockNumber !== null &&
    left.blockNumber === right.blockNumber;
  const difference = timeDifferenceMs(left, right) ?? Number.MAX_SAFE_INTEGER;
  return (sameBlock ? 0 : 1) * 1_000_000_000_000 + difference;
}

function eventAlertMap(alerts: PublicAlertRow[]): Map<string, PublicAlertRow> {
  return new Map(
    alerts
      .filter((alert) => typeof alert.monitored_event_id === "string")
      .map((alert) => [alert.monitored_event_id as string, alert]),
  );
}

export function createAaveFlowCorrelationService(deps: {
  eventRepo: MonitoredEventRepository;
  alertRepo: PublicAlertRepository;
}): AaveFlowCorrelationService {
  return {
    async findPair(event) {
      const identity = extractAaveFlowIdentity(event);
      if (!identity || identity.capturedAtMs === null) return null;

      const periodStart = new Date(
        identity.capturedAtMs - AAVE_FLOW_CORRELATION_LOOKAROUND_MS,
      ).toISOString();
      const periodEnd = new Date(
        identity.capturedAtMs + AAVE_FLOW_CORRELATION_LOOKAROUND_MS,
      ).toISOString();

      const recentEvents = await deps.eventRepo.listInWindow({
        periodStart,
        periodEnd,
        status: "qualified",
        chainId: event.chain_id,
        limit: AAVE_FLOW_CORRELATION_MAX_CANDIDATES,
      });
      if (!recentEvents.ok) return null;

      const candidates = recentEvents.value
        .filter((candidate) => candidate.id !== event.id)
        .filter((candidate) => isAaveFlowPair(event, candidate))
        .sort((left, right) => pairRank(event, left) - pairRank(event, right));
      if (candidates.length === 0 || !deps.alertRepo.listByEventIds) return null;

      const alertResult = await deps.alertRepo.listByEventIds(
        candidates.map((candidate) => candidate.id),
      );
      if (!alertResult.ok) return null;

      const alerts = eventAlertMap(alertResult.value);
      const counterpartEvent = candidates.find((candidate) => alerts.has(candidate.id));
      if (!counterpartEvent) return null;

      const counterpartIdentity = extractAaveFlowIdentity(counterpartEvent);
      if (!counterpartIdentity) return null;

      return {
        currentEvent: event,
        counterpartEvent,
        counterpartAlert: alerts.get(counterpartEvent.id) as PublicAlertRow,
        matchKind:
          identity.blockNumber !== null &&
          identity.blockNumber === counterpartIdentity.blockNumber
            ? "same_block"
            : "time_window",
      };
    },
  };
}
