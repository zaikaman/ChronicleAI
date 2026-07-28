// Repository for approved referral partners (affiliates)

import type { AffiliateStatus } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type { AffiliateInsert, AffiliateRow, AffiliateUpdate } from "./types.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const REFERRAL_CODE_RE = /^[a-zA-Z0-9_-]{2,64}$/;

/**
 * Normalize affiliate payout wallets to lowercase checksum-stable form.
 */
export function normalizeAffiliateWallet(
  wallet: string | null | undefined,
): string | null {
  if (wallet == null) return null;
  const trimmed = wallet.trim();
  if (!trimmed || !EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Normalize optional referral codes used in website ?ref= links.
 */
export function normalizeReferralCode(
  code: string | null | undefined,
): string | null {
  if (code == null) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (!REFERRAL_CODE_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export interface AffiliateRepository {
  findById(id: string): Promise<Result<AffiliateRow | null>>;
  findByWallet(wallet: string): Promise<Result<AffiliateRow | null>>;
  findByReferralCode(code: string): Promise<Result<AffiliateRow | null>>;
  /**
   * Resolve a wallet or referral code to an approved affiliate, if any.
   */
  findApprovedByWalletOrCode(
    walletOrCode: string,
  ): Promise<Result<AffiliateRow | null>>;
  /**
   * Wallets eligible for on-chain referral payouts (status = approved).
   */
  listApprovedWallets(): Promise<Result<string[]>>;
  listApproved(limit?: number): Promise<Result<AffiliateRow[]>>;
  /**
   * Register or re-activate an affiliate for the product website.
   * New partners default to `approved` (open affiliate program).
   * Suspended partners cannot re-register until status is cleared in the registry.
   */
  register(input: {
    wallet_address: string;
    display_name?: string | null;
    referral_code?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<Result<{ affiliate: AffiliateRow; created: boolean }>>;
  update(id: string, updates: AffiliateUpdate): Promise<Result<AffiliateRow>>;
  setStatus(id: string, status: AffiliateStatus): Promise<Result<AffiliateRow>>;
}

export function createAffiliateRepository(
  supabase: SupabaseClient,
): AffiliateRepository {
  const table = () => supabase.from("affiliates");

  return {
    async findById(id) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return success(null);
      }
      const { data, error } = await table().select("*").eq("id", id).limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateRow | null);
    },

    async findByWallet(wallet) {
      const normalized = normalizeAffiliateWallet(wallet);
      if (!normalized) {
        return failure(new ValidationError("Invalid affiliate wallet address"));
      }
      const { data, error } = await table()
        .select("*")
        .eq("wallet_address", normalized)
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateRow | null);
    },

    async findByReferralCode(code) {
      const normalized = normalizeReferralCode(code);
      if (!normalized) {
        return failure(new ValidationError("Invalid referral code"));
      }
      const { data, error } = await table()
        .select("*")
        .eq("referral_code", normalized)
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as AffiliateRow | null);
    },

    async findApprovedByWalletOrCode(walletOrCode) {
      const raw = walletOrCode.trim();
      if (!raw) return success(null);

      const asWallet = normalizeAffiliateWallet(raw);
      if (asWallet) {
        const byWallet = await this.findByWallet(asWallet);
        if (!byWallet.ok) return byWallet;
        if (byWallet.value?.status === "approved") {
          return success(byWallet.value);
        }
        return success(null);
      }

      const asCode = normalizeReferralCode(raw);
      if (!asCode) return success(null);
      const byCode = await this.findByReferralCode(asCode);
      if (!byCode.ok) return byCode;
      if (byCode.value?.status === "approved") {
        return success(byCode.value);
      }
      return success(null);
    },

    async listApprovedWallets() {
      const { data, error } = await table()
        .select("wallet_address")
        .eq("status", "approved")
        .order("wallet_address", { ascending: true });

      if (error) return failure(mapPostgrestError(error));
      const wallets = (data ?? [])
        .map((row) =>
          typeof (row as { wallet_address?: string }).wallet_address === "string"
            ? (row as { wallet_address: string }).wallet_address.toLowerCase()
            : null,
        )
        .filter((w): w is string => w != null);
      return success(wallets);
    },

    async listApproved(limit = 100) {
      const safeLimit = Math.min(Math.max(limit, 1), 500);
      const { data, error } = await table()
        .select("*")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(safeLimit);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as AffiliateRow[]);
    },

    async register(input) {
      const wallet = normalizeAffiliateWallet(input.wallet_address);
      if (!wallet) {
        return failure(
          new ValidationError("wallet_address must be a valid 0x EVM address"),
        );
      }

      let referralCode: string | null = null;
      if (input.referral_code != null && String(input.referral_code).trim()) {
        referralCode = normalizeReferralCode(input.referral_code);
        if (!referralCode) {
          return failure(
            new ValidationError(
              "referral_code must be 2–64 chars: letters, numbers, _ or -",
            ),
          );
        }
      }

      const displayName =
        typeof input.display_name === "string" && input.display_name.trim()
          ? input.display_name.trim().slice(0, 120)
          : null;

      const existing = await this.findByWallet(wallet);
      if (!existing.ok) return existing;

      if (existing.value) {
        if (existing.value.status === "suspended") {
          return failure(
            new ValidationError(
              "This affiliate wallet is suspended and cannot re-register",
            ),
          );
        }

        // Update profile fields; keep / restore approved for open program.
        const now = new Date().toISOString();
        const updates: AffiliateUpdate = {
          display_name: displayName ?? existing.value.display_name,
          status: "approved",
          approved_at: existing.value.approved_at ?? now,
        };
        if (referralCode) {
          updates.referral_code = referralCode;
        }
        if (input.metadata) {
          updates.metadata = { ...existing.value.metadata, ...input.metadata };
        }

        const updated = await this.update(existing.value.id, updates);
        if (!updated.ok) return updated;
        return success({ affiliate: updated.value, created: false });
      }

      const now = new Date().toISOString();
      const insert: AffiliateInsert = {
        wallet_address: wallet,
        display_name: displayName,
        referral_code: referralCode,
        status: "approved",
        approved_at: now,
        metadata: input.metadata ?? {},
      };

      const payload = buildInsertPayload(insert as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();

      if (error) {
        // Unique referral_code collision
        if (error.code === "23505") {
          return failure(
            new ValidationError(
              "wallet_address or referral_code is already registered",
            ),
          );
        }
        return failure(mapPostgrestError(error));
      }
      return success({
        affiliate: data as unknown as AffiliateRow,
        created: true,
      });
    },

    async update(id, updates) {
      const next: AffiliateUpdate = { ...updates };
      if (updates.wallet_address !== undefined) {
        const normalized = normalizeAffiliateWallet(updates.wallet_address);
        if (!normalized) {
          return failure(new ValidationError("Invalid wallet_address"));
        }
        next.wallet_address = normalized;
      }
      if (updates.referral_code !== undefined && updates.referral_code !== null) {
        const code = normalizeReferralCode(updates.referral_code);
        if (!code && String(updates.referral_code).trim()) {
          return failure(new ValidationError("Invalid referral_code"));
        }
        next.referral_code = code;
      }

      const payload = buildUpdatePayload({
        ...(next as Record<string, unknown>),
        updated_at: new Date().toISOString(),
      });
      const { data, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as AffiliateRow);
    },

    async setStatus(id, status) {
      const now = new Date().toISOString();
      const updates: AffiliateUpdate = {
        status,
        ...(status === "approved" ? { approved_at: now } : {}),
      };
      return this.update(id, updates);
    },
  };
}
