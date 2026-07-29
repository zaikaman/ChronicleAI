import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { formatUsdc, strategyLabel } from "./format.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import type { DeskTicketNarrative } from "./types.ts";

interface DeskTicketsPanelProps {
  tickets: DeskTicketNarrative[];
  "data-testid"?: string;
}

export function DeskTicketsPanel({
  tickets,
  "data-testid": dataTestId = "desk-tickets-panel",
}: DeskTicketsPanelProps): ReactElement {
  if (tickets.length === 0) {
    return (
      <Surface className="p-6 text-sm text-muted-foreground" data-testid={dataTestId}>
        No trade tickets yet. Filled intents publish registry tickets with content URIs under{" "}
        <code className="font-mono text-[11px] bg-muted px-1 rounded">/desk/tickets/:id</code>.
      </Surface>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid={dataTestId}>
      {tickets.map((ticket) => (
        <Surface
          as="article"
          key={ticket.id}
          className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="min-w-0">
            <Link
              to={`/desk/tickets/${ticket.id}`}
              className="font-medium text-foreground hover:text-muted-foreground transition-colors"
            >
              {ticket.summary ??
                `${strategyLabel(ticket.strategy)} · ${formatUsdc(ticket.notionalUsdc)}`}
            </Link>
            <p className="text-xs text-muted-foreground mt-1">
              {strategyLabel(ticket.strategy)}
              {ticket.notionalUsdc != null ? ` · ${formatUsdc(ticket.notionalUsdc)}` : ""}
              {" · "}
              <TimestampDisplay timestamp={ticket.createdAt} />
            </p>
            {ticket.executionAuditSummary ? (
              <p
                className="mt-1.5 text-xs text-muted-foreground leading-relaxed text-pretty max-w-xl line-clamp-2"
                data-testid="desk-ticket-card-audit-summary"
                title={ticket.executionAuditSummary}
              >
                {ticket.executionAuditSummary}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
            {ticket.txHash ? (
              <ProofMonoLink value={ticket.txHash} href={ticket.explorerUrl} asTx />
            ) : (
              <span className="text-xs text-muted-foreground">No registry tx yet</span>
            )}
            {ticket.keeperHubRunId ? (
              <span className="text-[11px] text-muted-foreground">
                KH <ProofMonoLink value={ticket.keeperHubRunId} />
              </span>
            ) : null}
            <Link
              to={`/desk/tickets/${ticket.id}`}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Open ticket →
            </Link>
          </div>
        </Surface>
      ))}
    </div>
  );
}
