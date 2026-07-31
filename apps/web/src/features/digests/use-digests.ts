// Paginated public digests list — React Query

import type { PaginationMeta } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiGetJson, toErrorMessage } from "../../lib/api.ts";
import { EMPTY_PAGINATION, normalizePaginationMeta } from "../../lib/pagination.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import {
  mapDigestResponse,
  type LatestDigestData,
} from "./use-latest-digest.ts";

export interface DigestsListState {
  digests: LatestDigestData[];
  pagination: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const DEFAULT_LIMIT = 20;

export function useDigests(limit = DEFAULT_LIMIT): DigestsListState {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.digests.list(page, limit),
    queryFn: async ({ signal }) => {
      const data = await apiGetJson<{
        items?: Array<Record<string, unknown>>;
        pagination?: unknown;
      }>("/digests", { signal, params: { page, limit } });
      const items = (data.items ?? []).map(mapDigestResponse);
      return {
        digests: items,
        pagination: normalizePaginationMeta(data.pagination, {
          page,
          limit,
          itemCount: items.length,
        }),
      };
    },
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  const handleSetPage = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  return {
    digests: query.data?.digests ?? [],
    pagination: query.data?.pagination ?? { ...EMPTY_PAGINATION, limit },
    page,
    setPage: handleSetPage,
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error ? toErrorMessage(query.error, "Failed to load digests") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
