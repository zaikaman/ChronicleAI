// Alert list hook — React Query (dedupe, cache, abort)

import type { PaginationMeta, PublicAlertResponse } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiGetJson, toErrorMessage } from "../../lib/api.ts";
import { EMPTY_PAGINATION, normalizePaginationMeta } from "../../lib/pagination.ts";
import { queryKeys } from "../../lib/query-keys.ts";

export interface AlertsState {
  alerts: PublicAlertResponse[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

function mapAlert(raw: Record<string, unknown>): PublicAlertResponse {
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

  return alert;
}

const DEFAULT_LIMIT = 20;

interface AlertsPageResult {
  alerts: PublicAlertResponse[];
  pagination: PaginationMeta;
}

async function fetchAlertsPage(
  page: number,
  limit: number,
  chainId?: string,
  signal?: AbortSignal,
): Promise<AlertsPageResult> {
  const data = await apiGetJson<{
    items: Array<Record<string, unknown>>;
    pagination?: unknown;
  }>("/alerts", { signal, params: { page, limit, ...(chainId ? { chainId } : {}) } });

  const items = (data.items ?? []).map(mapAlert);
  return {
    alerts: items,
    pagination: normalizePaginationMeta(data.pagination, {
      page,
      limit,
      itemCount: items.length,
    }),
  };
}

export function useAlerts(limit = DEFAULT_LIMIT, chainId?: string): AlertsState {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.alerts.list(page, limit, chainId),
    queryFn: ({ signal }) => fetchAlertsPage(page, limit, chainId, signal),
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
