// Telegram binding repository: one-time codes linking a Telegram chat_id
// to a Watch form so the send bot may DM that user for private alerts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, ValidationError, failure, success } from "./errors.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type {
  TelegramBindingInsert,
  TelegramBindingRow,
  TelegramBindingUpdate,
} from "./types.ts";

const CODE_PATTERN = /^[A-Z0-9]{4,16}$/i;

export function normalizeBindingCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidBindingCode(code: string): boolean {
  return CODE_PATTERN.test(normalizeBindingCode(code));
}

/** Generate a short human-pasteable binding code (e.g. ABCD12). */
export function generateBindingCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export interface TelegramBindingRepository {
  create(binding: TelegramBindingInsert): Promise<Result<TelegramBindingRow>>;
  /** Unused + not expired binding by code (for settle consumption). */
  findByCode(code: string, nowIso?: string): Promise<Result<TelegramBindingRow | null>>;
  /** Any not-expired binding by code (for prepare validation). */
  findValidByCode(code: string, nowIso?: string): Promise<Result<TelegramBindingRow | null>>;
  findByChatId(chatId: string): Promise<Result<TelegramBindingRow[]>>;
  markUsed(
    id: string,
    extra?: { walletAddress?: string | null },
  ): Promise<Result<TelegramBindingRow>>;
  update(id: string, update: TelegramBindingUpdate): Promise<Result<TelegramBindingRow>>;
}

export function createTelegramBindingRepository(
  supabase: SupabaseClient,
): TelegramBindingRepository {
  const table = () => supabase.from("telegram_bindings");

  return {
    async create(binding) {
      const code = normalizeBindingCode(binding.code);
      if (!isValidBindingCode(code)) {
        return failure(new ValidationError("Invalid Telegram binding code format"));
      }
      if (!binding.chat_id?.trim()) {
        return failure(new ValidationError("chat_id is required"));
      }

      const { data, error } = await table()
        .insert({
          ...binding,
          code,
          chat_id: String(binding.chat_id).trim(),
          source: binding.source ?? "watch",
        })
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TelegramBindingRow);
    },

    async findByCode(code, nowIso) {
      const normalized = normalizeBindingCode(code);
      if (!isValidBindingCode(normalized)) {
        return success(null);
      }
      const now = nowIso ?? new Date().toISOString();
      const { data, error } = await table()
        .select("*")
        .eq("code", normalized)
        .is("used_at", null)
        .gt("expires_at", now)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as TelegramBindingRow | null);
    },

    async findValidByCode(code, nowIso) {
      const normalized = normalizeBindingCode(code);
      if (!isValidBindingCode(normalized)) {
        return success(null);
      }
      const now = nowIso ?? new Date().toISOString();
      const { data, error } = await table()
        .select("*")
        .eq("code", normalized)
        .gt("expires_at", now)
        .limit(1);

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as TelegramBindingRow | null);
    },

    async findByChatId(chatId) {
      const id = String(chatId).trim();
      if (!id) return success([]);
      const { data, error } = await table()
        .select("*")
        .eq("chat_id", id)
        .order("created_at", { ascending: false });

      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []) as unknown as TelegramBindingRow[]);
    },

    async markUsed(id, extra) {
      if (!id?.trim()) {
        return failure(new ValidationError("Binding id is required"));
      }
      const update: TelegramBindingUpdate = {
        used_at: new Date().toISOString(),
      };
      if (extra?.walletAddress !== undefined) {
        update.wallet_address = extra.walletAddress;
      }
      // Atomic single-use: only consumes the code while it is still unused, so
      // concurrent settles / CHRONICLE_BIND can never double-consume one code.
      const { data, error } = await table()
        .update(update)
        .eq("id", id)
        .is("used_at", null)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TelegramBindingRow);
    },

    async update(id, update) {
      if (!id?.trim()) {
        return failure(new ValidationError("Binding id is required"));
      }
      const { data, error } = await table().update(update).eq("id", id).select().single();
      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as TelegramBindingRow);
    },
  };
}
