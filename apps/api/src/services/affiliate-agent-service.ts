// Affiliate payout agent: real LLM with tool calling.
// Tools execute on-chain via KeeperHub (withdrawals are never automatic).
// Provider order: Gemini → OpenAI → Groq. Deterministic fallback if no keys / LLM fails.

import OpenAI from "openai";
import type { LLMProvider } from "@chronicleai/schemas";
import { LLM_FALLBACK_ORDER } from "@chronicleai/config";
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

/** OpenAI-style tool definitions shared by OpenAI + Groq chat.completions. */
const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_affiliate_stats",
      description:
        "Load the affiliate dashboard: referred wallet count, total earned USDC, withdrawn USDC, available balance, referral link, and recent activity.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_balance",
      description:
        "Return only the available USDC balance plus earned/withdrawn totals for this affiliate.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "withdraw_usdc",
      description:
        "Execute a real on-chain USDC-denominated payout to the authenticated affiliate wallet through KeeperHub. Only call this when the user clearly wants to withdraw. Use amount \"all\" for full available balance, or a positive number for a partial amount.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            description: 'USDC amount as a number, or the string "all"',
            anyOf: [{ type: "number", minimum: 0.01 }, { type: "string", enum: ["all"] }],
          },
        },
        required: ["amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "help",
      description: "Explain what the agent can do and how referral rewards work.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: "get_affiliate_stats",
    description:
      "Load the affiliate dashboard: referred wallet count, total earned USDC, withdrawn USDC, available balance, referral link, and recent activity.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_available_balance",
    description:
      "Return only the available USDC balance plus earned/withdrawn totals for this affiliate.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "withdraw_usdc",
    description:
      "Execute a real on-chain USDC-denominated payout to the authenticated affiliate wallet through KeeperHub. Only call when the user clearly wants to withdraw. amount is a number or the string \"all\".",
    parameters: {
      type: "OBJECT",
      properties: {
        amount: {
          type: "STRING",
          description: 'USDC amount as a decimal string, or "all"',
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "help",
    description: "Explain what the agent can do and how referral rewards work.",
    parameters: { type: "OBJECT", properties: {} },
  },
];

interface LlmToolRequest {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

type LlmTurn =
  | { kind: "message"; content: string }
  | { kind: "tool_calls"; calls: LlmToolRequest[] };

/** Injectable LLM backend (production + tests). */
export interface AffiliateAgentLlm {
  complete(params: {
    system: string;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
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

function parseToolArgs(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function asToolName(name: string): ToolName | null {
  return TOOL_NAMES.has(name) ? (name as ToolName) : null;
}

/**
 * OpenAI / Groq chat.completions tool-calling client.
 */
async function completeOpenAICompatible(
  provider: "openai" | "groq",
  config: { apiKey: string; model: string; baseUrl?: string | undefined },
  params: {
    system: string;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    signal: AbortSignal;
  },
): Promise<LlmTurn> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL:
      config.baseUrl ||
      (provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1"),
  });

  const response = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0.2,
      messages: [{ role: "system", content: params.system }, ...params.messages],
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    },
    { signal: params.signal },
  );

  const choice = response.choices[0]?.message;
  if (!choice) throw new Error(`${provider} returned empty completion`);

  const toolCalls = choice.tool_calls ?? [];
  if (toolCalls.length > 0) {
    const calls: LlmToolRequest[] = [];
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const name = asToolName(tc.function.name);
      if (!name) continue;
      calls.push({
        id: tc.id,
        name,
        arguments: parseToolArgs(tc.function.arguments),
      });
    }
    if (calls.length > 0) {
      return { kind: "tool_calls", calls };
    }
  }

  const content = (choice.content ?? "").trim();
  if (!content) throw new Error(`${provider} returned empty message`);
  return { kind: "message", content };
}

/**
 * Gemini generateContent with function calling.
 */
async function completeGemini(
  config: { apiKey: string; model: string; baseUrl?: string | undefined },
  params: {
    system: string;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    signal: AbortSignal;
  },
): Promise<LlmTurn> {
  let host = config.baseUrl || "https://generativelanguage.googleapis.com";
  if (host.endsWith("/")) host = host.slice(0, -1);
  const path = host.includes("/v1")
    ? `/models/${config.model}:generateContent?key=${config.apiKey}`
    : `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const url = `${host}${path}`;

  // Convert OpenAI-style transcript into Gemini contents.
  type GeminiPart =
    | { text: string }
    | { functionCall: { name: string; args?: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } };

  type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

  const contents: GeminiContent[] = [];

  for (const msg of params.messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "";
      contents.push({ role: "user", parts: [{ text }] });
      continue;
    }
    if (msg.role === "assistant") {
      const assistant = msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
      const parts: GeminiPart[] = [];
      if (typeof assistant.content === "string" && assistant.content.trim()) {
        parts.push({ text: assistant.content });
      }
      if (assistant.tool_calls?.length) {
        for (const tc of assistant.tool_calls) {
          if (tc.type !== "function") continue;
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: parseToolArgs(tc.function.arguments),
            },
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }
    if (msg.role === "tool") {
      const toolMsg = msg as OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
      let responseObj: Record<string, unknown> = {};
      try {
        responseObj = JSON.parse(String(toolMsg.content)) as Record<string, unknown>;
      } catch {
        responseObj = { result: toolMsg.content };
      }
      // Gemini wants functionResponse on a user turn after model functionCall.
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: toolMsg.tool_call_id?.startsWith("fn:")
                ? toolMsg.tool_call_id.slice(3)
                : // tool_call_id is our id; name is not on tool message in OpenAI format.
                  // We encode name as tool_call_id when using Gemini path via "fn:name:uuid".
                  extractGeminiToolName(toolMsg.tool_call_id) ?? "tool",
              response: responseObj,
            },
          },
        ],
      });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const body = {
    systemInstruction: { parts: [{ text: params.system }] },
    contents,
    tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.2 },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const calls: LlmToolRequest[] = [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.functionCall?.name) {
      const name = asToolName(part.functionCall.name);
      if (name) {
        const args = part.functionCall.args ?? {};
        // Normalize amount if Gemini sent a string number
        if (typeof args.amount === "string" && args.amount !== "all") {
          const n = Number(args.amount);
          if (Number.isFinite(n)) args.amount = n;
        }
        calls.push({
          id: `fn:${name}:${crypto.randomUUID()}`,
          name,
          arguments: args,
        });
      }
    } else if (part.text?.trim()) {
      textParts.push(part.text.trim());
    }
  }

  if (calls.length > 0) {
    return { kind: "tool_calls", calls };
  }

  const content = textParts.join("\n").trim();
  if (!content) throw new Error("Gemini returned empty response");
  return { kind: "message", content };
}

function extractGeminiToolName(toolCallId: string | undefined): string | null {
  if (!toolCallId) return null;
  // format: fn:name:uuid
  const m = /^fn:([a-z_]+):/.exec(toolCallId);
  return m?.[1] ?? null;
}

/**
 * Create multi-provider LLM client with fallback order Gemini → OpenAI → Groq.
 */
export function createAffiliateAgentLlm(providerConfigs: LLMProviderMap): AffiliateAgentLlm | null {
  const configured = LLM_FALLBACK_ORDER.filter((p) => {
    const cfg = providerConfigs[p];
    return Boolean(cfg?.apiKey?.trim());
  });
  if (configured.length === 0) return null;

  return {
    async complete(params) {
      const errors: string[] = [];
      for (const provider of configured) {
        const cfg = providerConfigs[provider];
        try {
          if (provider === "gemini") {
            const turn = await completeGemini(cfg, params);
            return { ...turn, provider };
          }
          if (provider === "openai" || provider === "groq") {
            const turn = await completeOpenAICompatible(provider, cfg, params);
            return { ...turn, provider };
          }
        } catch (error) {
          errors.push(
            `${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      throw new Error(`All LLM providers failed: ${errors.join(" | ")}`);
    },
  };
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

  // withdraw_usdc
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

  for (const tool of planned) {
    const result = await executeTool(
      tool.name,
      tool.args,
      wallet,
      params.message,
      deps,
      statsRef,
    );
    toolCalls.push({ name: tool.name, arguments: tool.args, result });

    if (tool.name === "help") {
      replyParts.push(helpText());
    } else if (tool.name === "get_available_balance") {
      const r = result as { error?: string; availableUsdc?: number; totalEarnedUsdc?: number; totalWithdrawnUsdc?: number };
      if (r.error) replyParts.push(r.error);
      else {
        replyParts.push(
          `Available balance: **${formatUsdc(r.availableUsdc ?? 0)}** ` +
            `(earned ${formatUsdc(r.totalEarnedUsdc ?? 0)}, withdrawn ${formatUsdc(r.totalWithdrawnUsdc ?? 0)}).`,
        );
      }
    } else if (tool.name === "get_affiliate_stats") {
      if (statsRef.current) replyParts.push(formatStatsReply(statsRef.current));
      else replyParts.push(String((result as { error?: string }).error ?? "No stats"));
    } else if (tool.name === "withdraw_usdc") {
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

// ── Public factory ──────────────────────────────────────

export function createAffiliateAgentService(deps: {
  dashboardService: AffiliateDashboardService;
  withdrawalService: AffiliateWithdrawalService;
  /**
   * Real LLM with tool calling. Pass provider map via createAffiliateAgentLlm,
   * or inject a mock for tests. If null/omitted, uses deterministic fallback only
   * unless providerConfigs is provided.
   */
  llm?: AffiliateAgentLlm | null;
  providerConfigs?: LLMProviderMap;
}): AffiliateAgentService {
  const llm =
    deps.llm === undefined
      ? deps.providerConfigs
        ? createAffiliateAgentLlm(deps.providerConfigs)
        : null
      : deps.llm;

  return {
    async chat(params) {
      const wallet = params.affiliateWallet.trim().toLowerCase();

      if (!llm) {
        return runFallbackChat(params, deps);
      }

      const system = buildSystemPrompt(wallet);
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      // Optional short history (user/assistant only)
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

      try {
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
              mode: "llm" as const,
              provider: turn.provider,
            };
          }

          // Execute each tool, append assistant tool_calls + tool results to transcript
          const assistantToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
            turn.calls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: {
                name: c.name,
                arguments: JSON.stringify(c.arguments ?? {}),
              },
            }));

          messages.push({
            role: "assistant",
            content: null,
            tool_calls: assistantToolCalls,
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

        // Exceeded tool rounds — ask model one last time without tools by using fallback summary
        return {
          reply:
            "I hit the tool-call limit while working on that. Try a simpler request like \"show my balance\" or \"withdraw all\".",
          toolCalls,
          stats: statsRef.current ?? null,
          mode: "llm" as const,
          ...(providerUsed !== undefined ? { provider: providerUsed } : {}),
        };
      } catch (error) {
        // LLM path failed — deterministic tools still work for the demo.
        console.warn(
          "[affiliate-agent] LLM path failed, using fallback:",
          error instanceof Error ? error.message : error,
        );
        const fallback = await runFallbackChat(params, deps);
        return {
          ...fallback,
          reply:
            `${fallback.reply}\n\n_(Responded with tool fallback after LLM error: ${
              error instanceof Error ? error.message : "unknown"
            })_`,
        };
      }
    },
  };
}
