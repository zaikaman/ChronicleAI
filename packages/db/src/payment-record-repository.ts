// Payment Record Repository
// Handles CRUD for payment_records

import type { PaymentStatus } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { PaymentRecordInsert, PaymentRecordRow, PaymentRecordUpdate } from "./types.ts";

/** EVM address pattern (case-insensitive). */
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Normalize payer references for consistent storage and lookup.
 * - Trims whitespace
 * - Lowercases EVM addresses so checksum vs lowercase never miss matches
 * - Returns null for empty/missing values
 */
export function normalizePayerReference(
  payerReference: string | null | undefined,
): string | null {
  if (payerReference == null) return null;
  const trimmed = payerReference.trim();
  if (!trimmed) return null;
  if (EVM_ADDRESS_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Normalize affiliate referral wallets. Only valid EVM addresses are stored;
 * non-address identifiers cannot receive on-chain referral transfers.
 */
export function normalizeReferralAddress(
  referralAddress: string | null | undefined,
): string | null {
  if (referralAddress == null) return null;
  const trimmed = referralAddress.trim();
  if (!trimmed) return null;
  if (!EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export interface PaymentRecordRepository {
  createChallenge(record: PaymentRecordInsert): Promise<Result<PaymentRecordRow>>;
  findById(id: string): Promise<Result<PaymentRecordRow | null>>;
  findByChallengeReference(challengeReference: string): Promise<Result<PaymentRecordRow | null>>;
  markSettled(
    id: string,
    settlementReference: string,
    amountSettled: number,
    currency: string,
    payerReference?: string | null,
  ): Promise<Result<PaymentRecordRow>>;
  markUnderpaid(id: string): Promise<Result<PaymentRecordRow>>;
  markExpired(id: string): Promise<Result<PaymentRecordRow>>;
  markFailed(id: string, message?: string): Promise<Result<PaymentRecordRow>>;
  /**
   * Reap open challenges whose `expires_at` is at or before `asOf` (default: now).
   * Returns the number of rows transitioned to `expired`.
   */
  expireOpenChallenges(asOf?: string): Promise<Result<number>>;
  listByPremiumItem(premiumItemId: string): Promise<Result<PaymentRecordRow[]>>;
  list(limit?: number): Promise<Result<PaymentRecordRow[]>>;
  /**
   * Settled payments that carry an affiliate referral_address for revenue routing.
   */
  listSettledWithReferral(limit?: number): Promise<Result<PaymentRecordRow[]>>;
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
      const insert: PaymentRecordInsert = { ...record };
      if (record.payer_reference !== undefined) {
        insert.payer_reference = normalizePayerReference(record.payer_reference);
      }
      if (record.referral_address !== undefined) {
        insert.referral_address = normalizeReferralAddress(record.referral_address);
      }

      const { data, error } = await table().insert(insert).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as PaymentRecordRow);
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

    async findByChallengeReference(challengeReference) {
      const { data, error } = await table()
        .select("*")
        .eq("challenge_reference", challengeReference)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },

    /**
     * Mark a payment as settled and persist settlement metadata.
     * Always stores `payer_reference` when a verified (or challenge-time) payer is provided
     * so `findSettledByPayer` and payer-scoped access checks work.
     */
    async markSettled(id, settlementReference, amountSettled, currency, payerReference?) {
      const now = new Date().toISOString();
      const normalizedPayer = normalizePayerReference(payerReference);
      const updates: PaymentRecordUpdate = {
        status: "settled" as PaymentStatus,
        settlement_reference: settlementReference,
        amount_settled: amountSettled,
        currency,
        settled_at: now,
      };
      // Persist verified payer so access checks can scope entitlement to this payer only.
      if (normalizedPayer != null) {
        updates.payer_reference = normalizedPayer;
      }
      return update(id, updates);
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

    async expireOpenChallenges(asOf?) {
      const cutoff = asOf ?? new Date().toISOString();
      const { data, error } = await table()
        .update({ status: "expired" as PaymentStatus })
        .in("status", ["challenge_issued", "pending"])
        .not("expires_at", "is", null)
        .lte("expires_at", cutoff)
        .select("id");

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []).length);
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

    async listSettledWithReferral(limit = 500) {
      const safeLimit = Math.min(Math.max(limit, 1), 2000);
      const { data, error } = await table()
        .select("*")
        .eq("status", "settled")
        .not("referral_address", "is", null)
        .order("settled_at", { ascending: false })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as PaymentRecordRow[]);
    },

    async findSettledByPayer(premiumItemId, payerReference) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(premiumItemId)) {
        return success(null);
      }
      const normalizedPayer = normalizePayerReference(payerReference);
      if (!normalizedPayer) {
        return success(null);
      }
      const { data, error } = await table()
        .select("*")
        .eq("premium_item_id", premiumItemId)
        .eq("payer_reference", normalizedPayer)
        .eq("status", "settled")
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []));
    },
  };
}
