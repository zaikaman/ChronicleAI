import { type ReactElement, useMemo } from "react";
import { Link } from "react-router-dom";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { PublicationProof } from "../../components/publication-proof.tsx";
import { baseSepoliaTxUrl, truncateHash } from "../../lib/explorer.ts";
import { ExecutionLogTable } from "./ExecutionLogTable.tsx";
import { PayoutLogsTable } from "./PayoutLogsTable.tsx";
import { TreasuryStatusPanel } from "./TreasuryStatusPanel.tsx";
import { useAgentActivity } from "./use-agent-activity.ts";

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
      className="font-mono text-xs text-accent hover:underline break-all"
      title={`View ${txHash} on block explorer`}
    >
      {label ?? truncateHash(txHash)}
    </a>
  );
}

export function ActivityPage(): ReactElement {
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

  const executionLogs = useMemo(() => {
    if (!data) return [];
    return data.executionLogs.map((log) => {
      const details = log.details ?? undefined;
      const keeperHubRunId =
        typeof details?.keeper_hub_run_id === "string"
          ? details.keeper_hub_run_id
          : typeof details?.createKeeperHubRunId === "string"
            ? details.createKeeperHubRunId
            : typeof details?.reportKeeperHubRunId === "string"
              ? details.reportKeeperHubRunId
              : undefined;
      const txHash =
        typeof details?.registry_tx_hash === "string"
          ? details.registry_tx_hash
          : typeof details?.payout_tx_hash === "string"
            ? details.payout_tx_hash
            : typeof details?.createTxHash === "string"
              ? details.createTxHash
              : typeof details?.reportTxHash === "string"
                ? details.reportTxHash
                : undefined;
      const explorerUrl =
        typeof details?.explorer_url === "string" ? details.explorer_url : undefined;
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
    });
  }, [data]);

  const payoutEntries = useMemo(() => {
    if (!data?.payouts) return [];
    return data.payouts.map((p) => {
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
  }, [data]);

  return (
    <div data-testid="activity-page" className="max-w-5xl mx-auto">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent mb-3">
          Public agent trail
        </p>
        <h1
          className="text-3xl font-bold tracking-tight text-foreground mb-2"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          Live Agent Activity
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          ChronicleAI runs autonomously through KeeperHub. This page shows recent publications,
          on-chain proofs, payments, treasury health, and execution outcomes — all public, no login.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link to="/alerts" className="text-accent hover:underline font-medium">
            Market alerts
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link to="/digests/latest" className="text-accent hover:underline font-medium">
            Latest digest
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link to="/premium" className="text-accent hover:underline font-medium">
            Premium intelligence
          </Link>
        </div>
      </header>

      {isLoading ? (
        <LoadingState message="Loading agent activity..." data-testid="activity-loading" />
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
        <div className="flex flex-col gap-10">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Agent treasury</h2>
            <TreasuryStatusPanel treasury={data.treasury} />
            <p className="mt-3 text-xs text-muted-foreground">
              Operating funds power KeeperHub registry writes and LLM generation. Status is public so
              anyone can verify the agent is solvent enough to keep publishing.
            </p>
          </section>

          {stats && (
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">At a glance</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                  { label: "Public alerts", value: stats.alerts },
                  { label: "Daily digests", value: stats.digests },
                  { label: "On-chain anchors", value: stats.anchoredDigests },
                  { label: "Settled payments", value: stats.settledPayments },
                  { label: "Executions OK", value: stats.succeededLogs },
                  { label: "Executions failed", value: stats.failedLogs },
                  { label: "Payout records", value: stats.payouts },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-border bg-frame p-4"
                  >
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                      {item.label}
                    </p>
                    <p className="text-2xl font-bold text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-4 gap-4">
              <h2 className="text-lg font-semibold text-foreground">On-chain publication proofs</h2>
              <Link to="/digests/latest" className="text-xs font-semibold text-accent hover:underline">
                Open digest →
              </Link>
            </div>
            {data.digests.length === 0 ? (
              <div className="rounded-2xl border border-border bg-frame p-6 text-sm text-muted-foreground">
                No digests with registry receipts yet.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {data.digests.slice(0, 8).map((digest) => (
                  <article
                    key={digest.id}
                    className="rounded-2xl border border-border bg-frame p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/digests/${digest.id}`}
                        className="font-medium text-foreground hover:text-accent transition-colors truncate block"
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
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-4 gap-4">
              <h2 className="text-lg font-semibold text-foreground">Recent public alerts</h2>
              <Link to="/alerts" className="text-xs font-semibold text-accent hover:underline">
                All alerts →
              </Link>
            </div>
            {data.alerts.length === 0 ? (
              <div className="rounded-2xl border border-border bg-frame p-6 text-sm text-muted-foreground">
                No alerts published yet.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {data.alerts.slice(0, 6).map((alert) => (
                  <article
                    key={alert.id}
                    className="rounded-2xl border border-border bg-frame p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <Link
                        to={`/alerts/${alert.id}`}
                        className="font-medium text-foreground hover:text-accent transition-colors"
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
                          className="text-xs font-semibold text-accent hover:underline ml-auto"
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
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-4 gap-4">
              <h2 className="text-lg font-semibold text-foreground">Payment settlements</h2>
              <Link to="/premium" className="text-xs font-semibold text-accent hover:underline">
                Unlock premium →
              </Link>
            </div>
            {data.payments.length === 0 ? (
              <div className="rounded-2xl border border-border bg-frame p-6 text-sm text-muted-foreground">
                No premium payment activity yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {data.payments.slice(0, 10).map((payment) => (
                  <div
                    key={payment.id}
                    className="rounded-xl border border-border bg-frame px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge label={payment.paymentRoute.toUpperCase()} variant="info" />
                      <span className="text-xs font-mono text-muted-foreground">
                        item {payment.premiumItemId.slice(0, 12)}…
                      </span>
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
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Revenue routing payouts</h2>
            <PayoutLogsTable payouts={payoutEntries} />
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">KeeperHub execution log</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Full audit trail of monitoring, generation, publication, and treasury actions —
              including failures and retries.
            </p>
            <ExecutionLogTable logs={executionLogs} />
          </section>
        </div>
      )}
    </div>
  );
}
