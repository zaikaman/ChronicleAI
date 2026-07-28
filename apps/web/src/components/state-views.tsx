// Accessible state view components for loading, empty, error, and retry states.
// Page loading: prefer PageSkeleton from ./ui/skeleton.tsx.
// Inline / small waits: prefer Spinner from ./ui/spinner.tsx.

import type React from "react";
import { PageSkeleton, type PageSkeletonVariant } from "./ui/skeleton.tsx";
import { SpinnerBlock } from "./ui/spinner.tsx";

// ── Loading State ─────────────────────────────────────
interface LoadingStateProps {
  message?: string;
  /**
   * `skeleton` (default) — page-shaped placeholder.
   * `spinner` — compact centered spinner for small regions only.
   */
  mode?: "skeleton" | "spinner";
  /** Skeleton layout when mode is skeleton. */
  variant?: PageSkeletonVariant;
  count?: number;
  "data-testid"?: string;
}

/**
 * @deprecated Prefer `PageSkeleton` for pages and `Spinner` / `SpinnerBlock` for inline.
 * Kept for call-site convenience with a polished skeleton default.
 */
export function LoadingState({
  message = "Loading...",
  mode = "skeleton",
  variant = "cards",
  count,
  "data-testid": dataTestId = "loading-state",
}: LoadingStateProps): React.ReactElement {
  if (mode === "spinner") {
    return <SpinnerBlock message={message} data-testid={dataTestId} />;
  }
  return (
    <PageSkeleton
      variant={variant}
      count={count}
      label={message}
      data-testid={dataTestId}
    />
  );
}

// ── Empty State ───────────────────────────────────────
interface EmptyStateProps {
  title: string;
  description?: string;
  "data-testid"?: string;
}

export function EmptyState({
  title,
  description,
  "data-testid": dataTestId = "empty-state",
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      role="status"
      data-testid={dataTestId}
      className="flex flex-col items-center gap-2 py-12 px-6 text-center rounded-2xl border border-border bg-frame"
    >
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}

// ── Error State ───────────────────────────────────────
interface ErrorStateProps {
  title?: string;
  message: string;
  "data-testid"?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  "data-testid": dataTestId = "error-state",
}: ErrorStateProps): React.ReactElement {
  return (
    <div
      role="alert"
      data-testid={dataTestId}
      className="flex flex-col items-center gap-2 py-8 px-6 text-center rounded-2xl border border-rose-500/20 bg-frame"
    >
      <h3 className="text-base font-semibold text-rose-500">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{message}</p>
    </div>
  );
}

// ── Retry State ───────────────────────────────────────
interface RetryStateProps {
  title?: string;
  message: string;
  onRetry: () => void;
  "data-testid"?: string;
}

export function RetryState({
  title = "Failed to load",
  message,
  onRetry,
  "data-testid": dataTestId = "retry-state",
}: RetryStateProps): React.ReactElement {
  return (
    <div
      role="alert"
      data-testid={dataTestId}
      className="flex flex-col items-center gap-4 py-8 px-6 text-center rounded-2xl border border-rose-500/20 bg-frame"
    >
      <div>
        <h3 className="text-base font-semibold text-rose-500">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm leading-relaxed">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        data-testid="retry-button"
        className="px-4 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
      >
        Retry
      </button>
    </div>
  );
}
