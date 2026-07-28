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
): Promise<{ items: T[]; pagination: PaginationMeta }> {
  const data = await apiGetJson<{ items?: T[]; pagination?: unknown }>(path, {
    signal,
    params: { page, limit },
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
  queryKey: readonly unknown[],
  options: ProgressiveListOptions = {},
): PaginatedListState<T> {
  const { enabled = true } = options;
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...queryKey.slice(0, -2), page, limit] as const,
    queryFn: ({ signal }) => fetchPage<T>(path, page, limit, signal),
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

export function useExecutionLogs(
  limit = 25,
  options: ProgressiveListOptions = {},
): PaginatedListState<ExecutionLogItem> {
  return usePaginatedList<ExecutionLogItem>(
    "/activity/execution-logs",
    limit,
    queryKeys.activity.executionLogs(1, limit),
    options,
  );
}

export function useActivityPayments(
  limit = 20,
  options: ProgressiveListOptions = {},
): PaginatedListState<PaymentItem> {
  return usePaginatedList<PaymentItem>(
    "/activity/payments",
    limit,
    queryKeys.activity.payments(1, limit),
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
    queryKeys.activity.payouts(1, limit),
    options,
  );
}
