// Premium Intelligence Repository
// Handles CRUD for premium_intelligence_items

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PremiumIntelligenceItemInsert,
  PremiumIntelligenceItemRow,
  PremiumIntelligenceItemUpdate,
} from "./types.ts";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";

export interface PremiumIntelligenceRepository {
  listTeasers(): Promise<Result<PremiumIntelligenceItemRow[]>>;
  findBySlug(slug: string): Promise<Result<PremiumIntelligenceItemRow | null>>;
  findById(id: string): Promise<Result<PremiumIntelligenceItemRow | null>>;
  findPrivateContent(id: string): Promise<Result<unknown | null>>;
  create(item: PremiumIntelligenceItemInsert): Promise<Result<PremiumIntelligenceItemRow>>;
  update(
    id: string,
    update: PremiumIntelligenceItemUpdate,
  ): Promise<Result<PremiumIntelligenceItemRow>>;
}

export function createPremiumIntelligenceRepository(
  supabase: SupabaseClient,
): PremiumIntelligenceRepository {
  const table = () => supabase.from("premium_intelligence_items");

  return {
    async listTeasers() {
      const { data, error } = await table()
        .select("*")
        .eq("status", "available")
        .order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success(data ?? []);
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
      const { data, error } = await table()
        .select("*")
        .eq("id", id)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async findPrivateContent(id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return success(null);
      }
      const { data, error } = await table()
        .select("content_private")
        .eq("id", id)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow(data ?? []);
      return success(row?.content_private ?? null);
    },

    async create(item) {
      const { data, error } = await table()
        .insert(item)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as PremiumIntelligenceItemRow);
    },

    async update(id, update) {
      const { data, error } = await table()
        .update(update)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as PremiumIntelligenceItemRow);
    },
  };
}
