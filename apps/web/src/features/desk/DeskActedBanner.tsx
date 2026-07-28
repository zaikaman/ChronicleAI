import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { formatUsdc, strategyLabel } from "./format.ts";
import type { DeskTicketNarrative } from "./types.ts";

interface DeskActedBannerProps {
  ticket: DeskTicketNarrative;
  "data-testid"?: string;
}

/**
 * Shown on public alert detail when a desk trade ticket exists for the signal.
 */
export function DeskActedBanner({
  ticket,
  "data-testid": dataTestId = "desk-acted-banner",
}: DeskActedBannerProps): ReactElement {
  return (
    <aside
      data-testid={dataTestId}
      className="mb-6 rounded-2xl border border-border bg-frame p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      aria-label="Desk acted on this signal"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Desk acted</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-xl">
          Chronicle Desk executed on a related signal
          {ticket.strategy ? ` via ${strategyLabel(ticket.strategy)}` : ""}
          {ticket.notionalUsdc != null ? ` for ${formatUsdc(ticket.notionalUsdc)}` : ""}. Review
          the trade ticket for legs and on-chain proofs.
        </p>
      </div>
      <Link
        to={`/desk/tickets/${ticket.id}`}
        className="inline-flex items-center justify-center rounded-xl bg-accent text-black px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity shrink-0"
      >
        View trade ticket
      </Link>
    </aside>
  );
}
