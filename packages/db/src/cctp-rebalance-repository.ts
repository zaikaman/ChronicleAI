// CCTP rebalance transfer repository: create, CAS transitions, in-flight list

import type { CctpRebalanceStatus } from "@chronicleai/schemas";
import {
  CCTP_ALLOWED_TRANSITIONS,
  CCTP_IN_FLIGHT_STATUSES,
  CCTP_RESUMABLE_STATUSES,
  isCctpTransitionAllowed,
} from "@chronicleai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Result,
  failure,
  success,
} from "./errors.ts";
import {
  buildInsertPayload,
  buildPaginatedResult,
  buildUpdatePayload,
  mapPostgrestError,
  maybeRow,
  normalizePagination,
  type PaginatedResult,
  type PaginationParams,
} from "./repository-utils.ts";
import type {
  CctpRebalanceTransferInsert,
  CctpRebalanceTransferPatch,
  CctpRebalanceTransferRow,
} from "./types.ts";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH_RE = /^0[xX][a-fA-F0-9]{64}$/;

/** Default CCTP V2 domains / chain IDs (testnet Base → Sepolia). */
export const CCTP_DEFAULT_SOURCE_DOMAIN = 6;
export const CCTP_DEFAULT_DEST_DOMAIN = 0;
export const CCTP_DEFAULT_SOURCE_CHAIN_ID = 84532;
export const CCTP_DEFAULT_DEST_CHAIN_ID = 11155111;

export function normalizeCctpAddress(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeTxHash(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!TX_HASH_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function toAmountUsdc(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

function normalizeRow(row: Record<string, unknown>): CctpRebalanceTransferRow {
  const amount = toAmountUsdc(row.amount_usdc);
  return {
    ...(row as unknown as CctpRebalanceTransferRow),
    amount_usdc: amount,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export interface CctpRebalanceRepository {
  create(data: CctpRebalanceTransferInsert): Promise<Result<CctpRebalanceTransferRow>>;
  findById(id: string): Promise<Result<CctpRebalanceTransferRow | null>>;
  findByBurnTxHash(burnTxHash: string): Promise<Result<CctpRebalanceTransferRow | null>>;
  /**
   * Compare-and-set status transition. Fails with CONFLICT if current status
   * is not in `fromStatus` (or is not a legal predecessor of `toStatus`).
   */
  transition(
    id: string,
    fromStatus: CctpRebalanceStatus | readonly CctpRebalanceStatus[],
    toStatus: CctpRebalanceStatus,
    patch?: CctpRebalanceTransferPatch,
  ): Promise<Result<CctpRebalanceTransferRow>>;
  listInFlight(limitParam?: number): Promise<Result<CctpRebalanceTransferRow[]>>;
  /** Rows resume worker should poll (awaiting_attestation | minting | stuck). */
  listResumable(limitParam?: number): Promise<Result<CctpRebalanceTransferRow[]>>;
  countInFlight(): Promise<Result<number>>;
  listRecent(limitParam?: number): Promise<Result<CctpRebalanceTransferRow[]>>;
  listPage(params?: PaginationParams): Promise<Result<PaginatedResult<CctpRebalanceTransferRow>>>;
  listByTreasury(
    treasuryAddress: string,
    limitParam?: number,
  ): Promise<Result<CctpRebalanceTransferRow[]>>;
  /** Latest successful burn timestamp for cooldown policy (null if none). */
  findLastSuccessfulBurnAt(
    treasuryAddress?: string,
  ): Promise<Result<string | null>>;
}

export function createCctpRebalanceRepository(
  supabase: SupabaseClient,
): CctpRebalanceRepository {
  const table = () => supabase.from("cctp_rebalance_transfers");

  return {
    async create(data) {
      const treasury = normalizeCctpAddress(data.treasury_address);
      if (!treasury) {
        return failure(new ValidationError("Invalid treasury_address"));
      }
      const mintRecipient = normalizeCctpAddress(
        data.mint_recipient ?? data.treasury_address,
      );
      if (!mintRecipient) {
        return failure(new ValidationError("Invalid mint_recipient"));
      }
      if (!(data.amount_usdc > 0) || !Number.isFinite(data.amount_usdc)) {
        return failure(new ValidationError("amount_usdc must be a positive number"));
      }
      if (!data.amount_atomic || !/^\d+$/.test(data.amount_atomic)) {
        return failure(new ValidationError("amount_atomic must be a non-negative integer string"));
      }
      if (data.mode !== "direct" && data.mode !== "forwarding") {
        return failure(new ValidationError("mode must be direct or forwarding"));
      }

      const burnHash = data.burn_tx_hash
        ? normalizeTxHash(data.burn_tx_hash)
        : null;
      if (data.burn_tx_hash && !burnHash) {
        return failure(new ValidationError("Invalid burn_tx_hash"));
      }
      const approveHash = data.approve_tx_hash
        ? normalizeTxHash(data.approve_tx_hash)
        : null;
      if (data.approve_tx_hash && !approveHash) {
        return failure(new ValidationError("Invalid approve_tx_hash"));
      }
      const mintHash = data.mint_tx_hash
        ? normalizeTxHash(data.mint_tx_hash)
        : null;
      if (data.mint_tx_hash && !mintHash) {
        return failure(new ValidationError("Invalid mint_tx_hash"));
      }

      const payload = buildInsertPayload({
        status: data.status ?? "pending",
        direction: data.direction ?? "base_to_sepolia",
        source_domain: data.source_domain ?? CCTP_DEFAULT_SOURCE_DOMAIN,
        destination_domain: data.destination_domain ?? CCTP_DEFAULT_DEST_DOMAIN,
        source_chain_id: data.source_chain_id ?? CCTP_DEFAULT_SOURCE_CHAIN_ID,
        destination_chain_id: data.destination_chain_id ?? CCTP_DEFAULT_DEST_CHAIN_ID,
        amount_usdc: data.amount_usdc,
        amount_atomic: data.amount_atomic,
        max_fee_atomic: data.max_fee_atomic ?? null,
        min_finality_threshold: data.min_finality_threshold ?? null,
        mode: data.mode,
        treasury_address: treasury,
        mint_recipient: mintRecipient,
        approve_tx_hash: approveHash,
        burn_tx_hash: burnHash,
        message_bytes: data.message_bytes ?? null,
        attestation: data.attestation ?? null,
        message_hash: data.message_hash ?? null,
        mint_tx_hash: mintHash,
        iris_status: data.iris_status ?? null,
        error_message: data.error_message ?? null,
        attempt_count: data.attempt_count ?? 0,
        burned_at: data.burned_at ?? null,
        attested_at: data.attested_at ?? null,
        minted_at: data.minted_at ?? null,
        metadata: data.metadata ?? {},
      } as unknown as Record<string, unknown>);

      const { data: row, error } = await table().insert(payload).select().single();
      if (error) return failure(mapPostgrestError(error));
      return success(normalizeRow(row as Record<string, unknown>));
    },

    async findById(id) {
      if (!UUID_RE.test(id)) return success(null);
      const { data, error } = await table().select("*").eq("id", id).limit(1);
      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow((data ?? []) as Record<string, unknown>[]);
      return success(row ? normalizeRow(row) : null);
    },

    async findByBurnTxHash(burnTxHash) {
      const hash = normalizeTxHash(burnTxHash);
      if (!hash) return success(null);
      const { data, error } = await table()
        .select("*")
        .eq("burn_tx_hash", hash)
        .limit(1);
      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow((data ?? []) as Record<string, unknown>[]);
      return success(row ? normalizeRow(row) : null);
    },

    async transition(id, fromStatus, toStatus, patch = {}) {
      if (!UUID_RE.test(id)) {
        return failure(new NotFoundError("CctpRebalanceTransfer", id));
      }

      const expected = (Array.isArray(fromStatus) ? fromStatus : [fromStatus]) as CctpRebalanceStatus[];
      if (expected.length === 0) {
        return failure(new ValidationError("fromStatus must not be empty"));
      }

      for (const from of expected) {
        if (!isCctpTransitionAllowed(from, toStatus)) {
          return failure(
            new ValidationError(
              `Illegal CCTP status transition: ${from} → ${toStatus}`,
            ),
          );
        }
      }

      // Load current row for CAS validation and transition legality against actual status.
      const currentResult = await this.findById(id);
      if (!currentResult.ok) return currentResult;
      if (!currentResult.value) {
        return failure(new NotFoundError("CctpRebalanceTransfer", id));
      }
      const current = currentResult.value;

      if (!expected.includes(current.status)) {
        return failure(
          new ConflictError(
            `CCTP transfer ${id} is ${current.status}, expected one of [${expected.join(", ")}]`,
          ),
        );
      }
      if (!isCctpTransitionAllowed(current.status, toStatus)) {
        return failure(
          new ValidationError(
            `Illegal CCTP status transition: ${current.status} → ${toStatus}`,
          ),
        );
      }

      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {
        status: toStatus,
      };

      if (patch.approve_tx_hash !== undefined) {
        if (patch.approve_tx_hash === null) {
          updates.approve_tx_hash = null;
        } else {
          const h = normalizeTxHash(patch.approve_tx_hash);
          if (!h) return failure(new ValidationError("Invalid approve_tx_hash"));
          updates.approve_tx_hash = h;
        }
      }
      if (patch.burn_tx_hash !== undefined) {
        if (patch.burn_tx_hash === null) {
          updates.burn_tx_hash = null;
        } else {
          const h = normalizeTxHash(patch.burn_tx_hash);
          if (!h) return failure(new ValidationError("Invalid burn_tx_hash"));
          updates.burn_tx_hash = h;
        }
      }
      if (patch.mint_tx_hash !== undefined) {
        if (patch.mint_tx_hash === null) {
          updates.mint_tx_hash = null;
        } else {
          const h = normalizeTxHash(patch.mint_tx_hash);
          if (!h) return failure(new ValidationError("Invalid mint_tx_hash"));
          updates.mint_tx_hash = h;
        }
      }
      if (patch.message_bytes !== undefined) updates.message_bytes = patch.message_bytes;
      if (patch.attestation !== undefined) updates.attestation = patch.attestation;
      if (patch.message_hash !== undefined) updates.message_hash = patch.message_hash;
      if (patch.iris_status !== undefined) updates.iris_status = patch.iris_status;
      if (patch.error_message !== undefined) {
        updates.error_message =
          patch.error_message == null
            ? null
            : String(patch.error_message).slice(0, 2000);
      }
      if (patch.max_fee_atomic !== undefined) updates.max_fee_atomic = patch.max_fee_atomic;
      if (patch.min_finality_threshold !== undefined) {
        updates.min_finality_threshold = patch.min_finality_threshold;
      }
      if (patch.attempt_count !== undefined) updates.attempt_count = patch.attempt_count;
      if (patch.metadata !== undefined) updates.metadata = patch.metadata;

      // Timestamp conventions for lifecycle stages.
      if (patch.burned_at !== undefined) {
        updates.burned_at = patch.burned_at;
      } else if (toStatus === "awaiting_attestation" && patch.burn_tx_hash) {
        updates.burned_at = now;
      }
      if (patch.attested_at !== undefined) {
        updates.attested_at = patch.attested_at;
      } else if (
        (toStatus === "minting" || toStatus === "minted") &&
        (patch.message_bytes || patch.attestation)
      ) {
        updates.attested_at = current.attested_at ?? now;
      }
      if (patch.minted_at !== undefined) {
        updates.minted_at = patch.minted_at;
      } else if (toStatus === "minted") {
        updates.minted_at = now;
      }

      const payload = buildUpdatePayload(updates);
      // Compare-and-set on expected status to avoid double-submit races.
      let query = table().update(payload).eq("id", id);
      if (expected.length === 1) {
        query = query.eq("status", expected[0]!);
      } else {
        query = query.in("status", [...expected]);
      }
      const { data: row, error } = await query.select().single();

      if (error) {
        if (error.code === "PGRST116") {
          return failure(
            new ConflictError(
              `CCTP transfer ${id} status changed concurrently (expected [${expected.join(", ")}])`,
            ),
          );
        }
        return failure(mapPostgrestError(error));
      }
      return success(normalizeRow(row as Record<string, unknown>));
    },

    async listInFlight(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));
      const statuses = [...CCTP_IN_FLIGHT_STATUSES];
      const { data, error } = await table()
        .select("*")
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return failure(mapPostgrestError(error));
      return success(
        ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeRow(r)),
      );
    },

    async listResumable(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));
      const statuses = [...CCTP_RESUMABLE_STATUSES];
      const { data, error } = await table()
        .select("*")
        .in("status", statuses)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) return failure(mapPostgrestError(error));
      return success(
        ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeRow(r)),
      );
    },

    async countInFlight() {
      const statuses = [...CCTP_IN_FLIGHT_STATUSES];
      const { count, error } = await table()
        .select("id", { count: "exact", head: true })
        .in("status", statuses);
      if (error) return failure(mapPostgrestError(error));
      return success(count ?? 0);
    },

    async listRecent(limitParam = 50) {
      const limit = Math.min(200, Math.max(1, limitParam));
      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return failure(mapPostgrestError(error));
      return success(
        ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeRow(r)),
      );
    },

    async listPage(params) {
      const { page, limit, offset } = normalizePagination(params, {
        defaultLimit: 15,
        maxLimit: 100,
      });
      const { data, error, count } = await table()
        .select("*", { count: params?.countMode ?? "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) return failure(mapPostgrestError(error));
      const items = ((data ?? []) as Record<string, unknown>[]).map((r) =>
        normalizeRow(r),
      );
      return success(buildPaginatedResult(items, page, limit, count ?? items.length));
    },

    async listByTreasury(treasuryAddress, limitParam = 50) {
      const treasury = normalizeCctpAddress(treasuryAddress);
      if (!treasury) {
        return failure(new ValidationError("Invalid treasury_address"));
      }
      const limit = Math.min(200, Math.max(1, limitParam));
      const { data, error } = await table()
        .select("*")
        .eq("treasury_address", treasury)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return failure(mapPostgrestError(error));
      return success(
        ((data ?? []) as Record<string, unknown>[]).map((r) => normalizeRow(r)),
      );
    },

    async findLastSuccessfulBurnAt(treasuryAddress) {
      let query = table()
        .select("burned_at")
        .eq("status", "minted")
        .not("burned_at", "is", null)
        .order("burned_at", { ascending: false })
        .limit(1);

      if (treasuryAddress) {
        const treasury = normalizeCctpAddress(treasuryAddress);
        if (!treasury) {
          return failure(new ValidationError("Invalid treasury_address"));
        }
        query = query.eq("treasury_address", treasury);
      }

      const { data, error } = await query;
      if (error) return failure(mapPostgrestError(error));
      const row = maybeRow(
        (data ?? []) as Array<{ burned_at?: string | null }>,
      );
      return success(row?.burned_at ?? null);
    },
  };
}

/** Re-export transition legality for unit tests without pulling schema package alone. */
export { CCTP_ALLOWED_TRANSITIONS, isCctpTransitionAllowed };
