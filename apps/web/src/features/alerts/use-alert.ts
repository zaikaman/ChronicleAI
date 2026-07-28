// Single alert by id — React Query (dedupe, cache, abort)

import type { PublicAlertResponse } from "@chronicleai/schemas";
import { useQuery } from "@tanstack/react-query";
import { apiGetJson, isNotFoundError, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";

export type AlertDetailState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: string }
  | { status: "success"; data: PublicAlertResponse };

function mapAlert(raw: Record<string, unknown>): PublicAlertResponse {
  const alert: PublicAlertResponse = {
    id: String(raw.id),
    title: String(raw.title),
    summary: String(raw.summary),
    sourceReferences: Array.isArray(raw.sourceReferences)
      ? (raw.sourceReferences as string[])
      : [],
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

  return alert;
}

export function useAlert(alertId: string | undefined): {
  state: AlertDetailState;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: queryKeys.alerts.detail(alertId ?? ""),
    enabled: Boolean(alertId),
    queryFn: async ({ signal }) => {
      const raw = await apiGetJson<Record<string, unknown>>(
        `/alerts/${encodeURIComponent(alertId!)}`,
        { signal },
      );
      return mapAlert(raw);
    },
    retry: (failureCount, error) => {
      if (isNotFoundError(error)) return false;
      return failureCount < 1;
    },
  });

  let state: AlertDetailState;
  if (!alertId) {
    state = { status: "not-found" };
  } else if (query.isLoading || query.isPending) {
    state = { status: "loading" };
  } else if (query.error) {
    state = isNotFoundError(query.error)
      ? { status: "not-found" }
      : { status: "error", error: toErrorMessage(query.error, "Failed to fetch alert") };
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
