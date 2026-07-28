// Page and content skeleton placeholders.
// Use for full pages, lists, cards, and tables while data loads.
// Prefer Spinner for buttons and compact inline waits.

import type { CSSProperties, ReactElement } from "react";

// ── Primitive bone ─────────────────────────────────────

interface SkeletonProps {
  className?: string;
  /** Rounded pill (chips / badges) */
  pill?: boolean;
  style?: CSSProperties;
}

/** Single skeleton bone — shape with shimmer. */
export function Skeleton({
  className = "",
  pill = false,
  style,
}: SkeletonProps): ReactElement {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-bone ${pill ? "skeleton-bone--pill" : ""} ${className}`.trim()}
      style={style}
    />
  );
}

// ── Building blocks ────────────────────────────────────

export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}): ReactElement {
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-[60%]" : i % 2 === 0 ? "w-full" : "w-[92%]"}`}
        />
      ))}
    </div>
  );
}

/** Publication / alert card silhouette. */
export function SkeletonCard({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      className={`rounded-2xl border border-border bg-frame p-6 ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <div className="flex justify-between items-start gap-4 mb-4">
        <div className="flex flex-wrap gap-2 flex-1 min-w-0">
          <Skeleton pill className="h-5 w-16" />
          <Skeleton pill className="h-5 w-20" />
          <Skeleton pill className="h-5 w-14" />
        </div>
        <Skeleton className="h-4 w-16 shrink-0" />
      </div>
      <Skeleton className="h-5 w-[80%] mb-3" />
      <SkeletonText lines={2} className="mb-5" />
      <div className="pt-4 border-t border-border/60 flex flex-wrap gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

/** Premium teaser grid card. */
export function SkeletonTeaserCard({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      className={`rounded-2xl border border-border bg-frame p-6 flex flex-col h-full ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <Skeleton pill className="h-5 w-20" />
        <Skeleton pill className="h-5 w-14" />
      </div>
      <Skeleton className="h-5 w-3/4 mb-3" />
      <SkeletonText lines={3} className="mb-6 flex-1" />
      <div className="flex items-center justify-between gap-4 pt-4 border-t border-border mt-auto">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
    </div>
  );
}

/** Stat tile silhouette. */
export function SkeletonStatTile({ className = "" }: { className?: string }): ReactElement {
  return (
    <div
      className={`rounded-2xl border border-border bg-frame p-4 ${className}`.trim()}
      aria-hidden="true"
    >
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

/** Compact list/table row skeleton. */
export function SkeletonTableRows({
  rows = 4,
  className = "",
}: {
  rows?: number;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`rounded-2xl border border-border bg-frame overflow-hidden ${className}`.trim()}
      aria-hidden="true"
    >
      <div className="px-4 py-3 border-b border-border flex gap-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-28 hidden sm:block" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="px-4 py-3.5 border-b border-border/50 last:border-0 flex items-center gap-4"
        >
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-32 flex-1 max-w-[40%]" />
          <Skeleton pill className="h-5 w-16" />
          <Skeleton className="h-3 w-20 hidden sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Panel shell with a few row bones (activity secondary panels). */
export function SkeletonPanel({
  rows = 3,
  className = "",
  "data-testid": dataTestId,
}: {
  rows?: number;
  className?: string;
  "data-testid"?: string;
}): ReactElement {
  return (
    <div
      className={`rounded-2xl border border-border bg-frame p-5 ${className}`.trim()}
      data-testid={dataTestId}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton pill className="h-5 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page-level compositions ────────────────────────────

export type PageSkeletonVariant =
  | "cards"
  | "grid"
  | "detail"
  | "digest"
  | "stats"
  | "activity"
  | "route";

interface PageSkeletonProps {
  variant?: PageSkeletonVariant;
  /** Number of primary content units (cards / rows). */
  count?: number;
  className?: string;
  "data-testid"?: string;
  /** Optional accessible announcement (visually hidden). */
  label?: string;
}

/**
 * Full-page content skeleton matching product layouts.
 * Keeps page chrome (title) optional — pass header outside when the real header is already shown.
 */
export function PageSkeleton({
  variant = "cards",
  count,
  className = "",
  "data-testid": dataTestId = "page-skeleton",
  label = "Loading content",
}: PageSkeletonProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid={dataTestId}
      className={`page-skeleton ${className}`.trim()}
    >
      <span className="sr-only">{label}</span>
      {variant === "cards" ? <CardsSkeleton count={count ?? 4} /> : null}
      {variant === "grid" ? <GridSkeleton count={count ?? 4} /> : null}
      {variant === "detail" ? <DetailSkeleton /> : null}
      {variant === "digest" ? <DigestSkeleton /> : null}
      {variant === "stats" ? <StatsSkeleton /> : null}
      {variant === "activity" ? <ActivitySkeleton /> : null}
      {variant === "route" ? <RouteSkeleton /> : null}
    </div>
  );
}

function CardsSkeleton({ count }: { count: number }): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard
          key={i}
          className="skeleton-stagger"
          style={{ ["--stagger" as string]: `${i * 60}ms` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function GridSkeleton({ count }: { count: number }): ReactElement {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonTeaserCard
          key={i}
          className="skeleton-stagger"
          style={{ ["--stagger" as string]: `${i * 50}ms` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function DetailSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-24 mb-2" />
      <SkeletonCard />
      <div className="flex justify-center mt-4">
        <Skeleton className="h-9 w-64 rounded-xl" />
      </div>
    </div>
  );
}

function DigestSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-8 max-w-4xl">
      <div>
        <Skeleton className="h-8 w-[75%] mb-3 max-w-md" />
        <div className="flex gap-3 items-center">
          <Skeleton className="h-4 w-40" />
          <Skeleton pill className="h-6 w-20" />
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-frame p-6">
        <Skeleton className="h-4 w-28 mb-4" />
        <SkeletonText lines={4} />
        <div className="mt-5 pt-4 border-t border-border flex flex-wrap gap-3">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <div className="rounded-2xl border border-border bg-frame p-6">
          <SkeletonText lines={5} />
        </div>
        <div className="rounded-2xl border border-border bg-frame p-6">
          <SkeletonText lines={4} />
        </div>
      </div>
    </div>
  );
}

function StatsSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonStatTile key={i} />
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-frame p-6">
        <Skeleton className="h-4 w-36 mb-4" />
        <SkeletonText lines={3} />
      </div>
      <SkeletonPanel rows={4} />
    </div>
  );
}

function ActivitySkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonStatTile key={i} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <SkeletonPanel rows={3} />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <SkeletonTableRows rows={4} />
      </div>
    </div>
  );
}

/** Suspense / route-level fallback: soft page structure, no spinner center. */
function RouteSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-6 w-full py-2">
      <div>
        <Skeleton className="h-8 w-48 mb-3 max-w-[60%]" />
        <Skeleton className="h-3.5 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard className="opacity-70" />
      </div>
    </div>
  );
}
