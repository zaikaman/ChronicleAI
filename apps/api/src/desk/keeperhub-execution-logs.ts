/**
 * Layer B — KeeperHub execution logs client + normalizer.
 *
 * After a terminal workflow status, fetch per-node logs and map them to
 * public-safe DeskAuditRunNode rows for the execution audit outcome stage.
 *
 * Soft-fail only: never fail a desk trade because logs failed.
 *
 * @see docs/execution-audit-narrative-implementation-plan.md Phase 2
 * @see keeperhub/docs/api/executions.md (GET …/logs)
 */

import {
  buildRunNode,
  type DeskAuditOutcomeStage,
  type DeskAuditRunNode,
} from "./execution-audit.ts";

/** Max nodes stored/published on a ticket audit (plan §2.1). */
export const DESK_AUDIT_RUN_NODES_MAX = 20 as const;

/** Raw log row shape from KeeperHub GET …/logs (subset we care about). */
export interface KeeperHubExecutionLogRow {
  id?: string;
  executionId?: string;
  nodeId?: string;
  nodeName?: string | null;
  nodeType?: string | null;
  status?: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  duration?: string | number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  iterationIndex?: number | null;
  forEachNodeId?: string | null;
  timestamp?: string | null;
}

export interface KeeperHubExecutionLogsResponse {
  execution?: {
    id?: string;
    status?: string;
    gasUsedWei?: string | null;
    transactionHashes?: unknown;
  };
  logs?: KeeperHubExecutionLogRow[];
}

export interface NormalizeRunNodesResult {
  nodes: DeskAuditRunNode[];
  /** True when the raw response had a usable logs array (even if empty). */
  parsed: boolean;
  /** How many raw rows were present before cap. */
  rawCount: number;
  /** Truncated to DESK_AUDIT_RUN_NODES_MAX. */
  truncated: boolean;
}

export interface FetchExecutionLogsResult {
  logsFetched: boolean;
  logsFetchError?: string | null;
  nodes: DeskAuditRunNode[];
  /** Sum of gasUsedUnits from successful web3 write nodes (string decimal). */
  derivedGasUsedUnits?: string | null;
  /** Sum of gasUsed (wei cost) from successful web3 write nodes when present. */
  derivedGasUsedWei?: string | null;
  rawCount: number;
  truncated: boolean;
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return undefined;
}

function asDurationMs(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function isWeb3WriteNodeType(nodeType: string | null | undefined): boolean {
  if (!nodeType) return false;
  const t = nodeType.toLowerCase();
  return (
    t.startsWith("web3/") &&
    (t.includes("transfer") ||
      t.includes("approve") ||
      t.includes("write-contract") ||
      t.includes("write_contract") ||
      t.includes("swap") ||
      t.includes("repay") ||
      t.includes("supply") ||
      t.includes("withdraw") ||
      t.includes("borrow"))
  );
}

/**
 * Extract public-safe web3 fields from a KH log row output object.
 * Never copies full input/output payloads onto the node.
 */
function extractWeb3FieldsFromOutput(output: unknown): {
  txHash?: string | null;
  explorerUrl?: string | null;
  gasUsed?: string | null;
  gasUsedUnits?: string | null;
} {
  if (output === null || output === undefined || typeof output !== "object") {
    return {};
  }
  const out = output as Record<string, unknown>;
  const txHash = asOptionalString(out.transactionHash ?? out.txHash);
  const explorerUrl = asOptionalString(out.transactionLink ?? out.explorerUrl);
  // gasUsed on KH web3 success is wei cost; gasUsedUnits is units.
  const gasUsed = asOptionalString(out.gasUsed);
  const gasUsedUnits = asOptionalString(out.gasUsedUnits);
  const result: {
    txHash?: string | null;
    explorerUrl?: string | null;
    gasUsed?: string | null;
    gasUsedUnits?: string | null;
  } = {};
  if (txHash !== undefined) result.txHash = txHash;
  if (explorerUrl !== undefined && explorerUrl !== "") result.explorerUrl = explorerUrl;
  if (gasUsed !== undefined) result.gasUsed = gasUsed;
  if (gasUsedUnits !== undefined) result.gasUsedUnits = gasUsedUnits;
  return result;
}

/**
 * Map one KH log row → DeskAuditRunNode (public-safe).
 * Returns null when nodeId is missing.
 */
export function normalizeKeeperHubLogRow(
  row: KeeperHubExecutionLogRow | null | undefined,
): DeskAuditRunNode | null {
  if (!row || typeof row !== "object") return null;
  const nodeId =
    (typeof row.nodeId === "string" && row.nodeId.trim()) ||
    (typeof row.id === "string" && row.id.trim()) ||
    null;
  if (!nodeId) return null;

  const status =
    (typeof row.status === "string" && row.status.trim()) || "unknown";
  const web3 = extractWeb3FieldsFromOutput(row.output);
  const error =
    asOptionalString(row.error) ??
    (row.output &&
    typeof row.output === "object" &&
    typeof (row.output as Record<string, unknown>).error === "string"
      ? ((row.output as Record<string, unknown>).error as string)
      : undefined);

  // KH web3 success: gasUsed = wei cost, gasUsedUnits = gas units.
  // Store both as returned; UI prefers gasUsedUnits for display.
  return buildRunNode({
    nodeId,
    status,
    nodeName: asOptionalString(row.nodeName) ?? null,
    nodeType: asOptionalString(row.nodeType) ?? null,
    durationMs: asDurationMs(row.duration) ?? null,
    startedAt: asOptionalString(row.startedAt) ?? null,
    completedAt: asOptionalString(row.completedAt) ?? null,
    txHash: web3.txHash ?? null,
    explorerUrl: web3.explorerUrl ?? null,
    gasUsed: web3.gasUsed ?? null,
    gasUsedUnits: web3.gasUsedUnits ?? null,
    error: error ?? null,
  });
}

/**
 * Sort key for narrative order: startedAt ascending, then nodeId.
 * KH API returns logs descending by timestamp — we reverse for the ticket story.
 */
function startedAtSortKey(node: DeskAuditRunNode): number {
  if (node.startedAt) {
    const t = Date.parse(node.startedAt);
    if (Number.isFinite(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Normalize a KH logs response into ordered, capped DeskAuditRunNode[].
 * Drops raw input/output. Does not invent hashes or gas.
 */
export function normalizeKeeperHubExecutionLogs(
  body: KeeperHubExecutionLogsResponse | null | undefined,
  options?: { maxNodes?: number },
): NormalizeRunNodesResult {
  const maxNodes = options?.maxNodes ?? DESK_AUDIT_RUN_NODES_MAX;
  if (!body || typeof body !== "object" || !Array.isArray(body.logs)) {
    return { nodes: [], parsed: false, rawCount: 0, truncated: false };
  }

  const rawCount = body.logs.length;
  const mapped: DeskAuditRunNode[] = [];
  for (const row of body.logs) {
    const node = normalizeKeeperHubLogRow(row);
    if (node) mapped.push(node);
  }

  mapped.sort((a, b) => {
    const da = startedAtSortKey(a);
    const db = startedAtSortKey(b);
    if (da !== db) return da - db;
    return a.nodeId.localeCompare(b.nodeId);
  });

  const truncated = mapped.length > maxNodes;
  const nodes = truncated ? mapped.slice(0, maxNodes) : mapped;
  return { nodes, parsed: true, rawCount, truncated };
}

/**
 * Sum gas from successful web3 write nodes.
 * Documented as **derived** when used to fill missing receipt-level gas.
 * Prefer KH wait/status payload totals when present (plan §2.4).
 *
 * KH convention: gasUsedUnits = gas units; gasUsed = wei cost.
 * Outcome.gasUsed prefers units; outcome.gasUsedWei is wei.
 */
export function deriveGasFromRunNodes(nodes: DeskAuditRunNode[]): {
  gasUsedUnits: string | null;
  gasUsedWei: string | null;
} {
  let unitsSum = 0n;
  let weiSum = 0n;
  let hasUnits = false;
  let hasWei = false;

  for (const node of nodes) {
    const status = (node.status ?? "").toLowerCase();
    if (status !== "success" && status !== "succeeded" && status !== "completed") {
      continue;
    }
    const isWrite =
      isWeb3WriteNodeType(node.nodeType) ||
      Boolean(node.txHash) ||
      Boolean(node.gasUsedUnits) ||
      Boolean(node.gasUsed);
    if (!isWrite) continue;

    if (node.gasUsedUnits && /^\d+$/.test(node.gasUsedUnits.trim())) {
      try {
        unitsSum += BigInt(node.gasUsedUnits.trim());
        hasUnits = true;
      } catch {
        // ignore non-bigint strings
      }
    } else if (node.gasUsed && /^\d+$/.test(node.gasUsed.trim())) {
      // Units-only fallback when KH omitted gasUsedUnits (treat gasUsed as units).
      try {
        unitsSum += BigInt(node.gasUsed.trim());
        hasUnits = true;
      } catch {
        // ignore
      }
    }

    // Wei cost only when both fields present and differ (KH dual-field shape).
    if (
      node.gasUsedUnits &&
      node.gasUsed &&
      node.gasUsed.trim() !== node.gasUsedUnits.trim() &&
      /^\d+$/.test(node.gasUsed.trim())
    ) {
      try {
        weiSum += BigInt(node.gasUsed.trim());
        hasWei = true;
      } catch {
        // ignore
      }
    }
  }

  return {
    gasUsedUnits: hasUnits ? unitsSum.toString() : null,
    gasUsedWei: hasWei ? weiSum.toString() : null,
  };
}

/**
 * Attach Layer B fields onto an outcome stage.
 * Prefer existing receipt gas; only fill from derived node sums when missing.
 */
export function attachRunNodesToOutcome(
  outcome: DeskAuditOutcomeStage,
  logs: FetchExecutionLogsResult,
): DeskAuditOutcomeStage {
  const next: DeskAuditOutcomeStage = {
    ...outcome,
    runNodes: logs.nodes,
    logsFetched: logs.logsFetched,
    logsFetchError: logs.logsFetchError ?? null,
  };

  const receiptGasMissing =
    outcome.gasUsed == null ||
    outcome.gasUsed === "" ||
    (typeof outcome.gasUsed === "string" && outcome.gasUsed.trim() === "");

  if (receiptGasMissing && logs.derivedGasUsedUnits) {
    next.gasUsed = logs.derivedGasUsedUnits;
  }

  const receiptWeiMissing =
    outcome.gasUsedWei == null ||
    outcome.gasUsedWei === "" ||
    (typeof outcome.gasUsedWei === "string" && outcome.gasUsedWei.trim() === "");

  if (receiptWeiMissing && logs.derivedGasUsedWei) {
    next.gasUsedWei = logs.derivedGasUsedWei;
  }

  return next;
}

export type AuthorizedFetch = (
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
) => Promise<Response>;

/**
 * Fetch and normalize KeeperHub execution logs for a run.
 * Soft-fails: returns logsFetched=false + error message; never throws for HTTP/parse.
 */
export async function fetchAndNormalizeExecutionLogs(
  executionId: string,
  authorizedFetch: AuthorizedFetch,
  options?: { maxNodes?: number; timeoutMs?: number },
): Promise<FetchExecutionLogsResult> {
  const id = executionId?.trim();
  if (!id) {
    return {
      logsFetched: false,
      logsFetchError: "missing executionId",
      nodes: [],
      rawCount: 0,
      truncated: false,
    };
  }

  try {
    const path = `/api/workflows/executions/${encodeURIComponent(id)}/logs`;
    const init: RequestInit = { method: "GET" };
    // Abort after timeout when provided (best-effort; environments may ignore).
    if (options?.timeoutMs && options.timeoutMs > 0 && typeof AbortController !== "undefined") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const res = await authorizedFetch(path, {
          ...init,
          signal: controller.signal,
        } as RequestInit & { idempotencyKey?: string });
        return await parseLogsResponse(res, options?.maxNodes);
      } finally {
        clearTimeout(timer);
      }
    }

    const res = await authorizedFetch(path, init);
    return await parseLogsResponse(res, options?.maxNodes);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "logs fetch timed out"
          : error.message
        : "logs fetch failed";
    return {
      logsFetched: false,
      logsFetchError: message.slice(0, 240),
      nodes: [],
      rawCount: 0,
      truncated: false,
    };
  }
}

async function parseLogsResponse(
  res: Response,
  maxNodes?: number,
): Promise<FetchExecutionLogsResult> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      logsFetched: false,
      logsFetchError: `logs HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
      nodes: [],
      rawCount: 0,
      truncated: false,
    };
  }

  let body: KeeperHubExecutionLogsResponse;
  try {
    body = (await res.json()) as KeeperHubExecutionLogsResponse;
  } catch {
    return {
      logsFetched: false,
      logsFetchError: "logs response was not valid JSON",
      nodes: [],
      rawCount: 0,
      truncated: false,
    };
  }

  const normalized = normalizeKeeperHubExecutionLogs(body, { maxNodes });
  if (!normalized.parsed) {
    return {
      logsFetched: false,
      logsFetchError: "logs response missing logs array",
      nodes: [],
      rawCount: 0,
      truncated: false,
    };
  }

  const derived = deriveGasFromRunNodes(normalized.nodes);
  return {
    logsFetched: true,
    logsFetchError: null,
    nodes: normalized.nodes,
    derivedGasUsedUnits: derived.gasUsedUnits,
    derivedGasUsedWei: derived.gasUsedWei,
    rawCount: normalized.rawCount,
    truncated: normalized.truncated,
  };
}
