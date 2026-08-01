// Base repository utilities for Supabase select, insert, update, pagination, and single-row handling

import type { PostgrestError } from "@supabase/supabase-js";
import {
  ConflictError,
  NotFoundError,
  PersistenceError,
  type Result,
  ValidationError,
  failure,
  success,
} from "./errors.ts";

// ── Pagination ──────────────────────────────────────────
export interface PaginationParams {
  page?: number;
  limit?: number;
  /**
   * Controls the database work used to populate pagination totals.
   * Exact remains the default for existing callers; public Activity uses
   * planned counts because it only needs a navigation hint.
   */
  countMode?: "exact" | "planned" | "estimated";
}

/** Canonical page-based list envelope used by repositories and API responses. */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface NormalizePaginationOptions {
  /** Default page size when limit is omitted (default 20). */
  defaultLimit?: number;
  /** Hard ceiling for limit (default 100). */
  maxLimit?: number;
}

/**
 * Normalize page/limit into safe integers and a zero-based offset.
 * Defaults: page=1, limit=20, maxLimit=100.
 */
export function normalizePagination(
  params?: PaginationParams,
  options?: NormalizePaginationOptions,
): {
  limit: number;
  offset: number;
  page: number;
} {
  const defaultLimit = options?.defaultLimit ?? 20;
  const maxLimit = options?.maxLimit ?? 100;
  const page = Math.max(1, Math.floor(params?.page ?? 1));
  const rawLimit = params?.limit ?? defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)));
  const offset = (page - 1) * limit;
  return { limit, offset, page };
}

/** Build a full paginated envelope from a page of items + total count. */
export function buildPaginatedResult<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedResult<T> {
  const safeTotal = Math.max(0, Math.floor(total));
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);
  const safePage = Math.max(1, page);
  return {
    items,
    page: safePage,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage: totalPages > 0 && safePage < totalPages,
    hasPreviousPage: safePage > 1 && totalPages > 0,
  };
}

// ── Single Row Handling ─────────────────────────────────
export function expectRow<T>(rows: T[], entity: string, id: string): Result<T> {
  const row = rows[0];
  if (!row) {
    return failure(new NotFoundError(entity, id));
  }
  return success(row);
}

export function maybeRow<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

// ── Error Mapping ───────────────────────────────────────
export function mapPostgrestError(error: PostgrestError): PersistenceError {
  const message = error.message || "Database operation failed";
  const details = error.details || "";

  if (error.code === "23505") {
    // unique violation
    return new ConflictError(details || message);
  }
  if (error.code === "23503") {
    // foreign key violation
    return new ValidationError(details || message);
  }
  if (error.code === "23514") {
    // check constraint violation — keep constraint name (message) + detail row
    const combined =
      details && details !== message
        ? `${message}: ${details}`
        : details || message;
    return new ValidationError(combined);
  }
  if (error.code === "42P01") {
    // undefined table
    return new PersistenceError(`Table not found: ${message}`);
  }

  return new PersistenceError(message);
}

// ── Insert / Update Helpers ─────────────────────────────

/**
 * Timestamp options for insert payloads.
 * Set `updated_at: false` for append-only tables that only have `created_at`
 * (PostgREST rejects unknown columns such as missing `updated_at`).
 */
export type InsertTimestampOptions = {
  created_at?: string;
  /** ISO timestamp, or `false` to omit `updated_at` entirely. */
  updated_at?: string | false;
};

/**
 * Options for update payloads.
 * Set `includeUpdatedAt: false` for tables without an `updated_at` column.
 */
export type UpdateTimestampOptions = {
  includeUpdatedAt?: boolean;
};

export function buildInsertPayload<T extends Record<string, unknown>>(
  data: T,
  timestamps?: InsertTimestampOptions,
): T & { created_at?: string; updated_at?: string } {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    ...data,
    created_at: timestamps?.created_at ?? now,
  };

  if (timestamps?.updated_at !== false) {
    payload.updated_at =
      typeof timestamps?.updated_at === "string" ? timestamps.updated_at : now;
  }

  return payload as T & { created_at?: string; updated_at?: string };
}

export function buildUpdatePayload<T extends Record<string, unknown>>(
  data: T,
  options?: UpdateTimestampOptions,
): T & { updated_at?: string } {
  if (options?.includeUpdatedAt === false) {
    return { ...data };
  }
  return {
    ...data,
    updated_at: new Date().toISOString(),
  };
}
