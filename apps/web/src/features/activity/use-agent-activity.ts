// Public agent activity data (GET /activity) — React Query

import { useQuery } from "@tanstack/react-query";
import { apiGetJson, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import type { ReferralAttributionData } from "./ReferralAttributionPanel.tsx";
import type { SubscriptionAnalyticsData } from "./SubscriptionAnalyticsPanel.tsx";

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
    registryTxHash?: string;
    sourceEventHash?: string;
    contentHash?: string;
    contentUri?: string;
    gasUsed?: string;
    gasUsedWei?: string;
    keeperHubRunId?: string;
    explorerUrl?: string;
    eventType?: string;
    chainId?: number;
    protocol?: string;
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
    sourceEventRoot?: string;
    contentHash?: string;
    contentUri?: string;
    gasUsed?: string;
    gasUsedWei?: string;
    keeperHubRunId?: string;
    explorerUrl?: string;
  }>;
  payments: Array<{
    id: string;
    premiumItemId: string;
    paymentRoute: string;
    status: string;
    failureReason?: string;
    settlementReference?: string;
    amountRequested?: number;
    amountSettled?: number;
    currency?: string;
    referralAddress?: string;
    requestedAt?: string;
    settledAt?: string;
    registryTxHash?: string;
    keeperHubRunId?: string;
    explorerUrl?: string;
    contentUri?: string;
  }>;
  treasury: {
    availableBalance: number;
    safetyBuffer: number;
    /** Unit of availableBalance / safetyBuffer — ETH for gas health. */
    currency: string;
    status: string;
    /** Live (or snapshot) gas balance in ETH. */
    ethBalance?: number;
    /** Live USDC revenue float when on-chain read succeeds (Sepolia pocket). */
    usdcBalance?: number;
    walletAddress?: string;
    baseUsdcBalance?: number;
    sepoliaUsdcBalance?: number;
    baseEthBalance?: number;
    sepoliaEthBalance?: number;
    inFlightCctpUsdc?: number;
    deployableToDeskUsdc?: number;
    usdcOperatingReserve?: number;
    cctpEnabled?: boolean;
    capitalPlaneNote?: string;
    estimatedGenerationCost?: number | null;
    estimatedTransactionCost?: number | null;
    paidRequestCount?: number | null;
    revenueTotal?: number | null;
    capturedAt?: string;
  };
  cctpRebalances?: Array<{
    id: string;
    status: string;
    amountUsdc: number;
    mode: string;
    burnTxHash?: string | null;
    mintTxHash?: string | null;
    burnExplorerUrl?: string | null;
    mintExplorerUrl?: string | null;
    errorMessage?: string | null;
    burnedAt?: string | null;
    mintedAt?: string | null;
    createdAt: string;
    durationMs?: number | null;
  }>;
  activeSponsoredWatches?: Array<{
    id: string;
    targetContract: string;
    watchSpecHash?: string;
    startsAt: string;
    endsAt: string;
    status: string;
    createTxHash?: string;
    reportTxHash?: string;
    createExplorerUrl?: string;
    reportExplorerUrl?: string;
    sourceEventRoot?: string;
    monitoredEventCount?: number;
    onChainWatchId?: number;
    auditTrail?: {
      createTxHash?: string | null;
      reportTxHash?: string | null;
      createExplorerUrl?: string | null;
      reportExplorerUrl?: string | null;
      sourceEventRoot?: string | null;
    };
  }>;
  executionLogs: Array<{
    id: string;
    actionType: string;
    entityType: string | null;
    entityId: string | null;
    status: string;
    message: string | null;
    details?: Record<string, unknown> | null;
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
    keeperHubRunId?: string;
    explorerUrl?: string;
    transferKeeperHubRunId?: string;
    transferExplorerUrl?: string;
    status: string;
    createdAt: string;
  }>;
  subscriptionAnalytics?: SubscriptionAnalyticsData;
  referralAttribution?: ReferralAttributionData;
}

export interface AgentActivityState {
  data: AgentActivityData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAgentActivity(): AgentActivityState {
  const query = useQuery({
    queryKey: queryKeys.activity.summary,
    queryFn: ({ signal }) => apiGetJson<AgentActivityData>("/activity", { signal }),
    staleTime: 15_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading || (query.isFetching && !query.data),
    error: query.error ? toErrorMessage(query.error, "Failed to load agent activity") : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
