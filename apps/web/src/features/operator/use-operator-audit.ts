// Operator audit data fetching hook

import { useCallback, useEffect, useState } from "react";

export interface OperatorAuditData {
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
}

export interface OperatorAuditState {
  data: OperatorAuditData | null;
  isLoading: boolean;
  error: string | null;
  isUnauthenticated: boolean;
  refetch: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const OPERATOR_TOKEN = import.meta.env.VITE_OPERATOR_TOKEN ?? "";

export function useOperatorAudit(): OperatorAuditState {
  const [data, setData] = useState<OperatorAuditData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthenticated, setIsUnauthenticated] = useState(false);

  const fetchAudit = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setIsUnauthenticated(false);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (OPERATOR_TOKEN) {
        headers["Authorization"] = `Bearer ${OPERATOR_TOKEN}`;
      }

      const response = await fetch(`${API_BASE}/operator/audit`, { headers });

      if (response.status === 401) {
        setIsUnauthenticated(true);
        setError("Authentication required. Please provide a valid operator token.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch audit data: ${response.statusText}`);
      }

      const auditData = (await response.json()) as OperatorAuditData;
      setData(auditData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operator audit");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  return { data, isLoading, error, isUnauthenticated, refetch: fetchAudit };
}
