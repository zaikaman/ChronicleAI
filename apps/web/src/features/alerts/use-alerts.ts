// Alert list hook — React Query (dedupe, cache, abort)

import type { PaginationMeta, PublicAlertResponse } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { apiGetJson, toErrorMessage } from "../../lib/api.ts";
import { EMPTY_PAGINATION, normalizePaginationMeta } from "../../lib/pagination.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { isAlertVisibleInPublicUi } from "./alert-visibility.ts";

/** Product feed scope for the unified Alerts page. */
export type AlertsFeedScope = "all" | "market" | "desk";

export interface AlertsQueryFilters {
  scope?: AlertsFeedScope;
  eventType?: string;
  alertKind?: string;
  signalStatus?: string;
  chainId?: string;
}

export interface AlertsState {
  alerts: PublicAlertResponse[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function mapAlert(raw: Record<string, unknown>): PublicAlertResponse {
  const alert: PublicAlertResponse = {
    id: String(raw.id),
    title: String(raw.title),
    summary: String(raw.summary),
    sourceReferences: Array.isArray(raw.sourceReferences) ? (raw.sourceReferences as string[]) : [],
    deliveryStatus: String(raw.deliveryStatus) as PublicAlertResponse["deliveryStatus"],
    publishedAt: String(raw.publishedAt ?? ""),
  };

  if (typeof raw.confidence === "string") {
    alert.confidence = raw.confidence as NonNullable<PublicAlertResponse["confidence"]>;
  }
  if (typeof raw.generationProvider === "string") {
    alert.generationProvider = raw.generationProvider;
  }
  if (typeof raw.registryTxHash === "string") alert.registryTxHash = raw.registryTxHash;
  if (typeof raw.sourceEventHash === "string") alert.sourceEventHash = raw.sourceEventHash;
  if (typeof raw.contentHash === "string") alert.contentHash = raw.contentHash;
  if (typeof raw.contentUri === "string") alert.contentUri = raw.contentUri;
  if (typeof raw.gasUsed === "string") alert.gasUsed = raw.gasUsed;
  if (typeof raw.gasUsedWei === "string") alert.gasUsedWei = raw.gasUsedWei;
  if (typeof raw.explorerUrl === "string") alert.explorerUrl = raw.explorerUrl;
  if (typeof raw.keeperHubRunId === "string") alert.keeperHubRunId = raw.keeperHubRunId;
  if (typeof raw.eventType === "string") {
    alert.eventType = raw.eventType as NonNullable<PublicAlertResponse["eventType"]>;
  }
  if (typeof raw.chainId === "number") alert.chainId = raw.chainId;
  if (typeof raw.protocol === "string") alert.protocol = raw.protocol;
  if (raw.alertKind === "market_event" || raw.alertKind === "desk_trigger") {
    alert.alertKind = raw.alertKind;
  }
  if (typeof raw.publicationChainId === "number") {
    alert.publicationChainId = raw.publicationChainId;
  }
  if (typeof raw.sourceDedupeKey === "string") alert.sourceDedupeKey = raw.sourceDedupeKey;
  if (typeof raw.sourceTriggerLabel === "string") {
    alert.sourceTriggerLabel = raw.sourceTriggerLabel;
  }
  if (typeof raw.signalType === "string")
    alert.signalType = raw.signalType as NonNullable<PublicAlertResponse["signalType"]>;
  if (["not_eligible", "pending", "created", "failed"].includes(String(raw.signalStatus))) {
    alert.signalStatus = raw.signalStatus as NonNullable<PublicAlertResponse["signalStatus"]>;
  }
  if (["trade", "defend", "defer", "ignore"].includes(String(raw.policyVerdict))) {
    alert.policyVerdict = raw.policyVerdict as NonNullable<PublicAlertResponse["policyVerdict"]>;
  }
  if (
    ["not_created", "pending", "submitted", "filled", "failed", "deferred", "ignored"].includes(
      String(raw.actionStatus),
    )
  ) {
    alert.actionStatus = raw.actionStatus as NonNullable<PublicAlertResponse["actionStatus"]>;
  }
  if (typeof raw.intentId === "string") alert.intentId = raw.intentId;
  if (typeof raw.ticketId === "string") alert.ticketId = raw.ticketId;
  if (typeof raw.transactionHash === "string") alert.transactionHash = raw.transactionHash;
  if (typeof raw.actionTransactionHash === "string")
    alert.actionTransactionHash = raw.actionTransactionHash;
  if (typeof raw.actionKeeperHubRunId === "string")
    alert.actionKeeperHubRunId = raw.actionKeeperHubRunId;
  if (typeof raw.actionExplorerUrl === "string") alert.actionExplorerUrl = raw.actionExplorerUrl;
  if (raw.deterministicEvidence && typeof raw.deterministicEvidence === "object") {
    alert.deterministicEvidence = raw.deterministicEvidence as Record<string, unknown>;
  }
  if (raw.causalChain && typeof raw.causalChain === "object") {
    alert.causalChain = raw.causalChain as NonNullable<PublicAlertResponse["causalChain"]>;
  }
  if (raw.flowContext && typeof raw.flowContext === "object") {
    alert.flowContext = raw.flowContext as NonNullable<PublicAlertResponse["flowContext"]>;
  }

  return alert;
}

const DEFAULT_LIMIT = 20;

interface AlertsPageResult {
  alerts: PublicAlertResponse[];
  pagination: PaginationMeta;
}

function buildAlertParams(
  page: number,
  limit: number,
  filters?: AlertsQueryFilters,
): Record<string, string | number> {
  const params: Record<string, string | number> = { page, limit };
  if (filters?.scope) params.scope = filters.scope;
  if (filters?.eventType) params.eventType = filters.eventType;
  if (filters?.alertKind) params.alertKind = filters.alertKind;
  if (filters?.signalStatus) params.signalStatus = filters.signalStatus;
  if (filters?.chainId) params.chainId = filters.chainId;
  return params;
}

async function fetchAlertsPage(
  page: number,
  limit: number,
  filters?: AlertsQueryFilters,
  signal?: AbortSignal,
): Promise<AlertsPageResult> {
  const data = await apiGetJson<{
    items: Array<Record<string, unknown>>;
    pagination?: unknown;
  }>("/alerts", { signal, params: buildAlertParams(page, limit, filters) });

  const items = (data.items ?? []).map(mapAlert).filter(isAlertVisibleInPublicUi);
  return {
    alerts: items,
    pagination: normalizePaginationMeta(data.pagination, {
      page,
      limit,
      itemCount: items.length,
    }),
  };
}

/**
 * @param limit Page size
 * @param filtersOrChainId Either full query filters, or a legacy chainId string
 *   for callers that only pass chain (home preview / publications).
 */
export function useAlerts(
  limit = DEFAULT_LIMIT,
  filtersOrChainId?: AlertsQueryFilters | string,
): AlertsState {
  const filters: AlertsQueryFilters | undefined =
    typeof filtersOrChainId === "string"
      ? { chainId: filtersOrChainId }
      : filtersOrChainId;

  const [page, setPage] = useState(1);

  // Reset to page 1 when server-side filters change.
  const filterKey = JSON.stringify({
    scope: filters?.scope ?? null,
    eventType: filters?.eventType ?? null,
    alertKind: filters?.alertKind ?? null,
    signalStatus: filters?.signalStatus ?? null,
    chainId: filters?.chainId ?? null,
  });
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const query = useQuery({
    queryKey: queryKeys.alerts.list(page, limit, filterKey),
    queryFn: ({ signal }) => fetchAlertsPage(page, limit, filters, signal),
    placeholderData: (previous) => previous,
  });

  const handleSetPage = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  return {
    alerts: query.data?.alerts ?? [],
    pagination: query.data?.pagination ?? { ...EMPTY_PAGINATION, limit },
    page,
    setPage: handleSetPage,
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error ? toErrorMessage(query.error, "Failed to load alerts") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
