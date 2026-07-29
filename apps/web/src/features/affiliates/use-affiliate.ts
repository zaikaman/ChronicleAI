// Affiliate dashboard + agent client — React Query for stats; chat stays imperative.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiGetJson, apiPostJson, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";

export interface AffiliateStats {
  affiliate: {
    walletAddress: string;
    displayName: string | null;
    referralCode: string | null;
    status: string;
    referralLinkPath: string;
  };
  referredCount: number;
  totalEarnedUsdc: number;
  totalWithdrawnUsdc: number;
  reservedUsdc: number;
  availableUsdc: number;
  currency: string;
  recentReferrals: Array<{
    referredWallet: string;
    referralCode: string | null;
    source: string;
    attributedAt: string;
  }>;
  recentEarnings: Array<{
    id: string;
    referredWallet: string;
    paymentAmount: number;
    rewardAmount: number;
    currency: string;
    createdAt: string;
  }>;
  recentWithdrawals: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    payoutTxHash: string | null;
    explorerUrl: string | null;
    createdAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  }>;
}

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

const WELCOME =
  "Hi — I'm the ChronicleAI affiliate payout agent (LLM + tools). I can reason about your request, call tools for live balances, and execute USDC withdrawals on-chain through KeeperHub. Ask naturally — e.g. \"how am I doing?\" or \"cash out everything\".";

export function useAffiliateDashboard(walletAddress: string | null | undefined) {
  const queryClient = useQueryClient();
  const address = walletAddress?.trim().toLowerCase() || null;

  const query = useQuery({
    queryKey: queryKeys.affiliates.me(address ?? ""),
    enabled: Boolean(address),
    queryFn: ({ signal }) =>
      apiGetJson<AffiliateStats>("/affiliates/me", {
        signal,
        params: { wallet: address! },
      }),
    staleTime: 15_000,
  });

  const refresh = useCallback(
    async (wallet?: string | null) => {
      const target = (wallet ?? walletAddress)?.trim().toLowerCase();
      if (!target) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.affiliates.me(target) });
    },
    [queryClient, walletAddress],
  );

  const setStats = useCallback(
    (stats: AffiliateStats | null) => {
      if (!address) return;
      queryClient.setQueryData(queryKeys.affiliates.me(address), stats);
    },
    [queryClient, address],
  );

  return {
    stats: address ? (query.data ?? null) : null,
    isLoading: Boolean(address) && (query.isLoading || (query.isFetching && !query.data)),
    error: query.error ? toErrorMessage(query.error, "Failed to load dashboard") : null,
    refresh,
    setStats,
  };
}

export function useAffiliateAgent(walletAddress: string | null | undefined) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    { role: "assistant", content: WELCOME },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string, onStats?: (stats: AffiliateStats | null) => void) => {
      const address = walletAddress?.trim().toLowerCase();
      if (!address) {
        setError("Connect your wallet to chat with the agent.");
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;

      setError(null);
      setIsSending(true);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

      try {
        const jobBody = await apiPostJson<{
          jobId?: string;
          status?: "pending" | "processing" | "completed" | "failed";
          reply?: string;
          error?: string;
          stats?: AffiliateStats | null;
          toolCalls?: Array<{ name: string }>;
          mode?: "llm" | "fallback";
          provider?: string | null;
        }>("/affiliates/agent/chat", {
          walletAddress: address,
          message: trimmed,
        });

        let finalResult = jobBody;

        if (jobBody.jobId && jobBody.status !== "completed" && jobBody.status !== "failed") {
          const jobId = jobBody.jobId;
          const pollInterval = 1500;
          const maxPolls = 200; // 5 minutes max

          for (let attempt = 0; attempt < maxPolls; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));

            const pollRes = await apiGetJson<{
              jobId: string;
              status: "pending" | "processing" | "completed" | "failed";
              reply?: string;
              error?: string;
              stats?: AffiliateStats | null;
              toolCalls?: Array<{ name: string }>;
              mode?: "llm" | "fallback";
              provider?: string | null;
            }>(`/affiliates/agent/chat/jobs/${encodeURIComponent(jobId)}`);

            if (pollRes.status === "completed") {
              finalResult = pollRes;
              break;
            }

            if (pollRes.status === "failed") {
              throw new Error(pollRes.error ?? "Background job failed");
            }
          }
        }

        const reply = finalResult.reply ?? "No reply from agent.";
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        if (onStats && finalResult.stats !== undefined) {
          onStats(finalResult.stats);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent request failed";
        setError(msg);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `I couldn't complete that: ${msg}`,
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [walletAddress],
  );

  const resetChat = useCallback(() => {
    setMessages([{ role: "assistant", content: WELCOME }]);
    setError(null);
  }, []);

  return { messages, send, isSending, error, resetChat };
}
