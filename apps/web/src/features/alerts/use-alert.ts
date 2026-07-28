// Fetch a single public alert by id (HTTPS content URI page)

import type { PublicAlertResponse } from "@chronicleai/schemas";
import { useCallback, useEffect, useState } from "react";

export type AlertDetailState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: string }
  | { status: "success"; data: PublicAlertResponse };

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
      const data: PublicAlertResponse = {
        id: String(raw.id),
        title: String(raw.title),
        summary: String(raw.summary),
        sourceReferences: Array.isArray(raw.sourceReferences)
          ? (raw.sourceReferences as string[])
          : [],
        deliveryStatus: String(raw.deliveryStatus) as PublicAlertResponse["deliveryStatus"],
        publishedAt: String(raw.publishedAt ?? ""),
        confidence: raw.confidence
          ? (String(raw.confidence) as PublicAlertResponse["confidence"])
          : undefined,
        generationProvider: raw.generationProvider
          ? String(raw.generationProvider)
          : undefined,
        registryTxHash: raw.registryTxHash ? String(raw.registryTxHash) : undefined,
        sourceEventHash: raw.sourceEventHash ? String(raw.sourceEventHash) : undefined,
        contentUri: raw.contentUri ? String(raw.contentUri) : undefined,
        explorerUrl: raw.explorerUrl ? String(raw.explorerUrl) : undefined,
      };

      setState({ status: "success", data });
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
