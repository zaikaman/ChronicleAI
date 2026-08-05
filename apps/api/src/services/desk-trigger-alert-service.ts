/**
 * Deterministic Desk-trigger Alert service.
 *
 * Creates public `alert_kind: "desk_trigger"` Alerts from Desk-native conditions
 * (signals, capital decisions, event-linked microtrades). No LLM copy.
 * Publication is best-effort and never blocks safe Desk execution.
 */

import {
  ACTIVE_INTELLIGENCE_CHAIN_ID,
  chainLabel,
} from "@chronicleai/config";
import type {
  DeskSignalRepository,
  DeskSignalRow,
  PublicAlertInsert,
  PublicAlertRepository,
  PublicAlertRow,
} from "@chronicleai/db";
import type {
  AlertActionStatus,
  AlertSignalStatus,
  DeskPolicyVerdict,
  DeskSignalType,
} from "@chronicleai/schemas";
import type { AlertPublicationService } from "./alert-publication-service.ts";
import type { CapitalAction, CapitalDecision } from "../desk/types.ts";

/** Signal types that may produce a Desk-trigger Alert when verdict is non-ignore. */
export const DESK_TRIGGER_SIGNAL_TYPES = [
  "health_factor",
  "apy_delta",
  "oracle_basis",
  "gas_regime",
] as const;

export type DeskTriggerSignalType = (typeof DESK_TRIGGER_SIGNAL_TYPES)[number];

/** Capital actions that produce a Desk-trigger Alert before execution. */
export const DESK_TRIGGER_CAPITAL_ACTIONS = [
  "topup",
  "sweep",
  "emergency_return",
  "free_inventory",
] as const;

export type DeskTriggerCapitalAction = (typeof DESK_TRIGGER_CAPITAL_ACTIONS)[number];

/** Typed source label for UI — never parse raw evidence for this. */
export type DeskTriggerSourceLabel =
  | "Health factor"
  | "APY differential"
  | "Oracle basis"
  | "Gas regime"
  | "Capital top-up"
  | "Capital sweep"
  | "Emergency return"
  | "Free inventory"
  | "Event microtrade"
  | "Desk condition";

export interface DeskTriggerAlertResult {
  alert: PublicAlertRow;
  created: boolean;
  /** True when an existing Alert was reused via dedupe. */
  deduped: boolean;
  publicationAttempted: boolean;
  publicationOk: boolean;
  publicationError?: string;
}

export interface DeskTriggerFromSignalInput {
  signal: DeskSignalRow;
  /** When true, skip if signal already has source_alert_id (market Alert reuse). */
  skipIfLinked?: boolean;
}

export interface DeskTriggerFromCapitalInput {
  decision: CapitalDecision;
  /** Stable key fragment for this capital tick (e.g. direction + rounded amount + hour). */
  dedupeKey?: string;
  nowMs?: number;
}

export interface DeskTriggerFromMicrotradeInput {
  /** Existing public market Alert id when the monitored event already has one. */
  existingAlertId?: string | null;
  monitoredEventId?: string | null;
  eventType?: string | null;
  transactionHash?: string | null;
  sourceChainId?: number | null;
  notionalUsdc?: number | null;
  strategy?: string | null;
  mode?: string | null;
  reasonCodes?: string[];
  dedupeKey?: string;
}

export interface DeskTriggerExecutionUpdate {
  actionStatus: AlertActionStatus;
  intentId?: string | null;
  ticketId?: string | null;
  actionTransactionHash?: string | null;
  actionKeeperHubRunId?: string | null;
  actionExplorerUrl?: string | null;
  policyVerdict?: DeskPolicyVerdict | null;
}

export interface DeskTriggerAlertService {
  /** Create or reuse a Desk-trigger Alert for a non-ignore desk-native signal. */
  createFromSignal(input: DeskTriggerFromSignalInput): Promise<DeskTriggerAlertResult | null>;
  /** Create a Desk-trigger Alert for a non-none capital decision (before execution). */
  createFromCapital(input: DeskTriggerFromCapitalInput): Promise<DeskTriggerAlertResult | null>;
  /**
   * Reuse an existing market Alert when available, otherwise create a Desk-trigger
   * Alert for a qualified event-linked microtrade.
   */
  createOrAttachForMicrotrade(
    input: DeskTriggerFromMicrotradeInput,
  ): Promise<DeskTriggerAlertResult | null>;
  /** Best-effort causal update after execution / callback. */
  updateAfterExecution(
    alertId: string,
    update: DeskTriggerExecutionUpdate,
  ): Promise<PublicAlertRow | null>;
  /** Lookup for execution callbacks when no Desk Signal exists. */
  findByIntentId(intentId: string): Promise<PublicAlertRow | null>;
  findByTicketId(ticketId: string): Promise<PublicAlertRow | null>;
  /** Link an existing Desk Signal to its Alert (source_alert_id). */
  linkSignalToAlert(signalId: string, alertId: string): Promise<boolean>;
}

export interface DeskTriggerAlertServiceDeps {
  alertRepo: PublicAlertRepository;
  signalRepo?: DeskSignalRepository | null;
  publicationService?: AlertPublicationService | null;
}

// ── Pure helpers (exported for tests) ───────────────────

export function isDeskTriggerSignalType(value: string): value is DeskTriggerSignalType {
  return (DESK_TRIGGER_SIGNAL_TYPES as readonly string[]).includes(value);
}

export function isDeskTriggerCapitalAction(value: string): value is DeskTriggerCapitalAction {
  return (DESK_TRIGGER_CAPITAL_ACTIONS as readonly string[]).includes(value);
}

export function shouldCreateAlertForVerdict(verdict: DeskPolicyVerdict | string): boolean {
  return verdict === "trade" || verdict === "defend" || verdict === "defer";
}

export function actionStatusForVerdict(verdict: DeskPolicyVerdict): AlertActionStatus {
  if (verdict === "defer") return "deferred";
  if (verdict === "ignore") return "ignored";
  return "pending";
}

export function deskTriggerSourceLabel(params: {
  signalType?: string | null;
  capitalAction?: string | null;
  microtrade?: boolean;
}): DeskTriggerSourceLabel {
  if (params.microtrade) return "Event microtrade";
  switch (params.capitalAction) {
    case "topup":
      return "Capital top-up";
    case "sweep":
      return "Capital sweep";
    case "emergency_return":
      return "Emergency return";
    case "free_inventory":
      return "Free inventory";
    default:
      break;
  }
  switch (params.signalType) {
    case "health_factor":
      return "Health factor";
    case "apy_delta":
      return "APY differential";
    case "oracle_basis":
      return "Oracle basis";
    case "gas_regime":
      return "Gas regime";
    default:
      return "Desk condition";
  }
}

/** Allowlisted public feature keys — never expose raw wallet reads. */
const PUBLIC_FEATURE_KEYS = [
  "hf",
  "healthFactor",
  "basisBps",
  "apyDeltaBps",
  "aaveSupplyApyBps",
  "idleUsdcApyBps",
  "morphoApyBps",
  "gasGwei",
  "gasRegime",
  "oraclePrice",
  "ammPrice",
  "ammQuoteMethod",
  "severity",
  "consecutiveEdgePolls",
  "totalCollateralUsd",
  "totalDebtUsd",
  "fusionLabel",
  "fusionConfidence",
  "eventType",
  "sourceChainId",
  "executionChainId",
  "sourceChain",
  "executionChain",
  "executionEligibility",
] as const;

export function redactPublicEvidence(
  features: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!features || typeof features !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_FEATURE_KEYS) {
    if (key in features && features[key] !== undefined) {
      out[key] = features[key];
    }
  }
  return out;
}

function formatHf(hf: number): string {
  return hf >= 100 ? hf.toFixed(0) : hf.toFixed(3);
}

function formatUsdc(amount: number): string {
  if (amount >= 1000) return `$${amount.toFixed(0)}`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

function formatUsdPrice(price: number): string {
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function decisionTitle(verdict: DeskPolicyVerdict): string {
  switch (verdict) {
    case "trade":
      return "the desk is acting";
    case "defend":
      return "the desk is protecting the position";
    case "defer":
      return "the desk is waiting";
    default:
      return "the desk is reviewing it";
  }
}

function decisionSentence(verdict: DeskPolicyVerdict): string {
  switch (verdict) {
    case "trade":
      return "The desk decided to act on this condition";
    case "defend":
      return "The desk decided to protect the position";
    case "defer":
      return "The desk decided to wait, so no trade was made";
    default:
      return "The desk recorded the condition without taking action";
  }
}

function readableReason(reason: string): string {
  const knownReasons: Record<string, string> = {
    equity_below_target: "available desk capital was below its target",
    free_usdc_shortfall_unwind: "the desk needed more ready-to-use cash",
    free_usdc_shortfall: "the desk needed more ready-to-use cash",
    desk_paused: "the desk was paused",
  };
  return knownReasons[reason] ?? reason.replace(/_/g, " ");
}

export function buildSignalAlertCopy(signal: DeskSignalRow): {
  title: string;
  summary: string;
  sourceReferences: string[];
} {
  const features = (signal.features ?? {}) as Record<string, unknown>;
  const type = signal.signal_type;
  const verdict = signal.policy_verdict;
  const chain = chainLabel(signal.chain_id);
  const refs: string[] = [
    `desk:${type}`,
    `verdict:${verdict}`,
    `chain:${signal.chain_id}`,
  ];

  switch (type) {
    case "health_factor": {
      const hf = typeof features.hf === "number" ? features.hf : null;
      const hfLabel = hf != null ? formatHf(hf) : "n/a";
      return {
        title: `Position safety update - ${decisionTitle(verdict)}`,
        summary: `Chronicle Desk measured a lending safety score of ${hfLabel} on ${chain}. ${decisionSentence(verdict)}.`,
        sourceReferences: refs,
      };
    }
    case "apy_delta": {
      const delta =
        typeof features.apyDeltaBps === "number" ? features.apyDeltaBps : null;
      const aaveBps =
        typeof features.aaveSupplyApyBps === "number" ? features.aaveSupplyApyBps : null;
      const idleBps =
        typeof features.idleUsdcApyBps === "number" ? features.idleUsdcApyBps : null;
      const morphoBps =
        typeof features.morphoApyBps === "number" ? features.morphoApyBps : null;

      let yieldDetail = "";
      if (aaveBps != null && idleBps != null) {
        yieldDetail = ` (Aave supply yield of ${(aaveBps / 100).toFixed(2)}% vs idle USDC yield of ${(idleBps / 100).toFixed(2)}%)`;
      } else if (morphoBps != null && idleBps != null) {
        yieldDetail = ` (Morpho supply yield of ${(morphoBps / 100).toFixed(2)}% vs idle USDC yield of ${(idleBps / 100).toFixed(2)}%)`;
      } else if (aaveBps != null) {
        yieldDetail = ` (Aave supply yield of ${(aaveBps / 100).toFixed(2)}%)`;
      }

      const rateDetail =
        delta != null
          ? ` The estimated difference was ${Math.abs(delta / 100).toFixed(2)} percentage points.`
          : "";
      return {
        title: `Yield difference found - ${decisionTitle(verdict)}`,
        summary: `Chronicle Desk found a difference in the available yield on ${chain}${yieldDetail}.${rateDetail} ${decisionSentence(verdict)}.`,
        sourceReferences: refs,
      };
    }
    case "oracle_basis": {
      const oracle =
        typeof features.oraclePrice === "number" ? features.oraclePrice : null;
      const amm = typeof features.ammPrice === "number" ? features.ammPrice : null;
      const priceDetail =
        oracle != null && amm != null
          ? ` The reference feed priced ETH at ${formatUsdPrice(oracle)} while the exchange priced ETH at ${formatUsdPrice(amm)}, so the exchange price was ${amm >= oracle ? "much higher" : "much lower"}.`
          : "";
      return {
        title: `Large ETH price difference - ${decisionTitle(verdict)}`,
        summary: `Chronicle Desk found a large difference between the reference price for ETH and the exchange price for ETH on ${chain}.${priceDetail} ${decisionSentence(verdict)}.`,
        sourceReferences: refs,
      };
    }
    case "gas_regime": {
      const gwei = typeof features.gasGwei === "number" ? features.gasGwei : null;
      return {
        title: `Network fee update - ${decisionTitle(verdict)}`,
        summary: `Network transaction fees were${gwei != null ? ` about ${gwei.toFixed(1)} gwei` : " elevated"} on ${chain}. ${decisionSentence(verdict)}.`,
        sourceReferences: refs,
      };
    }
    default:
      return {
        title: `Desk condition update - ${decisionTitle(verdict)}`,
        summary: `Chronicle Desk recorded a condition on ${chain}. ${decisionSentence(verdict)}.`,
        sourceReferences: refs,
      };
  }
}

export function buildCapitalAlertCopy(decision: CapitalDecision): {
  title: string;
  summary: string;
  sourceReferences: string[];
} {
  const action = decision.action;
  const amount = formatUsdc(decision.amountUsdc);
  const chain = chainLabel(ACTIVE_INTELLIGENCE_CHAIN_ID);
  const refs = [`desk:capital:${action}`, `reason:${decision.reason}`, `chain:${ACTIVE_INTELLIGENCE_CHAIN_ID}`];

  switch (action) {
    case "topup":
      return {
        title: `Adding ${amount} to desk funds`,
        summary: `Chronicle Desk planned to add ${amount} to its ready-to-use funds on ${chain} because ${readableReason(decision.reason)}.`,
        sourceReferences: refs,
      };
    case "sweep":
      return {
        title: `Returning ${amount} to the treasury`,
        summary: `Chronicle Desk planned to return ${amount} from the desk to the treasury on ${chain} because ${readableReason(decision.reason)}.`,
        sourceReferences: refs,
      };
    case "emergency_return":
      return {
        title: `Emergency return of ${amount}`,
        summary: `Chronicle Desk planned an emergency return of ${amount} to the treasury on ${chain} because ${readableReason(decision.reason)}.`,
        sourceReferences: refs,
      };
    case "free_inventory":
      return {
        title: `Making ${amount} available for desk activity`,
        summary: `Chronicle Desk planned to turn ${amount} of its holdings into ready-to-use funds on ${chain} because ${readableReason(decision.reason)}.`,
        sourceReferences: refs,
      };
    default:
      return {
        title: `Desk funds update: ${amount}`,
        summary: `Chronicle Desk recorded a funds decision for ${amount} on ${chain}.`,
        sourceReferences: refs,
      };
  }
}

export function buildMicrotradeAlertCopy(input: DeskTriggerFromMicrotradeInput): {
  title: string;
  summary: string;
  sourceReferences: string[];
} {
  const eventType = input.eventType ?? "market event";
  const notional =
    input.notionalUsdc != null && Number.isFinite(input.notionalUsdc)
      ? formatUsdc(input.notionalUsdc)
      : null;
  const chainId = input.sourceChainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID;
  const refs = [
    "desk:event_microtrade",
    `event:${eventType}`,
    `chain:${chainId}`,
    ...(input.strategy ? [`strategy:${input.strategy}`] : []),
  ];
  return {
    title: `Desk action after ${eventType.replace(/_/g, " ")} was detected`,
    summary: `Chronicle Desk planned a small trade${notional ? ` of up to ${notional}` : ""} on ${chainLabel(chainId)} after detecting ${eventType.replace(/_/g, " ")}.`,
    sourceReferences: refs,
  };
}

export function signalSourceDedupeKey(signal: DeskSignalRow): string {
  return (
    signal.source_dedupe_key?.trim() ||
    signal.dedupe_key ||
    `desk-signal:${signal.signal_type}:${signal.id}`
  );
}

export function capitalSourceDedupeKey(
  decision: CapitalDecision,
  nowMs = Date.now(),
): string {
  // Hour-bucketed so repeated ticks for the same action/amount reuse one Alert.
  const hourBucket = Math.floor(nowMs / 3_600_000);
  const amountKey = Math.round(decision.amountUsdc * 100);
  return `desk-capital:${decision.action}:${amountKey}:${decision.reason}:${hourBucket}`;
}

export function microtradeSourceDedupeKey(input: DeskTriggerFromMicrotradeInput): string {
  if (input.dedupeKey?.trim()) return input.dedupeKey.trim();
  if (input.monitoredEventId?.trim()) {
    return `desk-microtrade:event:${input.monitoredEventId.trim()}`;
  }
  const eventType = input.eventType ?? "unknown";
  const tx = input.transactionHash?.trim() ?? "none";
  return `desk-microtrade:${eventType}:${tx}`;
}

function buildDeterministicEvidence(params: {
  triggerLabel: DeskTriggerSourceLabel;
  signalType?: string | null;
  capitalAction?: string | null;
  policyVerdict?: string | null;
  features?: Record<string, unknown>;
  capital?: CapitalDecision | null;
  microtrade?: DeskTriggerFromMicrotradeInput | null;
  deskSignalId?: string | null;
  sourceDedupeKey: string;
}): Record<string, unknown> {
  return {
    triggerLabel: params.triggerLabel,
    source: "chronicle_desk",
    sourceChainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
    executionChainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
    sourceChain: chainLabel(ACTIVE_INTELLIGENCE_CHAIN_ID),
    executionChain: chainLabel(ACTIVE_INTELLIGENCE_CHAIN_ID),
    publicationChainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
    sourceDedupeKey: params.sourceDedupeKey,
    ...(params.signalType ? { signalType: params.signalType } : {}),
    ...(params.capitalAction ? { capitalAction: params.capitalAction } : {}),
    ...(params.policyVerdict ? { policyVerdict: params.policyVerdict } : {}),
    ...(params.deskSignalId ? { deskSignalId: params.deskSignalId } : {}),
    ...(params.features ? { features: redactPublicEvidence(params.features) } : {}),
    ...(params.capital
      ? {
          capital: {
            action: params.capital.action,
            amountUsdc: params.capital.amountUsdc,
            reason: params.capital.reason,
            ...(params.capital.direction ? { direction: params.capital.direction } : {}),
            ...(params.capital.inventorySource
              ? { inventorySource: params.capital.inventorySource }
              : {}),
          },
        }
      : {}),
    ...(params.microtrade
      ? {
          microtrade: {
            eventType: params.microtrade.eventType ?? null,
            monitoredEventId: params.microtrade.monitoredEventId ?? null,
            notionalUsdc: params.microtrade.notionalUsdc ?? null,
            strategy: params.microtrade.strategy ?? null,
            mode: params.microtrade.mode ?? null,
            reasonCodes: params.microtrade.reasonCodes ?? [],
          },
        }
      : {}),
  };
}

// ── Service ─────────────────────────────────────────────

export function createDeskTriggerAlertService(
  deps: DeskTriggerAlertServiceDeps,
): DeskTriggerAlertService {
  const { alertRepo, signalRepo, publicationService } = deps;

  async function publishBestEffort(alertId: string): Promise<{
    attempted: boolean;
    ok: boolean;
    error?: string;
  }> {
    if (!publicationService) {
      return { attempted: false, ok: false, error: "publication_service_unavailable" };
    }
    try {
      const result = await publicationService.publishAlert(alertId, alertId);
      return {
        attempted: true,
        ok: result.success,
        ...(result.success ? {} : { error: result.message }),
      };
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function findExistingBySourceDedupe(
    sourceDedupeKey: string,
  ): Promise<PublicAlertRow | null> {
    if (alertRepo.findBySourceDedupeKey) {
      return alertRepo.findBySourceDedupeKey(sourceDedupeKey);
    }
    // Fallback: dedupe_key often mirrors source_dedupe_key for desk triggers.
    return alertRepo.findByDedupeKey(sourceDedupeKey);
  }

  async function createOrReuse(insert: PublicAlertInsert): Promise<{
    alert: PublicAlertRow;
    created: boolean;
    deduped: boolean;
  }> {
    const sourceKey = insert.source_dedupe_key ?? insert.dedupe_key;
    if (sourceKey) {
      const existing = await findExistingBySourceDedupe(sourceKey);
      if (existing) {
        return { alert: existing, created: false, deduped: true };
      }
    }

    const created = await alertRepo.create(insert);
    if (!created.ok) {
      // Race on unique source_dedupe_key — re-read
      if (sourceKey) {
        const again = await findExistingBySourceDedupe(sourceKey);
        if (again) return { alert: again, created: false, deduped: true };
      }
      throw created.error;
    }
    return { alert: created.value, created: true, deduped: false };
  }

  async function finalize(
    row: { alert: PublicAlertRow; created: boolean; deduped: boolean },
    opts?: { publish?: boolean },
  ): Promise<DeskTriggerAlertResult> {
    let publicationAttempted = false;
    let publicationOk = false;
    let publicationError: string | undefined;

    // Only attempt publication for newly created or still-queued Alerts.
    const shouldPublish =
      opts?.publish !== false &&
      (row.created ||
        row.alert.delivery_status === "queued" ||
        row.alert.delivery_status === "draft");

    if (shouldPublish) {
      const pub = await publishBestEffort(row.alert.id);
      publicationAttempted = pub.attempted;
      publicationOk = pub.ok;
      publicationError = pub.error;
      if (pub.ok || pub.attempted) {
        const refreshed = await alertRepo.findById(row.alert.id);
        if (refreshed.ok) {
          return {
            alert: refreshed.value,
            created: row.created,
            deduped: row.deduped,
            publicationAttempted,
            publicationOk,
            ...(publicationError ? { publicationError } : {}),
          };
        }
      }
    }

    return {
      alert: row.alert,
      created: row.created,
      deduped: row.deduped,
      publicationAttempted,
      publicationOk,
      ...(publicationError ? { publicationError } : {}),
    };
  }

  async function linkSignalToAlert(
    signalId: string,
    alertId: string,
  ): Promise<boolean> {
    if (!signalRepo?.linkSourceAlertId) {
      return false;
    }
    try {
      const result = await signalRepo.linkSourceAlertId(signalId, alertId, {
        signalOrigin: "desk_read",
      });
      return result.ok;
    } catch (error) {
      console.warn(
        "[desk-trigger-alert] linkSignalToAlert failed:",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  const service: DeskTriggerAlertService = {
    async createFromSignal(input) {
      const { signal, skipIfLinked = true } = input;

      if (skipIfLinked && signal.source_alert_id) {
        // Already linked to a market or prior Desk-trigger Alert — reuse it.
        const existing = await alertRepo.findById(signal.source_alert_id);
        if (existing.ok) {
          if (alertRepo.updateCausalMetadata) {
            await alertRepo.updateCausalMetadata(existing.value.id, {
              deskSignalId: signal.id,
              signalType: signal.signal_type as DeskSignalType,
              signalStatus: "created",
              policyVerdict: signal.policy_verdict,
              actionStatus: actionStatusForVerdict(signal.policy_verdict),
            });
            const refreshed = await alertRepo.findById(existing.value.id);
            if (refreshed.ok) {
              return {
                alert: refreshed.value,
                created: false,
                deduped: true,
                publicationAttempted: false,
                publicationOk: false,
              };
            }
          }
          return {
            alert: existing.value,
            created: false,
            deduped: true,
            publicationAttempted: false,
            publicationOk: false,
          };
        }
      }

      if (!shouldCreateAlertForVerdict(signal.policy_verdict)) {
        return null;
      }

      if (!isDeskTriggerSignalType(signal.signal_type)) {
        return null;
      }

      const sourceKey = signalSourceDedupeKey(signal);
      const copy = buildSignalAlertCopy(signal);
      const triggerLabel = deskTriggerSourceLabel({ signalType: signal.signal_type });
      const actionStatus = actionStatusForVerdict(signal.policy_verdict);

      const insert: PublicAlertInsert = {
        monitored_event_id: null,
        title: copy.title,
        summary: copy.summary,
        source_references: copy.sourceReferences,
        audience: "public",
        delivery_status: "queued",
        dedupe_key: sourceKey,
        confidence: "high",
        alert_kind: "desk_trigger",
        chain_id: signal.chain_id || ACTIVE_INTELLIGENCE_CHAIN_ID,
        publication_chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
        source_dedupe_key: sourceKey,
        desk_signal_id: signal.id,
        signal_type: signal.signal_type as DeskSignalType,
        signal_status: "created" satisfies AlertSignalStatus,
        policy_verdict: signal.policy_verdict,
        action_status: actionStatus,
        deterministic_evidence: buildDeterministicEvidence({
          triggerLabel,
          signalType: signal.signal_type,
          policyVerdict: signal.policy_verdict,
          features: (signal.features ?? {}) as Record<string, unknown>,
          deskSignalId: signal.id,
          sourceDedupeKey: sourceKey,
        }),
      };

      try {
        const row = await createOrReuse(insert);

        // If reusing, refresh causal linkage to this signal.
        if (row.deduped && alertRepo.updateCausalMetadata) {
          await alertRepo.updateCausalMetadata(row.alert.id, {
            deskSignalId: signal.id,
            signalType: signal.signal_type as DeskSignalType,
            signalStatus: "created",
            policyVerdict: signal.policy_verdict,
            actionStatus,
          });
        }

        // Link signal → alert (best-effort).
        await linkSignalToAlert(signal.id, row.alert.id);

        return finalize(row);
      } catch (error) {
        console.warn(
          "[desk-trigger-alert] createFromSignal failed (non-blocking):",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async createFromCapital(input) {
      const { decision } = input;
      if (decision.action === "none" || !isDeskTriggerCapitalAction(decision.action)) {
        return null;
      }

      const sourceKey =
        input.dedupeKey?.trim() || capitalSourceDedupeKey(decision, input.nowMs);
      const copy = buildCapitalAlertCopy(decision);
      const triggerLabel = deskTriggerSourceLabel({ capitalAction: decision.action });

      const insert: PublicAlertInsert = {
        monitored_event_id: null,
        title: copy.title,
        summary: copy.summary,
        source_references: copy.sourceReferences,
        audience: "public",
        delivery_status: "queued",
        dedupe_key: sourceKey,
        confidence: "high",
        alert_kind: "desk_trigger",
        chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
        publication_chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
        source_dedupe_key: sourceKey,
        // Direct capital decisions have no Desk Signal step.
        desk_signal_id: null,
        signal_type: "capital_tick",
        signal_status: "not_eligible",
        policy_verdict: "trade",
        action_status: "pending",
        deterministic_evidence: buildDeterministicEvidence({
          triggerLabel,
          capitalAction: decision.action,
          policyVerdict: "trade",
          capital: decision,
          sourceDedupeKey: sourceKey,
        }),
      };

      try {
        const row = await createOrReuse(insert);
        return finalize(row);
      } catch (error) {
        console.warn(
          "[desk-trigger-alert] createFromCapital failed (non-blocking):",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async createOrAttachForMicrotrade(input) {
      // Prefer reusing the originating public market Alert.
      if (input.existingAlertId?.trim()) {
        const existing = await alertRepo.findById(input.existingAlertId.trim());
        if (existing.ok) {
          if (alertRepo.updateCausalMetadata) {
            await alertRepo.updateCausalMetadata(existing.value.id, {
              policyVerdict: "trade",
              actionStatus: "pending",
            });
            // Attach microtrade evidence without overwriting market title.
            if (alertRepo.updateContent) {
              const evidence = {
                ...(existing.value.deterministic_evidence ?? {}),
                ...buildDeterministicEvidence({
                  triggerLabel: "Event microtrade",
                  policyVerdict: "trade",
                  microtrade: input,
                  sourceDedupeKey:
                    existing.value.source_dedupe_key ??
                    existing.value.dedupe_key ??
                    microtradeSourceDedupeKey(input),
                }),
              };
              await alertRepo.updateContent(existing.value.id, {
                deterministicEvidence: evidence,
              });
            }
            const refreshed = await alertRepo.findById(existing.value.id);
            if (refreshed.ok) {
              return {
                alert: refreshed.value,
                created: false,
                deduped: true,
                publicationAttempted: false,
                publicationOk: false,
              };
            }
          }
          return {
            alert: existing.value,
            created: false,
            deduped: true,
            publicationAttempted: false,
            publicationOk: false,
          };
        }
      }

      const sourceKey = microtradeSourceDedupeKey(input);
      const copy = buildMicrotradeAlertCopy(input);

      const insert: PublicAlertInsert = {
        monitored_event_id: input.monitoredEventId ?? null,
        title: copy.title,
        summary: copy.summary,
        source_references: copy.sourceReferences,
        audience: "public",
        delivery_status: "queued",
        dedupe_key: sourceKey,
        confidence: "medium",
        alert_kind: "desk_trigger",
        event_type: (input.eventType as PublicAlertInsert["event_type"]) ?? null,
        chain_id: input.sourceChainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID,
        publication_chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
        source_dedupe_key: sourceKey,
        signal_type: null,
        signal_status: "not_eligible",
        policy_verdict: "trade",
        action_status: "pending",
        transaction_hash: input.transactionHash ?? null,
        deterministic_evidence: buildDeterministicEvidence({
          triggerLabel: "Event microtrade",
          policyVerdict: "trade",
          microtrade: input,
          sourceDedupeKey: sourceKey,
        }),
      };

      try {
        const row = await createOrReuse(insert);
        return finalize(row);
      } catch (error) {
        console.warn(
          "[desk-trigger-alert] createOrAttachForMicrotrade failed (non-blocking):",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async updateAfterExecution(alertId, update) {
      if (!alertRepo.updateCausalMetadata) return null;
      try {
        const result = await alertRepo.updateCausalMetadata(alertId, {
          ...(update.policyVerdict !== undefined
            ? { policyVerdict: update.policyVerdict }
            : {}),
          actionStatus: update.actionStatus,
          ...(update.intentId !== undefined ? { intentId: update.intentId } : {}),
          ...(update.ticketId !== undefined ? { ticketId: update.ticketId } : {}),
          ...(update.actionTransactionHash !== undefined
            ? { actionTransactionHash: update.actionTransactionHash }
            : {}),
          ...(update.actionKeeperHubRunId !== undefined
            ? { actionKeeperHubRunId: update.actionKeeperHubRunId }
            : {}),
          ...(update.actionExplorerUrl !== undefined
            ? { actionExplorerUrl: update.actionExplorerUrl }
            : {}),
        });
        if (!result.ok) {
          console.warn(
            "[desk-trigger-alert] updateAfterExecution rejected:",
            result.error.message,
          );
          return null;
        }
        return result.value;
      } catch (error) {
        console.warn(
          "[desk-trigger-alert] updateAfterExecution failed:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async findByIntentId(intentId) {
      if (!intentId.trim()) return null;
      if (alertRepo.findByIntentId) {
        return alertRepo.findByIntentId(intentId);
      }
      return null;
    },

    async findByTicketId(ticketId) {
      if (!ticketId.trim()) return null;
      if (alertRepo.findByTicketId) {
        return alertRepo.findByTicketId(ticketId);
      }
      return null;
    },

    linkSignalToAlert,
  };

  return service;
}

/** Resolve typed source label from an Alert row for API responses. */
export function sourceTriggerLabelFromAlert(
  alert: PublicAlertRow,
): DeskTriggerSourceLabel | undefined {
  if ((alert.alert_kind ?? "market_event") !== "desk_trigger") return undefined;
  const evidence = alert.deterministic_evidence ?? {};
  if (typeof evidence.triggerLabel === "string" && evidence.triggerLabel.trim()) {
    return evidence.triggerLabel as DeskTriggerSourceLabel;
  }
  if (typeof evidence.capitalAction === "string") {
    return deskTriggerSourceLabel({ capitalAction: evidence.capitalAction });
  }
  if (evidence.microtrade) {
    return "Event microtrade";
  }
  return deskTriggerSourceLabel({ signalType: alert.signal_type });
}
