// Page-based hooks for long activity trails — React Query
// Supports `enabled` for progressive panel load (P1-3).

import type { PaginationMeta } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiGetJson, toErrorMessage } from "../../lib/api.ts";
import { EMPTY_PAGINATION, normalizePaginationMeta } from "../../lib/pagination.ts";
import { queryKeys } from "../../lib/query-keys.ts";

export interface ExecutionLogItem {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  message: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
  routing?: string;
  routingLabel?: string;
  routingApplied?: string;
  routingRequested?: string;
  routingStrict?: boolean;
  routingProvider?: string;
  protectStatusUrl?: string;
}

export interface PaymentItem {
  id: string;
  premiumItemId: string;
  paymentRoute: string;
  status: string;
  settlementReference?: string;
  amountRequested?: number;
  amountSettled?: number;
  currency?: string;
  referralAddress?: string;
  requestedAt?: string;
  settledAt?: string;
}

export interface PayoutItem {
  id: string;
  payoutPeriodHash: string;
  recipient: string;
  amount: number;
  reasonHash: string;
  payoutTxHash?: string;
  registryTxHash?: string;
  keeperHubRunId?: string;
  explorerUrl?: string;
  transferKeeperHubRunId?: string;
  transferExplorerUrl?: string;
  status: string;
  createdAt: string;
  routing?: string;
  routingLabel?: string;
  routingRequested?: string;
  routingApplied?: string;
}

export interface PaginatedListState<T> {
  items: T[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface ProgressiveListOptions {
  /** When false, query stays idle (progressive panel load). Default true. */
  enabled?: boolean;
}

async function fetchPage<T>(
  path: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
  extraParams?: Record<string, string | number | boolean | undefined | null>,
): Promise<{ items: T[]; pagination: PaginationMeta }> {
  const data = await apiGetJson<{ items?: T[]; pagination?: unknown }>(path, {
    signal,
    params: { page, limit, ...extraParams },
  });
  const items = data.items ?? [];
  return {
    items,
    pagination: normalizePaginationMeta(data.pagination, {
      page,
      limit,
      itemCount: items.length,
    }),
  };
}

function usePaginatedList<T>(
  path: string,
  limit: number,
  /** Stable key prefix — page is appended live; do not embed page in prefix. */
  queryKeyPrefix: readonly unknown[],
  options: ProgressiveListOptions = {},
  extraParams?: Record<string, string | number | boolean | undefined | null>,
): PaginatedListState<T> {
  const { enabled = true } = options;
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...queryKeyPrefix, page, limit, extraParams ?? null] as const,
    queryFn: ({ signal }) => fetchPage<T>(path, page, limit, signal, extraParams),
    placeholderData: (previous) => previous,
    enabled,
  });

  const handleSetPage = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  return {
    items: query.data?.items ?? [],
    pagination: query.data?.pagination ?? { ...EMPTY_PAGINATION, limit },
    page,
    setPage: handleSetPage,
    isLoading: enabled && (query.isLoading || (query.isFetching && !query.data)),
    error: query.error ? toErrorMessage(query.error, "Failed to load list") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

export interface ExecutionLogsFilterOptions extends ProgressiveListOptions {
  /** Filter logs by entity_id (desk intent UUID). Phase 4 deep link. */
  entityId?: string | null;
  entityType?: string | null;
}

export function useExecutionLogs(
  limit = 25,
  options: ExecutionLogsFilterOptions = {},
): PaginatedListState<ExecutionLogItem> {
  const { entityId, entityType, ...listOptions } = options;
  const entityIdTrimmed =
    typeof entityId === "string" && entityId.trim().length > 0 ? entityId.trim() : null;
  const entityTypeTrimmed =
    typeof entityType === "string" && entityType.trim().length > 0
      ? entityType.trim()
      : null;
  const extraParams: Record<string, string | undefined> = {};
  if (entityIdTrimmed) extraParams.entityId = entityIdTrimmed;
  if (entityTypeTrimmed) extraParams.entityType = entityTypeTrimmed;

  return usePaginatedList<ExecutionLogItem>(
    "/activity/execution-logs",
    limit,
    [
      "activity",
      "execution-logs",
      entityIdTrimmed,
      entityTypeTrimmed,
    ] as const,
    listOptions,
    Object.keys(extraParams).length > 0 ? extraParams : undefined,
  );
}

export function useActivityPayments(
  limit = 20,
  options: ProgressiveListOptions = {},
): PaginatedListState<PaymentItem> {
  return usePaginatedList<PaymentItem>(
    "/activity/payments",
    limit,
    ["activity", "payments"] as const,
    options,
  );
}

export function useActivityPayouts(
  limit = 15,
  options: ProgressiveListOptions = {},
): PaginatedListState<PayoutItem> {
  return usePaginatedList<PayoutItem>(
    "/activity/payouts",
    limit,
    ["activity", "payouts"] as const,
    options,
  );
}
