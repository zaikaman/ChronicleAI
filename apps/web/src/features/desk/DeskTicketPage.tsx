import type { ReactElement, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import {
  ContentUriFooter,
  Page,
  PageBackLink,
  PageHeader,
  PageSection,
  Surface,
} from "../../components/page-chrome.tsx";
import { RoutingBadge } from "../../components/routing-badge.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { flashbotsProtectStatusUrl, sepoliaTxUrl } from "../../lib/explorer.ts";
import { ExecutionAuditMissing, ExecutionAuditTimeline } from "./ExecutionAuditTimeline.tsx";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import {
  formatUsdc,
  signalTypeLabel,
  strategyLabel,
  ticketHeadline,
  ticketLegLabel,
  ticketOutcomeLabel,
  ticketOutcomeVariant,
} from "./format.ts";
import { useDeskTicket } from "./use-desk.ts";

export function DeskTicketPage(): ReactElement {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { state, refetch } = useDeskTicket(ticketId);

  if (state.status === "loading") {
    return (
      <Page data-testid="desk-ticket-page">
        <LoadingState
          message="Loading trade ticket..."
          variant="detail"
          data-testid="desk-ticket-loading"
        />
      </Page>
    );
  }

  if (state.status === "not-found") {
    return (
      <Page data-testid="desk-ticket-page">
        <PageBackLink to="/desk/intents">Desk intents</PageBackLink>
        <EmptyState
          title="Ticket not found"
          description="This trade ticket is not published or the content URI is invalid."
          data-testid="desk-ticket-not-found"
        />
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page data-testid="desk-ticket-page">
        <PageBackLink to="/desk/intents">Desk intents</PageBackLink>
        <RetryState
          title="Failed to load ticket"
          message={state.error}
          onRetry={refetch}
          data-testid="desk-ticket-error"
        />
      </Page>
    );
  }

  const { ticket, proofs } = state;
  const title = ticketHeadline(ticket);

  return (
    <Page data-testid="desk-ticket-page">
      <PageBackLink to="/desk/intents">Desk intents</PageBackLink>
      <PageHeader
        title={title}
        description="Follow the signal, decision, execution, and proof for this trade."
        meta={
          <StatusBadge label={ticketOutcomeLabel(ticket)} variant={ticketOutcomeVariant(ticket)} />
        }
        below={
          <>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground">
              {strategyLabel(ticket.strategy)}
            </span>
            {ticket.signalType ? (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground">
                {signalTypeLabel(ticket.signalType)}
              </span>
            ) : null}
            <TimestampDisplay timestamp={ticket.createdAt} />
          </>
        }
      />

      {/* Signal */}
      <PageSection title="Signal" description="What the desk observed before deciding.">
        <Surface className="p-5">
          <p className="text-base font-semibold text-foreground">
            {signalTypeLabel(ticket.signalType)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-2xl">
            The desk used this signal to decide whether an approved action was worth taking, then
            checked that decision against policy before execution.
          </p>
          {proofs.signalHash ? (
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-[11px] text-muted-foreground mb-1">Signal commitment</p>
              <ProofMonoLink value={proofs.signalHash} data-testid="ticket-signal-hash" />
            </div>
          ) : null}
        </Surface>
      </PageSection>

      {/* Agent thesis */}
      {ticket.agentThesis ? (
        <PageSection
          title="Agent thesis"
          description="The reasoning that informed the proposal; policy still gated the size and action."
        >
          <Surface className="p-5" data-testid="desk-ticket-agent-thesis">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {ticket.agentAction ? (
                <StatusBadge label={ticket.agentAction} variant="info" />
              ) : null}
              {ticket.agentConfidence != null ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  Confidence {(ticket.agentConfidence * 100).toFixed(0)}%
                </span>
              ) : null}
            </div>
            <p className="text-sm text-foreground leading-relaxed max-w-2xl text-pretty">
              {ticket.agentThesis}
            </p>
          </Surface>
        </PageSection>
      ) : null}

      {/* Decision */}
      <PageSection
        title="Decision"
        description="Why the desk acted, how much, and what policy allowed."
      >
        <Surface className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Strategy</p>
              <p className="text-sm font-semibold text-foreground">
                {strategyLabel(ticket.strategy)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notional</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {formatUsdc(ticket.notionalUsdc)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Intent</p>
              <Link
                to="/desk/intents"
                className="text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                {ticket.intentId.slice(0, 12)}…
              </Link>
            </div>
          </div>
          {ticket.reasonCodes.length > 0 ? (
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Reason codes</p>
              <div className="flex flex-wrap gap-2">
                {ticket.reasonCodes.map((code) => (
                  <span
                    key={code}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground font-mono"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {proofs.intentHash ? (
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-[11px] text-muted-foreground mb-1">Intent commitment</p>
              <ProofMonoLink value={proofs.intentHash} data-testid="ticket-intent-hash" />
            </div>
          ) : null}
        </Surface>
      </PageSection>

      {/* Legs */}
      <PageSection title="Legs" description="The concrete actions that made up this trade.">
        {ticket.legs.length === 0 ? (
          <Surface className="p-6 text-sm text-muted-foreground">
            This ticket does not include a public action summary.
          </Surface>
        ) : (
          <ol className="flex flex-col gap-2 list-none m-0 p-0">
            {ticket.legs.map((leg, index) => (
              <Surface
                as="li"
                key={`${leg.protocol}-${leg.action}-${index}`}
                className="px-4 py-3 flex flex-wrap items-center gap-3"
              >
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground tabular-nums shrink-0"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{ticketLegLabel(leg)}</p>
                  {(leg.asset || leg.tokenIn || leg.tokenOut) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Assets:{" "}
                      {[
                        leg.asset,
                        leg.tokenIn && leg.tokenOut ? `${leg.tokenIn}→${leg.tokenOut}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <details className="mt-1 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
                      Technical step details
                    </summary>
                    <p className="mt-1 font-mono text-[10px]">
                      {leg.protocol} · {leg.action}
                    </p>
                  </details>
                </div>
              </Surface>
            ))}
          </ol>
        )}
        {ticket.fillsCount > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {ticket.fillsCount} fill{ticket.fillsCount === 1 ? "" : "s"} recorded
            {ticket.fillTxHashes.length > 0 ? " with on-chain txs below." : "."}
          </p>
        ) : null}
      </PageSection>

      {/* Execution audit — KeeperHub last mile spine */}
      <PageSection
        title="Execution audit"
        description="Safety checks, KeeperHub run, and final outcome."
        data-testid="desk-ticket-execution-audit"
      >
        {ticket.executionAudit && ticket.executionAudit.version === 1 ? (
          <ExecutionAuditTimeline audit={ticket.executionAudit} />
        ) : (
          <ExecutionAuditMissing />
        )}
        {ticket.intentId ? (
          <p className="mt-3">
            <Link
              to={`/activity?entityId=${encodeURIComponent(ticket.intentId)}&entityType=desk_intent`}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              data-testid="ticket-activity-intent-link"
            >
              Activity logs for this intent →
            </Link>
          </p>
        ) : null}
      </PageSection>

      {/* Execution path (private routing) */}
      {(ticket.executionPath || ticket.routing) && (
        <PageSection
          title="Execution path"
          description="How this trade was submitted on Ethereum Sepolia via KeeperHub."
        >
          <Surface className="p-5" data-testid="desk-ticket-routing">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <RoutingBadge
                routing={ticket.routing}
                routingApplied={ticket.routing === "private_mempool" ? "unknown" : ticket.routing}
                data-testid="ticket-routing-badge"
              />
            </div>
            <p className="text-sm text-foreground leading-relaxed max-w-2xl text-pretty">
              {ticket.executionPath ??
                (ticket.routing === "private_mempool"
                  ? "Execution path: KeeperHub private mempool requested (Flashbots Protect · Sepolia)"
                  : "Execution path: public mempool submission")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Private submission path on Sepolia — not a claim of mainnet-scale sandwich protection.
            </p>
            {(() => {
              const protectUrl =
                ticket.protectStatusUrl ??
                (ticket.routing === "private_mempool" && ticket.fillTxHashes[0]
                  ? flashbotsProtectStatusUrl(ticket.fillTxHashes[0])
                  : ticket.routing === "private_mempool" && proofs.txHash
                    ? flashbotsProtectStatusUrl(proofs.txHash)
                    : null);
              if (!protectUrl) return null;
              return (
                <p className="mt-3">
                  <a
                    href={protectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="ticket-protect-status-link"
                  >
                    Flashbots Protect status →
                  </a>
                </p>
              );
            })()}
          </Surface>
        </PageSection>
      )}

      {/* Proofs */}
      <PageSection title="Proofs" description="The receipt trail for this decision and execution.">
        <Surface className="p-5 flex flex-col gap-3" data-testid="desk-ticket-proofs">
          <ProofRow label="Ticket hash">
            {proofs.ticketHash ? (
              <ProofMonoLink value={proofs.ticketHash} data-testid="ticket-hash" />
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </ProofRow>
          <ProofRow label="Registry tx">
            {proofs.txHash ? (
              <ProofMonoLink
                value={proofs.txHash}
                href={proofs.explorerUrl ?? sepoliaTxUrl(proofs.txHash)}
                asTx
                data-testid="ticket-tx"
              />
            ) : (
              <span className="text-sm text-muted-foreground">Not anchored yet</span>
            )}
          </ProofRow>
          <ProofRow label="KeeperHub run">
            {proofs.keeperHubRunId ? (
              <ProofMonoLink value={proofs.keeperHubRunId} data-testid="ticket-kh-run" />
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </ProofRow>
          {(proofs.fillTxHashes?.length ?? 0) > 0 || ticket.fillTxHashes.length > 0 ? (
            <ProofRow label="Fill txs">
              <div className="flex flex-col gap-1">
                {(proofs.fillTxHashes ?? ticket.fillTxHashes).map((hash) => (
                  <ProofMonoLink key={hash} value={hash} asTx />
                ))}
              </div>
            </ProofRow>
          ) : null}
          {proofs.explorerUrl ? (
            <div className="pt-2 border-t border-border/50">
              <a
                href={proofs.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Open registry proof on explorer →
              </a>
            </div>
          ) : null}
        </Surface>
      </PageSection>

      {proofs.contentUri || ticket.contentUri ? (
        <ContentUriFooter uri={(proofs.contentUri ?? ticket.contentUri) as string} />
      ) : null}
    </Page>
  );
}

function ProofRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 min-w-0">
      <span className="text-[11px] text-muted-foreground shrink-0 sm:w-[7.5rem]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
