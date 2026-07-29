/**
 * Native LangChain ReAct agent for ChronicleAI registry publications over KeeperHub MCP.
 *
 * Loop 1 (Alert) / Loop 2 (Digest):
 *   1. list_workflows / get_workflow — discover execution routes
 *   2. execute_workflow — post publishAlert / publishDigest
 *   3. get_execution / get_execution_status / get_execution_logs — confirm on-chain
 *
 * When LLM providers are available the agent reasons and calls MCP tools dynamically.
 * When no LLM is configured (or the agent fails to finish), a deterministic MCP
 * orchestration path still uses the same tools — never silent REST substitution
 * unless the caller opts into REST fallback after this module throws.
 *
 * Deterministic execute / poll / receipt helpers live in
 * `services/keeperhub-mcp-execute.ts` (shared with desk + all write methods).
 */

import { LLM_FALLBACK_ORDER } from "@chronicleai/config";
import type { LLMProvider } from "@chronicleai/schemas";
import type { LLMProviderMap } from "../../services/llm-provider-client.ts";
import {
  createKeeperHubMcpClient,
  resolveKeeperHubMcpUrl,
  type KeeperHubMcpClient,
  type KeeperHubMcpClientConfig,
} from "../../services/keeperhub-mcp-client.ts";
import {
  buildFallbackExplorerUrl,
  collectExecutionIds,
  executeViaDeterministicMcp,
  extractExecutionId,
  extractTxFromExecutionPayload,
  isAlreadyPublishedError,
  pollExecutionViaMcp,
  type KeeperHubMcpExecuteReceipt,
} from "../../services/keeperhub-mcp-execute.ts";
import { extractGasFromKeeperHubPayload } from "../../services/on-chain-write-receipt.ts";
import { createChatModelsInOrder } from "./models.ts";
import { invokeToolAgent, type ToolAgentToolCall } from "./tool-agent.ts";
import {
  createKeeperHubMcpLangChainTools,
  type KeeperHubMcpToolCallRecord,
} from "./keeperhub-mcp-tools.ts";

export type McpPublicationAction = "publishAlert" | "publishDigest";

export interface KeeperHubMcpPublicationReceipt
  extends Omit<KeeperHubMcpExecuteReceipt, "mode"> {
  mode: "langchain-mcp-agent" | "deterministic-mcp";
  /** Provider label when the LangChain agent ran. */
  provider?: LLMProvider | undefined;
}

export interface PublishViaKeeperHubMcpParams {
  action: McpPublicationAction;
  /** Workflow input for execute_workflow. */
  input: Record<string, unknown>;
  /** Preferred workflow ID from env (KEEPERHUB_WORKFLOW_PUBLISH_*). */
  preferredWorkflowId?: string | undefined;
  /** Name/id substrings used when discovering workflows via list_workflows. */
  workflowHints?: string[] | undefined;
  mcp: {
    mcpUrl: string;
    apiKey: string;
    requestTimeoutMs?: number | undefined;
  };
  /** When set, prefer LangChain ReAct agent over pure deterministic MCP. */
  llmProviders?: LLMProviderMap | null | undefined;
  network: string;
  pollIntervalMs?: number | undefined;
  pollTimeoutMs?: number | undefined;
  /** Idempotency key for execute_workflow. */
  idempotencyKey?: string | undefined;
  /** Max ReAct model rounds. */
  agentRunLimit?: number | undefined;
  signal?: AbortSignal | undefined;
}

// Re-export shared helpers so existing imports keep working.
export {
  extractExecutionId,
  extractTxFromExecutionPayload,
  isAlreadyPublishedError,
  collectExecutionIds,
};

function errorTextFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

class McpPublicationError extends Error {
  readonly toolCalls: KeeperHubMcpToolCallRecord[];
  readonly executionIds: string[];

  constructor(
    message: string,
    toolCalls: KeeperHubMcpToolCallRecord[],
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "McpPublicationError";
    this.toolCalls = toolCalls;
    this.executionIds = collectExecutionIds(toolCalls);
  }
}

function buildSystemPrompt(action: McpPublicationAction, preferredWorkflowId?: string): string {
  const method = action === "publishAlert" ? "publishAlert" : "publishDigest";
  return [
    "You are the ChronicleAI on-chain publication agent.",
    "You execute proof-of-publication registry writes through KeeperHub MCP tools only.",
    "Do not invent transaction hashes. Only report what tools return.",
    "",
    `Task: run the ${method} registry workflow and wait for on-chain confirmation.`,
    "",
    "Required tool sequence:",
    "1. Call list_workflows to discover available execution routes (unless a preferred workflow ID is already known).",
    "2. Optionally call get_workflow on the chosen workflow to confirm it is the publish route.",
    "3. Call execute_workflow EXACTLY ONCE with the provided input (content hashes, contentUri, network, contractAddress).",
    "4. Poll get_execution (or get_execution_status) until status is success/completed or failed.",
    "5. Optionally call get_execution_logs once for step detail after success.",
    "",
    "CRITICAL: Never call execute_workflow more than once for the same contentHash.",
    "ChronicleRegistry reverts duplicates with 'alert already published' / 'digest already published'.",
    "If execute_workflow already returned an executionId, only poll get_execution.",
    "",
    preferredWorkflowId
      ? `Preferred workflow ID (use this if present in the org): ${preferredWorkflowId}`
      : "No preferred workflow ID was preconfigured — select the best matching publish workflow by name.",
    "",
    "When finished, reply with a short summary including executionId and transactionHash.",
  ].join("\n");
}

function buildUserPrompt(params: PublishViaKeeperHubMcpParams): string {
  return [
    `Action: ${params.action}`,
    `Network: ${params.network}`,
    params.preferredWorkflowId
      ? `Preferred workflow ID: ${params.preferredWorkflowId}`
      : "Preferred workflow ID: (discover via list_workflows)",
    params.idempotencyKey ? `Idempotency key: ${params.idempotencyKey}` : null,
    "Workflow input JSON:",
    JSON.stringify(params.input, null, 2),
    "",
    "Execute the publication now via MCP tools and confirm the on-chain transaction.",
  ]
    .filter(Boolean)
    .join("\n");
}

function toolCallsFromAgent(
  agentCalls: ToolAgentToolCall[],
): KeeperHubMcpToolCallRecord[] {
  return agentCalls.map((tc) => ({
    name: tc.name,
    arguments: tc.arguments,
    result: tc.result,
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isTerminalSuccess(status: Record<string, unknown> | undefined): boolean {
  if (!status) return false;
  if (status.completed === true) {
    const err = status.error;
    if (err != null && typeof err === "string" && err.trim().length > 0) {
      return false;
    }
    return true;
  }
  const s = typeof status.status === "string" ? status.status.toLowerCase() : "";
  return s === "success" || s === "completed" || s === "succeeded";
}

/**
 * Try to assemble a receipt from agent tool-call history (no extra MCP polls).
 */
function receiptFromToolHistory(
  toolCalls: KeeperHubMcpToolCallRecord[],
  network: string,
  provider?: LLMProvider,
): KeeperHubMcpPublicationReceipt | null {
  let executionId: string | undefined;
  let statusPayload: Record<string, unknown> | undefined;

  for (const tc of toolCalls) {
    if (tc.name === "execute_workflow") {
      executionId = extractExecutionId(tc.result) ?? executionId;
    }
    if (
      tc.name === "get_execution" ||
      tc.name === "get_execution_status" ||
      tc.name === "get_execution_logs"
    ) {
      const parsed = parseJsonish(tc.result);
      const rec = asRecord(parsed);
      const status = asRecord(rec?.status) ?? rec ?? undefined;
      if (status && isTerminalSuccess(status)) {
        statusPayload = status;
        executionId =
          extractExecutionId(status) ??
          extractExecutionId(parsed) ??
          executionId;
      }
      if (!executionId) {
        executionId = extractExecutionId(parsed) ?? executionId;
      }
    }
  }

  if (!executionId || !statusPayload) return null;
  try {
    const extracted = extractTxFromExecutionPayload(statusPayload);
    if (!extracted.txHash) return null;
    const gas = extractGasFromKeeperHubPayload(statusPayload);
    return {
      keeperHubRunId: executionId,
      txHash: extracted.txHash,
      explorerUrl:
        extracted.explorerUrl ??
        buildFallbackExplorerUrl(extracted.txHash, network),
      mode: "langchain-mcp-agent",
      toolCalls,
      ...(provider ? { provider } : {}),
      result: statusPayload.result ?? statusPayload.output,
      ...(gas.gasUsed ? { gasUsed: gas.gasUsed } : {}),
      ...(gas.gasUsedWei ? { gasUsedWei: gas.gasUsedWei } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Deterministic MCP path: list → get → execute → poll.
 * Delegates to shared `executeViaDeterministicMcp`.
 */
export async function publishViaDeterministicMcp(
  client: KeeperHubMcpClient,
  params: PublishViaKeeperHubMcpParams,
): Promise<KeeperHubMcpPublicationReceipt> {
  const receipt = await executeViaDeterministicMcp(client, {
    action: params.action,
    workflowInput: params.input,
    preferredWorkflowId: params.preferredWorkflowId,
    workflowHints: params.workflowHints,
    idempotencyKey: params.idempotencyKey,
    mcp: params.mcp,
    network: params.network,
    pollIntervalMs: params.pollIntervalMs,
    pollTimeoutMs: params.pollTimeoutMs,
    singleExecute: true,
    wait: true,
    signal: params.signal,
  });
  return {
    ...receipt,
    mode: "deterministic-mcp",
  };
}

async function publishViaLangChainMcpAgent(
  client: KeeperHubMcpClient,
  params: PublishViaKeeperHubMcpParams,
): Promise<KeeperHubMcpPublicationReceipt> {
  if (!params.llmProviders) {
    throw new Error("LLM providers required for LangChain MCP agent path");
  }

  const models = createChatModelsInOrder(
    params.llmProviders,
    LLM_FALLBACK_ORDER,
  );
  if (models.length === 0) {
    throw new Error("No LLM providers configured for LangChain MCP agent");
  }

  const captured: KeeperHubMcpToolCallRecord[] = [];
  const tools = createKeeperHubMcpLangChainTools(client, {
    onToolCall: (record) => captured.push(record),
    // Prevent the ReAct loop from double-submitting the same contentHash.
    singleExecute: true,
  });

  const primary = models[0]!;
  const fallbacks = models.slice(1).map((m) => m.model);

  let result: Awaited<ReturnType<typeof invokeToolAgent>>;
  try {
    result = await invokeToolAgent({
      model: primary.model,
      fallbackModels: fallbacks.length > 0 ? fallbacks : undefined,
      tools,
      systemPrompt: buildSystemPrompt(params.action, params.preferredWorkflowId),
      messages: [{ role: "user", content: buildUserPrompt(params) }],
      runLimit: params.agentRunLimit ?? 8,
      ...(params.signal ? { signal: params.signal } : {}),
      providerLabels: models.map((m) => m.provider),
    });
  } catch (agentInvokeError) {
    throw new McpPublicationError(
      errorTextFromUnknown(agentInvokeError),
      captured,
      { cause: agentInvokeError },
    );
  }

  const toolCalls =
    captured.length > 0 ? captured : toolCallsFromAgent(result.toolCalls);

  const fromHistory = receiptFromToolHistory(
    toolCalls,
    params.network,
    result.provider ?? primary.provider,
  );
  if (fromHistory) {
    return fromHistory;
  }

  // Agent may have started execution but not finished polling — complete by
  // polling only (never re-call execute_workflow).
  const executionIds = collectExecutionIds(toolCalls);
  if (executionIds.length > 0) {
    let lastPollError: unknown;
    for (const executionId of executionIds) {
      try {
        const polled = await pollExecutionViaMcp(client, executionId, toolCalls, {
          network: params.network,
          pollIntervalMs: params.pollIntervalMs ?? 2_000,
          pollTimeoutMs: params.pollTimeoutMs ?? 120_000,
          mode: "langchain-mcp-agent",
          requireTxHash: true,
          ...(params.signal ? { signal: params.signal } : {}),
        });
        return {
          ...polled,
          mode: "langchain-mcp-agent",
          provider: result.provider ?? primary.provider,
        };
      } catch (pollError) {
        lastPollError = pollError;
        continue;
      }
    }
    throw new McpPublicationError(
      errorTextFromUnknown(lastPollError ?? "MCP execution poll failed"),
      toolCalls,
      lastPollError !== undefined ? { cause: lastPollError } : undefined,
    );
  }

  // Agent never called execute_workflow — full deterministic path is safe.
  try {
    const deterministic = await publishViaDeterministicMcp(client, params);
    return {
      ...deterministic,
      mode: "langchain-mcp-agent",
      toolCalls: [...toolCalls, ...deterministic.toolCalls],
      provider: result.provider ?? primary.provider,
    };
  } catch (detError) {
    throw new McpPublicationError(errorTextFromUnknown(detError), toolCalls, {
      cause: detError,
    });
  }
}

/**
 * Publish an alert or digest registry write via KeeperHub MCP.
 * Prefers LangChain ReAct agent when LLM keys exist; always stays on MCP tools.
 *
 * Important: if execute_workflow already ran (even on a failing agent path),
 * we never re-submit — ChronicleRegistry reverts duplicate contentHash with
 * "alert already published". We only poll existing execution IDs.
 */
export async function publishViaKeeperHubMcp(
  params: PublishViaKeeperHubMcpParams,
): Promise<KeeperHubMcpPublicationReceipt> {
  const mcpConfig: KeeperHubMcpClientConfig = {
    mcpUrl: params.mcp.mcpUrl,
    apiKey: params.mcp.apiKey,
    ...(params.mcp.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: params.mcp.requestTimeoutMs }
      : {}),
  };

  const client = createKeeperHubMcpClient(mcpConfig);
  await client.connect();
  try {
    const hasLlm =
      params.llmProviders &&
      createChatModelsInOrder(params.llmProviders, LLM_FALLBACK_ORDER).length > 0;

    if (hasLlm) {
      try {
        return await publishViaLangChainMcpAgent(client, params);
      } catch (agentError) {
        const message = errorTextFromUnknown(agentError);
        const toolCalls =
          agentError instanceof McpPublicationError ? agentError.toolCalls : [];
        const executionIds =
          agentError instanceof McpPublicationError
            ? agentError.executionIds
            : collectExecutionIds(toolCalls);

        // Already executed once — never call execute_workflow again.
        if (executionIds.length > 0) {
          console.warn(
            `[keeperhub-mcp] LangChain agent path failed for ${params.action} ` +
              `after execute_workflow (${executionIds.join(",")}): ${message}. ` +
              `Polling existing execution(s) only — will not re-submit ` +
              `(avoids ChronicleRegistry "already published").`,
          );

          let lastPollError: unknown = agentError;
          for (const executionId of executionIds) {
            try {
              const polled = await pollExecutionViaMcp(
                client,
                executionId,
                [...toolCalls],
                {
                  network: params.network,
                  pollIntervalMs: params.pollIntervalMs ?? 2_000,
                  pollTimeoutMs: params.pollTimeoutMs ?? 120_000,
                  mode: "langchain-mcp-agent",
                  requireTxHash: true,
                  ...(params.signal ? { signal: params.signal } : {}),
                },
              );
              return { ...polled, mode: "langchain-mcp-agent" };
            } catch (pollError) {
              lastPollError = pollError;
            }
          }

          const pollMsg = errorTextFromUnknown(lastPollError);
          if (isAlreadyPublishedError(message) || isAlreadyPublishedError(pollMsg)) {
            throw new Error(
              `KeeperHub MCP ${params.action}: contentHash already on-chain ` +
                `(ChronicleRegistry duplicate). First execution id(s): ${executionIds.join(", ")}. ` +
                `Original error: ${pollMsg}`,
            );
          }
          throw lastPollError instanceof Error
            ? lastPollError
            : new Error(pollMsg);
        }

        if (isAlreadyPublishedError(message)) {
          throw new Error(
            `KeeperHub MCP ${params.action}: ${message} ` +
              `(refusing deterministic re-submit of the same contentHash)`,
          );
        }

        console.warn(
          `[keeperhub-mcp] LangChain agent path failed for ${params.action} ` +
            `before execute_workflow, falling back to deterministic MCP: ${message}`,
        );
        return await publishViaDeterministicMcp(client, params);
      }
    }

    return await publishViaDeterministicMcp(client, params);
  } finally {
    await client.close();
  }
}

/** Build MCP publication config from KeeperHub write-client style env pieces. */
export function buildMcpPublicationConfig(env: {
  keeperhubApiBaseUrl: string;
  keeperhubApiKey: string;
  keeperhubMcpUrl?: string | undefined;
}): { mcpUrl: string; apiKey: string } {
  return {
    mcpUrl: resolveKeeperHubMcpUrl(env.keeperhubApiBaseUrl, env.keeperhubMcpUrl),
    apiKey: env.keeperhubApiKey,
  };
}
