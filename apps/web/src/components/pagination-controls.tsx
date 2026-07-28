// Page-based pagination controls for product list surfaces.
// Calm desk chrome: previous/next + compact page window + result range.

import type { ReactElement } from "react";
import type { PaginationMeta } from "@chronicleai/schemas";

export interface PaginationControlsProps {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  /** Disable controls while a page fetch is in flight. */
  disabled?: boolean;
  "data-testid"?: string;
  className?: string;
}

function pageWindow(current: number, totalPages: number, radius = 1): number[] {
  if (totalPages <= 0) return [];
  const start = Math.max(1, current - radius);
  const end = Math.min(totalPages, current + radius);
  const pages: number[] = [];
  for (let p = start; p <= end; p += 1) pages.push(p);
  return pages;
}

/**
 * Inline pagination bar. Hidden when there is only one page (or zero results).
 */
export function PaginationControls({
  pagination,
  onPageChange,
  disabled = false,
  "data-testid": dataTestId = "pagination",
  className = "",
}: PaginationControlsProps): ReactElement | null {
  const { page, limit, total, totalPages, hasNextPage, hasPreviousPage } = pagination;

  if (totalPages <= 1 || total === 0) {
    return null;
  }

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const pages = pageWindow(page, totalPages);
  const showLeading = pages[0] != null && pages[0] > 1;
  const showTrailing = pages[pages.length - 1] != null && pages[pages.length - 1]! < totalPages;

  const btnBase =
    "inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <nav
      className={`mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}
      aria-label="Pagination"
      data-testid={dataTestId}
    >
      <p className="text-xs text-muted-foreground tabular-nums" data-testid={`${dataTestId}-range`}>
        Showing {from}–{to} of {total}
      </p>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`${btnBase} border border-border bg-frame text-foreground hover:border-accent/40 hover:bg-muted/40`}
          disabled={disabled || !hasPreviousPage}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          data-testid={`${dataTestId}-prev`}
        >
          Previous
        </button>

        {showLeading ? (
          <>
            <button
              type="button"
              className={`${btnBase} border border-border bg-frame text-foreground hover:border-accent/40`}
              disabled={disabled}
              onClick={() => onPageChange(1)}
              aria-label="Page 1"
            >
              1
            </button>
            {pages[0]! > 2 ? (
              <span className="px-1 text-xs text-muted-foreground" aria-hidden>
                …
              </span>
            ) : null}
          </>
        ) : null}

        {pages.map((p) => {
          const active = p === page;
          return (
            <button
              key={p}
              type="button"
              className={
                active
                  ? `${btnBase} bg-foreground text-background`
                  : `${btnBase} border border-border bg-frame text-foreground hover:border-accent/40`
              }
              disabled={disabled || active}
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={active ? "page" : undefined}
              data-testid={active ? `${dataTestId}-current` : undefined}
            >
              {p}
            </button>
          );
        })}

        {showTrailing ? (
          <>
            {pages[pages.length - 1]! < totalPages - 1 ? (
              <span className="px-1 text-xs text-muted-foreground" aria-hidden>
                …
              </span>
            ) : null}
            <button
              type="button"
              className={`${btnBase} border border-border bg-frame text-foreground hover:border-accent/40`}
              disabled={disabled}
              onClick={() => onPageChange(totalPages)}
              aria-label={`Page ${totalPages}`}
            >
              {totalPages}
            </button>
          </>
        ) : null}

        <button
          type="button"
          className={`${btnBase} border border-border bg-frame text-foreground hover:border-accent/40 hover:bg-muted/40`}
          disabled={disabled || !hasNextPage}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          data-testid={`${dataTestId}-next`}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
