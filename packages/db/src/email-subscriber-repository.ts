// Email subscriber repository: opt-in digests/alerts recipients from real users

import type { EmailSubscriberSource, EmailSubscriberStatus } from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import {
  buildInsertPayload,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
} from "./repository-utils.ts";
import type {
  EmailSubscriberInsert,
  EmailSubscriberRow,
  EmailSubscriberUpdate,
} from "./types.ts";

/** RFC 5322-inspired practical email check (production gate, not full grammar). */
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeSubscriberEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidSubscriberEmail(email: string): boolean {
  const normalized = normalizeSubscriberEmail(email);
  if (normalized.length < 3 || normalized.length > 254) return false;
  return EMAIL_PATTERN.test(normalized);
}

export type EmailChannel = "digest" | "alert";

export interface SubscribeInput {
  email: string;
  receivesDigests?: boolean;
  receivesAlerts?: boolean;
  source?: EmailSubscriberSource;
  /** Wallet or payer id when known; omit or null when not applicable. */
  payerReference?: string | null | undefined;
}

export interface SubscribeResult {
  subscriber: EmailSubscriberRow;
  reactivated: boolean;
  created: boolean;
}

/** Hard cap for digest/alert fan-out lists (P2-1). */
export const EMAIL_LIST_CAP = 5_000;

export interface EmailSubscriberRepository {
  subscribe(input: SubscribeInput): Promise<Result<SubscribeResult>>;
  unsubscribeByEmail(email: string): Promise<Result<EmailSubscriberRow | null>>;
  unsubscribeByToken(token: string): Promise<Result<EmailSubscriberRow | null>>;
  findByEmail(email: string): Promise<Result<EmailSubscriberRow | null>>;
  /** Active recipient emails for a channel (bounded). */
  listActiveEmails(channel: EmailChannel, limitParam?: number): Promise<Result<string[]>>;
}

export function createEmailSubscriberRepository(
  supabase: SupabaseClient,
): EmailSubscriberRepository {
  const table = () => supabase.from("email_subscribers");

  async function findByEmail(email: string): Promise<Result<EmailSubscriberRow | null>> {
    const emailNormalized = normalizeSubscriberEmail(email);
    const { data, error } = await table()
      .select("*")
      .eq("email_normalized", emailNormalized)
      .limit(1);

    if (error) return failure(mapPostgrestError(error));
    return success(maybeRow(data ?? []) as EmailSubscriberRow | null);
  }

  return {
    async subscribe(input) {
      const email = input.email.trim();
      const emailNormalized = normalizeSubscriberEmail(email);

      if (!isValidSubscriberEmail(emailNormalized)) {
        return failure(new ValidationError("Invalid email address"));
      }

      const receivesDigests = input.receivesDigests ?? true;
      const receivesAlerts = input.receivesAlerts ?? true;
      const source = input.source ?? "web";
      const payerReference = input.payerReference?.trim() || null;
      const now = new Date().toISOString();

      const existingResult = await findByEmail(emailNormalized);
      if (!existingResult.ok) return existingResult;

      const existing = existingResult.value;
      if (existing) {
        if (existing.status === "active") {
          const updates: EmailSubscriberUpdate = {
            receives_digests: receivesDigests,
            receives_alerts: receivesAlerts,
          };
          if (payerReference) {
            updates.payer_reference = payerReference;
          }
          const payload = buildUpdatePayload(updates as Record<string, unknown>);
          const { data, error } = await table()
            .update(payload)
            .eq("id", existing.id)
            .select()
            .single();

          if (error) return failure(mapPostgrestError(error));
          return success({
            subscriber: data as unknown as EmailSubscriberRow,
            reactivated: false,
            created: false,
          });
        }

        // Re-activate previously unsubscribed address
        const payload = buildUpdatePayload({
          status: "active" as EmailSubscriberStatus,
          receives_digests: receivesDigests,
          receives_alerts: receivesAlerts,
          subscribed_at: now,
          unsubscribed_at: null,
          ...(payerReference ? { payer_reference: payerReference } : {}),
          ...(source ? { source } : {}),
        } as Record<string, unknown>);

        const { data, error } = await table()
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();

        if (error) return failure(mapPostgrestError(error));
        return success({
          subscriber: data as unknown as EmailSubscriberRow,
          reactivated: true,
          created: false,
        });
      }

      const insert: EmailSubscriberInsert = {
        email,
        email_normalized: emailNormalized,
        status: "active",
        receives_digests: receivesDigests,
        receives_alerts: receivesAlerts,
        source,
        payer_reference: payerReference,
        subscribed_at: now,
      };

      const payload = buildInsertPayload(insert as unknown as Record<string, unknown>);
      const { data, error } = await table().insert(payload).select().single();

      if (error) return failure(mapPostgrestError(error));
      return success({
        subscriber: data as unknown as EmailSubscriberRow,
        reactivated: false,
        created: true,
      });
    },

    async unsubscribeByEmail(email) {
      const emailNormalized = normalizeSubscriberEmail(email);
      if (!isValidSubscriberEmail(emailNormalized)) {
        return failure(new ValidationError("Invalid email address"));
      }

      const existingResult = await findByEmail(emailNormalized);
      if (!existingResult.ok) return existingResult;

      const existing = existingResult.value;
      if (!existing) {
        return success(null);
      }
      if (existing.status === "unsubscribed") {
        return success(existing);
      }

      const now = new Date().toISOString();
      const payload = buildUpdatePayload({
        status: "unsubscribed" as EmailSubscriberStatus,
        unsubscribed_at: now,
      } as Record<string, unknown>);

      const { data, error } = await table()
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as EmailSubscriberRow);
    },

    async unsubscribeByToken(token) {
      const trimmed = token.trim();
      if (!trimmed) {
        return failure(new ValidationError("Unsubscribe token is required"));
      }

      const { data: rows, error: findError } = await table()
        .select("*")
        .eq("unsubscribe_token", trimmed)
        .limit(1);

      if (findError) return failure(mapPostgrestError(findError));
      const existing = maybeRow(rows ?? []) as EmailSubscriberRow | null;
      if (!existing) {
        return success(null);
      }
      if (existing.status === "unsubscribed") {
        return success(existing);
      }

      const now = new Date().toISOString();
      const payload = buildUpdatePayload({
        status: "unsubscribed" as EmailSubscriberStatus,
        unsubscribed_at: now,
      } as Record<string, unknown>);

      const { data, error } = await table()
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as EmailSubscriberRow);
    },

    findByEmail,

    async listActiveEmails(channel, limitParam = EMAIL_LIST_CAP) {
      const preferenceColumn =
        channel === "digest" ? "receives_digests" : "receives_alerts";
      // P2-1: bound list — digest/alert fan-out must not pull unbounded rows.
      const limit = Math.min(EMAIL_LIST_CAP, Math.max(1, limitParam));

      const { data, error } = await table()
        .select("email")
        .eq("status", "active")
        .eq(preferenceColumn, true)
        .order("subscribed_at", { ascending: true })
        .limit(limit);

      if (error) return failure(mapPostgrestError(error));

      const emails = (data ?? [])
        .map((row: { email?: string }) => row.email?.trim())
        .filter((value: string | undefined): value is string => Boolean(value));

      // Dedupe while preserving order
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const address of emails) {
        const key = normalizeSubscriberEmail(address);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(address);
      }

      return success(unique);
    },
  };
}
