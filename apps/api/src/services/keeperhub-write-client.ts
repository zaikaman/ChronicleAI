// KeeperHub write client: sole production path for material on-chain writes.
// Registry and transfer writes go exclusively through pre-imported KeeperHub
// workflows (POST /api/workflows/{id}/execute). Direct Execution
// (/api/execute/contract-call, /api/execute/transfer) is not used.
//
// ABI aligned with IDEA Chronicle Registry signatures:
//   publishAlert(contentHash, sourceEventHash, contentUri)
//   publishDigest(contentHash, sourceEventRoot, contentUri)
//   createSponsoredWatch(..., uint64 startsAt, endsAt)
//   publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri)
//   recordPayout(...)
//   publishPremiumReceipt(...) — reportType PremiumReceipt
//   publishTradeTicket(ticketHash, signalHash, intentHash, contentUri) — desk proof
//   recordCapitalMove(moveId, from, to, amount, reasonHash) — desk capital audit

import { keccak256, parseUnits, stringToBytes } from "viem";
import type { ExecutionLogRepository } from "@chronicleai/db";
import {
  isAlreadyPublishedError,
  publishViaKeeperHubMcp,
} from "../agents/langchain/keeperhub-mcp-publication-agent.ts";
import { resolveKeeperHubMcpUrl } from "./keeperhub-mcp-client.ts";
import {
  executeViaKeeperHubMcp,
  isAlreadyPublishedError as isAlreadyPublishedErrorShared,
  isSingleExecuteAction,
  mcpActionFromWriteMethod,
  summarizeMcpToolCalls,
  type McpWriteAction,
} from "./keeperhub-mcp-execute.ts";
import type { LLMProviderMap } from "./llm-provider-client.ts";
import {
  extractGasFromKeeperHubPayload,
  type OnChainWriteReceipt,
} from "./on-chain-write-receipt.ts";
import {
  actionTypeForWriteMethod,
  withKeeperHubLog,
} from "./keeperhub-execution-log.ts";
import {
  buildPrivateRoutingDetails,
  type PrivateRoutingPolicy,
  type RoutingDetails,
} from "./routing-metadata.ts";
import {
  fetchAndDecodeWatchIdFromTxHash,
  parseOnChainWatchId,
  requireOnChainWatchId,
} from "./sponsored-watch-id.ts";

export interface KeeperHubWriteReceipt extends OnChainWriteReceipt {
  keeperHubRunId: string;
  txHash: string;
  explorerUrl: string;
  /** Decoded return value when available (e.g. createSponsoredWatch watchId). */
  result?: unknown;
}

/**
 * Pre-imported KeeperHub workflow IDs. Every write method requires its
 * corresponding ID — there is no Direct Execution fallback.
 */
export interface KeeperHubWorkflowIds {
  publishAlert?: string;
  publishDigest?: string;
  createSponsoredWatch?: string;
  publishSponsoredReport?: string;
  publishPremiumReceipt?: string;
  recordPayout?: string;
  publishTradeTicket?: string;
  recordCapitalMove?: string;
  transfer?: string;
}

export interface KeeperHubMcpWriteOptions {
  /**
   * When true, all material write methods prefer KeeperHub MCP
   * (list_workflows → execute_workflow → get_execution). REST remains fallback.
   * Default true when mcp config is present.
   */
  enabled?: boolean;
  /** Full MCP URL; defaults to `${apiBaseUrl}/mcp`. */
  mcpUrl?: string;
  /**
   * LLM providers for the LangChain ReAct path (alert/digest only).
   * When empty/missing, alert/digest still use deterministic MCP.
   */
  llmProviders?: LLMProviderMap | null;
  /**
   * When true (default), alert/digest may use LangChain ReAct when LLM keys exist.
   * Other write methods always use deterministic MCP.
   */
  langchainAgent?: boolean;
  /** Fall back to REST workflow execute if MCP fails. Default true. */
  restFallback?: boolean;
}

export interface KeeperHubWriteClientConfig {
  apiBaseUrl: string;
  apiKey: string;
  network: string;
  registryAddress: string;
  /**
   * ERC-20 used for treasury payouts (x402 USDC by default).
   * Required for sendTransfer (USDC human units → on-chain ERC-20 transfer).
   */
  usdcAddress: string;
  /** USDC decimals (Circle USDC = 6). */
  usdcDecimals?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Required for all writes — map 1:1 to workflows/keeperhub/*.workflow.json imports. */
  workflowIds?: KeeperHubWorkflowIds;
  /**
   * When set, every workflow execute is wrapped with started/succeeded/failed
   * execution_logs rows (Phase 3 observability). Soft-fails never block writes.
   */
  execLogRepo?: ExecutionLogRepository | null;
  /**
   * Routing policy for registry logs (Phase 2).
   * When set, execution_logs.details include routing metadata.
   * Treasury transfers always override this with public routing metadata.
   */
  routingPolicy?: PrivateRoutingPolicy | null;
  /** Override routing for recordPayout; sendTransfer is always public. */
  transferRoutingPolicy?: PrivateRoutingPolicy | null;
  /**
   * KeeperHub MCP preferred path for all material writes.
   * Alert/digest may use LangChain ReAct; others use deterministic MCP.
   * REST workflow execute remains fallback when restFallback is true.
   */
  mcp?: KeeperHubMcpWriteOptions | null;
}

export interface KeeperHubWriteClient {
  publishAlert(
    contentHash: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  publishDigest(
    contentHash: string,
    sourceEventRoot: string,
    contentUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  createSponsoredWatch(
    targetContract: string,
    watchSpecHash: string,
    startsAt: number,
    endsAt: number,
  ): Promise<KeeperHubWriteReceipt & { watchId: number }>;
  publishSponsoredReport(
    watchId: number,
    reportHash: string,
    sourceEventRoot: string,
    contentUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  publishPremiumReceipt(
    contentHash: string,
    sourceEventHash: string,
    contentUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  recordPayout(
    payoutPeriodHash: string,
    recipient: string,
    amount: number,
    reasonHash: string,
  ): Promise<KeeperHubWriteReceipt>;
  /**
   * Anchor a desk trade ticket on-chain.
   * Requires KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET.
   * contentUri should be the public ticket page (e.g. https://…/desk/tickets/:id).
   */
  publishTradeTicket(
    ticketHash: string,
    signalHash: string,
    intentHash: string,
    contentUri: string,
  ): Promise<KeeperHubWriteReceipt>;
  /**
   * Record a desk capital move (top-up / sweep / emergency return) on-chain.
   * amountUsdc is human USDC units; encoded as 6-decimal base units on-chain.
   * Requires KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE.
   */
  recordCapitalMove(
    moveId: string,
    from: string,
    to: string,
    amountUsdc: number,
    reasonHash: string,
  ): Promise<KeeperHubWriteReceipt>;
  /**
   * Transfer treasury USDC to a recipient (human USDC units, e.g. 12.5).
   * Requires KEEPERHUB_WORKFLOW_TRANSFER (transfer workflow ID).
   */
  sendTransfer(to: string, amountUsdc: number): Promise<KeeperHubWriteReceipt>;
}

/** IDEA-aligned ChronicleRegistry ABI fragment (encoding helpers / Para path). */
export const REGISTRY_ABI = [
  "function publishAlert(bytes32 contentHash, bytes32 sourceEventHash, string calldata contentUri) external",
  "function publishDigest(bytes32 contentHash, bytes32 sourceEventRoot, string calldata contentUri) external",
  "function createSponsoredWatch(address targetContract, bytes32 watchSpecHash, uint64 startsAt, uint64 endsAt) external returns (uint256 watchId)",
  "function publishSponsoredReport(uint256 watchId, bytes32 reportHash, bytes32 sourceEventRoot, string calldata contentUri) external",
  "function publishPremiumReceipt(bytes32 contentHash, bytes32 sourceEventHash, string calldata contentUri) external",
  "function recordPayout(bytes32 payoutPeriodHash, address recipient, uint256 amount, bytes32 reasonHash) external",
  "function publishTradeTicket(bytes32 ticketHash, bytes32 signalHash, bytes32 intentHash, string calldata contentUri) external",
  "function recordCapitalMove(bytes32 moveId, address from, address to, uint256 amount, bytes32 reasonHash) external",
] as const;

function hashString(input: string): string {
  return keccak256(stringToBytes(input));
}

/**
 * Normalize a hash-like input to a bytes32 hex string.
 * Already-0x-prefixed 32-byte hashes are passed through; other strings are keccak256'd.
 */
export function toBytes32Hash(input: string): string {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return hashString(trimmed);
}

/** Clamp a unix-second timestamp into uint64 range for createSponsoredWatch. */
export function toUint64Seconds(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid uint64 timestamp: ${value}`);
  }
  const floored = Math.floor(value);
  // uint64 max
  if (floored > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Timestamp exceeds safe integer range: ${value}`);
  }
  return BigInt(floored);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExecuteStartResponse {
  executionId?: string;
  status?: string;
  error?: string;
  message?: string;
}

interface ExecuteStatusResponse {
  executionId?: string;
  status?: string;
  transactionHash?: string;
  transactionLink?: string;
  transactionHashes?: Array<{ hash?: string; transactionLink?: string }>;
  result?: unknown;
  error?: string | null;
  completed?: boolean;
  output?: unknown;
  gasUsed?: string | number;
  gasUsedUnits?: string | number;
  gasUsedWei?: string | number;
}

const WORKFLOW_ACTION_ENV: Record<keyof KeeperHubWorkflowIds, string> = {
  publishAlert: "KEEPERHUB_WORKFLOW_PUBLISH_ALERT",
  publishDigest: "KEEPERHUB_WORKFLOW_PUBLISH_DIGEST",
  createSponsoredWatch: "KEEPERHUB_WORKFLOW_CREATE_SPONSORED_WATCH",
  publishSponsoredReport: "KEEPERHUB_WORKFLOW_PUBLISH_SPONSORED_REPORT",
  publishPremiumReceipt: "KEEPERHUB_WORKFLOW_PUBLISH_PREMIUM_RECEIPT",
  recordPayout: "KEEPERHUB_WORKFLOW_RECORD_PAYOUT",
  publishTradeTicket: "KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET",
  recordCapitalMove: "KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE",
  transfer: "KEEPERHUB_WORKFLOW_TRANSFER",
};

function requireWorkflowId(
  workflowIds: KeeperHubWorkflowIds,
  action: keyof KeeperHubWorkflowIds,
): string {
  const id = workflowIds[action]?.trim();
  if (!id) {
    const envName = WORKFLOW_ACTION_ENV[action];
    throw new Error(
      `KeeperHub write requires workflow ID for ${action}. ` +
        `Import the matching workflow from workflows/keeperhub/ and set ${envName}. ` +
        `Direct Execution is disabled — workflows are the only write path.`,
    );
  }
  return id;
}

function extractTx(status: ExecuteStatusResponse): { txHash?: string; explorerUrl?: string } {
  if (typeof status.transactionHash === "string" && status.transactionHash.length > 0) {
    const out: { txHash?: string; explorerUrl?: string } = {
      txHash: status.transactionHash,
    };
    if (typeof status.transactionLink === "string" && status.transactionLink.length > 0) {
      out.explorerUrl = status.transactionLink;
    }
    return out;
  }

  const first = status.transactionHashes?.[0];
  if (first && typeof first.hash === "string" && first.hash.length > 0) {
    const out: { txHash?: string; explorerUrl?: string } = {
      txHash: first.hash,
    };
    if (typeof first.transactionLink === "string" && first.transactionLink.length > 0) {
      out.explorerUrl = first.transactionLink;
    }
    return out;
  }

  return {};
}

function isTerminalSuccess(body: ExecuteStatusResponse): boolean {
  return (
    body.completed === true ||
    body.status === "success" ||
    body.status === "completed"
  );
}

function isTerminalFailure(body: ExecuteStatusResponse): boolean {
  return (
    body.status === "error" ||
    body.status === "failed" ||
    body.status === "cancelled"
  );
}

function receiptFromStatus(
  executionId: string,
  body: ExecuteStatusResponse,
  network: string,
): KeeperHubWriteReceipt {
  const { txHash, explorerUrl } = extractTx(body);
  if (!txHash) {
    throw new Error(
      `KeeperHub execution ${executionId} completed without a transaction hash`,
    );
  }
  const gas = extractGasFromKeeperHubPayload(body);
  return {
    keeperHubRunId: executionId,
    txHash,
    explorerUrl: explorerUrl ?? buildFallbackExplorerUrl(txHash, network),
    result: body.result ?? body.output,
    ...(gas.gasUsed ? { gasUsed: gas.gasUsed } : {}),
    ...(gas.gasUsedWei ? { gasUsedWei: gas.gasUsedWei } : {}),
  };
}

/** @deprecated Use parseOnChainWatchId from sponsored-watch-id.ts */
function parseWatchId(result: unknown): number | undefined {
  return parseOnChainWatchId(result);
}

function mcpReceiptToWriteReceipt(receipt: {
  keeperHubRunId: string;
  txHash: string;
  explorerUrl: string;
  gasUsed?: string;
  gasUsedWei?: string;
  result?: unknown;
}): KeeperHubWriteReceipt {
  const out: KeeperHubWriteReceipt = {
    keeperHubRunId: receipt.keeperHubRunId,
    txHash: receipt.txHash,
    explorerUrl: receipt.explorerUrl,
  };
  if (receipt.gasUsed) out.gasUsed = receipt.gasUsed;
  if (receipt.gasUsedWei) out.gasUsedWei = receipt.gasUsedWei;
  if (receipt.result !== undefined) out.result = receipt.result;
  return out;
}

function alreadyPublished(message: string): boolean {
  return isAlreadyPublishedError(message) || isAlreadyPublishedErrorShared(message);
}

export function createKeeperHubWriteClient(
  config: KeeperHubWriteClientConfig,
): KeeperHubWriteClient {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
  const pollIntervalMs = config.pollIntervalMs ?? 2_000;
  const pollTimeoutMs = config.pollTimeoutMs ?? 120_000;
  const workflowIds = config.workflowIds ?? {};
  const execLogRepo = config.execLogRepo ?? null;
  // MCP is opt-in via config.mcp (web3 client passes this from env when enabled).
  // Existing REST-only unit tests omit mcp and keep the pure workflow execute path.
  const mcpOpts = config.mcp ?? null;
  const mcpEnabled =
    mcpOpts != null &&
    mcpOpts.enabled !== false &&
    Boolean(config.apiKey?.trim());
  const mcpUrl = resolveKeeperHubMcpUrl(baseUrl, mcpOpts?.mcpUrl);
  const mcpRestFallback = mcpOpts?.restFallback !== false;
  const mcpLangchainAgent = mcpOpts?.langchainAgent !== false;

  function routingDetailsForMethod(
    method: keyof typeof WORKFLOW_ACTION_ENV,
  ): RoutingDetails | null {
    if (method === "transfer") {
      const policy = config.transferRoutingPolicy ?? config.routingPolicy;
      return policy
        ? buildPrivateRoutingDetails({
            ...policy,
            enabled: false,
            strict: false,
            provider: "public",
          })
        : null;
    }
    if (method === "recordPayout") {
      const policy = config.transferRoutingPolicy ?? config.routingPolicy;
      return policy ? buildPrivateRoutingDetails(policy) : null;
    }
    return config.routingPolicy
      ? buildPrivateRoutingDetails(config.routingPolicy)
      : null;
  }

  /**
   * Prefer KeeperHub MCP for any write method; REST fallback when allowed.
   * Alert/digest may use LangChain ReAct; all others use deterministic MCP.
   */
  async function runViaMcpOrRest(
    method: keyof typeof WORKFLOW_ACTION_ENV,
    workflowId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    logDetails?: Record<string, unknown>,
  ): Promise<KeeperHubWriteReceipt> {
    if (!mcpEnabled) {
      return runWorkflowLogged(method, workflowId, input, idempotencyKey, {
        executionPath: "rest",
        ...(logDetails ?? {}),
      });
    }

    const mcpAction: McpWriteAction = mcpActionFromWriteMethod(method);
    const useLangChain =
      mcpLangchainAgent &&
      (method === "publishAlert" || method === "publishDigest");
    const routing = routingDetailsForMethod(method);

    return withKeeperHubLog(
      execLogRepo,
      {
        actionType: actionTypeForWriteMethod(method),
        entityType: "keeperhub_workflow",
        entityId: null,
        method,
        details: {
          workflowId,
          network: config.network,
          executionPath: "mcp",
          execution_surface: useLangChain ? "langchain_mcp" : "deterministic_mcp",
          mcp_url: mcpUrl,
          ...(routing ?? {}),
          ...(logDetails ?? {}),
        },
      },
      async () => {
        try {
          if (useLangChain) {
            const mcpReceipt = await publishViaKeeperHubMcp({
              action: method as "publishAlert" | "publishDigest",
              input,
              preferredWorkflowId: workflowId,
              mcp: {
                mcpUrl,
                apiKey: config.apiKey,
              },
              llmProviders: mcpOpts?.llmProviders ?? null,
              network: config.network,
              pollIntervalMs,
              pollTimeoutMs,
              idempotencyKey,
            });
            console.info(
              `[keeperhub-mcp] ${method} succeeded via ${mcpReceipt.mode}` +
                (mcpReceipt.provider ? ` (provider=${mcpReceipt.provider})` : "") +
                ` run=${mcpReceipt.keeperHubRunId} tx=${mcpReceipt.txHash}`,
            );
            return mcpReceiptToWriteReceipt(mcpReceipt);
          }

          const mcpReceipt = await executeViaKeeperHubMcp({
            action: mcpAction,
            workflowInput: input,
            preferredWorkflowId: workflowId,
            mcp: {
              mcpUrl,
              apiKey: config.apiKey,
            },
            network: config.network,
            pollIntervalMs,
            pollTimeoutMs,
            idempotencyKey,
            singleExecute: isSingleExecuteAction(mcpAction),
            wait: true,
          });
          console.info(
            `[keeperhub-mcp] ${method} succeeded via ${mcpReceipt.mode}` +
              ` run=${mcpReceipt.keeperHubRunId} tx=${mcpReceipt.txHash}` +
              ` tools=${summarizeMcpToolCalls(mcpReceipt.toolCalls)
                .map((t) => t.name)
                .join(",")}`,
          );
          return mcpReceiptToWriteReceipt(mcpReceipt);
        } catch (mcpError) {
          const message =
            mcpError instanceof Error ? mcpError.message : String(mcpError);

          // Registry already has this contentHash. REST re-submit will only
          // burn gas and fail again with the same revert.
          if (alreadyPublished(message)) {
            console.warn(
              `[keeperhub-mcp] ${method} refused REST fallback — contentHash ` +
                `already published on-chain: ${message}`,
            );
            throw mcpError instanceof Error
              ? mcpError
              : new Error(`KeeperHub MCP ${method} failed: ${message}`);
          }

          if (!mcpRestFallback) {
            throw mcpError instanceof Error
              ? mcpError
              : new Error(`KeeperHub MCP ${method} failed: ${message}`);
          }
          console.warn(
            `[keeperhub-mcp] ${method} MCP path failed, falling back to REST workflow execute: ${message}`,
          );
          // Inside withKeeperHubLog — call raw runWorkflow to avoid double-log rows.
          // Mark path as rest for the success receipt details merge below via extra.
          const receipt = await runWorkflow(workflowId, input, idempotencyKey);
          return receipt;
        }
      },
      {
        receiptFromResult: (receipt) => ({
          keeperHubRunId: receipt.keeperHubRunId,
          txHash: receipt.txHash,
          explorerUrl: receipt.explorerUrl,
          gasUsed: receipt.gasUsed,
          gasUsedWei: receipt.gasUsedWei,
        }),
      },
    );
  }

  async function authorizedFetch(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    if (init.idempotencyKey) {
      headers.set("Idempotency-Key", init.idempotencyKey);
    }

    const { idempotencyKey: _key, ...rest } = init;
    return fetch(`${baseUrl}${path}`, {
      ...rest,
      headers,
    });
  }

  /**
   * Poll workflow execution only (wait → status). No Direct Execution status path.
   */
  async function pollUntilComplete(executionId: string): Promise<KeeperHubWriteReceipt> {
    const started = Date.now();
    let lastError: string | undefined;

    while (Date.now() - started < pollTimeoutMs) {
      const waitRes = await authorizedFetch(
        `/api/workflows/executions/${encodeURIComponent(executionId)}/wait?timeoutMs=25000`,
        { method: "GET" },
      );

      if (waitRes.ok) {
        const body = (await waitRes.json()) as ExecuteStatusResponse;
        if (isTerminalSuccess(body)) {
          return receiptFromStatus(executionId, body, config.network);
        }
        if (isTerminalFailure(body)) {
          const err = (body as any).errorContext?.error ?? body.error;
          throw new Error(
            err ?? `KeeperHub execution ${executionId} ended with status ${body.status}`,
          );
        }
      }

      const statusRes = await authorizedFetch(
        `/api/workflows/executions/${encodeURIComponent(executionId)}/status`,
        { method: "GET" },
      );

      if (statusRes.ok) {
        const body = (await statusRes.json()) as ExecuteStatusResponse;
        if (isTerminalSuccess(body)) {
          return receiptFromStatus(executionId, body, config.network);
        }
        if (isTerminalFailure(body)) {
          const err = (body as any).errorContext?.error ?? body.error;
          throw new Error(
            err ??
              `KeeperHub execution ${executionId} ended with status ${body.status}`,
          );
        }

        const hintHeader = statusRes.headers.get("X-Poll-Interval-Hint");
        const hintSeconds = hintHeader ? Number(hintHeader) : Number.NaN;
        if (Number.isFinite(hintSeconds) && hintSeconds > 0) {
          await sleep(hintSeconds * 1000);
          continue;
        }
      } else {
        lastError = `workflow status poll HTTP ${statusRes.status}`;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Timed out waiting for KeeperHub execution ${executionId}${lastError ? ` (${lastError})` : ""}`,
    );
  }

  async function startWorkflow(
    workflowId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await authorizedFetch(`/api/workflows/${encodeURIComponent(workflowId)}/execute`, {
      method: "POST",
      body: JSON.stringify({ input }),
      idempotencyKey,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KeeperHub workflow execute failed (${res.status}): ${text.slice(0, 400)}`);
    }

    const body = (await res.json()) as ExecuteStartResponse;
    if (!body.executionId) {
      throw new Error("KeeperHub workflow execute response missing executionId");
    }
    return body.executionId;
  }

  async function runWorkflow(
    workflowId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<KeeperHubWriteReceipt> {
    const executionId = await startWorkflow(workflowId, input, idempotencyKey);
    return pollUntilComplete(executionId);
  }

  async function runWorkflowLogged(
    method: keyof typeof WORKFLOW_ACTION_ENV,
    workflowId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    logDetails?: Record<string, unknown>,
  ): Promise<KeeperHubWriteReceipt> {
    const routing = routingDetailsForMethod(method);
    return withKeeperHubLog(
      execLogRepo,
      {
        actionType: actionTypeForWriteMethod(method),
        // entity_id is UUID-only; KeeperHub workflow IDs are opaque strings.
        // Correlate via details.workflowId / details.keeper_hub_run_id instead.
        entityType: "keeperhub_workflow",
        entityId: null,
        method,
        details: {
          workflowId,
          network: config.network,
          executionPath: "rest",
          ...(routing ?? {}),
          ...(logDetails ?? {}),
        },
      },
      () => runWorkflow(workflowId, input, idempotencyKey),
      {
        receiptFromResult: (receipt) => ({
          keeperHubRunId: receipt.keeperHubRunId,
          txHash: receipt.txHash,
          explorerUrl: receipt.explorerUrl,
          gasUsed: receipt.gasUsed,
          gasUsedWei: receipt.gasUsedWei,
        }),
      },
    );
  }

  return {
    async publishAlert(contentHash, sourceEventHash, contentUri) {
      const contentBytes = toBytes32Hash(contentHash);
      const sourceBytes = toBytes32Hash(sourceEventHash);
      const workflowId = requireWorkflowId(workflowIds, "publishAlert");
      const input = {
        contentHash: contentBytes,
        sourceEventHash: sourceBytes,
        contentUri,
        // legacy workflow key aliases
        alertHash: contentBytes,
        ipfsUri: contentUri,
        contractAddress: config.registryAddress,
        network: config.network,
      };
      return runViaMcpOrRest(
        "publishAlert",
        workflowId,
        input,
        `chronicle-publishAlert-${contentHash}-${sourceEventHash}`,
        { contentUri },
      );
    },

    async publishDigest(contentHash, sourceEventRoot, contentUri) {
      const contentBytes = toBytes32Hash(contentHash);
      const rootBytes = toBytes32Hash(sourceEventRoot);
      const workflowId = requireWorkflowId(workflowIds, "publishDigest");
      const input = {
        contentHash: contentBytes,
        sourceEventRoot: rootBytes,
        contentUri,
        // legacy workflow key aliases
        digestHash: contentBytes,
        ipfsUri: contentUri,
        contractAddress: config.registryAddress,
        network: config.network,
      };
      return runViaMcpOrRest(
        "publishDigest",
        workflowId,
        input,
        `chronicle-publishDigest-${contentHash}`,
        { contentUri },
      );
    },

    async createSponsoredWatch(targetContract, watchSpecHash, startsAt, endsAt) {
      const specBytes = toBytes32Hash(watchSpecHash);
      const starts = toUint64Seconds(startsAt);
      const ends = toUint64Seconds(endsAt);
      const workflowId = requireWorkflowId(workflowIds, "createSponsoredWatch");
      const receipt = await runViaMcpOrRest(
        "createSponsoredWatch",
        workflowId,
        {
          targetContract,
          watchSpecHash: specBytes,
          startsAt: starts.toString(),
          endsAt: ends.toString(),
          contractAddress: config.registryAddress,
          network: config.network,
        },
        `chronicle-createSponsoredWatch-${watchSpecHash}-${startsAt}-${endsAt}`,
        { targetContract, watchSpecHash, startsAt, endsAt },
      );

      // Prefer explicit return value; also scan KeeperHub status payload & RPC fallback for event-decoded id.
      let fromPayload = parseWatchId(receipt.result);
      if (fromPayload === undefined) {
        fromPayload = parseWatchId(receipt);
      }
      if (fromPayload === undefined && receipt.txHash) {
        fromPayload = await fetchAndDecodeWatchIdFromTxHash(
          receipt.txHash,
          config.network,
        );
      }

      const watchId = requireOnChainWatchId(
        fromPayload,
        `KeeperHub createSponsoredWatch run ${receipt.keeperHubRunId}`,
      );
      return { ...receipt, watchId };
    },

    async publishSponsoredReport(watchId, reportHash, sourceEventRoot, contentUri) {
      const reportBytes = toBytes32Hash(reportHash);
      const rootBytes = toBytes32Hash(sourceEventRoot);
      const workflowId = requireWorkflowId(workflowIds, "publishSponsoredReport");
      return runViaMcpOrRest(
        "publishSponsoredReport",
        workflowId,
        {
          watchId,
          reportHash: reportBytes,
          sourceEventRoot: rootBytes,
          contentUri,
          // legacy workflow key aliases
          reportContentHash: reportBytes,
          reportUri: contentUri,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        `chronicle-publishSponsoredReport-${watchId}-${reportHash}-${sourceEventRoot}`,
        { watchId, contentUri },
      );
    },

    async publishPremiumReceipt(contentHash, sourceEventHash, contentUri) {
      const contentBytes = toBytes32Hash(contentHash);
      const sourceBytes = toBytes32Hash(sourceEventHash);
      const workflowId = requireWorkflowId(workflowIds, "publishPremiumReceipt");
      return runViaMcpOrRest(
        "publishPremiumReceipt",
        workflowId,
        {
          contentHash: contentBytes,
          sourceEventHash: sourceBytes,
          contentUri,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        `chronicle-publishPremiumReceipt-${contentHash}`,
        { contentUri },
      );
    },

    async recordPayout(payoutPeriodHash, recipient, amount, reasonHash) {
      const periodBytes = toBytes32Hash(payoutPeriodHash);
      const reasonBytes = toBytes32Hash(reasonHash);
      // Registry amount is USDC base units (6 decimals), matching payment accounting.
      const amountRaw = parseUnits(
        String(amount),
        config.usdcDecimals ?? 6,
      ).toString();
      const workflowId = requireWorkflowId(workflowIds, "recordPayout");
      return runViaMcpOrRest(
        "recordPayout",
        workflowId,
        {
          payoutPeriodHash: periodBytes,
          recipient,
          amount: amountRaw,
          reasonHash: reasonBytes,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        `chronicle-recordPayout-${payoutPeriodHash}-${recipient}-${amount}`,
        { recipient, amount },
      );
    },

    async publishTradeTicket(ticketHash, signalHash, intentHash, contentUri) {
      const ticketBytes = toBytes32Hash(ticketHash);
      const signalBytes = toBytes32Hash(signalHash);
      const intentBytes = toBytes32Hash(intentHash);
      const workflowId = requireWorkflowId(workflowIds, "publishTradeTicket");
      return runViaMcpOrRest(
        "publishTradeTicket",
        workflowId,
        {
          ticketHash: ticketBytes,
          signalHash: signalBytes,
          intentHash: intentBytes,
          contentUri,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        `chronicle-publishTradeTicket-${ticketHash}`,
        { contentUri },
      );
    },

    async recordCapitalMove(moveId, from, to, amountUsdc, reasonHash) {
      const moveBytes = toBytes32Hash(moveId);
      const reasonBytes = toBytes32Hash(reasonHash);
      const amountRaw = parseUnits(
        String(amountUsdc),
        config.usdcDecimals ?? 6,
      ).toString();
      const workflowId = requireWorkflowId(workflowIds, "recordCapitalMove");
      return runViaMcpOrRest(
        "recordCapitalMove",
        workflowId,
        {
          moveId: moveBytes,
          from,
          to,
          amount: amountRaw,
          reasonHash: reasonBytes,
          contractAddress: config.registryAddress,
          network: config.network,
        },
        `chronicle-recordCapitalMove-${moveId}-${from}-${to}-${amountUsdc}`,
        { from, to, amountUsdc },
      );
    },

    async sendTransfer(to, amountUsdc) {
      const workflowId = requireWorkflowId(workflowIds, "transfer");
      const usdcAddress = config.usdcAddress.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(usdcAddress)) {
        throw new Error(
          `KeeperHub USDC transfer requires a valid usdcAddress (got ${JSON.stringify(usdcAddress)})`,
        );
      }
      const decimals = config.usdcDecimals ?? 6;
      const idempotencyKey = `chronicle-usdc-transfer-${to}-${amountUsdc}-${Date.now()}`;

      return runViaMcpOrRest(
        "transfer",
        workflowId,
        {
          recipientAddress: to,
          amount: String(amountUsdc),
          network: config.network,
          tokenAddress: usdcAddress,
          tokenConfig: JSON.stringify({
            mode: "custom",
            customToken: {
              address: usdcAddress,
              symbol: "USDC",
              decimals,
            },
          }),
        },
        idempotencyKey,
        { to, amountUsdc },
      );
    },
  };
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
  // Default product home: Ethereum Sepolia
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

export function isKeeperHubWriteConfigured(env: {
  keeperhubApiBaseUrl?: string | undefined;
  keeperhubApiKey?: string | undefined;
  chronicleRegistryAddress?: string | undefined;
}): boolean {
  return Boolean(
    env.keeperhubApiBaseUrl &&
      env.keeperhubApiKey &&
      env.chronicleRegistryAddress &&
      env.keeperhubApiKey.startsWith("kh_"),
  );
}
