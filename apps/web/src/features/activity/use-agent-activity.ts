// Public agent activity data (GET /activity — no auth)

import { useCallback, useEffect, useState } from "react";

export interface AgentActivityData {
  alerts: Array<{
    id: string;
    title: string;
    summary: string;
    sourceReferences: string[];
    deliveryStatus: string;
    publishedAt: string;
    confidence?: string;
    generationProvider?: string;
  }>;
  digests: Array<{
    id: string;
    reportDate: string;
    title: string;
    summary: string;
    highlights: string[];
    analysis?: string;
    publicationStatus: string;
    publishedAt?: string;
    registryTxHash?: string;
  }>;
  payments: Array<{
    id: string;
    premiumItemId: string;
    paymentRoute: string;
    status: string;
    settlementReference?: string;
  }>;
  treasury: {
    availableBalance: number;
    safetyBuffer: number;
    status: string;
  };
  executionLogs: Array<{
    id: string;
    actionType: string;
    entityType: string | null;
    entityId: string | null;
    status: string;
    message: string | null;
    createdAt: string;
  }>;
  payouts?: Array<{
    id: string;
    payoutPeriodHash: string;
    recipient: string;
    amount: number;
    reasonHash: string;
    payoutTxHash?: string;
    registryTxHash?: string;
    status: string;
    createdAt: string;
  }>;
}

export interface AgentActivityState {
  data: AgentActivityData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export function useAgentActivity(): AgentActivityState {
  const [data, setData] = useState<AgentActivityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/activity`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch agent activity: ${response.statusText}`);
      }

      const activityData = (await response.json()) as AgentActivityData;
      setData(activityData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent activity");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return { data, isLoading, error, refetch: fetchActivity };
}
