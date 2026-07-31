// Daily digest repository: create, find by reporting window, latest public, update publication status

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildPaginatedResult,
  buildUpdatePayload,
  mapPostgrestError,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type { DailyDigestInsert, DailyDigestRow, DailyDigestUpdate } from "./types.ts";

export interface DailyDigestRepository {
  create(data: DailyDigestInsert): Promise<Result<DailyDigestRow>>;
  findById(id: string): Promise<Result<DailyDigestRow>>;
  findByWindow(periodStart: string, periodEnd: string): Promise<DailyDigestRow | null>;
  findLatestPublic(): Promise<Result<DailyDigestRow | null>>;
  updatePublicationStatus(
    id: string,
    status: string,
    publishedAt?: string,
  ): Promise<Result<DailyDigestRow>>;
  updateRegistryMetadata(
    id: string,
    metadata: {
      registryTxHash?: string;
      sourceEventRoot?: string;
      contentUri?: string;
      contentHash?: string;
      gasUsed?: string;
      gasUsedWei?: string;
      keeperHubRunId?: string;
      explorerUrl?: string;
    },
  ): Promise<Result<DailyDigestRow>>;
  list(limitParam?: number): Promise<Result<DailyDigestRow[]>>;
  /** Page-based public published digests (newest first). */
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<DailyDigestRow>>>;
}

export function createDailyDigestRepository(supabase: SupabaseClient): DailyDigestRepository {
  const table = () => supabase.from("daily_digests");

  return {
    async create(data) {
      const payload = buildInsertPayload(data as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().insert(payload).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as DailyDigestRow);
    },

    async findById(id) {
      const { data: rows, error } = await table().select("*").eq("id", id);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      const row = rows?.[0] as unknown as DailyDigestRow | undefined;
      if (!row) {
        return success(null as unknown as DailyDigestRow);
      }
      return success(row);
    },

    async findByWindow(periodStart, periodEnd) {
      const { data: rows, error } = await table()
        .select("*")
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd);

      if (error) {
        return null;
      }

      return (rows?.[0] as DailyDigestRow | undefined) ?? null;
    },

    async findLatestPublic() {
      const { data: rows, error } = await table()
        .select("*")
        .eq("audience", "public")
        .order("published_at", { ascending: false })
        .limit(1);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      const row = rows?.[0] as unknown as DailyDigestRow | undefined;
      return success(row ?? null);
    },

    async updatePublicationStatus(id, status, publishedAt?) {
      const update: DailyDigestUpdate = {
        publication_status: status as DailyDigestRow["publication_status"],
      };
      if (publishedAt) {
        update.published_at = publishedAt;
      }
      if (status === "published" && !publishedAt) {
        update.published_at = new Date().toISOString();
      }

      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as DailyDigestRow);
    },

    async updateRegistryMetadata(id, metadata) {
      const update: DailyDigestUpdate = {};
      if (metadata.registryTxHash) {
        update.registry_tx_hash = metadata.registryTxHash;
      }
      if (metadata.sourceEventRoot) {
        update.source_event_root = metadata.sourceEventRoot;
      }
      if (metadata.contentUri) {
        update.content_uri = metadata.contentUri;
      }
      if (metadata.contentHash) {
        update.content_hash = metadata.contentHash;
      }
      if (metadata.gasUsed) {
        update.gas_used = metadata.gasUsed;
      }
      if (metadata.gasUsedWei) {
        update.gas_used_wei = metadata.gasUsedWei;
      }
      if (metadata.keeperHubRunId) {
        update.keeper_hub_run_id = metadata.keeperHubRunId;
      }
      if (metadata.explorerUrl) {
        update.explorer_url = metadata.explorerUrl;
      }

      const payload = buildUpdatePayload(update as unknown as Record<string, unknown>);
      const { data: rows, error } = await table().update(payload).eq("id", id).select().single();

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as DailyDigestRow);
    },

    async list(limitParam = 10) {
      const limit = Math.min(50, Math.max(1, limitParam));

      const { data: rows, error } = await table()
        .select("*")
        .order("published_at", { ascending: false })
        .limit(limit);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      return success(rows as unknown as DailyDigestRow[]);
    },

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 20,
        maxLimit: 100,
      });

      const { data: rows, error, count } = await table()
        .select("*", { count: "exact" })
        .eq("audience", "public")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return failure(mapPostgrestError(error));
      }

      const items = (rows ?? []) as unknown as DailyDigestRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },
  };
}
