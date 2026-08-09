// Execution log repository: append logs and list by entity

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildPaginatedResult,
  mapPostgrestError,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type { ExecutionLogInsert, ExecutionLogRow } from "./types.ts";

/** Optional entity filters for page-based Activity deep links (Phase 4). */
export interface ExecutionLogListPageParams extends PaginationParams {
  /** When set, only rows with this entity_id (UUID). */
  entityId?: string;
  /** Optional companion to entityId (e.g. desk_intent). */
  entityType?: string;
}

/** The fields needed to render a public payment failure reason. */
export type ExecutionLogFailureDiagnostic = Pick<
  ExecutionLogRow,
  "entity_id" | "status" | "message" | "details"
>;

export interface ExecutionLogRepository {
  append(data: ExecutionLogInsert): Promise<Result<ExecutionLogRow>>;
  listByEntity(
    entityType: string,
    entityId: string,
    limitParam?: number,
  ): Promise<Result<ExecutionLogRow[]>>;
  listRecent(limitParam?: number): Promise<Result<ExecutionLogRow[]>>;
  /** Fetch failed diagnostics for many entities with one database query. */
  listFailedByEntityIds?(
    entityType: string,
    entityIds: readonly string[],
    limitPerEntity?: number,
  ): Promise<Result<ExecutionLogFailureDiagnostic[]>>;
  listPage(
    params?: ExecutionLogListPageParams,
  ): Promise<Result<PaginatedResult<ExecutionLogRow>>>;
  countHackathonExecutions?(
    fromIso?: string,
    toIso?: string,
  ): Promise<Result<number>>;
  listAllChronological?(options?: {
    page?: number | "all";
    limit?: number;
  }): Promise<
    Result<{
      items: ExecutionLogRow[];
      total: number;
      page: number | "all";
      limit: number;
      totalPages: number;
    }>
  >;
}

export function getTxHashKey(log: unknown): string | null {
  if (!log || typeof log !== "object") return null;
  const l = log as Record<string, unknown>;
  const details =
    l.details && typeof l.details === "object" && !Array.isArray(l.details)
      ? (l.details as Record<string, unknown>)
      : {};

  const getString = (val: unknown): string | null =>
    typeof val === "string" && val.trim().length > 0 ? val.trim() : null;

  const txHash =
    getString(l.tx_hash) ||
    getString(l.txHash) ||
    getString(l.transaction_hash) ||
    getString(l.transactionHash) ||
    getString(details.txHash) ||
    getString(details.transactionHash) ||
    getString(details.registryTxHash) ||
    getString(details.payoutTxHash) ||
    getString(details.burnTxHash) ||
    getString(details.mintTxHash) ||
    getString(details.action_transaction_hash) ||
    getString(details.actionTransactionHash) ||
    null;

  if (txHash && /^0x[0-9a-fA-F]{10,}$/.test(txHash)) {
    return txHash.toLowerCase();
  }

  const explorerUrl =
    getString(l.explorer_url) ||
    getString(l.explorerUrl) ||
    getString(details.explorer_url) ||
    getString(details.explorerUrl) ||
    getString(details.action_explorer_url) ||
    getString(details.actionExplorerUrl) ||
    getString(details.protectStatusUrl) ||
    getString(l.protectStatusUrl) ||
    null;

  if (explorerUrl && explorerUrl.startsWith("http")) {
    const txMatch = explorerUrl.match(/0x[0-9a-fA-F]{10,}/i);
    if (txMatch) return txMatch[0].toLowerCase();
    return explorerUrl.toLowerCase();
  }

  return null;
}

export function hasExplorerLink(log: unknown): boolean {
  return Boolean(getTxHashKey(log));
}

export function createExecutionLogRepository(supabase: SupabaseClient): ExecutionLogRepository {
  const table = () => supabase.from("execution_logs");

  return {
    async append(data) {
      // execution_logs is append-only (created_at only; no updated_at).
      // entity_id is UUID in Postgres — strip non-UUID values so PostgREST
      // does not reject KeeperHub workflow/run ids or free-form keys.
      const entityId =
        typeof data.entity_id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          data.entity_id.trim(),
        )
          ? data.entity_id.trim()
          : null;
      const details =
        data.details && typeof data.details === "object" && !Array.isArray(data.details)
          ? { ...(data.details as Record<string, unknown>) }
          : data.details;
      const detailsRecord =
        details && typeof details === "object" && !Array.isArray(details)
          ? (details as Record<string, unknown>)
          : null;
      if (
        data.entity_id != null &&
        entityId == null &&
        detailsRecord &&
        detailsRecord.entity_id_raw == null
      ) {
        detailsRecord.entity_id_raw = data.entity_id;
      }

      const payload = buildInsertPayload(
        {
          ...(data as unknown as Record<string, unknown>),
          entity_id: entityId,
          ...(detailsRecord ? { details: detailsRecord } : {}),
        },
        {
          updated_at: false,
        },
      );
      const { data: rows, error } = await table().insert(payload).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as ExecutionLogRow);
    },

    async listByEntity(entityType, entityId, limitParam = 50) {
      const limit = Math.min(100, Math.max(1, limitParam));

      const { data: rows, error } = await table()
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as ExecutionLogRow[]);
    },

    async listRecent(limitParam = 100) {
      const limit = Math.min(200, Math.max(1, limitParam));

      const { data: rows, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as ExecutionLogRow[]);
    },

    async listFailedByEntityIds(entityType, entityIds, limitPerEntity = 10) {
      const ids = [
        ...new Set(
          entityIds.filter((id) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id.trim(),
            ),
          ),
        ),
      ];
      if (ids.length === 0) return success([]);

      const safeLimitPerEntity = Math.min(100, Math.max(1, Math.floor(limitPerEntity)));
      const { data: rows, error } = await table()
        .select("entity_id, status, message, details")
        .eq("entity_type", entityType)
        .eq("status", "failed")
        .in("entity_id", ids)
        .order("created_at", { ascending: false })
        // The caller only needs the same bounded diagnostic window as
        // listByEntity, while the query itself remains batched.
        .limit(Math.min(1000, ids.length * safeLimitPerEntity));

      if (error) return failure(mapPostgrestError(error));

      return success((rows ?? []) as unknown as ExecutionLogFailureDiagnostic[]);
    },

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 25,
        maxLimit: 100,
      });

      const entityId =
        typeof params?.entityId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          params.entityId.trim(),
        )
          ? params.entityId.trim()
          : null;
      const entityType =
        typeof params?.entityType === "string" && params.entityType.trim().length > 0
          ? params.entityType.trim()
          : null;

      let query = table()
        .select("*", { count: params?.countMode ?? "exact" })
        .order("created_at", { ascending: false });

      if (entityId) {
        query = query.eq("entity_id", entityId);
      }
      if (entityType) {
        query = query.eq("entity_type", entityType);
      }

      const { data: rows, error, count } = await query.range(
        offset,
        offset + limit - 1,
      );

      if (error) {
        return failure(mapPostgrestError(error));
      }

      const items = (rows ?? []) as unknown as ExecutionLogRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async countHackathonExecutions(
      fromIso = "2026-07-27T00:00:00.000Z",
      toIso = "2026-08-13T23:59:59.999Z",
    ) {
      let query = table().select("id", { count: "exact", head: true });
      if (fromIso) query = query.gte("created_at", fromIso);
      if (toIso) query = query.lte("created_at", toIso);

      const { count, error } = await query;
      if (error) {
        return failure(mapPostgrestError(error));
      }
      return success(count ?? 0);
    },

    async listAllChronological(options) {
      const pageOpt = options?.page ?? 1;
      const limitOpt = Math.min(1000, Math.max(1, options?.limit ?? 100));

      const { count, error: countErr } = await table().select("id", {
        count: "exact",
        head: true,
      });

      if (countErr) {
        return failure(mapPostgrestError(countErr));
      }

      const rawTotal = count ?? 0;
      const batchSize = 1000;
      const totalBatches = Math.ceil(rawTotal / batchSize) || 1;
      const batchPromises: Array<Promise<any>> = [];

      for (let b = 0; b < totalBatches; b++) {
        const from = b * batchSize;
        const to = from + batchSize - 1;
        batchPromises.push(
          Promise.resolve(
            table()
              .select("*")
              .order("created_at", { ascending: true })
              .range(from, to),
          ),
        );
      }

      const results = await Promise.all(batchPromises);
      const allItems: ExecutionLogRow[] = [];
      for (const res of results) {
        if (res.error) return failure(mapPostgrestError(res.error));
        if (res.data) allItems.push(...(res.data as unknown as ExecutionLogRow[]));
      }

      // Filter ONLY rows that have an explorer link
      const validItems = allItems.filter(hasExplorerLink);
      const total = validItems.length;

      if (pageOpt === "all") {
        return success({
          items: validItems,
          total,
          page: "all" as const,
          limit: total,
          totalPages: 1,
        });
      }

      const pageNum = typeof pageOpt === "number" ? Math.max(1, pageOpt) : 1;
      const offset = (pageNum - 1) * limitOpt;
      const pageItems = validItems.slice(offset, offset + limitOpt);

      return success({
        items: pageItems,
        total,
        page: pageNum,
        limit: limitOpt,
        totalPages: Math.ceil(total / limitOpt) || 1,
      });
    },
  };
}
