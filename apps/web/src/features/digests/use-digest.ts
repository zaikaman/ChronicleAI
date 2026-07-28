// Single digest by id — React Query

import { useQuery } from "@tanstack/react-query";
import { apiGetJson, isNotFoundError, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { mapDigestResponse, type DigestState } from "./use-latest-digest.ts";

export function useDigest(digestId: string | undefined): {
  state: DigestState;
  refetch: () => void;
} {
  const isLatest = digestId === "latest";
  const queryKey = isLatest
    ? queryKeys.digests.latest
    : queryKeys.digests.detail(digestId ?? "");

  const query = useQuery({
    queryKey,
    enabled: Boolean(digestId),
    queryFn: async ({ signal }) => {
      const path =
        digestId === "latest"
          ? "/digests/latest"
          : `/digests/${encodeURIComponent(digestId!)}`;
      const raw = await apiGetJson<Record<string, unknown>>(path, { signal });
      return mapDigestResponse(raw);
    },
    retry: (failureCount, error) => {
      if (isNotFoundError(error)) return false;
      return failureCount < 1;
    },
    staleTime: 30_000,
  });

  let state: DigestState;
  if (!digestId) {
    state = { status: "not-found" };
  } else if (query.isLoading || query.isPending) {
    state = { status: "loading" };
  } else if (query.error) {
    state = isNotFoundError(query.error)
      ? { status: "not-found" }
      : {
          status: "error",
          error: toErrorMessage(query.error, "Unknown error fetching digest"),
        };
  } else if (query.data) {
    state = { status: "success", data: query.data };
  } else {
    state = { status: "loading" };
  }

  return {
    state,
    refetch: () => {
      void query.refetch();
    },
  };
}
