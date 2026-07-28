// Shared pagination types + helpers for page-based list hooks

import type { PaginationMeta } from "@chronicleai/schemas";

export type { PaginationMeta };

export const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/** Normalize API pagination payloads (or derive from a bare item array). */
export function normalizePaginationMeta(
  raw: unknown,
  fallback: { page: number; limit: number; itemCount: number },
): PaginationMeta {
  if (raw && typeof raw === "object") {
    const p = raw as Record<string, unknown>;
    const page = typeof p.page === "number" && p.page >= 1 ? p.page : fallback.page;
    const limit =
      typeof p.limit === "number" && p.limit >= 1 ? p.limit : fallback.limit;
    const total =
      typeof p.total === "number" && p.total >= 0 ? p.total : fallback.itemCount;
    const totalPages =
      typeof p.totalPages === "number" && p.totalPages >= 0
        ? p.totalPages
        : total === 0
          ? 0
          : Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNextPage:
        typeof p.hasNextPage === "boolean" ? p.hasNextPage : page < totalPages,
      hasPreviousPage:
        typeof p.hasPreviousPage === "boolean" ? p.hasPreviousPage : page > 1,
    };
  }

  return {
    page: fallback.page,
    limit: fallback.limit,
    total: fallback.itemCount,
    totalPages: fallback.itemCount === 0 ? 0 : 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}
