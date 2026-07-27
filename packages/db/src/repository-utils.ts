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
}

export interface PaginatedResult<T> {
  items: T[];
  total: number | null;
  page: number;
  limit: number;
}

export function normalizePagination(params?: PaginationParams): {
  limit: number;
  offset: number;
  page: number;
} {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
  const offset = (page - 1) * limit;
  return { limit, offset, page };
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
    // check constraint violation
    return new ValidationError(details || message);
  }
  if (error.code === "42P01") {
    // undefined table
    return new PersistenceError(`Table not found: ${message}`);
  }

  return new PersistenceError(message);
}

// ── Insert / Update Helpers ─────────────────────────────
export function buildInsertPayload<T extends Record<string, unknown>>(
  data: T,
  timestamps?: { created_at?: string; updated_at?: string },
): T & { created_at?: string; updated_at?: string } {
  const now = new Date().toISOString();
  return {
    ...data,
    created_at: timestamps?.created_at ?? now,
    updated_at: timestamps?.updated_at ?? now,
  };
}

export function buildUpdatePayload<T extends Record<string, unknown>>(
  data: T,
): T & { updated_at: string } {
  return {
    ...data,
    updated_at: new Date().toISOString(),
  };
}
