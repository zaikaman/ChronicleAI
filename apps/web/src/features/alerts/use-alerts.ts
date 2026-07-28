// Alert data fetching hook

import type { PublicAlertResponse } from "@chronicleai/schemas";
import { useCallback, useEffect, useState } from "react";

export interface AlertsState {
  alerts: PublicAlertResponse[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

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

export function useAlerts(limit = 50): AlertsState {
  const [alerts, setAlerts] = useState<PublicAlertResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
      const response = await fetch(`${baseUrl}/alerts?limit=${limit}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch alerts: ${response.statusText}`);
      }

      const data = (await response.json()) as { items: Array<Record<string, unknown>> };
      setAlerts((data.items ?? []).map(mapAlert));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  return { alerts, isLoading, error, refetch: fetchAlerts };
}
