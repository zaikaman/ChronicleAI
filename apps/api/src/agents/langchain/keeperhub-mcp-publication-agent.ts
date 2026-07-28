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
  extractGasFromKeeperHubPayload,
  type OnChainWriteReceipt,
} from "../../services/on-chain-write-receipt.ts";
import { createChatModelsInOrder } from "./models.ts";
import { invokeToolAgent, type ToolAgentToolCall } from "./tool-agent.ts";
import {
  createKeeperHubMcpLangChainTools,
  type KeeperHubMcpToolCallRecord,
} from "./keeperhub-mcp-tools.ts";

export type McpPublicationAction = "publishAlert" | "publishDigest";

export interface KeeperHubMcpPublicationReceipt extends OnChainWriteReceipt {
  keeperHubRunId: string;
  txHash: string;
  explorerUrl: string;
  /** How the publication was driven. */
  mode: "langchain-mcp-agent" | "deterministic-mcp";
  /** Tool invocations performed (agent or deterministic). */
  toolCalls: KeeperHubMcpToolCallRecord[];
  /** Provider label when the LangChain agent ran. */
  provider?: LLMProvider | undefined;
  result?: unknown;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFallbackExplorerUrl(txHash: string, network: string): string {
  const n = network.toLowerCase();
  if (n === "base-sepolia" || n === "84532") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  if (n === "base" || n === "8453") {
    return `https://basescan.org/tx/${txHash}`;
  }
  if (n === "sepolia" || n === "11155111") {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (n === "ethereum" || n === "mainnet" || n === "1") {
    return `https://etherscan.io/tx/${txHash}`;
  }
  return `https://sepolia.etherscan.io/tx/${txHash}`;
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

/** Walk nested MCP / agent payloads for an execution id. */
export function extractExecutionId(payload: unknown): string | undefined {
  const root = parseJsonish(payload);
  const rec = asRecord(root);
  if (!rec) return undefined;

  for (const key of ["executionId", "execution_id", "id", "runId", "run_id"]) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  for (const nestedKey of ["data", "result", "status", "execution"]) {
    const nested = extractExecutionId(rec[nestedKey]);
    if (nested) return nested;
  }
  return undefined;
}

function extractTxFromRecord(
  rec: Record<string, unknown>,
): { txHash?: string; explorerUrl?: string } {
  if (typeof rec.transactionHash === "string" && rec.transactionHash.length > 0) {
    const out: { txHash?: string; explorerUrl?: string } = {
      txHash: rec.transactionHash,
    };
    if (typeof rec.transactionLink === "string" && rec.transactionLink.length > 0) {
      out.explorerUrl = rec.transactionLink;
    }
    return out;
  }
  if (typeof rec.txHash === "string" && rec.txHash.length > 0) {
    const out: { txHash?: string; explorerUrl?: string } = { txHash: rec.txHash };
    if (typeof rec.explorerUrl === "string" && rec.explorerUrl.length > 0) {
      out.explorerUrl = rec.explorerUrl;
    }
    return out;
  }
  const hashes = rec.transactionHashes;
  if (Array.isArray(hashes) && hashes[0] && typeof hashes[0] === "object") {
    const first = hashes[0] as Record<string, unknown>;
    if (typeof first.hash === "string" && first.hash.length > 0) {
      const out: { txHash?: string; explorerUrl?: string } = { txHash: first.hash };
      if (typeof first.transactionLink === "string" && first.transactionLink.length > 0) {
        out.explorerUrl = first.transactionLink;
      }
      return out;
    }
  }
  return {};
}

export function extractTxFromExecutionPayload(
  payload: unknown,
): { txHash?: string; explorerUrl?: string; statusPayload?: Record<string, unknown> } {
  const root = parseJsonish(payload);
  const rec = asRecord(root);
  if (!rec) return {};

  // get_execution returns { status, logs }
  const status = asRecord(rec.status) ?? rec;
  const direct = extractTxFromRecord(status);
  if (direct.txHash) {
    return { ...direct, statusPayload: status };
  }

  // Sometimes nested under data / result
  for (const key of ["data", "result", "output"]) {
    const nested = asRecord(status[key] ?? rec[key]);
    if (nested) {
      const found = extractTxFromRecord(nested);
      if (found.txHash) {
        return { ...found, statusPayload: status };
      }
    }
  }

  return { statusPayload: status };
}

function isTerminalSuccess(status: Record<string, unknown> | undefined): boolean {
  if (!status) return false;
  if (status.completed === true) return true;
  const s = typeof status.status === "string" ? status.status.toLowerCase() : "";
  return s === "success" || s === "completed" || s === "succeeded";
}

function isTerminalFailure(status: Record<string, unknown> | undefined): boolean {
  if (!status) return false;
  const s = typeof status.status === "string" ? status.status.toLowerCase() : "";
  return s === "error" || s === "failed" || s === "cancelled" || s === "canceled";
}

function receiptFromStatus(
  executionId: string,
  statusPayload: Record<string, unknown>,
  network: string,
  mode: KeeperHubMcpPublicationReceipt["mode"],
  toolCalls: KeeperHubMcpToolCallRecord[],
  provider?: LLMProvider,
): KeeperHubMcpPublicationReceipt {
  const { txHash, explorerUrl } = extractTxFromRecord(statusPayload);
  if (!txHash) {
    // Try one more full extract
    const again = extractTxFromExecutionPayload(statusPayload);
    if (!again.txHash) {
      throw new Error(
        `KeeperHub MCP execution ${executionId} completed without a transaction hash`,
      );
    }
    const gas = extractGasFromKeeperHubPayload(statusPayload);
    return {
      keeperHubRunId: executionId,
      txHash: again.txHash,
      explorerUrl: again.explorerUrl ?? buildFallbackExplorerUrl(again.txHash, network),
      mode,
      toolCalls,
      ...(provider ? { provider } : {}),
      result: statusPayload.result ?? statusPayload.output,
      ...(gas.gasUsed ? { gasUsed: gas.gasUsed } : {}),
      ...(gas.gasUsedWei ? { gasUsedWei: gas.gasUsedWei } : {}),
    };
  }
  const gas = extractGasFromKeeperHubPayload(statusPayload);
  return {
    keeperHubRunId: executionId,
    txHash,
    explorerUrl: explorerUrl ?? buildFallbackExplorerUrl(txHash, network),
    mode,
    toolCalls,
    ...(provider ? { provider } : {}),
    result: statusPayload.result ?? statusPayload.output,
    ...(gas.gasUsed ? { gasUsed: gas.gasUsed } : {}),
    ...(gas.gasUsedWei ? { gasUsedWei: gas.gasUsedWei } : {}),
  };
}

function defaultWorkflowHints(action: McpPublicationAction): string[] {
  if (action === "publishAlert") {
    return ["publish-alert", "publishAlert", "publish_alert", "alert"];
  }
  return ["publish-digest", "publishDigest", "publish_digest", "digest"];
}

function scoreWorkflowMatch(
  workflow: Record<string, unknown>,
  hints: string[],
  preferredId?: string,
): number {
  const id = typeof workflow.id === "string" ? workflow.id : "";
  const name = typeof workflow.name === "string" ? workflow.name : "";
  const slug = typeof workflow.slug === "string" ? workflow.slug : "";
  const desc = typeof workflow.description === "string" ? workflow.description : "";
  const hay = `${id} ${name} ${slug} ${desc}`.toLowerCase();

  if (preferredId && id === preferredId) return 10_000;

  let score = 0;
  for (const hint of hints) {
    const h = hint.toLowerCase();
    if (!h) continue;
    if (id.toLowerCase() === h) score += 500;
    if (name.toLowerCase().includes(h)) score += 100;
    if (slug.toLowerCase().includes(h)) score += 80;
    if (hay.includes(h)) score += 20;
  }
  return score;
}

function pickWorkflowId(
  listPayload: unknown,
  hints: string[],
  preferredId?: string,
): string | undefined {
  if (preferredId?.trim()) return preferredId.trim();

  const root = parseJsonish(listPayload);
  const rec = asRecord(root);
  const list: unknown[] = Array.isArray(root)
    ? root
    : Array.isArray(rec?.workflows)
      ? (rec!.workflows as unknown[])
      : Array.isArray(rec?.data)
        ? (rec!.data as unknown[])
        : Array.isArray(rec?.items)
          ? (rec!.items as unknown[])
          : [];

  let bestId: string | undefined;
  let bestScore = 0;
  for (const item of list) {
    const w = asRecord(item);
    if (!w) continue;
    const id = typeof w.id === "string" ? w.id : undefined;
    if (!id) continue;
    const score = scoreWorkflowMatch(w, hints, preferredId);
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
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
    "3. Call execute_workflow with the provided input (content hashes, contentUri, network, contractAddress).",
    "4. Poll get_execution (or get_execution_status) until status is success/completed or failed.",
    "5. Optionally call get_execution_logs once for step detail after success.",
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

/**
 * Try to assemble a receipt from agent tool-call history (no extra MCP polls).
 */
function receiptFromToolHistory(
  toolCalls: KeeperHubMcpToolCallRecord[],
  network: string,
  mode: KeeperHubMcpPublicationReceipt["mode"],
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
    return receiptFromStatus(
      executionId,
      statusPayload,
      network,
      mode,
      toolCalls,
      provider,
    );
  } catch {
    return null;
  }
}

async function pollExecutionViaMcp(
  client: KeeperHubMcpClient,
  executionId: string,
  toolCalls: KeeperHubMcpToolCallRecord[],
  opts: {
    network: string;
    pollIntervalMs: number;
    pollTimeoutMs: number;
    mode: KeeperHubMcpPublicationReceipt["mode"];
    provider?: LLMProvider;
    signal?: AbortSignal;
  },
): Promise<KeeperHubMcpPublicationReceipt> {
  const started = Date.now();
  let lastError: string | undefined;

  while (Date.now() - started < opts.pollTimeoutMs) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error("timeout"), { name: "AbortError" });
    }

    const res = await client.callTool("get_execution", {
      executionId,
      includeData: false,
    });
    toolCalls.push({
      name: "get_execution",
      arguments: { executionId, includeData: false },
      result: res.data,
      isError: res.isError,
    });

    if (res.isError) {
      lastError = res.text;
      await sleep(opts.pollIntervalMs);
      continue;
    }

    const parsed = parseJsonish(res.data);
    const rec = asRecord(parsed);
    const status = asRecord(rec?.status) ?? rec ?? undefined;

    if (isTerminalFailure(status)) {
      const errMsg =
        (status && typeof status.error === "string" && status.error) ||
        `KeeperHub MCP execution ${executionId} ended with status ${status?.status ?? "failed"}`;
      throw new Error(errMsg);
    }

    if (isTerminalSuccess(status) && status) {
      // Optional logs pull for audit richness
      try {
        const logsRes = await client.callTool("get_execution", {
          executionId,
          includeData: true,
        });
        toolCalls.push({
          name: "get_execution_logs",
          arguments: { executionId },
          result: logsRes.data,
          isError: logsRes.isError,
        });
        if (!logsRes.isError) {
          const logsParsed = parseJsonish(logsRes.data);
          const logsRec = asRecord(logsParsed);
          const richStatus = asRecord(logsRec?.status) ?? status;
          return receiptFromStatus(
            executionId,
            richStatus,
            opts.network,
            opts.mode,
            toolCalls,
            opts.provider,
          );
        }
      } catch {
        /* soft-fail logs */
      }

      return receiptFromStatus(
        executionId,
        status,
        opts.network,
        opts.mode,
        toolCalls,
        opts.provider,
      );
    }

    await sleep(opts.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for KeeperHub MCP execution ${executionId}` +
      (lastError ? ` (${lastError})` : ""),
  );
}

/**
 * Deterministic MCP path: list → get → execute → poll.
 * Uses the same MCP tools the LangChain agent would call.
 */
export async function publishViaDeterministicMcp(
  client: KeeperHubMcpClient,
  params: PublishViaKeeperHubMcpParams,
): Promise<KeeperHubMcpPublicationReceipt> {
  const toolCalls: KeeperHubMcpToolCallRecord[] = [];
  const hints = [
    ...(params.workflowHints ?? []),
    ...defaultWorkflowHints(params.action),
  ];
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const pollTimeoutMs = params.pollTimeoutMs ?? 120_000;

  let workflowId = params.preferredWorkflowId?.trim();

  // Discover routes
  const listRes = await client.callTool("list_workflows", {});
  toolCalls.push({
    name: "list_workflows",
    arguments: {},
    result: listRes.data,
    isError: listRes.isError,
  });
  if (!listRes.isError) {
    workflowId =
      pickWorkflowId(listRes.data, hints, params.preferredWorkflowId) ?? workflowId;
  }

  if (!workflowId) {
    throw new Error(
      `KeeperHub MCP could not resolve a workflow for ${params.action}. ` +
        `Set KEEPERHUB_WORKFLOW_${params.action === "publishAlert" ? "PUBLISH_ALERT" : "PUBLISH_DIGEST"} ` +
        `or ensure a matching workflow exists in the org.`,
    );
  }

  const getRes = await client.callTool("get_workflow", { workflowId });
  toolCalls.push({
    name: "get_workflow",
    arguments: { workflowId },
    result: getRes.data,
    isError: getRes.isError,
  });
  if (getRes.isError) {
    throw new Error(
      `KeeperHub MCP get_workflow failed for ${workflowId}: ${getRes.text}`,
    );
  }

  const executeArgs: Record<string, unknown> = {
    workflowId,
    input: params.input,
  };
  if (params.idempotencyKey) {
    executeArgs.idempotency_key = params.idempotencyKey;
  }

  const execRes = await client.callTool("execute_workflow", executeArgs);
  toolCalls.push({
    name: "execute_workflow",
    arguments: executeArgs,
    result: execRes.data,
    isError: execRes.isError,
  });
  if (execRes.isError) {
    throw new Error(
      `KeeperHub MCP execute_workflow failed: ${execRes.text}`,
    );
  }

  const executionId = extractExecutionId(execRes.data);
  if (!executionId) {
    throw new Error(
      "KeeperHub MCP execute_workflow response missing executionId",
    );
  }

  return pollExecutionViaMcp(client, executionId, toolCalls, {
    network: params.network,
    pollIntervalMs,
    pollTimeoutMs,
    mode: "deterministic-mcp",
    ...(params.signal ? { signal: params.signal } : {}),
  });
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
  });

  const primary = models[0]!;
  const fallbacks = models.slice(1).map((m) => m.model);

  const result = await invokeToolAgent({
    model: primary.model,
    fallbackModels: fallbacks.length > 0 ? fallbacks : undefined,
    tools,
    systemPrompt: buildSystemPrompt(params.action, params.preferredWorkflowId),
    messages: [{ role: "user", content: buildUserPrompt(params) }],
    runLimit: params.agentRunLimit ?? 8,
    ...(params.signal ? { signal: params.signal } : {}),
    providerLabels: models.map((m) => m.provider),
  });

  const toolCalls =
    captured.length > 0 ? captured : toolCallsFromAgent(result.toolCalls);

  const fromHistory = receiptFromToolHistory(
    toolCalls,
    params.network,
    "langchain-mcp-agent",
    result.provider ?? primary.provider,
  );
  if (fromHistory) {
    return fromHistory;
  }

  // Agent may have started execution but not finished polling — complete deterministically.
  let executionId: string | undefined;
  for (const tc of toolCalls) {
    if (tc.name === "execute_workflow") {
      executionId = extractExecutionId(tc.result) ?? executionId;
    }
  }

  if (executionId) {
    return pollExecutionViaMcp(client, executionId, toolCalls, {
      network: params.network,
      pollIntervalMs: params.pollIntervalMs ?? 2_000,
      pollTimeoutMs: params.pollTimeoutMs ?? 120_000,
      mode: "langchain-mcp-agent",
      provider: result.provider ?? primary.provider,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  }

  // Agent never called execute_workflow — fall through to full deterministic path
  // reusing the same MCP session (toolCalls already has discovery attempts).
  const deterministic = await publishViaDeterministicMcp(client, params);
  return {
    ...deterministic,
    mode: "langchain-mcp-agent",
    toolCalls: [...toolCalls, ...deterministic.toolCalls],
    provider: result.provider ?? primary.provider,
  };
}

/**
 * Publish an alert or digest registry write via KeeperHub MCP.
 * Prefers LangChain ReAct agent when LLM keys exist; always stays on MCP tools.
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
        const message =
          agentError instanceof Error ? agentError.message : String(agentError);
        console.warn(
          `[keeperhub-mcp] LangChain agent path failed for ${params.action}, ` +
            `falling back to deterministic MCP: ${message}`,
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
