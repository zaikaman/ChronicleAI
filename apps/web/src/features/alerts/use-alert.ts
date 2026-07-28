// Fetch a single public alert by id (HTTPS content URI page)

import type { PublicAlertResponse } from "@chronicleai/schemas";
import { useCallback, useEffect, useState } from "react";

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
  if (typeof raw.contentUri === "string") alert.contentUri = raw.contentUri;
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
  const [state, setState] = useState<AlertDetailState>({ status: "loading" });

  const fetchAlert = useCallback(async () => {
    if (!alertId) {
      setState({ status: "not-found" });
      return;
    }

    setState({ status: "loading" });

    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
      const response = await fetch(`${baseUrl}/alerts/${encodeURIComponent(alertId)}`);

      if (response.status === 404) {
        setState({ status: "not-found" });
        return;
      }

      if (!response.ok) {
        setState({ status: "error", error: `Failed to fetch alert (${response.status})` });
        return;
      }

      const raw = (await response.json()) as Record<string, unknown>;
      setState({ status: "success", data: mapAlert(raw) });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error fetching alert",
      });
    }
  }, [alertId]);

  useEffect(() => {
    void fetchAlert();
  }, [fetchAlert]);

  return { state, refetch: fetchAlert };
}
