// Affiliate agent job repository: persists async chat job states across server restarts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type {
  AffiliateAgentJobInsert,
  AffiliateAgentJobRow,
  AffiliateAgentJobUpdate,
} from "./types.ts";

export interface AffiliateAgentJobRepository {
  getById(id: string, affiliateWallet: string): Promise<Result<AffiliateAgentJobRow | null>>;
  create(job: AffiliateAgentJobInsert): Promise<Result<AffiliateAgentJobRow>>;
  update(id: string, patch: AffiliateAgentJobUpdate): Promise<Result<AffiliateAgentJobRow>>;
}

export function createAffiliateAgentJobRepository(
  supabase: SupabaseClient,
): AffiliateAgentJobRepository {
  const table = () => supabase.from("affiliate_agent_jobs");

  return {
    async getById(id: string, affiliateWallet: string) {
      const { data, error } = await table()
        .select("*")
        .eq("id", id)
        .eq("affiliate_wallet", affiliateWallet)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow((data ?? []) as AffiliateAgentJobRow[]));
    },

    async create(job) {
      const now = new Date().toISOString();
      const payload: AffiliateAgentJobRow = {
        id: job.id,
        affiliate_wallet: job.affiliate_wallet,
        status: job.status,
        request: job.request,
        result: job.result ?? null,
        error: job.error ?? null,
        created_at: job.created_at ?? now,
        updated_at: job.updated_at ?? now,
      };

      const { data, error } = await table()
        .insert(payload)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as AffiliateAgentJobRow);
    },

    async update(id, patch) {
      const payload = {
        ...patch,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as AffiliateAgentJobRow);
    },
  };
}
