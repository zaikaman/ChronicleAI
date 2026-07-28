/**
 * Shared KeeperHub execution log helper.
 *
 * Wraps any KH (or KH-adjacent) async work with started → succeeded/failed
 * rows so Activity never depends on callers remembering to log.
 *
 * Soft-fails on append errors so observability never blocks real writes.
 */

import type { ExecutionLogRepository, ExecutionLogInsert } from "@chronicleai/db";
import type { ExecutionLogActionType, ExecutionLogStatus } from "@chronicleai/schemas";

export interface KeeperHubLogContext {
  actionType: ExecutionLogActionType;
  entityType?: string | null;
  entityId?: string | null;
  /** Workflow / registry method name (e.g. publishAlert, rotate). */
  method?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface KeeperHubLoggableReceipt {
  keeperHubRunId?: string | undefined;
  txHash?: string | undefined;
  explorerUrl?: string | undefined;
  gasUsed?: string | undefined;
  gasUsedWei?: string | undefined;
  status?: string | undefined;
}

/** Map KeeperHub write-client methods to execution log action types. */
export function actionTypeForWriteMethod(
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
): ExecutionLogActionType {
  switch (method) {
    case "createSponsoredWatch":
    case "publishSponsoredReport":
      return "sponsored_watch";
    case "publishPremiumReceipt":
      return "premium_receipt";
    case "recordPayout":
    case "transfer":
      return "payout";
    default:
      return "registry_write";
  }
}

/**
 * `execution_logs.entity_id` is UUID. KeeperHub workflow/run IDs, idempotency
 * keys, and free-form labels are not — PostgREST rejects them. Only pass through
 * real UUIDs; stash the original value under details for Activity correlation.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isExecutionLogEntityUuid(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Normalize an insert so non-UUID entity_id never hits the database. */
export function sanitizeExecutionLogInsert(
  entry: ExecutionLogInsert,
): ExecutionLogInsert {
  const raw = entry.entity_id;
  if (raw == null || raw === "" || isExecutionLogEntityUuid(raw)) {
    return entry;
  }

  const details =
    entry.details && typeof entry.details === "object" && !Array.isArray(entry.details)
      ? { ...(entry.details as Record<string, unknown>) }
      : {};

  if (details.entity_ref == null) details.entity_ref = raw;
  if (details.entity_id_raw == null) details.entity_id_raw = raw;

  return {
    ...entry,
    entity_id: null,
    details,
  };
}

/** Soft append — never throws; logs console errors on failure. */
export async function softAppendExecutionLog(
  execLog: ExecutionLogRepository | null | undefined,
  entry: ExecutionLogInsert,
  label = "keeperhub-execution-log",
): Promise<void> {
  if (!execLog) return;
  try {
    const result = await execLog.append(sanitizeExecutionLogInsert(entry));
    if (!result.ok) {
      console.error(
        `[${label}] execution_log append failed:`,
        result.error.message,
        result.error.code,
      );
    }
  } catch (error) {
    console.error(
      `[${label}] execution_log append threw:`,
      error instanceof Error ? error.message : error,
    );
  }
}

function buildReceiptDetails(
  base: Record<string, unknown> | undefined,
  method: string | undefined,
  receipt: KeeperHubLoggableReceipt | null | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const details: Record<string, unknown> = { ...(base ?? {}) };
  if (method) details.method = method;
  if (receipt?.keeperHubRunId) {
    details.keeper_hub_run_id = receipt.keeperHubRunId;
    details.executedViaKeeperHub = true;
  }
  if (receipt?.txHash) {
    details.tx_hash = receipt.txHash;
    details.registry_tx_hash = details.registry_tx_hash ?? receipt.txHash;
  }
  if (receipt?.explorerUrl) details.explorer_url = receipt.explorerUrl;
  if (receipt?.gasUsed) details.gas_used = receipt.gasUsed;
  if (receipt?.gasUsedWei) details.gas_used_wei = receipt.gasUsedWei;
  if (receipt?.status) details.workflow_status = receipt.status;
  if (extra) Object.assign(details, extra);
  return details;
}

function defaultMessage(
  phase: "started" | "succeeded" | "failed",
  context: KeeperHubLogContext,
  errorMessage?: string,
): string {
  const label = context.method ?? context.actionType;
  if (phase === "started") {
    return context.message ?? `KeeperHub ${label} started`;
  }
  if (phase === "succeeded") {
    return context.message ?? `KeeperHub ${label} succeeded`;
  }
  return (
    context.message ??
    `KeeperHub ${label} failed${errorMessage ? `: ${errorMessage}` : ""}`
  );
}

/**
 * Record started → succeeded/failed around an async KeeperHub operation.
 * Re-throws the original error after logging failure.
 */
export async function withKeeperHubLog<T>(
  execLog: ExecutionLogRepository | null | undefined,
  context: KeeperHubLogContext,
  execute: () => Promise<T>,
  options?: {
    /** Extract receipt fields from a successful result for terminal details. */
    receiptFromResult?: (result: T) => KeeperHubLoggableReceipt | null | undefined;
    /** When true, also append a `retrying` row before rethrow (default false). */
    logRetryingOnFailure?: boolean;
  },
): Promise<T> {
  const startedAt = new Date().toISOString();
  const baseDetails = buildReceiptDetails(context.details, context.method, null);

  await softAppendExecutionLog(execLog, {
    action_type: context.actionType,
    entity_type: context.entityType ?? null,
    entity_id: context.entityId ?? null,
    status: "started" satisfies ExecutionLogStatus,
    message: defaultMessage("started", context),
    details: baseDetails,
    started_at: startedAt,
    completed_at: null,
  });

  try {
    const result = await execute();
    const completedAt = new Date().toISOString();
    const receipt = options?.receiptFromResult?.(result) ?? null;
    const terminalDetails = buildReceiptDetails(
      context.details,
      context.method,
      receipt && typeof receipt === "object" ? receipt : null,
    );

    // Prefer structured receipt on objects that look like KH receipts.
    if (!options?.receiptFromResult && result && typeof result === "object") {
      const r = result as KeeperHubLoggableReceipt;
      if (r.keeperHubRunId || r.txHash) {
        Object.assign(
          terminalDetails,
          buildReceiptDetails(context.details, context.method, r),
        );
      }
    }

    await softAppendExecutionLog(execLog, {
      action_type: context.actionType,
      entity_type: context.entityType ?? null,
      entity_id: context.entityId ?? null,
      status: "succeeded",
      message: defaultMessage("succeeded", context),
      details: terminalDetails,
      started_at: startedAt,
      completed_at: completedAt,
    });

    return result;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failDetails = buildReceiptDetails(context.details, context.method, null, {
      error_message: errorMessage,
      reason: "keeperhub_execute_failed",
    });

    // Extract run id from timeout / failure messages when present.
    const runIdMatch = errorMessage.match(
      /execution\s+([a-zA-Z0-9_-]+)|run\s+([a-zA-Z0-9_-]+)/i,
    );
    const runId = runIdMatch?.[1] ?? runIdMatch?.[2];
    if (runId) {
      failDetails.keeper_hub_run_id = runId;
      failDetails.executedViaKeeperHub = true;
    }

    if (options?.logRetryingOnFailure) {
      await softAppendExecutionLog(execLog, {
        action_type: context.actionType,
        entity_type: context.entityType ?? null,
        entity_id: context.entityId ?? null,
        status: "retrying",
        message: `KeeperHub ${context.method ?? context.actionType} retrying after error`,
        details: failDetails,
        started_at: startedAt,
        completed_at: null,
      });
    }

    await softAppendExecutionLog(execLog, {
      action_type: context.actionType,
      entity_type: context.entityType ?? null,
      entity_id: context.entityId ?? null,
      status: "failed",
      message: defaultMessage("failed", context, errorMessage),
      details: failDetails,
      started_at: startedAt,
      completed_at: completedAt,
    });

    throw error;
  }
}
