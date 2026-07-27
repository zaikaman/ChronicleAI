// Alert data fetching hook

import { useState, useEffect, useCallback } from "react";
import type { PublicAlertResponse } from "@chronicleai/schemas";

export interface AlertsState {
  alerts: PublicAlertResponse[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
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

      const data = (await response.json()) as { items: PublicAlertResponse[] };
      setAlerts(data.items ?? []);
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
