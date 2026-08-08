// Premium Intelligence Repository
// Handles CRUD for premium_intelligence_items

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import {
  type PaginatedResult,
  type PaginationParams,
  buildPaginatedResult,
  mapPostgrestError,
  maybeRow,
  normalizePagination,
} from "./repository-utils.ts";
import type {
  PremiumIntelligenceItemInsert,
  PremiumIntelligenceItemRow,
  PremiumIntelligenceItemUpdate,
} from "./types.ts";

/** Public teaser columns only — never includes content_private (P2-1). */
export const PREMIUM_TEASER_COLUMNS =
  "id, slug, title, content_type, summary_public, source_event_ids, source_chain_id, price_amount, price_currency, payment_routes, status, created_at, updated_at" as const;

/** Cap for public teaser lists (legacy non-page callers). */
export const PREMIUM_TEASER_LIST_LIMIT = 50;

/**
 * Row shape returned by listTeasers — public columns only.
 * content_private is intentionally omitted at the DB projection layer.
 */
export type PremiumIntelligenceTeaserRow = Omit<PremiumIntelligenceItemRow, "content_private">;

export interface PremiumIntelligenceRepository {
  /** Public catalog teasers (bounded, no content_private). */
  listTeasers(
    limitParam?: number,
    filters?: { chainId?: number },
  ): Promise<Result<PremiumIntelligenceTeaserRow[]>>;
  /**
   * Page-based public catalog teasers (no content_private).
   * `includeArchived` expands the catalog with archived editorial items — only
   * ever enabled for authenticated Chronicle Pass holders.
   */
  listTeasersPage(
    params?: PaginationParams & { chainId?: number; includeArchived?: boolean },
  ): Promise<Result<PaginatedResult<PremiumIntelligenceTeaserRow>>>;
  findBySlug(slug: string): Promise<Result<PremiumIntelligenceItemRow | null>>;
  findById(id: string): Promise<Result<PremiumIntelligenceItemRow | null>>;
  findPrivateContent(id: string): Promise<Result<unknown | null>>;
  /**
   * Sponsored-monitor products that share the same deterministic intent key
   * (target contract + kind + visibility + binding + duration, window-agnostic).
   * Used to reuse an open challenge instead of minting a duplicate billable one.
   */
  findSponsoredMonitorsByIntentKey(
    intentKey: string,
    limitParam?: number,
  ): Promise<Result<PremiumIntelligenceItemRow[]>>;
  create(item: PremiumIntelligenceItemInsert): Promise<Result<PremiumIntelligenceItemRow>>;
  update(
    id: string,
    update: PremiumIntelligenceItemUpdate,
  ): Promise<Result<PremiumIntelligenceItemRow>>;
  /**
   * Archive auto-productized deep dives / historical feeds that were never
   * LLM-authored (boot backfill / deterministic fallback leftovers).
   */
  archiveNonLlmAutoProducts(): Promise<Result<number>>;
}

export function createPremiumIntelligenceRepository(
  supabase: SupabaseClient,
): PremiumIntelligenceRepository {
  const table = () => supabase.from("premium_intelligence_items");

  return {
    async listTeasers(limitParam = PREMIUM_TEASER_LIST_LIMIT, filters = {}) {
      // Exclude catalog-only products (newsletter + desk feed payment FKs).
      // Still findable via findById/findBySlug for settlements and access gates.
      // P2-1: project public columns only — never select content_private for teasers.
      const limit = Math.min(PREMIUM_TEASER_LIST_LIMIT, Math.max(1, limitParam));
      let query = table()
        .select(PREMIUM_TEASER_COLUMNS)
        .eq("status", "available")
        .neq("content_type", "monthly_newsletter")
        .neq("slug", "chronicle-desk-feed");
      if (filters?.chainId !== undefined) query = query.eq("source_chain_id", filters.chainId);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as PremiumIntelligenceTeaserRow[]);
    },

    async listTeasersPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      let query = table()
        .select(PREMIUM_TEASER_COLUMNS, { count: "exact" })
        .in(
          "status",
          params?.includeArchived === true
            ? (["available", "archived"] as const)
            : (["available"] as const),
        )
        .neq("content_type", "monthly_newsletter")
        .neq("slug", "chronicle-desk-feed");
      if (params?.chainId !== undefined) query = query.eq("source_chain_id", params.chainId);
      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return failure(mapPostgrestError(error));
      const items = (data ?? []) as unknown as PremiumIntelligenceTeaserRow[];
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async findBySlug(slug) {
      const { data, error } = await table()
        .select("*")
        .eq("slug", slug)
        .eq("status", "available")
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async findById(id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return success(null);
      }
      const { data, error } = await table().select("*").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async findPrivateContent(id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return success(null);
      }
      const { data, error } = await table().select("content_private").eq("id", id).limit(1);

      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow(data ?? []);
      return success(row?.content_private ?? null);
    },

    async findSponsoredMonitorsByIntentKey(intentKey, limitParam = 10) {
      const limit = Math.min(25, Math.max(1, limitParam));
      const { data, error } = await table()
        .select("*")
        .eq("content_type", "sponsored_monitor")
        .eq("content_private->>intentKey", intentKey)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as PremiumIntelligenceItemRow[]);
    },

    async create(item) {
      const { data, error } = await table().insert(item).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as PremiumIntelligenceItemRow);
    },

    async update(id, update) {
      const { data, error } = await table().update(update).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as PremiumIntelligenceItemRow);
    },

    async archiveNonLlmAutoProducts() {
      const { data: rows, error } = await table()
        .select("id, slug, content_type, content_private, status")
        .eq("status", "available")
        .in("content_type", ["deep_dive", "historical_feed"]);

      if (error) return failure(mapPostgrestError(error));

      const toArchive = (rows ?? []).filter((row) => {
        const slug = typeof row.slug === "string" ? row.slug : "";
        const isAuto =
          slug.startsWith("deep-dive-cluster-") ||
          slug.startsWith("deep-dive-cascade-") ||
          slug.startsWith("deep-dive-digest-") ||
          slug.startsWith("historical-feed-");
        if (!isAuto) return false;

        const privateContent = row.content_private;
        if (!privateContent || typeof privateContent !== "object") return true;
        const usedLlm = (privateContent as { usedLlm?: unknown }).usedLlm;
        return usedLlm !== true;
      });

      if (toArchive.length === 0) return success(0);

      const ids = toArchive.map((r) => r.id as string);
      const { error: updateError } = await table().update({ status: "archived" }).in("id", ids);

      if (updateError) return failure(mapPostgrestError(updateError));
      return success(ids.length);
    },
  };
}
