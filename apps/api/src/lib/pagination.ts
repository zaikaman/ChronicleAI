// Shared page-based pagination parsing + response helpers for public list routes

export interface PaginationQuery {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedEnvelope<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface ParsePaginationOptions {
  /** Default page size when limit is omitted. */
  defaultLimit?: number;
  /** Maximum allowed limit (inclusive). */
  maxLimit?: number;
}

/**
 * Parse `page` and `limit` query params into safe integers.
 * Returns null when values are present but invalid (caller should 400).
 */
export function parsePaginationQuery(
  query: { page?: unknown; limit?: unknown },
  options?: ParsePaginationOptions,
): PaginationQuery | { error: string } {
  const defaultLimit = options?.defaultLimit ?? 20;
  const maxLimit = options?.maxLimit ?? 100;

  let page = 1;
  if (query.page !== undefined && query.page !== null && query.page !== "") {
    const raw = typeof query.page === "string" ? Number(query.page) : Number(query.page);
    if (!Number.isInteger(raw) || raw < 1) {
      return { error: "page must be an integer >= 1" };
    }
    page = raw;
  }

  let limit = defaultLimit;
  if (query.limit !== undefined && query.limit !== null && query.limit !== "") {
    const raw =
      typeof query.limit === "string" ? Number(query.limit) : Number(query.limit);
    if (!Number.isInteger(raw) || raw < 1 || raw > maxLimit) {
      return { error: `limit must be an integer between 1 and ${maxLimit}` };
    }
    limit = raw;
  }

  return { page, limit };
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const safeTotal = Math.max(0, Math.floor(total));
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);
  const safePage = Math.max(1, page);
  return {
    page: safePage,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage: totalPages > 0 && safePage < totalPages,
    hasPreviousPage: safePage > 1 && totalPages > 0,
  };
}

export function toPaginatedEnvelope<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedEnvelope<T> {
  return {
    items,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

/** Map a DB PaginatedResult-shaped object into the public API envelope. */
export function fromDbPage<T, U>(
  page: {
    items: T[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  },
  mapItem: (item: T) => U,
): PaginatedEnvelope<U> {
  return {
    items: page.items.map(mapItem),
    pagination: {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages: page.totalPages,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    },
  };
}
