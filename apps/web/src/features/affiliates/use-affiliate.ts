// Affiliate dashboard + agent client — React Query for stats; chat stays imperative.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiGetJson, apiPostJson, toErrorMessage } from "../../lib/api.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { keccak256, stringToBytes } from "viem";
import { useWallet } from "../wallet";

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

export function useAffiliateAgent(walletAddress: string | null | undefined, availableUsdc = 0) {
  const wallet = useWallet();
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
        const lower = trimmed.toLowerCase();
        const isWithdrawal = /\b(withdraw|claim|cash\s*out|pay\s*me|send\s+(me\s+)?(my\s+)?(money|usdc|funds|rewards?))\b/.test(lower);
        const amountMatch = lower.match(/(?:withdraw|claim|send|transfer|cash\s*out)\s*(?:me\s+)?(?:about\s+)?(\d+(?:\.\d+)?)\s*(?:usdc|usd)?/);
        const requestedAmount = amountMatch ? Number(amountMatch[1]) : availableUsdc;
        const nonce = keccak256(stringToBytes(`${address}:${Date.now()}:${Math.random()}`));
        const expiry = Math.floor(Date.now() / 1000) + 600;
        const withdrawalAuthorization = {
          wallet: address,
          amount: String(Math.round(requestedAmount * 1_000_000)),
          nonce,
          expiry,
          action: "withdraw_usdc",
          signature: isWithdrawal
            ? await wallet.signTypedData({
                domain: { name: "ChronicleAI Affiliate Withdrawal", version: "1", chainId: wallet.chainId ?? 84532 },
                types: { AffiliateWithdrawal: [
                  { name: "wallet", type: "address" },
                  { name: "amount", type: "uint256" },
                  { name: "nonce", type: "bytes32" },
                  { name: "expiry", type: "uint256" },
                  { name: "action", type: "string" },
                ] },
                primaryType: "AffiliateWithdrawal",
                message: { wallet: address, amount: BigInt(Math.round(requestedAmount * 1_000_000)), nonce, expiry: BigInt(expiry), action: "withdraw_usdc" },
              })
            : "0x",
        };
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
          withdrawalAuthorization,
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
