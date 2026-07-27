// Payment Record Repository
// Handles CRUD for payment_records

import type { PaymentStatus } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { PaymentRecordInsert, PaymentRecordRow, PaymentRecordUpdate } from "./types.ts";

export interface PaymentRecordRepository {
  createChallenge(record: PaymentRecordInsert): Promise<Result<PaymentRecordRow>>;
  findByChallengeReference(challengeReference: string): Promise<Result<PaymentRecordRow | null>>;
  markSettled(
    id: string,
    settlementReference: string,
    amountSettled: number,
    currency: string,
  ): Promise<Result<PaymentRecordRow>>;
  markUnderpaid(id: string): Promise<Result<PaymentRecordRow>>;
  markExpired(id: string): Promise<Result<PaymentRecordRow>>;
  markFailed(id: string, message?: string): Promise<Result<PaymentRecordRow>>;
  listByPremiumItem(premiumItemId: string): Promise<Result<PaymentRecordRow[]>>;
  list(limit?: number): Promise<Result<PaymentRecordRow[]>>;
  findSettledByPayer(
    premiumItemId: string,
    payerReference: string,
  ): Promise<Result<PaymentRecordRow | null>>;
}

export function createPaymentRecordRepository(supabase: SupabaseClient): PaymentRecordRepository {
  const table = () => supabase.from("payment_records");

  const update = async (
    id: string,
    updates: PaymentRecordUpdate,
  ): Promise<Result<PaymentRecordRow>> => {
    const { data, error } = await table().update(updates).eq("id", id).select().single();

    if (error) return failure(mapPostgrestError(error));
    return success(data as unknown as PaymentRecordRow);
  };

  return {
    async createChallenge(record) {
      const { data, error } = await table().insert(record).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as PaymentRecordRow);
    },

    async findByChallengeReference(challengeReference) {
      const { data, error } = await table()
        .select("*")
        .eq("challenge_reference", challengeReference)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    async markSettled(id, settlementReference, amountSettled, currency) {
      const now = new Date().toISOString();
      return update(id, {
        status: "settled" as PaymentStatus,
        settlement_reference: settlementReference,
        amount_settled: amountSettled,
        currency,
        settled_at: now,
      });
    },

    async markUnderpaid(id) {
      return update(id, { status: "underpaid" as PaymentStatus });
    },

    async markExpired(id) {
      return update(id, { status: "expired" as PaymentStatus });
    },

    async markFailed(id, _message?) {
      return update(id, { status: "failed" as PaymentStatus });
    },

    async listByPremiumItem(premiumItemId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(premiumItemId)) {
        return success([]);
      }
      const { data, error } = await table()
        .select("*")
        .eq("premium_item_id", premiumItemId)
        .order("requested_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success(data ?? []);
    },

    async list(limit = 25) {
      const { data, error } = await table()
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));
      return success(data ?? []);
    },

    async findSettledByPayer(premiumItemId, payerReference) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(premiumItemId)) {
        return success(null);
      }
      const { data, error } = await table()
        .select("*")
        .eq("premium_item_id", premiumItemId)
        .eq("payer_reference", payerReference)
        .eq("status", "settled")
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },
  };
}
