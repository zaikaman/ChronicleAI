// Public alerts routes: GET /alerts, GET /alerts/:id
// Returns newest-first public alerts with page-based pagination, plus by-id lookup
// for HTTPS on-chain content URIs.
//
// Unified feed scopes:
//   scope=all    — Mainnet market_event + Sepolia desk_trigger
//   scope=market — market_event Alerts
//   scope=desk   — desk_trigger Alerts
// Legacy chain scopes (mainnet/sepolia) remain for explicit chain filters.

import {
  ACTIVE_INTELLIGENCE_CHAIN_ID,
  PRIMARY_SIGNAL_CHAIN_ID,
  isAllowedSignalSourceChain,
} from "@chronicleai/config";
import type {
  DeskSignalRepository,
  DeskSignalRow,
  PublicAlertFeedScope,
  PublicAlertRepository,
  PublicAlertRow,
} from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { notFound } from "../errors.ts";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";
import { sourceTriggerLabelFromAlert } from "../services/desk-trigger-alert-service.ts";

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

function hasCausalSignal(alert: PublicAlertRow, signal?: DeskSignalRow | null): boolean {
  if (signal) return true;
  if (alert.desk_signal_id) return true;
  // Direct capital decisions use capital_tick with signal_status not_eligible.
  if (alert.signal_status === "not_eligible" && !alert.desk_signal_id) return false;
  if (alert.signal_type === "capital_tick" && alert.signal_status === "not_eligible") {
    return false;
  }
  return Boolean(alert.signal_type && alert.signal_status === "created");
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
  const includeSignal = hasCausalSignal(alert, signal);
  const sourceTriggerLabel = sourceTriggerLabelFromAlert(alert);

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
    ...(sourceTriggerLabel ? { sourceTriggerLabel } : {}),
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
      ...(includeSignal && signal ? { signal: formatSignalResponse(signal) } : {}),
      ...(includeSignal && !signal && signalType
        ? {
            signal: {
              id: alert.desk_signal_id ?? alert.id,
              signalType,
              origin: "desk_read" as const,
              chainId: chainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID,
              policyVerdict: policyVerdict ?? "ignore",
              severity: 0,
              features: {},
              sources: {},
              dedupeKey: alert.source_dedupe_key ?? alert.dedupe_key ?? alert.id,
              createdAt: alert.created_at,
            },
          }
        : {}),
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

type AlertListScope =
  | { feedScope: PublicAlertFeedScope }
  | { chainId: number }
  | { error: string };

/**
 * Resolve list scope from query.
 * Product scopes: all | market | desk
 * Legacy chain scopes: mainnet | sepolia | active | legacy | primary | testnet
 */
function resolveListScope(req: { query: Record<string, unknown> }): AlertListScope {
  const scope = queryString(req.query.scope)?.toLowerCase();
  const chainValue = queryString(req.query.chainId);

  if (scope === "all" || scope === "market" || scope === "desk") {
    if (chainValue !== undefined) {
      const requestedChainId = Number(chainValue);
      if (
        !Number.isInteger(requestedChainId) ||
        !isAllowedSignalSourceChain(requestedChainId)
      ) {
        return { error: `Unsupported alert source chain: ${chainValue}` };
      }
      // Product scope + optional chain narrow: pass both via feedScope + chainId
      // by returning feedScope; chain filter applied in list handler via chainId param.
      return { feedScope: scope };
    }
    return { feedScope: scope };
  }

  const scopeChainId =
    scope === undefined
      ? undefined
      : scope === "legacy" || scope === "mainnet" || scope === "primary"
        ? PRIMARY_SIGNAL_CHAIN_ID
        : scope === "sepolia" || scope === "active" || scope === "testnet"
          ? ACTIVE_INTELLIGENCE_CHAIN_ID
          : undefined;

  if (scope !== undefined && scopeChainId === undefined) {
    return { error: "scope must be all, market, desk, mainnet, or sepolia" };
  }

  const requestedChainId = chainValue === undefined ? undefined : Number(chainValue);
  const hasValidRequestedChain =
    requestedChainId !== undefined &&
    Number.isInteger(requestedChainId) &&
    isAllowedSignalSourceChain(requestedChainId);

  if (chainValue !== undefined && !hasValidRequestedChain) {
    return { error: `Unsupported alert source chain: ${chainValue}` };
  }

  if (
    scopeChainId !== undefined &&
    requestedChainId !== undefined &&
    scopeChainId !== requestedChainId
  ) {
    return { error: "scope and chainId select different source chains" };
  }

  // Default product feed is unified (mainnet market + sepolia desk) when no
  // explicit chain/scope is provided — matches the Alerts UI "All" default.
  if (scope === undefined && chainValue === undefined) {
    return { feedScope: "all" };
  }

  return { chainId: requestedChainId ?? scopeChainId ?? PRIMARY_SIGNAL_CHAIN_ID };
}

function resolveDetailScope(req: {
  query: Record<string, unknown>;
}): { chainId?: number; feedScope?: PublicAlertFeedScope } | { error: string } {
  if (!hasExplicitChainScope(req.query)) {
    return {};
  }
  return resolveListScope(req);
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
   *   page       - Page number (1-based, default 1)
   *   limit      - Page size (1-100, default 20)
   *   scope      - all | market | desk | mainnet | sepolia
   *   chainId    - Explicit source chain filter
   *   alertKind  - market_event | desk_trigger (server-side; pagination-accurate)
   *   signalStatus, eventType, policyVerdict, actionStatus
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

      const scope = resolveListScope(req);
      if ("error" in scope) {
        res.status(400).json({ error: scope.error });
        return;
      }

      const alertKindParam = queryString(req.query.alertKind);
      const chainValue = queryString(req.query.chainId);
      const ticketIdParam = queryString(req.query.ticketId);
      const intentIdParam = queryString(req.query.intentId);
      const requestedChainId =
        chainValue !== undefined && Number.isInteger(Number(chainValue))
          ? Number(chainValue)
          : undefined;

      if (ticketIdParam && alertRepo.findByTicketId) {
        const found = await alertRepo.findByTicketId(ticketIdParam);
        if (found) {
          let signal: DeskSignalRow | null = null;
          if (signalRepo && found.desk_signal_id) {
            const sigRes = await signalRepo.findById(found.desk_signal_id);
            if (sigRes.ok) signal = sigRes.value;
          }
          res.json({
            items: [formatAlertResponse(found, signal)],
            pagination: { page: 1, limit: 1, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
          });
          return;
        }
      }

      if (intentIdParam && alertRepo.findByIntentId) {
        const found = await alertRepo.findByIntentId(intentIdParam);
        if (found) {
          let signal: DeskSignalRow | null = null;
          if (signalRepo && found.desk_signal_id) {
            const sigRes = await signalRepo.findById(found.desk_signal_id);
            if (sigRes.ok) signal = sigRes.value;
          }
          res.json({
            items: [formatAlertResponse(found, signal)],
            pagination: { page: 1, limit: 1, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
          });
          return;
        }
      }

      const result = await alertRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
        ...("feedScope" in scope
          ? {
              feedScope: scope.feedScope,
              ...(requestedChainId !== undefined ? { chainId: requestedChainId } : {}),
            }
          : { chainId: scope.chainId }),
        // Server-side alertKind only when not already implied by feedScope.
        ...("feedScope" in scope && scope.feedScope !== "all"
          ? {}
          : alertKindParam
            ? { alertKind: alertKindParam as "market_event" | "desk_trigger" }
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

      // Optionally hydrate signals for list items that have desk_signal_id.
      const items = result.value.items;
      const signalById = new Map<string, DeskSignalRow>();
      if (signalRepo) {
        const ids = [
          ...new Set(
            items
              .map((a) => a.desk_signal_id)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          ),
        ];
        await Promise.all(
          ids.map(async (id) => {
            const found = await signalRepo.findById(id);
            if (found.ok && found.value) signalById.set(id, found.value);
          }),
        );
      }

      res.json(
        fromDbPage(
          {
            ...result.value,
            items: items.map((alert) => {
              const sig = alert.desk_signal_id
                ? (signalById.get(alert.desk_signal_id) ?? null)
                : null;
              return formatAlertResponse(alert, sig);
            }),
          },
          (item) => item,
        ),
      );
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
      const scope = resolveDetailScope(req);
      if ("error" in scope) {
        res.status(400).json({ error: scope.error });
        return;
      }

      if (alert.delivery_status === "draft" || alert.delivery_status === "queued") {
        next(notFound("Alert not found"));
        return;
      }

      // When an explicit chain/product scope is provided, enforce it.
      if ("feedScope" in scope && scope.feedScope) {
        const kind = alert.alert_kind ?? "market_event";
        const chain = alert.chain_id ?? null;
        if (scope.feedScope === "market" && kind !== "market_event") {
          next(notFound("Alert not found"));
          return;
        }
        if (scope.feedScope === "desk" && kind !== "desk_trigger") {
          next(notFound("Alert not found"));
          return;
        }
        if (scope.feedScope === "all") {
          const ok =
            (kind === "market_event" && chain === PRIMARY_SIGNAL_CHAIN_ID) ||
            (kind === "desk_trigger" && chain === ACTIVE_INTELLIGENCE_CHAIN_ID);
          if (!ok) {
            next(notFound("Alert not found"));
            return;
          }
        }
      } else if ("chainId" in scope && scope.chainId !== undefined) {
        if ((alert.chain_id ?? null) !== scope.chainId) {
          next(notFound("Alert not found"));
          return;
        }
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
