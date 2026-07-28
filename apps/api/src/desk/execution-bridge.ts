/**
 * Desk execution bridge: sole path to trigger KeeperHub strategy/capital workflows.
 * Mirrors registry write client discipline:
 * - Only POST /api/workflows/{id}/execute with org API key
 * - Require env workflow IDs; fail hard if missing
 * - Store keeper_hub_run_id; poll status when wait=true
 * - Never mock fills
 */

import type { DeskStrategy } from "@chronicleai/schemas";
import type { ExecutionLogRepository } from "@chronicleai/db";
import {
  extractGasFromKeeperHubPayload,
  type OnChainWriteReceipt,
} from "../services/on-chain-write-receipt.ts";
import {
  isExecutionLogEntityUuid,
  withKeeperHubLog,
} from "../services/keeperhub-execution-log.ts";

export type DeskWorkflowAction =
  | "sweep"
  | "defend"
  | "rotate"
  | "oracle_arb"
  | "kill_switch";

export interface DeskWorkflowIds {
  sweep?: string | undefined;
  defend?: string | undefined;
  rotate?: string | undefined;
  oracleArb?: string | undefined;
  killSwitch?: string | undefined;
}

export interface ExecutionBridgeConfig {
  apiBaseUrl: string;
  apiKey: string;
  network: string;
  workflowIds: DeskWorkflowIds;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /**
   * When set, every desk workflow execute is wrapped with
   * started/succeeded/failed `desk_workflow` execution_logs rows.
   */
  execLogRepo?: ExecutionLogRepository | null;
}

export interface DeskWorkflowReceipt extends OnChainWriteReceipt {
  keeperHubRunId: string;
  /** May be empty when workflow is multi-step off-chain until final tx. */
  txHash: string;
  /**
   * All on-chain hashes returned by KeeperHub for multi-leg workflows
   * (e.g. withdraw + swap). `txHash` is the first/primary hash.
   */
  txHashes?: string[] | undefined;
  /** Explorer links parallel to txHashes when available. */
  explorerUrls?: string[] | undefined;
  explorerUrl: string;
  status: string;
  result?: unknown;
}

export interface ExecutionBridge {
  /** Start workflow; optionally wait for terminal status. */
  execute(
    action: DeskWorkflowAction,
    input: Record<string, unknown>,
    options?: { wait?: boolean; idempotencyKey?: string },
  ): Promise<DeskWorkflowReceipt>;

  /** Map strategy → workflow action. */
  actionForStrategy(strategy: DeskStrategy): DeskWorkflowAction;

  /** Fail hard when workflow ID missing. */
  requireWorkflowId(action: DeskWorkflowAction): string;

  isConfigured(action?: DeskWorkflowAction): boolean;
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
  errorContext?: { error?: string | null; failedNodeId?: string | null } | null;
  completed?: boolean;
  output?: unknown;
  gasUsed?: string | number;
  gasUsedUnits?: string | number;
  gasUsedWei?: string | number;
}

const ACTION_ENV: Record<DeskWorkflowAction, string> = {
  sweep: "KEEPERHUB_WORKFLOW_DESK_SWEEP",
  defend: "KEEPERHUB_WORKFLOW_DESK_DEFEND",
  rotate: "KEEPERHUB_WORKFLOW_DESK_ROTATE",
  oracle_arb: "KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB",
  kill_switch: "KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH",
};

const ACTION_KEY: Record<DeskWorkflowAction, keyof DeskWorkflowIds> = {
  sweep: "sweep",
  defend: "defend",
  rotate: "rotate",
  oracle_arb: "oracleArb",
  kill_switch: "killSwitch",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTx(status: ExecuteStatusResponse): {
  txHash?: string;
  explorerUrl?: string;
  txHashes?: string[];
  explorerUrls?: string[];
} {
  const hashes: string[] = [];
  const explorers: string[] = [];

  if (Array.isArray(status.transactionHashes)) {
    for (const entry of status.transactionHashes) {
      if (entry && typeof entry.hash === "string" && entry.hash.length > 0) {
        hashes.push(entry.hash);
        explorers.push(
          typeof entry.transactionLink === "string" && entry.transactionLink.length > 0
            ? entry.transactionLink
            : "",
        );
      }
    }
  }

  // Top-level single hash may be the only one or a primary not listed in the array.
  if (
    typeof status.transactionHash === "string" &&
    status.transactionHash.length > 0 &&
    !hashes.includes(status.transactionHash)
  ) {
    hashes.unshift(status.transactionHash);
    explorers.unshift(
      typeof status.transactionLink === "string" && status.transactionLink.length > 0
        ? status.transactionLink
        : "",
    );
  }

  const primary = hashes[0];
  if (!primary) return {};

  const primaryExplorer =
    (explorers[0] && explorers[0].length > 0
      ? explorers[0]
      : typeof status.transactionLink === "string" && status.transactionLink.length > 0
        ? status.transactionLink
        : undefined) ?? undefined;

  return {
    txHash: primary,
    ...(primaryExplorer ? { explorerUrl: primaryExplorer } : {}),
    txHashes: hashes,
    explorerUrls: explorers,
  };
}

function isTerminalFailure(body: ExecuteStatusResponse): boolean {
  return (
    body.status === "error" ||
    body.status === "failed" ||
    body.status === "cancelled" ||
    // KeeperHub wait API often sets completed=true on terminal error runs.
    (body.completed === true &&
      typeof body.error === "string" &&
      body.error.trim().length > 0 &&
      body.status !== "success" &&
      body.status !== "completed")
  );
}

/**
 * Terminal success only when the run is done *and* not failed.
 * Never treat `completed: true` alone as success — KH returns
 * `{ status: "error", completed: true, error: "..." }` on failed nodes.
 */
function isTerminalSuccess(body: ExecuteStatusResponse): boolean {
  if (isTerminalFailure(body)) return false;
  if (body.status === "success" || body.status === "completed") return true;
  // completed without explicit error/status — only if no error field set
  if (body.completed === true) {
    const err = body.error;
    if (err == null || (typeof err === "string" && err.trim().length === 0)) {
      return true;
    }
  }
  return false;
}

/** Best-effort error string from a terminal KH status payload. */
export function extractKeeperHubError(body: ExecuteStatusResponse): string | undefined {
  if (typeof body.error === "string" && body.error.trim().length > 0) {
    return body.error.trim();
  }
  if (body.errorContext && typeof body.errorContext === "object") {
    const ctx = body.errorContext as { error?: unknown };
    if (typeof ctx.error === "string" && ctx.error.trim().length > 0) {
      return ctx.error.trim();
    }
  }
  if (body.status === "error" || body.status === "failed") {
    return `KeeperHub execution status=${body.status}`;
  }
  return undefined;
}

function explorerFallback(txHash: string, network: string): string {
  const n = network.toLowerCase();
  if (n === "sepolia" || n === "11155111") {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (n === "base-sepolia" || n === "84532") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

export function createExecutionBridge(config: ExecutionBridgeConfig): ExecutionBridge {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
  const pollIntervalMs = config.pollIntervalMs ?? 2_000;
  const pollTimeoutMs = config.pollTimeoutMs ?? 180_000;
  const workflowIds = config.workflowIds;
  const execLogRepo = config.execLogRepo ?? null;

  function requireWorkflowId(action: DeskWorkflowAction): string {
    const key = ACTION_KEY[action];
    const id = workflowIds[key]?.trim();
    if (!id) {
      throw new Error(
        `Desk execution requires workflow ID for ${action}. ` +
          `Import the matching workflow and set ${ACTION_ENV[action]}. ` +
          `Direct Execution is disabled — workflows are the only write path.`,
      );
    }
    return id;
  }

  function isConfigured(action?: DeskWorkflowAction): boolean {
    if (!config.apiBaseUrl?.trim() || !config.apiKey?.trim()) return false;
    if (!config.apiKey.startsWith("kh_")) return false;
    if (!action) {
      return Object.values(workflowIds).some((id) => Boolean(id?.trim()));
    }
    try {
      requireWorkflowId(action);
      return true;
    } catch {
      return false;
    }
  }

  function actionForStrategy(strategy: DeskStrategy): DeskWorkflowAction {
    switch (strategy) {
      case "risk_defend":
        return "defend";
      case "yield_rotation":
        return "rotate";
      case "oracle_amm":
        return "oracle_arb";
      default: {
        const _exhaustive: never = strategy;
        throw new Error(`Unknown desk strategy: ${_exhaustive}`);
      }
    }
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
    return fetch(`${baseUrl}${path}`, { ...rest, headers });
  }

  async function startWorkflow(
    workflowId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await authorizedFetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/execute`,
      {
        method: "POST",
        body: JSON.stringify({ input }),
        idempotencyKey,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `KeeperHub desk workflow execute failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }
    const body = (await res.json()) as ExecuteStartResponse;
    if (!body.executionId) {
      throw new Error("KeeperHub desk workflow execute response missing executionId");
    }
    return body.executionId;
  }

  function receiptFromStatus(
    executionId: string,
    body: ExecuteStatusResponse,
  ): DeskWorkflowReceipt {
    const extracted = extractTx(body);
    const gas = extractGasFromKeeperHubPayload(body);
    // Strategy workflows may complete multi-step without a single top-level hash early on;
    // still return run id. Callers must not invent fills — only use real txHash when present.
    const hash = extracted.txHash ?? "";
    const hashes = extracted.txHashes ?? (hash ? [hash] : []);
    const explorers = (extracted.explorerUrls ?? []).map((url, i) =>
      url && url.length > 0
        ? url
        : hashes[i]
          ? explorerFallback(hashes[i]!, config.network)
          : "",
    );
    return {
      keeperHubRunId: executionId,
      txHash: hash,
      ...(hashes.length > 0 ? { txHashes: hashes } : {}),
      ...(explorers.some((u) => u.length > 0) ? { explorerUrls: explorers } : {}),
      explorerUrl:
        extracted.explorerUrl ??
        (hash ? explorerFallback(hash, config.network) : ""),
      status: body.status ?? (body.completed ? "completed" : "unknown"),
      result: body.result ?? body.output,
      ...(gas.gasUsed ? { gasUsed: gas.gasUsed } : {}),
      ...(gas.gasUsedWei ? { gasUsedWei: gas.gasUsedWei } : {}),
    };
  }

  async function pollUntilComplete(executionId: string): Promise<DeskWorkflowReceipt> {
    const started = Date.now();
    let lastError: string | undefined;

    while (Date.now() - started < pollTimeoutMs) {
      const waitRes = await authorizedFetch(
        `/api/workflows/executions/${encodeURIComponent(executionId)}/wait?timeoutMs=25000`,
        { method: "GET" },
      );

      if (waitRes.ok) {
        const body = (await waitRes.json()) as ExecuteStatusResponse;
        // Failures first: KH often returns completed=true with status=error.
        if (isTerminalFailure(body)) {
          const detail = extractKeeperHubError(body);
          throw new Error(
            detail ??
              `KeeperHub desk execution ${executionId} ended with status ${body.status}`,
          );
        }
        if (isTerminalSuccess(body)) {
          return receiptFromStatus(executionId, body);
        }
      }

      const statusRes = await authorizedFetch(
        `/api/workflows/executions/${encodeURIComponent(executionId)}/status`,
        { method: "GET" },
      );

      if (statusRes.ok) {
        const body = (await statusRes.json()) as ExecuteStatusResponse;
        if (isTerminalFailure(body)) {
          const detail = extractKeeperHubError(body);
          throw new Error(
            detail ??
              `KeeperHub desk execution ${executionId} ended with status ${body.status}`,
          );
        }
        if (isTerminalSuccess(body)) {
          return receiptFromStatus(executionId, body);
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
      `Timed out waiting for KeeperHub desk execution ${executionId}${lastError ? ` (${lastError})` : ""}`,
    );
  }

  return {
    requireWorkflowId,
    isConfigured,
    actionForStrategy,

    async execute(action, input, options) {
      const workflowId = requireWorkflowId(action);
      const wait = options?.wait ?? true;
      const idempotencyKey =
        options?.idempotencyKey ??
        `desk-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const payload = {
        ...input,
        network: input.network ?? config.network,
      };

      // entity_id is UUID. Only desk intent ids qualify — never KH workflow IDs
      // or free-form idempotency keys (PostgREST rejects non-UUID entity_id).
      const intentId =
        typeof input.intentId === "string" ? input.intentId : null;
      const entityId = isExecutionLogEntityUuid(intentId) ? intentId : null;

      return withKeeperHubLog(
        execLogRepo,
        {
          actionType: "desk_workflow",
          entityType: entityId ? "desk_intent" : "desk_workflow",
          entityId,
          method: action,
          details: {
            action,
            workflowId,
            network: config.network,
            wait,
            idempotencyKey,
            ...(intentId && !entityId ? { intent_id_raw: intentId } : {}),
          },
        },
        async () => {
          const executionId = await startWorkflow(workflowId, payload, idempotencyKey);

          if (!wait) {
            return {
              keeperHubRunId: executionId,
              txHash: "",
              explorerUrl: "",
              status: "started",
            } satisfies DeskWorkflowReceipt;
          }

          return pollUntilComplete(executionId);
        },
        {
          receiptFromResult: (receipt) => ({
            keeperHubRunId: receipt.keeperHubRunId,
            txHash: receipt.txHash || undefined,
            explorerUrl: receipt.explorerUrl || undefined,
            gasUsed: receipt.gasUsed,
            gasUsedWei: receipt.gasUsedWei,
            status: receipt.status,
          }),
        },
      );
    },
  };
}

/** Build bridge config from ServerEnv desk + KeeperHub fields. */
export function deskWorkflowIdsFromEnv(env: {
  keeperhubWorkflowDeskSweep?: string | undefined;
  keeperhubWorkflowDeskDefend?: string | undefined;
  keeperhubWorkflowDeskRotate?: string | undefined;
  keeperhubWorkflowDeskOracleArb?: string | undefined;
  keeperhubWorkflowDeskKillSwitch?: string | undefined;
}): DeskWorkflowIds {
  return {
    sweep: env.keeperhubWorkflowDeskSweep,
    defend: env.keeperhubWorkflowDeskDefend,
    rotate: env.keeperhubWorkflowDeskRotate,
    oracleArb: env.keeperhubWorkflowDeskOracleArb,
    killSwitch: env.keeperhubWorkflowDeskKillSwitch,
  };
}

export function createExecutionBridgeFromEnv(
  env: {
    keeperhubApiBaseUrl?: string | undefined;
    keeperhubApiKey?: string | undefined;
    keeperhubNetwork: string;
    keeperhubWorkflowDeskSweep?: string | undefined;
    keeperhubWorkflowDeskDefend?: string | undefined;
    keeperhubWorkflowDeskRotate?: string | undefined;
    keeperhubWorkflowDeskOracleArb?: string | undefined;
    keeperhubWorkflowDeskKillSwitch?: string | undefined;
  },
  options?: { execLogRepo?: ExecutionLogRepository | null },
): ExecutionBridge | null {
  const base = env.keeperhubApiBaseUrl?.trim();
  const key = env.keeperhubApiKey?.trim();
  if (!base || !key || !key.startsWith("kh_")) {
    return null;
  }
  return createExecutionBridge({
    apiBaseUrl: base,
    apiKey: key,
    network: env.keeperhubNetwork,
    workflowIds: deskWorkflowIdsFromEnv(env),
    execLogRepo: options?.execLogRepo ?? null,
  });
}
