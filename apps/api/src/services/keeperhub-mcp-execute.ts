/**
 * Shared KeeperHub MCP execute core.
 *
 * Deterministic path used by every material write class:
 *   list_workflows → get_workflow → execute_workflow → get_execution (poll)
 *
 * Production write client + desk bridge prefer this when MCP is enabled;
 * REST workflow execute remains the fallback. Direct Execution is never used.
 *
 * Alert/digest may still prefer LangChain ReAct (see publication agent);
 * that path reuses the same poll / receipt helpers here.
 */

import type { KeeperHubMcpToolCallRecord } from "../agents/langchain/keeperhub-mcp-tools.ts";
import type { KeeperHubMcpClient } from "./keeperhub-mcp-client.ts";
import { type KeeperHubMcpClientConfig, createKeeperHubMcpClient } from "./keeperhub-mcp-client.ts";
import {
  type OnChainWriteReceipt,
  extractGasFromKeeperHubPayload,
} from "./on-chain-write-receipt.ts";

/** All production write classes that can run through KeeperHub MCP. */
export type McpWriteAction =
  | "publishAlert"
  | "publishDigest"
  | "createSponsoredWatch"
  | "publishSponsoredReport"
  | "publishPremiumReceipt"
  | "recordPayout"
  | "publishTradeTicket"
  | "recordCapitalMove"
  | "transfer"
  | "deskSweep"
  | "deskDefend"
  | "deskRotate"
  | "deskOracleArb"
  | "deskKillSwitch";

export type KeeperHubMcpExecuteMode = "deterministic-mcp" | "langchain-mcp-agent";

export interface ExecuteViaKeeperHubMcpParams {
  action: McpWriteAction;
  workflowInput: Record<string, unknown>;
  preferredWorkflowId?: string | undefined;
  workflowHints?: string[] | undefined;
  idempotencyKey?: string | undefined;
  mcp: {
    mcpUrl: string;
    apiKey: string;
    requestTimeoutMs?: number | undefined;
  };
  network: string;
  pollIntervalMs?: number | undefined;
  pollTimeoutMs?: number | undefined;
  /**
   * When true (default), only one execute_workflow is sent for this session.
   * Critical for registry contentHash actions (duplicate reverts).
   */
  singleExecute?: boolean | undefined;
  /**
   * When false, return after execute_workflow with run id (no terminal poll).
   * Desk fire-and-forget uses this. Default true.
   */
  wait?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface KeeperHubMcpExecuteReceipt extends OnChainWriteReceipt {
  keeperHubRunId: string;
  txHash: string;
  explorerUrl: string;
  mode: KeeperHubMcpExecuteMode;
  toolCalls: KeeperHubMcpToolCallRecord[];
  result?: unknown;
  /** Multi-leg workflows (desk) may return several hashes. */
  txHashes?: string[] | undefined;
  explorerUrls?: string[] | undefined;
  /** Terminal KH status string when known. */
  status?: string | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildFallbackExplorerUrl(txHash: string, network: string): string {
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

function extractTxFromRecord(rec: Record<string, unknown>): {
  txHash?: string;
  explorerUrl?: string;
  txHashes?: string[];
  explorerUrls?: string[];
} {
  const hashes: string[] = [];
  const explorers: string[] = [];

  if (Array.isArray(rec.transactionHashes)) {
    for (const entry of rec.transactionHashes) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.hash === "string" && e.hash.length > 0) {
          hashes.push(e.hash);
          explorers.push(
            typeof e.transactionLink === "string" && e.transactionLink.length > 0
              ? e.transactionLink
              : "",
          );
        }
      }
    }
  }

  if (
    typeof rec.transactionHash === "string" &&
    rec.transactionHash.length > 0 &&
    !hashes.includes(rec.transactionHash)
  ) {
    hashes.unshift(rec.transactionHash);
    explorers.unshift(
      typeof rec.transactionLink === "string" && rec.transactionLink.length > 0
        ? rec.transactionLink
        : "",
    );
  }

  if (typeof rec.txHash === "string" && rec.txHash.length > 0 && !hashes.includes(rec.txHash)) {
    hashes.unshift(rec.txHash);
    explorers.unshift(
      typeof rec.explorerUrl === "string" && rec.explorerUrl.length > 0 ? rec.explorerUrl : "",
    );
  }

  const primary = hashes[0];
  if (!primary) return {};

  const primaryExplorer =
    (explorers[0] && explorers[0].length > 0
      ? explorers[0]
      : typeof rec.transactionLink === "string" && rec.transactionLink.length > 0
        ? rec.transactionLink
        : typeof rec.explorerUrl === "string" && rec.explorerUrl.length > 0
          ? rec.explorerUrl
          : undefined) ?? undefined;

  return {
    txHash: primary,
    ...(primaryExplorer ? { explorerUrl: primaryExplorer } : {}),
    txHashes: hashes,
    explorerUrls: explorers,
  };
}

export function extractTxFromExecutionPayload(payload: unknown): {
  txHash?: string;
  explorerUrl?: string;
  txHashes?: string[];
  explorerUrls?: string[];
  statusPayload?: Record<string, unknown>;
} {
  const root = parseJsonish(payload);
  const rec = asRecord(root);
  if (!rec) return {};

  const status = asRecord(rec.status) ?? rec;
  const direct = extractTxFromRecord(status);
  if (direct.txHash) {
    return { ...direct, statusPayload: status };
  }

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
  // Failures first: KH often returns completed=true with status=error.
  if (isTerminalFailure(status)) return false;
  if (status.completed === true) {
    const err = status.error;
    if (err == null || (typeof err === "string" && err.trim().length === 0)) {
      return true;
    }
  }
  const s = typeof status.status === "string" ? status.status.toLowerCase() : "";
  return s === "success" || s === "completed" || s === "succeeded";
}

function isTerminalFailure(status: Record<string, unknown> | undefined): boolean {
  if (!status) return false;
  const s = typeof status.status === "string" ? status.status.toLowerCase() : "";
  if (s === "error" || s === "failed" || s === "cancelled" || s === "canceled") {
    return true;
  }
  if (
    status.completed === true &&
    typeof status.error === "string" &&
    status.error.trim().length > 0 &&
    s !== "success" &&
    s !== "completed" &&
    s !== "succeeded"
  ) {
    return true;
  }
  return false;
}

function receiptFromStatus(
  executionId: string,
  statusPayload: Record<string, unknown>,
  network: string,
  mode: KeeperHubMcpExecuteMode,
  toolCalls: KeeperHubMcpToolCallRecord[],
  options?: { requireTxHash?: boolean },
): KeeperHubMcpExecuteReceipt {
  const requireTx = options?.requireTxHash !== false;
  let extracted = extractTxFromRecord(statusPayload);
  if (!extracted.txHash) {
    extracted = extractTxFromExecutionPayload(statusPayload);
  }

  if (requireTx && !extracted.txHash) {
    throw new Error(`KeeperHub MCP execution ${executionId} completed without a transaction hash`);
  }

  const txHash = extracted.txHash ?? "";
  const hashes = extracted.txHashes ?? (txHash ? [txHash] : []);
  const explorers = (extracted.explorerUrls ?? []).map((url, i) =>
    url && url.length > 0 ? url : hashes[i] ? buildFallbackExplorerUrl(hashes[i]!, network) : "",
  );
  const gas = extractGasFromKeeperHubPayload(statusPayload);
  const statusStr =
    typeof statusPayload.status === "string"
      ? statusPayload.status
      : statusPayload.completed
        ? "completed"
        : "unknown";

  return {
    keeperHubRunId: executionId,
    txHash,
    explorerUrl: extracted.explorerUrl ?? (txHash ? buildFallbackExplorerUrl(txHash, network) : ""),
    mode,
    toolCalls,
    result: statusPayload.result ?? statusPayload.output ?? statusPayload.data ?? statusPayload,
    status: statusStr,
    ...(hashes.length > 0 ? { txHashes: hashes } : {}),
    ...(explorers.some((u) => u.length > 0) ? { explorerUrls: explorers } : {}),
    ...(gas.gasUsed ? { gasUsed: gas.gasUsed } : {}),
    ...(gas.gasUsedWei ? { gasUsedWei: gas.gasUsedWei } : {}),
  };
}

/** Default name/slug hints when preferred workflow ID is missing. */
export function defaultWorkflowHints(action: McpWriteAction): string[] {
  switch (action) {
    case "publishAlert":
      return ["publish-alert", "publishAlert", "publish_alert", "alert"];
    case "publishDigest":
      return ["publish-digest", "publishDigest", "publish_digest", "digest"];
    case "createSponsoredWatch":
      return [
        "create-sponsored-watch",
        "createSponsoredWatch",
        "sponsored-watch",
        "sponsored_watch",
      ];
    case "publishSponsoredReport":
      return ["publish-sponsored-report", "publishSponsoredReport", "sponsored-report"];
    case "publishPremiumReceipt":
      return ["publish-premium-receipt", "publishPremiumReceipt", "premium-receipt"];
    case "recordPayout":
      return ["record-payout", "recordPayout", "payout"];
    case "publishTradeTicket":
      return ["publish-trade-ticket", "publishTradeTicket", "trade-ticket", "trade_ticket"];
    case "recordCapitalMove":
      return ["record-capital-move", "recordCapitalMove", "capital-move", "capital_move"];
    case "transfer":
      return ["transfer", "usdc-transfer", "treasury-transfer"];
    case "deskSweep":
      return ["desk-sweep", "desk_sweep", "sweep"];
    case "deskDefend":
      return ["desk-defend", "desk_defend", "defend", "risk-defend"];
    case "deskRotate":
      return ["desk-rotate", "desk_rotate", "rotate", "yield-rotation"];
    case "deskOracleArb":
      return ["desk-oracle-arb", "desk_oracle_arb", "oracle-arb", "oracle_amm"];
    case "deskKillSwitch":
      return ["desk-kill-switch", "desk_kill_switch", "kill-switch", "kill_switch"];
    default: {
      const _exhaustive: never = action;
      return [_exhaustive];
    }
  }
}

/** Env var name for a write action (operator messaging). */
export function envNameForMcpWriteAction(action: McpWriteAction): string {
  switch (action) {
    case "publishAlert":
      return "KEEPERHUB_WORKFLOW_PUBLISH_ALERT";
    case "publishDigest":
      return "KEEPERHUB_WORKFLOW_PUBLISH_DIGEST";
    case "createSponsoredWatch":
      return "KEEPERHUB_WORKFLOW_CREATE_SPONSORED_WATCH";
    case "publishSponsoredReport":
      return "KEEPERHUB_WORKFLOW_PUBLISH_SPONSORED_REPORT";
    case "publishPremiumReceipt":
      return "KEEPERHUB_WORKFLOW_PUBLISH_PREMIUM_RECEIPT";
    case "recordPayout":
      return "KEEPERHUB_WORKFLOW_RECORD_PAYOUT";
    case "publishTradeTicket":
      return "KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET";
    case "recordCapitalMove":
      return "KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE";
    case "transfer":
      return "KEEPERHUB_WORKFLOW_TRANSFER";
    case "deskSweep":
      return "KEEPERHUB_WORKFLOW_DESK_SWEEP";
    case "deskDefend":
      return "KEEPERHUB_WORKFLOW_DESK_DEFEND";
    case "deskRotate":
      return "KEEPERHUB_WORKFLOW_DESK_ROTATE";
    case "deskOracleArb":
      return "KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB";
    case "deskKillSwitch":
      return "KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH";
    default: {
      const _exhaustive: never = action;
      return String(_exhaustive);
    }
  }
}

/**
 * Registry contentHash actions must never double-submit (ChronicleRegistry reverts).
 */
export function isSingleExecuteAction(action: McpWriteAction): boolean {
  return (
    action === "publishAlert" ||
    action === "publishDigest" ||
    action === "publishSponsoredReport" ||
    action === "publishPremiumReceipt" ||
    action === "publishTradeTicket"
  );
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

export function pickWorkflowId(
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

/** True when the registry (or KH) reported a duplicate contentHash publish. */
export function isAlreadyPublishedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already published") ||
    m.includes("alert already published") ||
    m.includes("digest already published") ||
    m.includes("report already published") ||
    m.includes("sponsored report already published") ||
    m.includes("premium receipt already published") ||
    m.includes("trade ticket already published")
  );
}

/**
 * Identify an RPC transport timeout without treating KeeperHub's own polling
 * deadline as retryable. A workflow may have submitted a transaction before a
 * polling deadline, so only viem/RPC timeout-shaped errors may switch routes.
 */
export function isRpcTimeoutError(error: unknown): boolean {
  const messages: string[] = [];
  if (typeof error === "string") messages.push(error);
  const seen = new Set<object>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
    }
    const record = current as Record<string, unknown>;
    for (const key of ["message", "reason", "code", "error", "details"]) {
      const value = record[key];
      if (typeof value === "string") messages.push(value);
    }
    current = record.cause;
  }

  const message = messages.join(" ");
  if (/timed out waiting for keeperhub/i.test(message)) return false;
  return (
    /\bTIMEOUT\b/i.test(message) ||
    /operation\s*=\s*["']?request\.send/i.test(message) ||
    /rpc failed[^\n]*\btimeout\b/i.test(message)
  );
}

export function collectExecutionIds(toolCalls: KeeperHubMcpToolCallRecord[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.name !== "execute_workflow") continue;
    const id = extractExecutionId(tc.result);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Truncated tool-call summary for execution_logs (names + executionId only; no secrets).
 */
export function summarizeMcpToolCalls(
  toolCalls: KeeperHubMcpToolCallRecord[],
): Array<{ name: string; executionId?: string; isError?: boolean }> {
  return toolCalls.map((tc) => {
    const executionId = extractExecutionId(tc.result);
    const row: { name: string; executionId?: string; isError?: boolean } = {
      name: tc.name,
    };
    if (executionId) row.executionId = executionId;
    if (tc.isError) row.isError = true;
    return row;
  });
}

/**
 * Poll get_execution until terminal success/failure.
 * Never re-calls execute_workflow.
 */
export async function pollExecutionViaMcp(
  client: KeeperHubMcpClient,
  executionId: string,
  toolCalls: KeeperHubMcpToolCallRecord[],
  opts: {
    network: string;
    pollIntervalMs: number;
    pollTimeoutMs: number;
    mode: KeeperHubMcpExecuteMode;
    /** Desk multi-leg may complete without a top-level hash early; default false for desk. */
    requireTxHash?: boolean;
    signal?: AbortSignal;
  },
): Promise<KeeperHubMcpExecuteReceipt> {
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
          return receiptFromStatus(executionId, richStatus, opts.network, opts.mode, toolCalls, {
            requireTxHash: opts.requireTxHash,
          });
        }
      } catch {
        /* soft-fail logs */
      }

      return receiptFromStatus(executionId, status, opts.network, opts.mode, toolCalls, {
        requireTxHash: opts.requireTxHash,
      });
    }

    await sleep(opts.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for KeeperHub MCP execution ${executionId}` +
      (lastError ? ` (${lastError})` : ""),
  );
}

function isDeskAction(action: McpWriteAction): boolean {
  return (
    action === "deskSweep" ||
    action === "deskDefend" ||
    action === "deskRotate" ||
    action === "deskOracleArb" ||
    action === "deskKillSwitch"
  );
}

/**
 * Deterministic MCP path: list → get → execute → poll.
 * Prefer preferredWorkflowId from env when present (no accidental wrong workflow).
 */
export async function executeViaDeterministicMcp(
  client: KeeperHubMcpClient,
  params: ExecuteViaKeeperHubMcpParams,
): Promise<KeeperHubMcpExecuteReceipt> {
  const toolCalls: KeeperHubMcpToolCallRecord[] = [];
  const hints = [...(params.workflowHints ?? []), ...defaultWorkflowHints(params.action)];
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const pollTimeoutMs = params.pollTimeoutMs ?? 120_000;
  const wait = params.wait !== false;
  // singleExecute is enforced by calling execute_workflow exactly once below.
  // Callers set singleExecute for registry contentHash actions (never re-submit).
  void (params.singleExecute !== false || isSingleExecuteAction(params.action));

  let workflowId = params.preferredWorkflowId?.trim();

  // Discover routes (still list when preferred id set so toolCalls show discovery)
  const listRes = await client.callTool("list_workflows", {});
  toolCalls.push({
    name: "list_workflows",
    arguments: {},
    result: listRes.data,
    isError: listRes.isError,
  });
  if (!listRes.isError) {
    workflowId = pickWorkflowId(listRes.data, hints, params.preferredWorkflowId) ?? workflowId;
  }

  // preferred ID always wins when provided
  if (params.preferredWorkflowId?.trim()) {
    workflowId = params.preferredWorkflowId.trim();
  }

  if (!workflowId) {
    throw new Error(
      `KeeperHub MCP could not resolve a workflow for ${params.action}. ` +
        `Set ${envNameForMcpWriteAction(params.action)} ` +
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
    throw new Error(`KeeperHub MCP get_workflow failed for ${workflowId}: ${getRes.text}`);
  }

  // Exactly one execute_workflow per deterministic session (single-execute guard).
  const executeArgs: Record<string, unknown> = {
    workflowId,
    input: params.workflowInput,
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
    throw new Error(`KeeperHub MCP execute_workflow failed: ${execRes.text}`);
  }

  const executionId = extractExecutionId(execRes.data);
  if (!executionId) {
    throw new Error("KeeperHub MCP execute_workflow response missing executionId");
  }

  if (!wait) {
    return {
      keeperHubRunId: executionId,
      txHash: "",
      explorerUrl: "",
      mode: "deterministic-mcp",
      toolCalls,
      status: "started",
    };
  }

  return pollExecutionViaMcp(client, executionId, toolCalls, {
    network: params.network,
    pollIntervalMs,
    pollTimeoutMs,
    mode: "deterministic-mcp",
    // Desk multi-leg may finish without a single top-level hash early.
    requireTxHash: !isDeskAction(params.action),
    ...(params.signal ? { signal: params.signal } : {}),
  });
}

/**
 * Full session: connect → deterministic execute → close.
 * Used by write client / desk bridge for non-LangChain MCP paths.
 */
export async function executeViaKeeperHubMcp(
  params: ExecuteViaKeeperHubMcpParams,
): Promise<KeeperHubMcpExecuteReceipt> {
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
    return await executeViaDeterministicMcp(client, params);
  } finally {
    await client.close();
  }
}

/**
 * Map a write-client / desk method name to McpWriteAction.
 */
export function mcpActionFromWriteMethod(
  method:
    | "publishAlert"
    | "publishDigest"
    | "createSponsoredWatch"
    | "publishSponsoredReport"
    | "publishPremiumReceipt"
    | "recordPayout"
    | "publishTradeTicket"
    | "recordCapitalMove"
    | "transfer",
): McpWriteAction {
  return method;
}

export function mcpActionFromDeskAction(
  action: "sweep" | "defend" | "rotate" | "oracle_arb" | "kill_switch",
): McpWriteAction {
  switch (action) {
    case "sweep":
      return "deskSweep";
    case "defend":
      return "deskDefend";
    case "rotate":
      return "deskRotate";
    case "oracle_arb":
      return "deskOracleArb";
    case "kill_switch":
      return "deskKillSwitch";
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown desk action: ${_exhaustive}`);
    }
  }
}
