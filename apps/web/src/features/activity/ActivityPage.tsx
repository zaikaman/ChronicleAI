import { type ReactElement, type ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import {
  Page,
  PageHeader,
  PageSection,
  SectionLink,
  StatTile,
  Surface,
} from "../../components/page-chrome.tsx";
import { PublicationProof } from "../../components/publication-proof.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { SkeletonPanel } from "../../components/ui/skeleton.tsx";
import { baseSepoliaAddressUrl, baseSepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";
import { useInView } from "../../lib/use-in-view.ts";
import { CapitalMovesPanel } from "../desk/CapitalMovesPanel.tsx";
import { DeskTicketsPanel } from "../desk/DeskTicketsPanel.tsx";
import { useDeskCapitalMoves, useDeskTickets } from "../desk/use-desk.ts";
import { CctpRebalancesPanel } from "./CctpRebalancesPanel.tsx";
import { ExecutionLogTable } from "./ExecutionLogTable.tsx";
import { LowBalanceBanner } from "./LowBalanceBanner.tsx";
import { PayoutLogsTable } from "./PayoutLogsTable.tsx";
import { ReferralAttributionPanel } from "./ReferralAttributionPanel.tsx";
import { SponsoredWatchesPanel } from "./SponsoredWatchesPanel.tsx";
import { SubscriptionAnalyticsPanel } from "./SubscriptionAnalyticsPanel.tsx";
import { TreasuryStatusPanel } from "./TreasuryStatusPanel.tsx";
import {
  useActivityPayments,
  useActivityPayouts,
  useExecutionLogs,
} from "./use-activity-lists.ts";
import { useAgentActivity } from "./use-agent-activity.ts";

/**
 * P1-3: Gate secondary list fetches until the panel nears the viewport.
 * Primary `/activity` aggregate still loads immediately for above-the-fold panels.
 */
function ProgressivePanel({
  children,
}: {
  children: (ready: boolean) => ReactNode;
  /** @deprecated Placeholders use skeleton panels; prop kept for call-site compatibility. */
  placeholder?: string;
}): ReactElement {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "280px 0px", once: true });
  return (
    <div ref={ref}>
      {inView ? children(true) : <SkeletonPanel rows={3} />}
    </div>
  );
}

/** Default explorer for x402 settlement refs (payment rail = Base Sepolia). */
function ProofLink({
  txHash,
  label,
  explorerUrl,
}: {
  txHash: string;
  label?: string;
  explorerUrl?: string;
}): ReactElement {
  const href = explorerUrl ?? baseSepoliaTxUrl(txHash);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors break-all"
      title={`View ${txHash} on block explorer`}
    >
      {label ?? truncateHash(txHash)}
    </a>
  );
}

function mapExecutionLog(log: {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  message: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}) {
  const details = log.details ?? undefined;
  const keeperHubRunId =
    typeof details?.keeper_hub_run_id === "string"
      ? details.keeper_hub_run_id
      : typeof details?.createKeeperHubRunId === "string"
        ? details.createKeeperHubRunId
        : typeof details?.reportKeeperHubRunId === "string"
          ? details.reportKeeperHubRunId
          : typeof details?.transfer_keeper_hub_run_id === "string"
            ? details.transfer_keeper_hub_run_id
            : undefined;
  const txHash =
    typeof details?.tx_hash === "string"
      ? details.tx_hash
      : typeof details?.registry_tx_hash === "string"
        ? details.registry_tx_hash
        : typeof details?.payout_tx_hash === "string"
          ? details.payout_tx_hash
          : typeof details?.mintTxHash === "string"
            ? details.mintTxHash
            : typeof details?.burnTxHash === "string"
              ? details.burnTxHash
              : typeof details?.createTxHash === "string"
                ? details.createTxHash
                : typeof details?.reportTxHash === "string"
                  ? details.reportTxHash
                  : typeof details?.txHash === "string"
                    ? details.txHash
                    : undefined;
  const explorerUrl =
    typeof details?.explorer_url === "string"
      ? details.explorer_url
      : typeof details?.mintExplorerUrl === "string"
        ? details.mintExplorerUrl
        : typeof details?.burnExplorerUrl === "string"
          ? details.burnExplorerUrl
          : typeof details?.createExplorerUrl === "string"
            ? details.createExplorerUrl
            : typeof details?.reportExplorerUrl === "string"
              ? details.reportExplorerUrl
              : typeof details?.transfer_explorer_url === "string"
                ? details.transfer_explorer_url
                : undefined;
  const executedViaKeeperHub =
    details?.executedViaKeeperHub === true || Boolean(keeperHubRunId);

  const entry: {
    id: string;
    actionType: string;
    entityType: string | null;
    entityId: string | null;
    status: string;
    message: string | null;
    createdAt: string;
    keeperHubRunId?: string;
    txHash?: string;
    explorerUrl?: string;
    executedViaKeeperHub: boolean;
  } = {
    id: log.id,
    actionType: log.actionType,
    entityType: log.entityType,
    entityId: log.entityId,
    status: log.status,
    message: log.message,
    createdAt: log.createdAt,
    executedViaKeeperHub,
  };
  if (keeperHubRunId) entry.keeperHubRunId = keeperHubRunId;
  if (txHash) entry.txHash = txHash;
  if (explorerUrl) entry.explorerUrl = explorerUrl;
  return entry;
}

function CapitalMovesSection(): ReactElement {
  const capitalMoves = useDeskCapitalMoves(15);
  return (
    <>
      {capitalMoves.isLoading ? (
        <SkeletonPanel rows={4} data-testid="capital-moves-loading" />
      ) : capitalMoves.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{capitalMoves.error}</Surface>
      ) : (
        <>
          <CapitalMovesPanel moves={capitalMoves.capitalMoves} />
          <PaginationControls
            pagination={capitalMoves.pagination}
            onPageChange={capitalMoves.setPage}
            disabled={capitalMoves.isLoading}
            data-testid="capital-moves-pagination"
          />
        </>
      )}
    </>
  );
}

function DeskTicketsSection(): ReactElement {
  const deskTickets = useDeskTickets(12);
  return (
    <>
      {deskTickets.isLoading ? (
        <SkeletonPanel rows={4} data-testid="desk-tickets-loading" />
      ) : deskTickets.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{deskTickets.error}</Surface>
      ) : (
        <>
          <DeskTicketsPanel tickets={deskTickets.tickets} />
          <PaginationControls
            pagination={deskTickets.pagination}
            onPageChange={deskTickets.setPage}
            disabled={deskTickets.isLoading}
            data-testid="desk-tickets-pagination"
          />
        </>
      )}
    </>
  );
}

function PaymentsSection(): ReactElement {
  const paymentsPage = useActivityPayments(20);
  return (
    <>
      {paymentsPage.isLoading ? (
        <SkeletonPanel rows={5} data-testid="payments-loading" />
      ) : paymentsPage.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{paymentsPage.error}</Surface>
      ) : paymentsPage.items.length === 0 ? (
        <Surface className="p-6 text-sm text-muted-foreground">
          No premium payment activity yet.
        </Surface>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {paymentsPage.items.map((payment) => {
              const amount =
                typeof payment.amountSettled === "number"
                  ? payment.amountSettled
                  : payment.amountRequested;
              const currency = payment.currency ?? "USDC";
              return (
                <Surface
                  key={payment.id}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={payment.paymentRoute.toUpperCase()} variant="info" />
                    <span className="text-xs font-mono text-muted-foreground">
                      item {payment.premiumItemId.slice(0, 12)}…
                    </span>
                    {typeof amount === "number" ? (
                      <span className="text-xs tabular-nums text-foreground">
                        {amount} {currency}
                      </span>
                    ) : null}
                    {payment.referralAddress ? (
                      <a
                        href={baseSepoliaAddressUrl(payment.referralAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                        title={`Referral ${payment.referralAddress}`}
                      >
                        ref {truncateHash(payment.referralAddress, 6, 4)}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge
                      label={payment.status}
                      variant={
                        payment.status === "settled"
                          ? "success"
                          : payment.status === "failed" || payment.status === "expired"
                            ? "error"
                            : "warning"
                      }
                    />
                    {payment.settlementReference ? (
                      <ProofLink txHash={payment.settlementReference} />
                    ) : null}
                  </div>
                </Surface>
              );
            })}
          </div>
          <PaginationControls
            pagination={paymentsPage.pagination}
            onPageChange={paymentsPage.setPage}
            disabled={paymentsPage.isLoading}
            data-testid="payments-pagination"
          />
        </>
      )}
    </>
  );
}

function PayoutsSection(): ReactElement {
  const payoutsPage = useActivityPayouts(15);
  const payoutEntries = useMemo(() => {
    return payoutsPage.items.map((p) => {
      const entry: {
        id: string;
        payoutPeriodHash: string;
        recipient: string;
        amount: number;
        reasonHash: string;
        payoutTxHash?: string;
        registryTxHash?: string;
        keeperHubRunId?: string;
        explorerUrl?: string;
        status: string;
        createdAt: string;
      } = {
        id: p.id,
        payoutPeriodHash: p.payoutPeriodHash,
        recipient: p.recipient,
        amount: p.amount,
        reasonHash: p.reasonHash,
        status: p.status,
        createdAt: p.createdAt,
      };
      if (p.payoutTxHash) entry.payoutTxHash = p.payoutTxHash;
      if (p.registryTxHash) entry.registryTxHash = p.registryTxHash;
      if (p.keeperHubRunId) entry.keeperHubRunId = p.keeperHubRunId;
      if (p.explorerUrl) entry.explorerUrl = p.explorerUrl;
      return entry;
    });
  }, [payoutsPage.items]);

  return (
    <>
      {payoutsPage.isLoading ? (
        <SkeletonPanel rows={4} data-testid="payouts-loading" />
      ) : payoutsPage.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{payoutsPage.error}</Surface>
      ) : (
        <>
          <PayoutLogsTable payouts={payoutEntries} />
          <PaginationControls
            pagination={payoutsPage.pagination}
            onPageChange={payoutsPage.setPage}
            disabled={payoutsPage.isLoading}
            data-testid="payouts-pagination"
          />
        </>
      )}
    </>
  );
}

function ExecutionLogsSection(): ReactElement {
  const executionLogsPage = useExecutionLogs(25);
  const executionLogs = useMemo(
    () => executionLogsPage.items.map(mapExecutionLog),
    [executionLogsPage.items],
  );

  return (
    <>
      {executionLogsPage.isLoading ? (
        <SkeletonPanel rows={5} data-testid="execution-logs-loading" />
      ) : executionLogsPage.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{executionLogsPage.error}</Surface>
      ) : (
        <>
          <ExecutionLogTable logs={executionLogs} />
          <PaginationControls
            pagination={executionLogsPage.pagination}
            onPageChange={executionLogsPage.setPage}
            disabled={executionLogsPage.isLoading}
            data-testid="execution-logs-pagination"
          />
        </>
      )}
    </>
  );
}

export function ActivityPage(): ReactElement {
  // Primary aggregate only — secondary list endpoints load as panels enter view (P1-3).
  const { data, isLoading, error, refetch } = useAgentActivity();

  const stats = useMemo(() => {
    if (!data) return null;

    const settledPayments = data.payments.filter((p) => p.status === "settled").length;
    const succeededLogs = data.executionLogs.filter((l) => l.status === "succeeded").length;
    const failedLogs = data.executionLogs.filter((l) => l.status === "failed").length;
    const anchoredDigests = data.digests.filter((d) => Boolean(d.registryTxHash)).length;

    return {
      alerts: data.alerts.length,
      digests: data.digests.length,
      anchoredDigests,
      settledPayments,
      succeededLogs,
      failedLogs,
      payouts: data.payouts?.length ?? 0,
    };
  }, [data]);

  return (
    <Page data-testid="activity-page">
      <PageHeader
        title="Agent Activity"
        description="Public trail of publications, on-chain proofs, desk capital moves, trade tickets, subscription analytics, referral attribution, treasury health, and KeeperHub execution outcomes."
        meta={<SectionLink to="/desk">Open desk →</SectionLink>}
      />

      {isLoading ? (
        <LoadingState
          message="Loading agent activity..."
          variant="activity"
          data-testid="activity-loading"
        />
      ) : error ? (
        <RetryState
          title="Failed to load activity"
          message={error}
          onRetry={refetch}
          data-testid="activity-error"
        />
      ) : !data ? (
        <EmptyState
          title="No activity yet"
          description="Agent activity will appear here once ChronicleAI publishes alerts, digests, or settles payments."
          data-testid="activity-empty"
        />
      ) : (
        <>
          <PageSection
            title="Agent treasury"
            description="Dual-rail capital plane: Base USDC from x402 payments, Sepolia USDC for desk top-ups after Circle CCTP. Gas health is Sepolia ETH vs the safety buffer."
            action={<SectionLink to="/desk">Desk book →</SectionLink>}
          >
            <LowBalanceBanner treasury={data.treasury} />
            <TreasuryStatusPanel treasury={data.treasury} />
          </PageSection>

          {(data.cctpRebalances && data.cctpRebalances.length > 0) ||
          data.treasury.cctpEnabled ? (
            <PageSection
              title="CCTP rebalances"
              description="Circle CCTP burns Base Sepolia USDC and mints native Ethereum Sepolia USDC into the same treasury. Burn and mint explorer links are chain-correct."
            >
              <CctpRebalancesPanel transfers={data.cctpRebalances ?? []} />
            </PageSection>
          ) : null}

          <PageSection
            title="Desk capital moves"
            description="Treasury ↔ desk top-ups, profit sweeps, and emergency returns with explorer proofs. Top-ups use Sepolia USDC only — never Base float."
            action={<SectionLink to="/desk">Desk status →</SectionLink>}
          >
            <ProgressivePanel placeholder="Loading capital moves…">
              {() => <CapitalMovesSection />}
            </ProgressivePanel>
          </PageSection>

          <PageSection
            title="Trade tickets"
            description="Registry-anchored desk executions: signal → decision → legs → proofs."
            action={<SectionLink to="/desk/intents">All intents →</SectionLink>}
          >
            <ProgressivePanel placeholder="Loading trade tickets…">
              {() => <DeskTicketsSection />}
            </ProgressivePanel>
          </PageSection>

          {stats ? (
            <PageSection title="At a glance">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <StatTile label="Public alerts" value={stats.alerts} />
                <StatTile label="Daily digests" value={stats.digests} />
                <StatTile label="On-chain anchors" value={stats.anchoredDigests} />
                <StatTile label="Settled payments" value={stats.settledPayments} />
                <StatTile label="Executions OK" value={stats.succeededLogs} />
                <StatTile label="Executions failed" value={stats.failedLogs} />
                <StatTile label="Payout records" value={stats.payouts} />
              </div>
            </PageSection>
          ) : null}

          {data.subscriptionAnalytics ? (
            <PageSection
              title="Subscription analytics"
              description="Public MRR from entitled newsletter agreements, paywall conversion, and settled volume by payment rail."
            >
              <SubscriptionAnalyticsPanel analytics={data.subscriptionAnalytics} />
            </PageSection>
          ) : null}

          {data.referralAttribution ? (
            <PageSection
              title="Referral attribution"
              description="Settled volume and newsletter intents attributed to referral partner wallets from payment intent metadata."
            >
              <ReferralAttributionPanel attribution={data.referralAttribution} />
            </PageSection>
          ) : null}

          <PageSection
            title="On-chain publication proofs"
            action={<SectionLink to="/digests/latest">Open digest →</SectionLink>}
          >
            {data.digests.length === 0 ? (
              <Surface className="p-6 text-sm text-muted-foreground">
                No digests with registry receipts yet.
              </Surface>
            ) : (
              <div className="flex flex-col gap-3">
                {data.digests.slice(0, 8).map((digest) => (
                  <Surface
                    as="article"
                    key={digest.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/digests/${digest.id}`}
                        className="font-medium text-foreground hover:text-muted-foreground transition-colors truncate block"
                      >
                        {digest.title}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-1">
                        Report date {digest.reportDate}
                        {digest.publishedAt ? (
                          <>
                            {" · "}
                            <TimestampDisplay timestamp={digest.publishedAt} />
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0 w-full sm:w-auto">
                      <div className="flex items-center gap-3">
                        <StatusBadge
                          label={digest.publicationStatus}
                          variant={
                            digest.publicationStatus === "published"
                              ? "success"
                              : digest.publicationStatus === "partial_failure"
                                ? "warning"
                                : "default"
                          }
                        />
                        {!digest.registryTxHash ? (
                          <span className="text-xs text-muted-foreground">No tx yet</span>
                        ) : null}
                      </div>
                      <PublicationProof
                        registryTxHash={digest.registryTxHash}
                        contentHash={digest.contentHash}
                        sourceEventRoot={digest.sourceEventRoot}
                        gasUsed={digest.gasUsed}
                        gasUsedWei={digest.gasUsedWei}
                        keeperHubRunId={digest.keeperHubRunId}
                        explorerUrl={digest.explorerUrl}
                        compact
                        data-testid={`digest-proof-${digest.id}`}
                      />
                    </div>
                  </Surface>
                ))}
              </div>
            )}
          </PageSection>

          <PageSection
            title="Recent public alerts"
            action={<SectionLink to="/alerts">All alerts →</SectionLink>}
          >
            {data.alerts.length === 0 ? (
              <Surface className="p-6 text-sm text-muted-foreground">
                No alerts published yet.
              </Surface>
            ) : (
              <div className="flex flex-col gap-3">
                {data.alerts.slice(0, 6).map((alert) => (
                  <Surface as="article" key={alert.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <Link
                        to={`/alerts/${alert.id}`}
                        className="font-medium text-foreground hover:text-muted-foreground transition-colors"
                      >
                        {alert.title}
                      </Link>
                      <div className="flex items-center gap-2">
                        <StatusBadge label={alert.deliveryStatus} variant="info" />
                        <TimestampDisplay timestamp={alert.publishedAt} />
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {alert.summary.length > 160
                        ? `${alert.summary.slice(0, 160)}…`
                        : alert.summary}
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {alert.generationProvider ? (
                          <p className="text-[11px] text-muted-foreground">
                            Generated by{" "}
                            <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                              {alert.generationProvider}
                            </code>
                          </p>
                        ) : null}
                        <Link
                          to={`/alerts/${alert.id}`}
                          className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors ml-auto"
                        >
                          View alert →
                        </Link>
                      </div>
                      <PublicationProof
                        registryTxHash={alert.registryTxHash}
                        contentHash={alert.contentHash}
                        sourceEventHash={alert.sourceEventHash}
                        gasUsed={alert.gasUsed}
                        gasUsedWei={alert.gasUsedWei}
                        keeperHubRunId={alert.keeperHubRunId}
                        explorerUrl={alert.explorerUrl}
                        compact
                        data-testid={`alert-proof-${alert.id}`}
                      />
                    </div>
                  </Surface>
                ))}
              </div>
            )}
          </PageSection>

          <PageSection
            title="Payment settlements"
            action={<SectionLink to="/premium">Unlock premium →</SectionLink>}
          >
            <ProgressivePanel placeholder="Loading payments…">
              {() => <PaymentsSection />}
            </ProgressivePanel>
          </PageSection>

          <PageSection
            title="Sponsored watch campaigns"
            description="Paid monitoring jobs with dual on-chain audit trails (createSponsoredWatch + publishSponsoredReport)."
            action={<SectionLink to="/premium">Open premium →</SectionLink>}
          >
            <SponsoredWatchesPanel watches={data.activeSponsoredWatches ?? []} />
          </PageSection>

          <PageSection title="Revenue routing payouts">
            <ProgressivePanel placeholder="Loading payouts…">
              {() => <PayoutsSection />}
            </ProgressivePanel>
          </PageSection>

          <PageSection
            title="KeeperHub execution log"
            description="Full audit trail of monitoring, generation, publication, and treasury actions — including failures and retries."
          >
            <ProgressivePanel placeholder="Loading execution logs…">
              {() => <ExecutionLogsSection />}
            </ProgressivePanel>
          </PageSection>
        </>
      )}
    </Page>
  );
}
