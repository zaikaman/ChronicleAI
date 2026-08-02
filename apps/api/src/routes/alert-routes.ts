// Public alerts routes: GET /alerts, GET /alerts/:id
// Returns newest-first public alerts with page-based pagination, plus by-id lookup
// for HTTPS on-chain content URIs.

import {
  ACTIVE_INTELLIGENCE_CHAIN_ID,
  PRIMARY_SIGNAL_CHAIN_ID,
  isAllowedSignalSourceChain,
} from "@chronicleai/config";
import type {
  DeskSignalRepository,
  DeskSignalRow,
  PublicAlertRepository,
  PublicAlertRow,
} from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { notFound } from "../errors.ts";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";

function formatSignalResponse(signal: DeskSignalRow): Record<string, unknown> {
  return {
    id: signal.id,
    signalType: signal.signal_type,
    origin: signal.signal_origin ?? "manual",
    ...(signal.source_alert_id ? { sourceAlertId: signal.source_alert_id } : {}),
    ...(signal.source_event_id ? { sourceEventId: signal.source_event_id } : {}),
    chainId: signal.chain_id,
    policyVerdict: signal.policy_verdict,
    severity: signal.severity,
    features: signal.features,
    sources: signal.sources,
    dedupeKey: signal.dedupe_key,
    createdAt: signal.created_at,
  };
}

function formatAlertResponse(
  alert: PublicAlertRow,
  signal?: DeskSignalRow | null,
): Record<string, unknown> {
  const actionStatus = alert.action_status ?? "not_created";
  const signalStatus = alert.signal_status ?? "not_eligible";
  const signalType = alert.signal_type ?? signal?.signal_type ?? undefined;
  const policyVerdict = alert.policy_verdict ?? signal?.policy_verdict ?? undefined;
  const chainId = alert.chain_id ?? undefined;
  return {
    id: alert.id,
    title: alert.title,
    summary: alert.summary,
    sourceReferences: alert.source_references,
    deliveryStatus: alert.delivery_status,
    publishedAt: alert.published_at ?? "",
    confidence: alert.confidence,
    generationProvider: alert.generation_provider ?? undefined,
    registryTxHash: alert.registry_tx_hash ?? undefined,
    sourceEventHash: alert.source_event_hash ?? undefined,
    contentHash: alert.content_hash ?? undefined,
    contentUri: alert.content_uri ?? undefined,
    gasUsed: alert.gas_used ?? undefined,
    gasUsedWei: alert.gas_used_wei ?? undefined,
    explorerUrl: alert.explorer_url ?? undefined,
    keeperHubRunId: alert.keeper_hub_run_id ?? undefined,
    eventType: alert.event_type ?? undefined,
    chainId,
    protocol: alert.protocol ?? undefined,
    ...(alert.flow_context ? { flowContext: alert.flow_context } : {}),
    alertKind: alert.alert_kind ?? "market_event",
    publicationChainId: alert.publication_chain_id ?? ACTIVE_INTELLIGENCE_CHAIN_ID,
    sourceDedupeKey: alert.source_dedupe_key ?? alert.dedupe_key ?? undefined,
    signalType,
    signalStatus,
    policyVerdict,
    actionStatus,
    intentId: alert.intent_id ?? undefined,
    ticketId: alert.ticket_id ?? undefined,
    transactionHash: alert.transaction_hash ?? undefined,
    actionTransactionHash: alert.action_transaction_hash ?? undefined,
    actionKeeperHubRunId: alert.action_keeper_hub_run_id ?? undefined,
    actionExplorerUrl: alert.action_explorer_url ?? undefined,
    deterministicEvidence: alert.deterministic_evidence ?? undefined,
    causalChain: {
      alertId: alert.id,
      sourceEventId:
        alert.source_event_id ??
        (typeof alert.deterministic_evidence?.sourceEventId === "string"
          ? alert.deterministic_evidence.sourceEventId
          : (alert.monitored_event_id ?? undefined)),
      ...(signal ? { signal: formatSignalResponse(signal) } : {}),
      ...(policyVerdict
        ? {
            decision: {
              verdict: policyVerdict,
              ...(alert.intent_id ? { intentId: alert.intent_id } : {}),
              reasonCodes: [],
              actionStatus,
            },
          }
        : {}),
      action: {
        ...(alert.intent_id ? { intentId: alert.intent_id } : {}),
        ...(alert.ticket_id ? { ticketId: alert.ticket_id } : {}),
        status: actionStatus,
        ...(alert.action_transaction_hash
          ? { transactionHash: alert.action_transaction_hash }
          : {}),
        ...(alert.action_keeper_hub_run_id
          ? { keeperHubRunId: alert.action_keeper_hub_run_id }
          : {}),
        ...(alert.action_explorer_url ? { explorerUrl: alert.action_explorer_url } : {}),
      },
      proof: {
        ...(alert.transaction_hash ? { sourceTransactionHash: alert.transaction_hash } : {}),
        ...(alert.action_transaction_hash
          ? { transactionHash: alert.action_transaction_hash }
          : {}),
        ...(alert.registry_tx_hash ? { registryTransactionHash: alert.registry_tx_hash } : {}),
        ...(alert.content_hash ? { contentHash: alert.content_hash } : {}),
        ...(alert.content_uri ? { contentUri: alert.content_uri } : {}),
        ...((alert.action_explorer_url ?? alert.explorer_url)
          ? { explorerUrl: alert.action_explorer_url ?? alert.explorer_url }
          : {}),
      },
    },
  };
}

function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function hasExplicitChainScope(query: Record<string, unknown>): boolean {
  return queryString(query.scope) !== undefined || queryString(query.chainId) !== undefined;
}

function chainScope(req: { query: Record<string, unknown> }):
  | { chainId: number }
  | { error: string } {
  const scope = queryString(req.query.scope)?.toLowerCase();
  const chainValue = queryString(req.query.chainId);
  const scopeChainId =
    scope === undefined
      ? undefined
      : scope === "legacy" || scope === "mainnet" || scope === "primary"
        ? PRIMARY_SIGNAL_CHAIN_ID
        : scope === "sepolia" || scope === "active" || scope === "testnet"
          ? ACTIVE_INTELLIGENCE_CHAIN_ID
          : undefined;
  if (scope !== undefined && scopeChainId === undefined) {
    return { error: "scope must be mainnet or sepolia" };
  }
  const requestedChainId = chainValue === undefined ? undefined : Number(chainValue);
  const hasValidRequestedChain =
    requestedChainId !== undefined &&
    Number.isInteger(requestedChainId) &&
    isAllowedSignalSourceChain(requestedChainId);
  if (
    chainValue !== undefined &&
    !hasValidRequestedChain
  ) {
    return { error: `Unsupported alert source chain: ${chainValue}` };
  }
  if (scopeChainId !== undefined && requestedChainId !== undefined && scopeChainId !== requestedChainId) {
    return { error: "scope and chainId select different source chains" };
  }
  return { chainId: requestedChainId ?? scopeChainId ?? PRIMARY_SIGNAL_CHAIN_ID };
}

export function createAlertRoutes(
  alertRepo: PublicAlertRepository,
  signalRepo?: DeskSignalRepository,
): RouterType {
  const router: RouterType = Router();

  /**
   * GET /alerts
   *
   * List public alerts with newest-first ordering (page-based).
   *
   * Query parameters:
   *   page  - Page number (1-based, default 1)
   *   limit - Page size (1-100, default 20)
   *
   * Responses:
   *   200 - { items: PublicAlert[], pagination: PaginationMeta }
   */
  router.get("/alerts", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const scope = chainScope(req);
      if ("error" in scope) {
        res.status(400).json({ error: scope.error });
        return;
      }

      const result = await alertRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
        chainId: scope.chainId,
        ...(queryString(req.query.alertKind)
          ? { alertKind: queryString(req.query.alertKind) as "market_event" | "desk_trigger" }
          : {}),
        ...(queryString(req.query.signalStatus)
          ? {
              signalStatus: queryString(req.query.signalStatus) as
                | "not_eligible"
                | "pending"
                | "created"
                | "failed",
            }
          : {}),
        ...(queryString(req.query.eventType)
          ? { eventType: queryString(req.query.eventType) as PublicAlertRow["event_type"] & string }
          : {}),
        ...(queryString(req.query.policyVerdict)
          ? {
              policyVerdict: queryString(req.query.policyVerdict) as
                | "trade"
                | "defend"
                | "defer"
                | "ignore",
            }
          : {}),
        ...(queryString(req.query.actionStatus)
          ? {
              actionStatus: queryString(req.query.actionStatus) as
                | "not_created"
                | "pending"
                | "submitted"
                | "filled"
                | "failed"
                | "deferred"
                | "ignored",
            }
          : {}),
      });

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(fromDbPage(result.value, formatAlertResponse));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /alerts/:id
   *
   * Fetch a single public alert by id (content URI resolution target).
   */
  router.get("/alerts/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: "alert id is required" });
        return;
      }

      const result = await alertRepo.findById(id);

      if (!result.ok) {
        if (result.error.statusCode === 404) {
          next(notFound("Alert not found"));
          return;
        }
        res.status(500).json({ error: result.error.message });
        return;
      }

      const alert = result.value;
      const scope = hasExplicitChainScope(req.query)
        ? chainScope(req)
        : { chainId: alert.chain_id ?? PRIMARY_SIGNAL_CHAIN_ID };
      if ("error" in scope) {
        res.status(400).json({ error: scope.error });
        return;
      }
      if (
        (alert.chain_id ?? null) !== scope.chainId ||
        alert.delivery_status === "draft" ||
        alert.delivery_status === "queued"
      ) {
        next(notFound("Alert not found"));
        return;
      }

      let signal: DeskSignalRow | null = null;
      if (signalRepo && alert.desk_signal_id) {
        const signalResult = await signalRepo.findById(alert.desk_signal_id);
        if (signalResult.ok) signal = signalResult.value;
      }

      res.json(formatAlertResponse(alert, signal));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
