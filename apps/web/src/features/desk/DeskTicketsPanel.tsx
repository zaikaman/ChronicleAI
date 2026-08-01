import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import {
  formatUsdc,
  strategyLabel,
  ticketExecutionNarrative,
  ticketHeadline,
  ticketLegSummary,
  ticketOutcomeLabel,
  ticketOutcomeVariant,
} from "./format.ts";
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
        No completed desk trades yet. When the desk acts, each ticket will explain why, what it
        changed, and how to verify it.
      </Surface>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid={dataTestId}>
      {tickets.map((ticket) => (
        <Surface
          as="article"
          key={ticket.id}
          className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
        >
          <div className="min-w-0">
            <Link
              to={`/desk/tickets/${ticket.id}`}
              className="block text-base font-semibold text-foreground hover:text-muted-foreground transition-colors text-pretty"
            >
              {ticketHeadline(ticket)}
            </Link>
            <p className="text-xs text-muted-foreground mt-1.5">
              {strategyLabel(ticket.strategy)}
              {ticket.notionalUsdc != null ? ` · ${formatUsdc(ticket.notionalUsdc)}` : ""}
              {" · "}
              <TimestampDisplay timestamp={ticket.createdAt} />
            </p>
            {ticket.agentThesis ? (
              <p
                className="mt-2 text-sm text-foreground/90 leading-relaxed text-pretty max-w-xl line-clamp-2"
                title={ticket.agentThesis}
              >
                <span className="text-xs font-medium text-muted-foreground">Why: </span>
                {ticket.agentThesis}
              </p>
            ) : ticketLegSummary(ticket.legs) ? (
              <p className="mt-2 text-sm text-foreground/90 leading-relaxed text-pretty max-w-xl">
                <span className="text-xs font-medium text-muted-foreground">Action: </span>
                {ticketLegSummary(ticket.legs)}
              </p>
            ) : null}
            <p
              className="mt-2 text-xs text-muted-foreground leading-relaxed text-pretty max-w-xl"
              data-testid="desk-ticket-card-audit-summary"
            >
              {ticketExecutionNarrative(ticket)}
            </p>
            {ticket.executionAuditSummary ? (
              <details className="mt-2 max-w-xl text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
                  Technical execution details
                </summary>
                <p className="mt-1.5 leading-relaxed text-pretty">{ticket.executionAuditSummary}</p>
              </details>
            ) : null}
          </div>
          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <StatusBadge
              label={ticketOutcomeLabel(ticket)}
              variant={ticketOutcomeVariant(ticket)}
              data-testid="desk-ticket-outcome"
            />
            <div className="flex flex-col items-start sm:items-end gap-1 text-[11px] text-muted-foreground">
              {ticket.txHash ? (
                <span className="flex items-center gap-1.5">
                  <span>Registry proof</span>
                  <ProofMonoLink value={ticket.txHash} href={ticket.explorerUrl} asTx />
                </span>
              ) : (
                <span>Registry proof pending</span>
              )}
              {ticket.keeperHubRunId ? (
                <span className="flex items-center gap-1.5">
                  <span>KeeperHub run</span>
                  <ProofMonoLink value={ticket.keeperHubRunId} />
                </span>
              ) : null}
            </div>
            <Link
              to={`/desk/tickets/${ticket.id}`}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Read full ticket →
            </Link>
          </div>
        </Surface>
      ))}
    </div>
  );
}
