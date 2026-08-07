// Unified activity feed — one chronological stream replaces the old 5-tab / 13-panel layout.
// Filter chips: All / Publications / Desk / Money / System (dense execution log).

import { type ReactElement, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { EmptyState } from "../../components/state-views.tsx";
import { SkeletonPanel } from "../../components/ui/skeleton.tsx";
import { truncateHash } from "../../lib/explorer.ts";
import { ExecutionLogTable } from "./ExecutionLogTable.tsx";
import {
  type ActivityFeedState,
  type ActivityFilterId,
  type FeedItem,
  FeedKindIcon,
} from "./use-activity-feed.tsx";
import { useExecutionLogs } from "./use-activity-lists.ts";

interface ActivityFeedProps {
  feed: ActivityFeedState;
  filter: ActivityFilterId;
  onFilterChange: (filter: ActivityFilterId) => void;
  entityId?: string | null;
  entityType?: string | null;
  onClearEntityFilter?: () => void;
}

const FILTER_OPTIONS: Array<{ id: ActivityFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "publications", label: "Publications" },
  { id: "desk", label: "Desk" },
  { id: "money", label: "Money" },
  { id: "system", label: "System" },
];

export function ActivityFeed({
  feed,
  filter,
  onFilterChange,
  entityId,
  entityType,
  onClearEntityFilter,
}: ActivityFeedProps): ReactElement {
  const executionLogs = useExecutionLogs(25, {
    entityId: entityId ?? null,
    entityType: entityType ?? null,
    enabled: filter === "system",
  });

  const visibleItems = useMemo(() => {
    if (filter === "all" || filter === "system") return feed.items;
    return feed.items.filter((item) => item.category === filter);
  }, [feed.items, filter]);

  const isSystem = filter === "system";

  return (
    <div data-testid="activity-feed">
      {/* Filter bar */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2.5 border-b border-border/50 bg-background/95 backdrop-blur-sm mb-6 transition-colors">
        <nav
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
          aria-label="Activity filters"
        >
          {FILTER_OPTIONS.map((option) => {
            const active = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onFilterChange(option.id)}
                aria-pressed={active}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? "bg-accent text-black font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                data-testid={`activity-filter-${option.id}`}
              >
                {option.label}
              </button>
            );
          })}
        </nav>
      </div>

      {isSystem ? (
        <SystemView
          isLoading={executionLogs.isLoading}
          error={executionLogs.error}
          entityId={entityId}
          entityType={entityType}
          onClearEntityFilter={onClearEntityFilter}
          logs={executionLogs.items}
          pagination={executionLogs.pagination}
          onPageChange={executionLogs.setPage}
          isFetchingPage={executionLogs.isLoading}
        />
      ) : (
        <FeedView
          items={visibleItems}
          isLoading={feed.isLoading}
          error={feed.error}
          onRetry={feed.refetch}
          showKind={filter === "all"}
        />
      )}
    </div>
  );
}

function FeedView({
  items,
  isLoading,
  error,
  onRetry,
  showKind,
}: {
  items: FeedItem[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  showKind: boolean;
}): ReactElement {
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const pagination = useMemo(
    () => ({
      page: safePage,
      limit: pageSize,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    }),
    [safePage, pageSize, total, totalPages],
  );

  if (isLoading) {
    return <SkeletonPanel rows={6} data-testid="activity-feed-loading" />;
  }
  if (error) {
    return (
      <Surface className="p-6 text-sm text-muted-foreground" data-testid="activity-feed-error">
        <p className="leading-relaxed">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </Surface>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Alerts, digests, desk trades, and settlements will appear here once ChronicleAI records them."
        data-testid="activity-feed-empty"
      />
    );
  }

  return (
    <div data-testid="activity-feed-list">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="activity-feed-count">
          Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, total)} of {total} events · newest first
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {paginatedItems.map((item) => (
          <FeedRow key={item.key} item={item} showKind={showKind} />
        ))}
      </ul>
      <PaginationControls
        pagination={pagination}
        onPageChange={setPage}
        disabled={isLoading}
        data-testid="activity-feed-pagination"
      />
    </div>
  );
}

function FeedRow({ item, showKind }: { item: FeedItem; showKind: boolean }): ReactElement {
  const titleNode = item.href ? (
    <Link
      to={item.href}
      className="font-medium text-foreground hover:text-muted-foreground transition-colors text-pretty"
    >
      {item.title}
    </Link>
  ) : (
    <span className="font-medium text-foreground text-pretty">{item.title}</span>
  );

  return (
    <li
      className="rounded-2xl border border-border bg-frame p-4 flex gap-3 transition-colors hover:border-border/70"
      data-testid={`feed-item-${item.key}`}
    >
      <FeedKindIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {showKind ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {item.kindLabel}
                </span>
              ) : null}
              {titleNode}
            </div>
            {item.detail ? (
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed text-pretty line-clamp-2">
                {item.detail}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <TimestampDisplay timestamp={item.timestamp} />
            {item.status ? (
              <StatusBadge label={item.status.label} variant={item.status.variant} />
            ) : null}
          </div>
        </div>
        {item.proofs && item.proofs.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {item.proofs.map((proof) => {
              const label = `${proof.label} ${truncateHash(proof.hash, 8, 4)}`;
              return proof.href ? (
                <a
                  key={`${proof.label}:${proof.hash}`}
                  href={proof.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 bg-muted/40 border border-border/40 px-2 py-0.5 rounded-lg font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  title={proof.hash}
                >
                  {label}
                </a>
              ) : (
                <code
                  key={`${proof.label}:${proof.hash}`}
                  className="inline-flex items-center gap-1 bg-muted/40 border border-border/40 px-2 py-0.5 rounded-lg font-mono text-[11px] text-muted-foreground"
                  title={proof.hash}
                >
                  {label}
                </code>
              );
            })}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SystemView({
  isLoading,
  error,
  entityId,
  entityType,
  onClearEntityFilter,
  logs,
  pagination,
  onPageChange,
  isFetchingPage,
}: {
  isLoading: boolean;
  error: string | null;
  entityId?: string | null;
  entityType?: string | null;
  onClearEntityFilter?: () => void;
  logs: ReturnType<typeof useExecutionLogs>["items"];
  pagination: ReturnType<typeof useExecutionLogs>["pagination"];
  onPageChange: (page: number) => void;
  isFetchingPage: boolean;
}): ReactElement {
  return (
    <div id="execution-logs" data-testid="execution-logs-section">
      <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
        The detailed record of monitoring, publishing, treasury, and execution events, including
        failures and retries. {entityId ? "" : "Filter by status, action, or free text."}
      </p>

      {entityId ? (
        <Surface
          className="mb-3 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
          data-testid="execution-logs-intent-filter"
        >
          <p className="text-xs text-muted-foreground leading-relaxed min-w-0">
            Showing KeeperHub logs for intent{" "}
            <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded break-all">
              {entityId}
            </code>
            {entityType ? (
              <>
                {" "}
                · type <span className="font-medium text-foreground">{entityType}</span>
              </>
            ) : null}
          </p>
          {onClearEntityFilter ? (
            <button
              type="button"
              onClick={onClearEntityFilter}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="execution-logs-clear-filter"
            >
              Clear filter
            </button>
          ) : null}
        </Surface>
      ) : null}

      {isLoading ? (
        <SkeletonPanel rows={5} data-testid="execution-logs-loading" />
      ) : error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{error}</Surface>
      ) : (
        <>
          <ExecutionLogTable logs={logs} isLoading={isFetchingPage} />
          <PaginationControls
            pagination={pagination}
            onPageChange={onPageChange}
            disabled={isFetchingPage}
            data-testid="execution-logs-pagination"
          />
        </>
      )}
    </div>
  );
}
