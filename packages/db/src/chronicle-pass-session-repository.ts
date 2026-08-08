// Chronicle Pass wallet-auth session repository.
// Stores single-use challenge nonces and active session token hashes (never raw tokens).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, failure, success } from "./errors.ts";
import { normalizeWalletAddress } from "./newsletter-subscription-repository.ts";
import { mapPostgrestError, maybeRow } from "./repository-utils.ts";
import type { ChroniclePassSessionInsert, ChroniclePassSessionRow } from "./types.ts";

/** Default challenge lifetime (seconds) — short-lived signed-message session. */
export const CHRONICLE_PASS_CHALLENGE_TTL_SECONDS = 5 * 60;

/** Default active session lifetime (seconds). */
export const CHRONICLE_PASS_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface ChroniclePassSessionRepository {
  /** Persist a challenge nonce (single-use). */
  createChallenge(input: ChroniclePassSessionInsert): Promise<Result<ChroniclePassSessionRow>>;
  findByNonce(nonce: string): Promise<Result<ChroniclePassSessionRow | null>>;
  findBySessionTokenHash(tokenHash: string): Promise<Result<ChroniclePassSessionRow | null>>;
  /**
   * Activate a challenge into a session (consumes the nonce). Fails when the
   * nonce was already consumed (single-use guarantee).
   */
  activate(
    id: string,
    update: { sessionTokenHash: string; sessionExpiresAt: string },
  ): Promise<Result<ChroniclePassSessionRow | null>>;
  markExpired(id: string): Promise<Result<ChroniclePassSessionRow | null>>;
  revoke(id: string): Promise<Result<ChroniclePassSessionRow | null>>;
  touch(id: string): Promise<Result<ChroniclePassSessionRow | null>>;
  /** Expire challenges/sessions past their window (best-effort sweep). */
  expireSweep(asOf?: string): Promise<Result<number>>;
}

export function createChroniclePassSessionRepository(
  supabase: SupabaseClient,
): ChroniclePassSessionRepository {
  const table = () => supabase.from("chronicle_pass_sessions");

  return {
    async createChallenge(input) {
      const { data, error } = await table()
        .insert({
          ...input,
          wallet_address: normalizeWalletAddress(input.wallet_address) ?? input.wallet_address,
        })
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(data as unknown as ChroniclePassSessionRow);
    },

    async findByNonce(nonce) {
      const ref = nonce.trim();
      if (!ref) return success(null);
      const { data, error } = await table().select("*").eq("nonce", ref).limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as ChroniclePassSessionRow | null);
    },

    async findBySessionTokenHash(tokenHash) {
      const ref = tokenHash.trim();
      if (!ref) return success(null);
      const { data, error } = await table()
        .select("*")
        .eq("session_token_hash", ref)
        .eq("status", "active")
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow(data ?? []) as ChroniclePassSessionRow | null);
    },

    async activate(id, update) {
      // Compare-and-swap: only a still-unconsumed challenge can become a session.
      const { data, error } = await table()
        .update({
          status: "active" as const,
          session_token_hash: update.sessionTokenHash,
          session_expires_at: update.sessionExpiresAt,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "challenge_issued")
        .is("session_token_hash", null)
        .select()
        .single();

      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow([data]) as ChroniclePassSessionRow | null);
    },

    async markExpired(id) {
      const { data, error } = await table()
        .update({ status: "expired" as const })
        .eq("id", id)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow([data]) as ChroniclePassSessionRow | null);
    },

    async revoke(id) {
      const { data, error } = await table()
        .update({ status: "revoked" as const, session_token_hash: null })
        .eq("id", id)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow([data]) as ChroniclePassSessionRow | null);
    },

    async touch(id) {
      const { data, error } = await table()
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) return failure(mapPostgrestError(error));
      return success(maybeRow([data]) as ChroniclePassSessionRow | null);
    },

    async expireSweep(asOf) {
      const cutoff = asOf ?? new Date().toISOString();
      const { data, error } = await table()
        .update({ status: "expired" as const })
        .in("status", ["challenge_issued", "active"] as const)
        .lte("expires_at", cutoff)
        .select("id");
      if (error) return failure(mapPostgrestError(error));
      return success((data ?? []).length);
    },
  };
}

/** SHA-256 hex digest helper shared by the API session service. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
