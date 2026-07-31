import { type ReactElement, type ReactNode, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { baseSepoliaAddressUrl, baseSepoliaTxUrl, sepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";
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
import { useDigests } from "../digests/use-digests.ts";
import { useSponsoredWatches } from "../premium/use-premium.ts";
import {
  useActivityCctpRebalances,
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

/** Explorer link helper for payment settlements (x402 & MPP). */
function PaymentProofLink({
  payment,
}: {
  payment: {
    paymentRoute: string;
    settlementReference?: string;
    registryTxHash?: string;
    explorerUrl?: string;
  };
}): ReactElement | null {
  // 1. Explicit published receipt explorerUrl
  if (payment.explorerUrl) {
    const raw = payment.registryTxHash ?? payment.settlementReference ?? "";
    const cleanHash = raw.includes(":") ? raw.split(":").pop()! : raw;
    const formattedHash = cleanHash.startsWith("0x") ? cleanHash : `0x${cleanHash}`;
    return (
      <a
        href={payment.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors break-all"
        title="View receipt publication on block explorer"
      >
        {truncateHash(formattedHash)}
      </a>
    );
  }

  // 2. On-chain registryTxHash
  if (payment.registryTxHash) {
    const hash = payment.registryTxHash.startsWith("0x")
      ? payment.registryTxHash
      : `0x${payment.registryTxHash}`;
    return (
      <a
        href={sepoliaTxUrl(hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors break-all"
        title={`View ${hash} on Sepolia explorer`}
      >
        {truncateHash(hash)}
      </a>
    );
  }

  // 3. settlementReference (clean HMAC timestamp prefix if MPP)
  if (!payment.settlementReference) return null;

  let rawHash = payment.settlementReference.trim();
  if (rawHash.includes(":")) {
    rawHash = rawHash.split(":").pop() || rawHash;
  }
  const targetHash = rawHash.startsWith("0x") ? rawHash : `0x${rawHash}`;

  const href = `https://sepolia.basescan.org/tx/${targetHash}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors break-all"
      title={`View ${targetHash} on Basescan`}
    >
      {truncateHash(targetHash)}
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
  routing?: string;
  routingLabel?: string;
  routingApplied?: string;
  routingRequested?: string;
  protectStatusUrl?: string;
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

  const routingFromTop =
    typeof log.routing === "string"
      ? log.routing
      : typeof details?.routing === "string"
        ? details.routing
        : undefined;
  const routingLabel =
    typeof log.routingLabel === "string"
      ? log.routingLabel
      : undefined;
  const routingApplied =
    typeof log.routingApplied === "string"
      ? log.routingApplied
      : typeof details?.routingApplied === "string"
        ? details.routingApplied
        : undefined;
  const routingRequested =
    typeof log.routingRequested === "string"
      ? log.routingRequested
      : typeof details?.routingRequested === "string"
        ? details.routingRequested
        : undefined;

  const protectStatusUrl =
    typeof log.protectStatusUrl === "string"
      ? log.protectStatusUrl
      : typeof details?.protectStatusUrl === "string"
        ? details.protectStatusUrl
        : undefined;

  const executionAuditSummary =
    typeof details?.execution_audit_summary === "string" &&
    details.execution_audit_summary.trim().length > 0
      ? details.execution_audit_summary.trim()
      : undefined;

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
    routing?: string;
    routingLabel?: string;
    routingApplied?: string;
    routingRequested?: string;
    protectStatusUrl?: string;
    executionAuditSummary?: string;
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
  if (routingFromTop) entry.routing = routingFromTop;
  if (routingLabel) entry.routingLabel = routingLabel;
  if (routingApplied) entry.routingApplied = routingApplied;
  if (routingRequested) entry.routingRequested = routingRequested;
  if (protectStatusUrl) entry.protectStatusUrl = protectStatusUrl;
  if (executionAuditSummary) entry.executionAuditSummary = executionAuditSummary;
  return entry;
}

function CctpRebalancesSection({
  cctpEnabled,
}: {
  cctpEnabled?: boolean;
}): ReactElement | null {
  const page = useActivityCctpRebalances(15);
  const hasRows = page.items.length > 0 || page.pagination.total > 0;
  if (!page.isLoading && !page.error && !hasRows && !cctpEnabled) {
    return null;
  }
  return (
    <PageSection
      title="CCTP rebalances"
      description="Circle CCTP burns Base Sepolia USDC and mints native Ethereum Sepolia USDC into the same treasury. Burn and mint explorer links are chain-correct."
    >
      {page.isLoading ? (
        <SkeletonPanel rows={3} data-testid="cctp-rebalances-loading" />
      ) : page.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{page.error}</Surface>
      ) : (
        <>
          <CctpRebalancesPanel transfers={page.items} />
          <PaginationControls
            pagination={page.pagination}
            onPageChange={page.setPage}
            disabled={page.isLoading}
            data-testid="cctp-rebalances-pagination"
          />
        </>
      )}
    </PageSection>
  );
}

function DigestsProofSection(): ReactElement {
  const digestsPage = useDigests(8);
  return (
    <>
      {digestsPage.isLoading ? (
        <SkeletonPanel rows={3} data-testid="digests-proof-loading" />
      ) : digestsPage.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{digestsPage.error}</Surface>
      ) : digestsPage.digests.length === 0 ? (
        <Surface className="p-6 text-sm text-muted-foreground">
          No digests with registry receipts yet.
        </Surface>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {digestsPage.digests.map((digest) => (
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
          <PaginationControls
            pagination={digestsPage.pagination}
            onPageChange={digestsPage.setPage}
            disabled={digestsPage.isLoading}
            data-testid="digests-pagination"
          />
        </>
      )}
    </>
  );
}

function SponsoredWatchesSection(): ReactElement {
  const watchesPage = useSponsoredWatches(12);
  return (
    <>
      {watchesPage.isLoading ? (
        <SkeletonPanel rows={3} data-testid="sponsored-watches-loading" />
      ) : watchesPage.error ? (
        <Surface className="p-6 text-sm text-muted-foreground">{watchesPage.error}</Surface>
      ) : (
        <>
          <SponsoredWatchesPanel watches={watchesPage.watches} />
          <PaginationControls
            pagination={watchesPage.pagination}
            onPageChange={watchesPage.setPage}
            disabled={watchesPage.isLoading}
            data-testid="activity-sponsored-watches-pagination"
          />
        </>
      )}
    </>
  );
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
                    <PaymentProofLink payment={payment} />
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
        routing?: string;
        routingLabel?: string;
        routingRequested?: string;
        routingApplied?: string;
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
      if (p.routing) entry.routing = p.routing;
      if (p.routingLabel) entry.routingLabel = p.routingLabel;
      if (p.routingRequested) entry.routingRequested = p.routingRequested;
      if (p.routingApplied) entry.routingApplied = p.routingApplied;
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ExecutionLogsSection({
  entityId,
  entityType,
  onClearFilter,
}: {
  entityId?: string | null;
  entityType?: string | null;
  onClearFilter?: () => void;
}): ReactElement {
  const executionLogsPage = useExecutionLogs(25, {
    entityId: entityId ?? null,
    entityType: entityType ?? null,
  });
  const executionLogs = useMemo(
    () => executionLogsPage.items.map(mapExecutionLog),
    [executionLogsPage.items],
  );

  const filtered = Boolean(entityId);

  return (
    <div id="execution-logs" data-testid="execution-logs-section">
      {filtered ? (
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
                · type{" "}
                <span className="font-medium text-foreground">{entityType}</span>
              </>
            ) : null}
          </p>
          {onClearFilter ? (
            <button
              type="button"
              onClick={onClearFilter}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="execution-logs-clear-filter"
            >
              Clear filter
            </button>
          ) : null}
        </Surface>
      ) : null}
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
    </div>
  );
}

export function ActivityPage(): ReactElement {
  // Primary aggregate only — secondary list endpoints load as panels enter view (P1-3).
  const { data, isLoading, error, refetch } = useAgentActivity();
  const [searchParams, setSearchParams] = useSearchParams();

  const entityIdRaw = searchParams.get("entityId")?.trim() ?? "";
  const entityId = UUID_RE.test(entityIdRaw) ? entityIdRaw : null;
  const entityTypeRaw = searchParams.get("entityType")?.trim() ?? "";
  const entityType = entityTypeRaw.length > 0 ? entityTypeRaw : null;

  useEffect(() => {
    if (!entityId) return;
    // Scroll to execution log panel after paint (ticket deep link).
    const t = window.setTimeout(() => {
      document.getElementById("execution-logs")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [entityId]);

  const clearEntityFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("entityId");
    next.delete("entityType");
    setSearchParams(next, { replace: true });
  };

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

          <ProgressivePanel placeholder="Loading CCTP rebalances…">
            {() => <CctpRebalancesSection cctpEnabled={data.treasury.cctpEnabled} />}
          </ProgressivePanel>

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
            <ProgressivePanel placeholder="Loading digests…">
              {() => <DigestsProofSection />}
            </ProgressivePanel>
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
            <ProgressivePanel placeholder="Loading sponsored watches…">
              {() => <SponsoredWatchesSection />}
            </ProgressivePanel>
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
            {/* Deep-link filter loads immediately so scroll + data are ready. */}
            {entityId ? (
              <ExecutionLogsSection
                entityId={entityId}
                entityType={entityType}
                onClearFilter={clearEntityFilter}
              />
            ) : (
              <ProgressivePanel placeholder="Loading execution logs…">
                {() => <ExecutionLogsSection />}
              </ProgressivePanel>
            )}
          </PageSection>
        </>
      )}
    </Page>
  );
}
