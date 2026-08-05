import { useMemo, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import {
  Page,
  PageBackLink,
  PageHeader,
  PageSection,
  Surface,
} from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { truncateHash } from "../../lib/explorer.ts";
import {
  formatUsdc,
  intentStatusVariant,
  strategyLabel,
} from "./format.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import { useDeskIntents, useDeskTickets } from "./use-desk.ts";

export function DeskIntentsPage(): ReactElement {
  const {
    intents,
    pagination,
    setPage: setIntentsPage,
    isLoading,
    error,
    refetch,
  } = useDeskIntents(20);
  // Ticket map for the current intents page (same page size / order by recency).
  const tickets = useDeskTickets(20);

  const setPage = (next: number) => {
    setIntentsPage(next);
    tickets.setPage(next);
  };

  const ticketByIntent = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tickets.tickets) {
      if (!map.has(t.intentId)) map.set(t.intentId, t.id);
    }
    return map;
  }, [tickets.tickets]);

  return (
    <Page data-testid="desk-intents-page">
      <PageBackLink to="/desk">Desk status</PageBackLink>
      <PageHeader
        title="Desk proposals"
        description="Review what the desk proposed, whether safety rules allowed it, and what proof was recorded."
        meta={
          !isLoading && !error ? (
            <span className="tabular-nums">
              {pagination.total} total
              {pagination.totalPages > 1
                ? ` · page ${pagination.page}/${pagination.totalPages}`
                : ""}
            </span>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingState
          message="Loading proposals..."
          variant="cards"
          count={5}
          data-testid="desk-intents-loading"
        />
      ) : error ? (
        <RetryState
          title="Failed to load intents"
          message={error}
          onRetry={refetch}
          data-testid="desk-intents-error"
        />
      ) : intents.length === 0 ? (
        <EmptyState
          title="No proposals yet"
          description="When the desk evaluates a signal, its next proposal will appear here with the decision and execution proof."
          data-testid="desk-intents-empty"
        />
      ) : (
        <PageSection>
          {/* Desktop table */}
          <Surface className="hidden md:block overflow-x-auto" data-testid="desk-intents-table">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Strategy</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Trade size</th>
                  <th className="px-4 py-3 font-medium">Legs</th>
                  <th className="px-4 py-3 font-medium">Proofs</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {intents.map((intent) => {
                  const ticketId = ticketByIntent.get(intent.id);
                  return (
                    <tr
                      key={intent.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-foreground">
                          {strategyLabel(intent.strategy)}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                          {truncateHash(intent.id, 8, 4)}
                        </p>
                        {intent.agentThesis ? (
                          <p
                            className="text-[11px] text-muted-foreground mt-1.5 max-w-[16rem] line-clamp-2 leading-snug"
                            title={intent.agentThesis}
                          >
                            {intent.agentConfidence != null ? (
                              <span className="tabular-nums text-foreground/80 mr-1">
                                {(intent.agentConfidence * 100).toFixed(0)}%
                              </span>
                            ) : null}
                            {intent.agentThesis}
                          </p>
                        ) : intent.reasonCodes.length > 0 ? (
                          <p className="text-[11px] text-muted-foreground mt-1 max-w-[12rem] truncate">
                            {intent.reasonCodes.slice(0, 3).join(", ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge
                          label={intent.status}
                          variant={intentStatusVariant(intent.status)}
                        />
                        {intent.errorMessage ? (
                          <p className="text-[11px] text-muted-foreground mt-1 max-w-[10rem] line-clamp-2">
                            {intent.errorMessage}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top tabular-nums text-foreground">
                        {formatUsdc(intent.notionalUsdc)}
                      </td>
                      <td className="px-4 py-3 align-top tabular-nums text-muted-foreground">
                        {intent.legCount}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-1.5">
                          {intent.keeperHubRunId ? (
                            <span className="text-[11px] text-muted-foreground">
                              KH{" "}
                              <ProofMonoLink value={intent.keeperHubRunId} />
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">No KH run</span>
                          )}
                          {ticketId ? (
                            <Link
                              to={`/desk/tickets/${ticketId}`}
                              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Trade ticket →
                            </Link>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">No ticket</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <TimestampDisplay timestamp={intent.createdAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Surface>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-3" data-testid="desk-intents-cards">
            {intents.map((intent) => {
              const ticketId = ticketByIntent.get(intent.id);
              return (
                <Surface key={intent.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-medium text-foreground">
                      {strategyLabel(intent.strategy)}
                    </p>
                    <StatusBadge
                      label={intent.status}
                      variant={intentStatusVariant(intent.status)}
                    />
                  </div>
                  <p className="text-sm tabular-nums text-foreground mb-2">
                    {formatUsdc(intent.notionalUsdc)} · {intent.legCount} leg
                    {intent.legCount === 1 ? "" : "s"}
                  </p>
                  {intent.agentThesis ? (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-3 leading-relaxed">
                      {intent.agentConfidence != null ? (
                        <span className="tabular-nums font-medium text-foreground/80 mr-1">
                          {(intent.agentConfidence * 100).toFixed(0)}% ·
                        </span>
                      ) : null}
                      {intent.agentThesis}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <TimestampDisplay timestamp={intent.createdAt} />
                    {intent.keeperHubRunId ? (
                      <ProofMonoLink value={intent.keeperHubRunId} />
                    ) : null}
                    {ticketId ? (
                      <Link
                        to={`/desk/tickets/${ticketId}`}
                        className="font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Ticket →
                      </Link>
                    ) : null}
                  </div>
                </Surface>
              );
            })}
          </div>

          <PaginationControls
            pagination={pagination}
            onPageChange={setPage}
            disabled={isLoading}
            data-testid="desk-intents-pagination"
          />
        </PageSection>
      )}
    </Page>
  );
}
