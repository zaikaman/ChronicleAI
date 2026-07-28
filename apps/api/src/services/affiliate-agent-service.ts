// Affiliate payout agent: LangChain createAgent with tool calling.
// Tools execute on-chain via KeeperHub (withdrawals are never automatic).
// Provider order: Gemini → Groq → OpenAI. Deterministic fallback if no keys / LLM fails.

import { tool } from "langchain";
import { z } from "zod";
import type { LLMProvider } from "@chronicleai/schemas";
import { LLM_FALLBACK_ORDER } from "@chronicleai/config";
import {
  createChatModelsInOrder,
  invokeToolAgent,
} from "../agents/langchain/index.ts";
import type { LLMProviderMap } from "./llm-provider-client.ts";
import type {
  AffiliateDashboardService,
  AffiliateDashboardStats,
} from "./affiliate-dashboard-service.ts";
import type { AffiliateWithdrawalService } from "./affiliate-withdrawal-service.ts";

export interface AffiliateAgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolResult?: unknown;
}

export interface AffiliateAgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface AffiliateAgentChatResult {
  reply: string;
  toolCalls: AffiliateAgentToolCall[];
  stats?: AffiliateDashboardStats | null;
  /** Which brain answered: llm provider name or "fallback". */
  mode: "llm" | "fallback";
  provider?: LLMProvider | "fallback";
}

export interface AffiliateAgentService {
  chat(params: {
    affiliateWallet: string;
    message: string;
    history?: AffiliateAgentMessage[];
  }): Promise<AffiliateAgentChatResult>;
}

type ToolName =
  | "get_affiliate_stats"
  | "get_available_balance"
  | "withdraw_usdc"
  | "help";

const TOOL_NAMES = new Set<string>([
  "get_affiliate_stats",
  "get_available_balance",
  "withdraw_usdc",
  "help",
]);

const MAX_TOOL_ROUNDS = 5;
const LLM_TIMEOUT_MS = 45_000;

interface LlmToolRequest {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

type LlmTurn =
  | { kind: "message"; content: string }
  | { kind: "tool_calls"; calls: LlmToolRequest[] };

/**
 * Injectable LLM backend for unit tests (manual tool-call loop).
 * Production uses LangChain createAgent when providerConfigs is set.
 */
export interface AffiliateAgentLlm {
  complete(params: {
    system: string;
    messages: Array<{
      role: "user" | "assistant" | "system" | "tool";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    }>;
    signal: AbortSignal;
  }): Promise<LlmTurn & { provider: LLMProvider }>;
}

function formatUsdc(n: number): string {
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return `${s} USDC`;
}

function helpText(): string {
  return [
    "I'm the ChronicleAI affiliate payout agent. I can check your stats and send earned USDC on-chain through KeeperHub.",
    "",
    "Try:",
    '• "Show my stats" — referrals, earned, withdrawn',
    '• "What\'s my available balance?"',
    '• "Withdraw all" — full available balance via KeeperHub',
    '• "Withdraw 5 USDC" — partial withdrawal',
    "",
    "Rewards credit when someone you referred connects a wallet and later pays for premium. Withdrawals are not automatic — you ask me, and I execute.",
  ].join("\n");
}

function buildSystemPrompt(wallet: string): string {
  return [
    "You are the ChronicleAI affiliate payout agent.",
    "You help approved referral partners inspect earnings and withdraw rewards.",
    "",
    "Hard rules:",
    `- The authenticated affiliate wallet is ${wallet}. Never send funds to any other address.`,
    "- You MUST call tools for live balances, stats, or withdrawals. Never invent balances, tx hashes, or KeeperHub run ids.",
    "- withdraw_usdc performs a real on-chain transfer via KeeperHub. Only call it when the user clearly wants to withdraw.",
    '- For full balance, pass amount "all". For partial, pass a positive USDC number.',
    "- If a tool fails, explain the error honestly. Do not claim a transfer succeeded unless the tool returned ok: true with a tx hash.",
    "- Be concise, calm, and technical — ChronicleAI editorial voice. No hype.",
    "- Prefer short paragraphs. Include explorer links / tx hashes from tool results when present.",
    "- If the user is chatting casually, answer helpfully and offer next actions (stats / withdraw).",
  ].join("\n");
}

function asToolName(name: string): ToolName | null {
  return TOOL_NAMES.has(name) ? (name as ToolName) : null;
}

// ── Tool execution ──────────────────────────────────────

async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  wallet: string,
  userMessage: string,
  deps: {
    dashboardService: AffiliateDashboardService;
    withdrawalService: AffiliateWithdrawalService;
  },
  statsRef: { current: AffiliateDashboardStats | null | undefined },
): Promise<unknown> {
  if (name === "help") {
    return { text: helpText() };
  }

  if (name === "get_affiliate_stats" || name === "get_available_balance") {
    const stats = await deps.dashboardService.getStats(wallet);
    statsRef.current = stats;
    if (!stats) {
      return {
        error: "Affiliate not found. Register on the Affiliates page first.",
      };
    }
    if (name === "get_available_balance") {
      return {
        availableUsdc: stats.availableUsdc,
        currency: stats.currency,
        totalEarnedUsdc: stats.totalEarnedUsdc,
        totalWithdrawnUsdc: stats.totalWithdrawnUsdc,
      };
    }
    return {
      displayName: stats.affiliate.displayName,
      referralCode: stats.affiliate.referralCode,
      referralLinkPath: stats.affiliate.referralLinkPath,
      status: stats.affiliate.status,
      referredCount: stats.referredCount,
      totalEarnedUsdc: stats.totalEarnedUsdc,
      totalWithdrawnUsdc: stats.totalWithdrawnUsdc,
      availableUsdc: stats.availableUsdc,
      currency: stats.currency,
      recentReferrals: stats.recentReferrals.slice(0, 5),
      recentEarnings: stats.recentEarnings.slice(0, 5),
      recentWithdrawals: stats.recentWithdrawals.slice(0, 5),
    };
  }

  const stats =
    statsRef.current ?? (await deps.dashboardService.getStats(wallet));
  statsRef.current = stats;
  if (!stats) {
    return { ok: false, error: "Affiliate not found or not approved." };
  }

  let amount: number;
  const raw = args.amount;
  if (raw === "all" || raw === undefined || raw === null) {
    amount = stats.availableUsdc;
  } else if (typeof raw === "string" && raw.toLowerCase() === "all") {
    amount = stats.availableUsdc;
  } else {
    amount = Number(raw);
  }

  if (!(amount > 0) || !Number.isFinite(amount)) {
    return {
      ok: false,
      error: `Nothing to withdraw. Available: ${formatUsdc(stats.availableUsdc)}.`,
      availableUsdc: stats.availableUsdc,
    };
  }

  const result = await deps.withdrawalService.withdraw({
    affiliateWallet: wallet,
    amountUsdc: amount,
    agentMessage: userMessage,
  });

  statsRef.current = await deps.dashboardService.getStats(wallet);

  return {
    ok: result.ok,
    amountUsdc: amount,
    errorMessage: result.errorMessage ?? null,
    txHash: result.txHash ?? null,
    explorerUrl: result.explorerUrl ?? null,
    keeperHubRunId: result.keeperHubRunId ?? null,
    availableUsdcAfter: statsRef.current?.availableUsdc ?? null,
  };
}

function buildLangChainTools(params: {
  wallet: string;
  userMessage: string;
  deps: {
    dashboardService: AffiliateDashboardService;
    withdrawalService: AffiliateWithdrawalService;
  };
  statsRef: { current: AffiliateDashboardStats | null | undefined };
  toolCalls: AffiliateAgentToolCall[];
}) {
  const run = async (name: ToolName, args: Record<string, unknown>) => {
    const result = await executeTool(
      name,
      args,
      params.wallet,
      params.userMessage,
      params.deps,
      params.statsRef,
    );
    params.toolCalls.push({ name, arguments: args, result });
    return JSON.stringify(result);
  };

  return [
    tool(
      async () => run("get_affiliate_stats", {}),
      {
        name: "get_affiliate_stats",
        description:
          "Load the affiliate dashboard: referred wallet count, total earned USDC, withdrawn USDC, available balance, referral link, and recent activity.",
        schema: z.object({}),
      },
    ),
    tool(
      async () => run("get_available_balance", {}),
      {
        name: "get_available_balance",
        description:
          "Return only the available USDC balance plus earned/withdrawn totals for this affiliate.",
        schema: z.object({}),
      },
    ),
    tool(
      async ({ amount }) => {
        const args: Record<string, unknown> = { amount };
        return run("withdraw_usdc", args);
      },
      {
        name: "withdraw_usdc",
        description:
          'Execute a real on-chain USDC-denominated payout to the authenticated affiliate wallet through KeeperHub. Only call this when the user clearly wants to withdraw. Use amount "all" for full available balance, or a positive number for a partial amount.',
        schema: z.object({
          amount: z
            .union([z.number().min(0.01), z.literal("all")])
            .describe('USDC amount as a number, or the string "all"'),
        }),
      },
    ),
    tool(
      async () => run("help", {}),
      {
        name: "help",
        description: "Explain what the agent can do and how referral rewards work.",
        schema: z.object({}),
      },
    ),
  ];
}

// ── Deterministic fallback (no LLM keys / LLM outage) ───

function parseWithdrawAmount(message: string): number | null {
  const lower = message.toLowerCase();
  if (
    /\b(withdraw|claim|cash\s*out|send)\b/.test(lower) &&
    /\b(all|everything|full|max|entire)\b/.test(lower)
  ) {
    return -1;
  }
  const patterns = [
    /(?:withdraw|claim|send|transfer|cash\s*out)\s*(?:me\s+)?(?:about\s+)?(\d+(?:\.\d+)?)\s*(?:usdc|usd)?/i,
    /(\d+(?:\.\d+)?)\s*usdc/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function planFallbackTools(message: string): Array<{ name: ToolName; args: Record<string, unknown> }> {
  const lower = message.toLowerCase().trim();
  if (!lower) return [{ name: "help", args: {} }];

  const withdrawAmount = parseWithdrawAmount(message);
  const wantsWithdraw =
    withdrawAmount !== null ||
    /\b(withdraw|claim|cash\s*out|pay\s*me|send\s*(me\s+)?(my\s+)?(money|usdc|funds|rewards?))\b/.test(
      lower,
    );

  if (wantsWithdraw) {
    return [
      {
        name: "withdraw_usdc",
        args: {
          amount:
            withdrawAmount === -1
              ? "all"
              : withdrawAmount != null
                ? withdrawAmount
                : "all",
        },
      },
    ];
  }
  if (/\b(stat|stats|dashboard|how many|referred|referrals|earned|earnings|history|summary)\b/.test(lower)) {
    return [{ name: "get_affiliate_stats", args: {} }];
  }
  if (/\b(balance|available|how much|what.?s left|owed|pending)\b/.test(lower)) {
    return [{ name: "get_available_balance", args: {} }];
  }
  if (/\b(help|what can you|how (do|does)|commands?)\b/.test(lower) || lower === "?") {
    return [{ name: "help", args: {} }];
  }
  return [{ name: "get_affiliate_stats", args: {} }];
}

function formatStatsReply(stats: AffiliateDashboardStats): string {
  const code = stats.affiliate.referralCode ?? stats.affiliate.walletAddress;
  return [
    `Affiliate: ${stats.affiliate.displayName ?? "Partner"} (${stats.affiliate.status})`,
    `Referral link path: ${stats.affiliate.referralLinkPath} (code: ${code})`,
    `People referred (wallet connects): ${stats.referredCount}`,
    `Total earned: ${formatUsdc(stats.totalEarnedUsdc)}`,
    `Total withdrawn: ${formatUsdc(stats.totalWithdrawnUsdc)}`,
    `Available to withdraw: ${formatUsdc(stats.availableUsdc)}`,
    "",
    stats.availableUsdc > 0
      ? 'Say "withdraw all" or "withdraw N USDC" and I\'ll execute the transfer through KeeperHub.'
      : "No available balance yet. Share your referral link — when referred wallets buy premium, you earn here.",
  ].join("\n");
}

async function runFallbackChat(
  params: { affiliateWallet: string; message: string },
  deps: {
    dashboardService: AffiliateDashboardService;
    withdrawalService: AffiliateWithdrawalService;
  },
): Promise<AffiliateAgentChatResult> {
  const wallet = params.affiliateWallet.trim().toLowerCase();
  const planned = planFallbackTools(params.message);
  const toolCalls: AffiliateAgentToolCall[] = [];
  const statsRef: { current: AffiliateDashboardStats | null | undefined } = {
    current: undefined,
  };
  const replyParts: string[] = [];

  for (const plannedTool of planned) {
    const result = await executeTool(
      plannedTool.name,
      plannedTool.args,
      wallet,
      params.message,
      deps,
      statsRef,
    );
    toolCalls.push({ name: plannedTool.name, arguments: plannedTool.args, result });

    if (plannedTool.name === "help") {
      replyParts.push(helpText());
    } else if (plannedTool.name === "get_available_balance") {
      const r = result as {
        error?: string;
        availableUsdc?: number;
        totalEarnedUsdc?: number;
        totalWithdrawnUsdc?: number;
      };
      if (r.error) replyParts.push(r.error);
      else {
        replyParts.push(
          `Available balance: **${formatUsdc(r.availableUsdc ?? 0)}** ` +
            `(earned ${formatUsdc(r.totalEarnedUsdc ?? 0)}, withdrawn ${formatUsdc(r.totalWithdrawnUsdc ?? 0)}).`,
        );
      }
    } else if (plannedTool.name === "get_affiliate_stats") {
      if (statsRef.current) replyParts.push(formatStatsReply(statsRef.current));
      else replyParts.push(String((result as { error?: string }).error ?? "No stats"));
    } else if (plannedTool.name === "withdraw_usdc") {
      const r = result as {
        ok?: boolean;
        error?: string;
        errorMessage?: string | null;
        amountUsdc?: number;
        txHash?: string | null;
        explorerUrl?: string | null;
        keeperHubRunId?: string | null;
      };
      if (!r.ok) {
        replyParts.push(
          `Withdrawal failed: ${r.errorMessage ?? r.error ?? "unknown error"}. I did not complete an on-chain transfer.`,
        );
      } else {
        const tx = r.txHash
          ? ` Tx: \`${r.txHash}\`${r.explorerUrl ? ` ([explorer](${r.explorerUrl}))` : ""}.`
          : "";
        const kh = r.keeperHubRunId ? ` KeeperHub run: \`${r.keeperHubRunId}\`.` : "";
        replyParts.push(
          `Done. I executed a **${formatUsdc(r.amountUsdc ?? 0)}** payout through KeeperHub.${tx}${kh}`,
        );
      }
    }
  }

  return {
    reply: replyParts.join("\n\n") || helpText(),
    toolCalls,
    stats: statsRef.current ?? null,
    mode: "fallback",
    provider: "fallback",
  };
}

/** @deprecated Production path uses LangChain createAgent; retained for tests that inject complete(). */
export function createAffiliateAgentLlm(
  _providerConfigs: LLMProviderMap,
): AffiliateAgentLlm | null {
  // Production no longer uses this manual multi-provider loop.
  // Returning null forces callers that only pass providerConfigs through
  // createAffiliateAgentService to use the LangChain path below.
  return null;
}

async function runLangChainChat(
  params: { affiliateWallet: string; message: string; history?: AffiliateAgentMessage[] },
  deps: {
    dashboardService: AffiliateDashboardService;
    withdrawalService: AffiliateWithdrawalService;
  },
  providerConfigs: LLMProviderMap,
): Promise<AffiliateAgentChatResult> {
  const wallet = params.affiliateWallet.trim().toLowerCase();
  const models = createChatModelsInOrder(providerConfigs, LLM_FALLBACK_ORDER, {
    temperature: 0.2,
  });
  if (models.length === 0) {
    return runFallbackChat(params, deps);
  }

  const statsRef: { current: AffiliateDashboardStats | null | undefined } = {
    current: undefined,
  };
  const toolCalls: AffiliateAgentToolCall[] = [];
  const tools = buildLangChainTools({
    wallet,
    userMessage: params.message,
    deps,
    statsRef,
    toolCalls,
  });

  const historyMessages = (params.history ?? [])
    .filter((h) => h.role === "user" || h.role === "assistant")
    .map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

  const primary = models[0]!;
  const controller = primary.provider === "openai" ? undefined : new AbortController();
  const timer =
    primary.provider === "openai" || !controller
      ? undefined
      : setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const fallbacks = models.slice(1).map((m) => m.model);
    const result = await invokeToolAgent({
      model: primary.model,
      fallbackModels: fallbacks.length > 0 ? fallbacks : undefined,
      tools,
      systemPrompt: buildSystemPrompt(wallet),
      messages: [
        ...historyMessages,
        { role: "user", content: params.message },
      ],
      runLimit: MAX_TOOL_ROUNDS,
      signal: controller?.signal,
      providerLabels: models.map((m) => m.provider),
    });

    // Prefer toolCalls captured during tool execution (includes full results).
    // Fall back to transcript extraction if tools somehow weren't invoked via our wrappers.
    const captured =
      toolCalls.length > 0
        ? toolCalls
        : result.toolCalls.map((tc) => ({
            name: asToolName(tc.name) ?? tc.name,
            arguments: tc.arguments,
            result: tc.result,
          }));

    return {
      reply:
        result.reply.trim() ||
        "I finished working on that. Ask me for your stats or to withdraw if you need a clearer answer.",
      toolCalls: captured,
      stats: statsRef.current ?? null,
      mode: "llm",
      provider: result.provider ?? primary.provider,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runInjectedLlmChat(
  params: { affiliateWallet: string; message: string; history?: AffiliateAgentMessage[] },
  deps: {
    dashboardService: AffiliateDashboardService;
    withdrawalService: AffiliateWithdrawalService;
  },
  llm: AffiliateAgentLlm,
): Promise<AffiliateAgentChatResult> {
  const wallet = params.affiliateWallet.trim().toLowerCase();
  const system = buildSystemPrompt(wallet);
  const messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }> = [];

  for (const h of params.history ?? []) {
    if (h.role === "user" || h.role === "assistant") {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: "user", content: params.message });

  const toolCalls: AffiliateAgentToolCall[] = [];
  const statsRef: { current: AffiliateDashboardStats | null | undefined } = {
    current: undefined,
  };
  let providerUsed: LLMProvider | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let turn: LlmTurn & { provider: LLMProvider };
    try {
      turn = await llm.complete({
        system,
        messages,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    providerUsed = turn.provider;

    if (turn.kind === "message") {
      return {
        reply: turn.content,
        toolCalls,
        stats: statsRef.current ?? null,
        mode: "llm",
        provider: turn.provider,
      };
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: turn.calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: {
          name: c.name,
          arguments: JSON.stringify(c.arguments ?? {}),
        },
      })),
    });

    for (const call of turn.calls) {
      const result = await executeTool(
        call.name,
        call.arguments,
        wallet,
        params.message,
        deps,
        statsRef,
      );
      toolCalls.push({
        name: call.name,
        arguments: call.arguments,
        result,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    reply:
      'I hit the tool-call limit while working on that. Try a simpler request like "show my balance" or "withdraw all".',
    toolCalls,
    stats: statsRef.current ?? null,
    mode: "llm",
    ...(providerUsed !== undefined ? { provider: providerUsed } : {}),
  };
}

// ── Public factory ──────────────────────────────────────

export function createAffiliateAgentService(deps: {
  dashboardService: AffiliateDashboardService;
  withdrawalService: AffiliateWithdrawalService;
  /**
   * Injectable LLM for unit tests (manual tool-call loop).
   * Production: omit this and pass providerConfigs to use LangChain createAgent.
   * Pass null to force deterministic fallback only.
   */
  llm?: AffiliateAgentLlm | null;
  providerConfigs?: LLMProviderMap;
}): AffiliateAgentService {
  return {
    async chat(params) {
      // Explicit test injection
      if (deps.llm !== undefined && deps.llm !== null) {
        try {
          return await runInjectedLlmChat(params, deps, deps.llm);
        } catch (error) {
          console.warn(
            "[affiliate-agent] Injected LLM path failed, using fallback:",
            error instanceof Error ? error.message : error,
          );
          const fallback = await runFallbackChat(params, deps);
          return {
            ...fallback,
            reply: `${fallback.reply}\n\n_(Responded with tool fallback after LLM error: ${
              error instanceof Error ? error.message : "unknown"
            })_`,
          };
        }
      }

      if (deps.llm === null) {
        return runFallbackChat(params, deps);
      }

      // Production: LangChain createAgent with Gemini → Groq → OpenAI fallback
      if (deps.providerConfigs) {
        try {
          return await runLangChainChat(params, deps, deps.providerConfigs);
        } catch (error) {
          console.warn(
            "[affiliate-agent] LangChain agent path failed, using fallback:",
            error instanceof Error ? error.message : error,
          );
          const fallback = await runFallbackChat(params, deps);
          return {
            ...fallback,
            reply: `${fallback.reply}\n\n_(Responded with tool fallback after LLM error: ${
              error instanceof Error ? error.message : "unknown"
            })_`,
          };
        }
      }

      return runFallbackChat(params, deps);
    },
  };
}
