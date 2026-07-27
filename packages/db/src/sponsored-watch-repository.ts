// Sponsored Watch Repository
// Handles CRUD for sponsored_watches

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { SponsoredWatchInsert, SponsoredWatchRow, SponsoredWatchUpdate } from "./types.ts";

export interface SponsoredWatchRepository {
  create(watch: SponsoredWatchInsert): Promise<Result<SponsoredWatchRow>>;
  findById(id: string): Promise<Result<SponsoredWatchRow | null>>;
  list(): Promise<Result<SponsoredWatchRow[]>>;
  listActive(): Promise<Result<SponsoredWatchRow[]>>;
  update(id: string, update: SponsoredWatchUpdate): Promise<Result<SponsoredWatchRow>>;
  updateStatus(
    id: string,
    status: string,
    extraFields?: Partial<SponsoredWatchUpdate>,
  ): Promise<Result<SponsoredWatchRow>>;
}

export function createSponsoredWatchRepository(supabase: SupabaseClient): SponsoredWatchRepository {
  const table = () => supabase.from("sponsored_watches");

  return {
    async create(watch) {
      const { data, error } = await table().insert(watch).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as SponsoredWatchRow);
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

    async list() {
      const { data, error } = await table().select("*").order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success(data ?? []);
    },

    async listActive() {
      const { data, error } = await table()
        .select("*")
        .in("status", ["accepted", "monitoring"])
        .order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success(data ?? []);
    },

    async update(id, update) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return failure(new ValidationError("Invalid UUID format"));
      }
      const { data, error } = await table().update(update).eq("id", id).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as SponsoredWatchRow);
    },

    async updateStatus(id, status, extraFields) {
      const update: SponsoredWatchUpdate = { ...extraFields, status } as SponsoredWatchUpdate;
      return this.update(id, update);
    },
  };
}
