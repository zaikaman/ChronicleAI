// Repository for recurring x402 monthly newsletter subscription agreements

import type { NewsletterSubscriptionStatus } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  isValidSubscriberEmail,
  normalizeSubscriberEmail,
} from "./email-subscriber-repository.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  NewsletterSubscriptionInsert,
  NewsletterSubscriptionRow,
  NewsletterSubscriptionUpdate,
} from "./types.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function normalizeWalletAddress(
  wallet: string | null | undefined,
): string | null {
  if (wallet == null) return null;
  const trimmed = wallet.trim();
  if (!trimmed) return null;
  if (!EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export interface NewsletterSubscriptionRepository {
  findById(id: string): Promise<Result<NewsletterSubscriptionRow | null>>;
  findByEmail(email: string): Promise<Result<NewsletterSubscriptionRow | null>>;
  findByPayerWallet(wallet: string): Promise<Result<NewsletterSubscriptionRow | null>>;
  findByPendingChallenge(
    challengeReference: string,
  ): Promise<Result<NewsletterSubscriptionRow | null>>;
  create(
    input: NewsletterSubscriptionInsert,
  ): Promise<Result<NewsletterSubscriptionRow>>;
  update(
    id: string,
    updates: NewsletterSubscriptionUpdate,
  ): Promise<Result<NewsletterSubscriptionRow>>;
  /**
   * Active paid entitlement: status active|past_due within period+grace,
   * or active with cancel_at_period_end still inside current period.
   */
  listEntitledEmails(asOf?: string): Promise<Result<string[]>>;
  /** Subscriptions whose billing period needs past_due / expire transitions. */
  listDueForBillingSweep(asOf?: string): Promise<Result<NewsletterSubscriptionRow[]>>;
}

export function createNewsletterSubscriptionRepository(
  supabase: SupabaseClient,
): NewsletterSubscriptionRepository {
  const table = () => supabase.from("x402_newsletter_subscriptions");

  async function findByEmail(
    email: string,
  ): Promise<Result<NewsletterSubscriptionRow | null>> {
    const emailNormalized = normalizeSubscriberEmail(email);
    if (!emailNormalized) return success(null);

    const { data, error } = await table()
      .select("*")
      .eq("email_normalized", emailNormalized)
      .limit(1);

    if (error) return failure(mapPostgrestError(error));
    return success(maybeRow(data ?? []) as NewsletterSubscriptionRow | null);
  }

  return {
    async findById(id) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return success(null);
      }
      const { data, error } = await table().select("*").eq("id", id).limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as NewsletterSubscriptionRow | null);
    },

    findByEmail,

    async findByPayerWallet(wallet) {
      const normalized = normalizeWalletAddress(wallet);
      if (!normalized) {
        return failure(new ValidationError("Invalid payer wallet address"));
      }
      const { data, error } = await table()
        .select("*")
        .eq("payer_wallet", normalized)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as NewsletterSubscriptionRow | null);
    },

    async findByPendingChallenge(challengeReference) {
      const ref = challengeReference.trim();
      if (!ref) {
        return failure(new ValidationError("challengeReference is required"));
      }
      const { data, error } = await table()
        .select("*")
        .eq("pending_challenge_reference", ref)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as NewsletterSubscriptionRow | null);
    },

    async create(input) {
      const emailNormalized = normalizeSubscriberEmail(input.email);
      if (!isValidSubscriberEmail(emailNormalized)) {
        return failure(new ValidationError("Invalid email address"));
      }

      const insert: NewsletterSubscriptionInsert = {
        ...input,
        email: input.email.trim(),
        email_normalized: emailNormalized,
        payer_wallet: normalizeWalletAddress(input.payer_wallet) ?? null,
        referral_address: normalizeWalletAddress(input.referral_address) ?? null,
      };

      const payload = buildInsertPayload(insert as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as NewsletterSubscriptionRow);
    },

    async update(id, updates) {
      const next: NewsletterSubscriptionUpdate = { ...updates };
      if (updates.payer_wallet !== undefined) {
        next.payer_wallet = normalizeWalletAddress(updates.payer_wallet);
      }
      if (updates.referral_address !== undefined) {
        next.referral_address = normalizeWalletAddress(updates.referral_address);
      }
      if (updates.email !== undefined) {
        next.email = updates.email.trim();
        next.email_normalized = normalizeSubscriberEmail(updates.email);
      }

      const payload = buildUpdatePayload(next as Record<string, unknown>);
      const { data, error } = await table()
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as NewsletterSubscriptionRow);
    },

    async listEntitledEmails(asOf?) {
      const nowIso = asOf ?? new Date().toISOString();
      // Entitled while active/past_due and still within grace after period end.
      // We pull candidate rows and filter grace in app for clarity with grace_period_days.
      const { data, error } = await table()
        .select("email, status, current_period_end, grace_period_days, cancel_at_period_end")
        .in("status", ["active", "past_due"] satisfies NewsletterSubscriptionStatus[])
        .order("email_normalized", { ascending: true });

      if (error) return failure(mapPostgrestError(error));

      const nowMs = Date.parse(nowIso);
      const emails: string[] = [];
      const seen = new Set<string>();

      for (const row of data ?? []) {
        const email = typeof row.email === "string" ? row.email.trim() : "";
        if (!email) continue;

        const periodEnd = row.current_period_end
          ? Date.parse(String(row.current_period_end))
          : Number.NaN;
        if (Number.isNaN(periodEnd)) continue;

        const graceDays =
          typeof row.grace_period_days === "number" && row.grace_period_days >= 0
            ? row.grace_period_days
            : 3;
        const entitlementEnd = periodEnd + graceDays * 24 * 60 * 60 * 1000;
        if (nowMs > entitlementEnd) continue;

        // Cancelled-at-period-end: still entitled until period end (not grace)
        if (row.cancel_at_period_end === true && nowMs > periodEnd) continue;

        const key = normalizeSubscriberEmail(email);
        if (seen.has(key)) continue;
        seen.add(key);
        emails.push(email);
      }

      return success(emails);
    },

    async listDueForBillingSweep(asOf?) {
      const nowIso = asOf ?? new Date().toISOString();
      const { data, error } = await table()
        .select("*")
        .in("status", ["active", "past_due"] satisfies NewsletterSubscriptionStatus[])
        .not("current_period_end", "is", null)
        .lte("current_period_end", nowIso)
        .order("current_period_end", { ascending: true })
        .limit(500);

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as NewsletterSubscriptionRow[]);
    },
  };
}

/**
 * Whether a subscription currently entitles the holder to premium digests.
 */
export function isNewsletterEntitled(
  sub: Pick<
    NewsletterSubscriptionRow,
    "status" | "current_period_end" | "grace_period_days" | "cancel_at_period_end"
  >,
  asOfMs: number = Date.now(),
): boolean {
  if (sub.status !== "active" && sub.status !== "past_due") {
    return false;
  }
  if (!sub.current_period_end) return false;
  const periodEnd = Date.parse(sub.current_period_end);
  if (Number.isNaN(periodEnd)) return false;

  if (sub.cancel_at_period_end && asOfMs > periodEnd) {
    return false;
  }

  const graceMs = Math.max(0, sub.grace_period_days) * 24 * 60 * 60 * 1000;
  return asOfMs <= periodEnd + graceMs;
}
