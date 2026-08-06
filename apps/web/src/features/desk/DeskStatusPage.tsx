import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import {
  Page,
  PageHeader,
  PageSection,
  SectionLink,
  StatTile,
  Surface,
} from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { SkeletonPanel } from "../../components/ui/skeleton.tsx";
import { chainLabel, sepoliaAddressUrl, truncateHash } from "../../lib/explorer.ts";
import { ProofMonoLink } from "./ProofMonoLink.tsx";
import { equityProgress, formatHealthFactor, formatUsdc, strategyLabel } from "./format.ts";
import { DESK_STRATEGY_META } from "./types.ts";
import { useDeskCapitalMoves, useDeskStatus } from "./use-desk.ts";

export function DeskStatusPage(): ReactElement {
  const { data, isLoading, error, refetch } = useDeskStatus();
  const capital = useDeskCapitalMoves(6);

  if (isLoading) {
    return (
      <Page data-testid="desk-status-page">
        <LoadingState
          message="Loading desk status..."
          variant="stats"
          data-testid="desk-status-loading"
        />
      </Page>
    );
  }

  if (error) {
    return (
      <Page data-testid="desk-status-page">
        <PageHeader
          title="Chronicle Desk"
          description="The trading desk turns approved intelligence into controlled actions, with visible risk controls."
        />
        <RetryState
          title="Failed to load desk status"
          message={error}
          onRetry={refetch}
          data-testid="desk-status-error"
        />
      </Page>
    );
  }

  if (!data) {
    return (
      <Page data-testid="desk-status-page">
        <EmptyState
          title="Desk offline"
          description="No desk status snapshot is available yet."
          data-testid="desk-status-empty"
        />
      </Page>
    );
  }

  const progress = equityProgress(data.equityUsdc, data.targetAumUsdc, data.maxAumUsdc);
  const kill = data.killSwitch;
  const hf = data.healthFactor;
  const hfVariant =
    hf === null || hf === undefined
      ? "default"
      : hf < data.policy.hfCritical
        ? "error"
        : hf < data.policy.hfWarn
          ? "warning"
          : "success";
  const gateStatus = kill.armed
    ? { label: "Blocked · emergency stop", variant: "error" as const }
    : data.paused
      ? { label: "Paused", variant: "warning" as const }
      : data.heartbeat.killEligible
        ? { label: "Blocked · heartbeat", variant: "error" as const }
        : data.heartbeat.stale
          ? { label: "Heartbeat stale", variant: "warning" as const }
          : data.agentEnabled === false
            ? { label: "Agent fail-closed", variant: "warning" as const }
            : { label: "Policy gate active", variant: "success" as const };
  const heartbeatStatus = data.heartbeat.stale
    ? { label: "Heartbeat stale", variant: "warning" as const }
    : data.heartbeat.lastSeenAt
      ? { label: "Heartbeat fresh", variant: "success" as const }
      : { label: "No heartbeat", variant: "default" as const };

  return (
    <Page data-testid="desk-status-page">
      <PageHeader
        title="Chronicle Desk"
        description="Treasury funds the book, safety rules approve each action, and KeeperHub submits the final transaction with public proof when available."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={data.paused ? "Paused" : "Live"}
              variant={data.paused ? "warning" : "success"}
            />
            <StatusBadge
              label={kill.armed ? "Emergency stop armed" : "Emergency stop clear"}
              variant={kill.armed ? "error" : "default"}
            />
          </div>
        }
        below={
          <>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground">
              {chainLabel(data.chainId)}
            </span>
            {data.lastPositionAsOf ? (
              <span className="text-xs text-muted-foreground">
                Marked <TimestampDisplay timestamp={data.lastPositionAsOf} />
              </span>
            ) : null}
          </>
        }
      />

      <PageSection
        title="Decision lane"
        description="Latest proposal and safety checks before anything can execute."
        action={
          <div className="flex gap-3">
            <SectionLink to="/desk/intents">View proposals →</SectionLink>
            <SectionLink to="/activity?filter=publications">Proof trail →</SectionLink>
          </div>
        }
      >
        <Surface className="p-5" data-testid="desk-decision-lane">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground mb-1">Latest desk proposal</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  label={data.lastAgent?.action ?? "No proposal yet"}
                  variant={
                    !data.lastAgent
                      ? "default"
                      : data.lastAgent.action === "hold" || data.lastAgent.action === "defer"
                        ? "default"
                        : data.lastAgent.action === "defend"
                          ? "warning"
                          : "info"
                  }
                />
                {data.lastAgent?.strategy ? (
                  <span className="text-xs text-muted-foreground">
                    {strategyLabel(data.lastAgent.strategy)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <StatusBadge label={gateStatus.label} variant={gateStatus.variant} />
              <StatusBadge label={heartbeatStatus.label} variant={heartbeatStatus.variant} />
            </div>
          </div>
          {data.lastAgent ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Last proposal{" "}
              {data.lastAgent.createdAt ? (
                <TimestampDisplay timestamp={data.lastAgent.createdAt} />
              ) : (
                "—"
              )}
              {data.lastAgent.confidence != null
                ? ` · ${(data.lastAgent.confidence * 100).toFixed(0)}% confidence`
                : ""}
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              The desk will hold until a fresh proposal and heartbeat pass the policy gate.
            </p>
          )}
        </Surface>
      </PageSection>

      <PageSection
        title="Book size"
        description="How much the desk holds, its target, and its hard ceiling."
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatTile label="Desk equity" value={formatUsdc(data.equityUsdc)} />
          <StatTile label="Target AUM" value={formatUsdc(data.targetAumUsdc)} />
          <StatTile label="Max AUM" value={formatUsdc(data.maxAumUsdc)} />
          <StatTile label="Free USDC" value={formatUsdc(data.freeUsdc)} />
        </div>
        <Surface className="p-5">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Equity vs max AUM</span>
            <span className="tabular-nums">{progress.pctOfMax.toFixed(0)}%</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(Math.min(Math.max(progress.pctOfMax, 0), 100))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Desk equity as percent of max AUM"
            tabIndex={0}
          >
            <div
              className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
              style={{ width: `${Math.min(Math.max(progress.pctOfMax, 0), 100)}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            Min book {formatUsdc(data.minAumUsdc)} · target {formatUsdc(data.targetAumUsdc)} ·
            ceiling {formatUsdc(data.maxAumUsdc)}. Max trade size{" "}
            {formatUsdc(data.policy.maxTradeUsdc)}.
          </p>
        </Surface>
      </PageSection>

      <PageSection
        title="Treasury vs desk"
        description="Treasury holds earned revenue and a safety buffer. The desk wallet holds the active trading book."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <WalletCard
            title="Treasury"
            description="Revenue · buffer · desk funding"
            address={data.treasuryWalletAddress}
            testId="desk-treasury-wallet"
          />
          <WalletCard
            title="Desk"
            description="USDC book · strategy inventory"
            address={data.deskWalletAddress}
            testId="desk-execution-wallet"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Surface className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last top-up</p>
            {data.lastTopupAt ? (
              <TimestampDisplay timestamp={data.lastTopupAt} />
            ) : (
              <p className="text-sm text-muted-foreground">None recorded</p>
            )}
          </Surface>
          <Surface className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Last sweep</p>
            {data.lastSweepAt ? (
              <TimestampDisplay timestamp={data.lastSweepAt} />
            ) : (
              <p className="text-sm text-muted-foreground">None recorded</p>
            )}
          </Surface>
        </div>
      </PageSection>

      {data.privateRouting ? (
        <PageSection
          title="Private submission"
          description="Some transactions use a private network path. This can require ETH in the desk wallet."
        >
          <Surface className="p-5" data-testid="desk-private-routing">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <StatusBadge
                label={data.privateRouting.label}
                variant={data.privateRouting.enabled ? "info" : "default"}
                data-testid="desk-private-routing-badge"
              />
              {data.privateRouting.strict ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground">
                  Strict
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {data.privateRouting.enabled
                ? `Policy prefers private mempool submission via ${
                    data.privateRouting.provider === "flashbots_protect"
                      ? "Flashbots Protect"
                      : data.privateRouting.provider
                  } on chain ${data.privateRouting.chainId}.`
                : "Private routing is off for desk workflows; submissions use the public mempool path."}
            </p>
          </Surface>
        </PageSection>
      ) : null}

      <PageSection title="Risk controls">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <Surface className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Health factor</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {formatHealthFactor(hf)}
              </p>
              <StatusBadge
                label={
                  hf === null
                    ? "n/a"
                    : hf < data.policy.hfCritical
                      ? "critical"
                      : hf < data.policy.hfWarn
                        ? "warn"
                        : "healthy"
                }
                variant={hfVariant}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Warn &lt; {data.policy.hfWarn.toFixed(1)} · critical &lt;{" "}
              {data.policy.hfCritical.toFixed(1)}
            </p>
          </Surface>
          <Surface className="p-4 sm:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Emergency stop</p>
                <p className="text-sm font-semibold text-foreground">
                  {kill.armed ? "Armed — new proposals blocked" : "Clear — desk may act"}
                </p>
              </div>
              <StatusBadge
                label={kill.armed ? "Armed" : "Disarmed"}
                variant={kill.armed ? "error" : "success"}
              />
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs mt-3">
              <div>
                <dt className="text-muted-foreground">Last trip</dt>
                <dd className="text-foreground mt-0.5">
                  {kill.lastTripAt ? <TimestampDisplay timestamp={kill.lastTripAt} /> : "None"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Trip reason</dt>
                <dd className="text-foreground mt-0.5">
                  {kill.lastTripReason ?? kill.armedReason ?? "—"}
                </dd>
              </div>
              {kill.lastTxHash ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Last emergency-stop tx</dt>
                  <dd className="mt-0.5">
                    <ProofMonoLink value={kill.lastTxHash} asTx />
                  </dd>
                </div>
              ) : null}
              {kill.lastKeeperHubRunId ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Last emergency-stop run</dt>
                  <dd className="mt-0.5">
                    <ProofMonoLink value={kill.lastKeeperHubRunId} />
                  </dd>
                </div>
              ) : null}
            </dl>
          </Surface>
        </div>
        <Surface className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Heartbeat</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={
                data.heartbeat.stale
                  ? "Stale"
                  : data.heartbeat.killEligible
                    ? "Kill-eligible"
                    : "Fresh"
              }
              variant={
                data.heartbeat.killEligible ? "error" : data.heartbeat.stale ? "warning" : "success"
              }
            />
            {data.heartbeat.lastSeenAt ? (
              <span className="text-sm text-foreground">
                Last seen <TimestampDisplay timestamp={data.heartbeat.lastSeenAt} />
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">No heartbeat yet</span>
            )}
            {data.heartbeat.source ? (
              <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">
                {data.heartbeat.source}
              </code>
            ) : null}
          </div>
        </Surface>
      </PageSection>

      <PageSection
        title="Decision agent"
        description="The model proposes; hard policy decides whether the action is allowed. KeeperHub remains the only on-chain last mile."
      >
        <Surface className="p-5" data-testid="desk-status-agent">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <StatusBadge
              label={data.agentEnabled === false ? "Agent fail-closed" : "Agent mandatory"}
              variant={data.agentEnabled === false ? "warning" : "success"}
            />
            {data.agentEnabled === false && data.agentBlockedReason ? (
              <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">
                {data.agentBlockedReason}
              </code>
            ) : null}
            {data.lastAgent ? (
              <>
                <StatusBadge
                  label={data.lastAgent.action}
                  variant={
                    data.lastAgent.action === "hold" || data.lastAgent.action === "defer"
                      ? "default"
                      : data.lastAgent.action === "defend"
                        ? "warning"
                        : "info"
                  }
                />
                {data.lastAgent.forceDefendOverride ? (
                  <StatusBadge label="Force defend" variant="error" />
                ) : null}
                {data.lastAgent.forceMaintenanceOverride ? (
                  <StatusBadge label="Force maintenance" variant="warning" />
                ) : null}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No agent run yet</span>
            )}
          </div>
          {data.lastAgent ? (
            <>
              <p className="text-sm text-foreground leading-relaxed max-w-2xl text-pretty">
                {data.lastAgent.thesis}
              </p>
              <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Confidence</dt>
                  <dd className="tabular-nums text-foreground mt-0.5">
                    {(data.lastAgent.confidence * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Trade size</dt>
                  <dd className="tabular-nums text-foreground mt-0.5">
                    {formatUsdc(data.lastAgent.notionalUsdc)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Strategy</dt>
                  <dd className="text-foreground mt-0.5">
                    {data.lastAgent.strategy ? strategyLabel(data.lastAgent.strategy) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="text-foreground mt-0.5">
                    {data.lastAgent.createdAt ? (
                      <TimestampDisplay timestamp={data.lastAgent.createdAt} />
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-sm text-muted-foreground leading-relaxed">
              The desk PM LLM is the only strategy decision path. After the next tick, the last
              hold/propose/defend decision and thesis appear here.
            </p>
          )}
        </Surface>
      </PageSection>

      <PageSection
        title="Strategies"
        description="Available strategies run under the same hard safety rules. This page is read-only."
      >
        <div className="flex flex-col gap-2">
          {DESK_STRATEGY_META.map((s) => (
            <Surface
              key={s.id}
              className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {s.description}
                </p>
              </div>
              <StatusBadge
                label={data.paused || kill.armed ? "Held" : "Armed"}
                variant={data.paused || kill.armed ? "warning" : "success"}
              />
            </Surface>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Basis band {data.policy.basisBps} bps · APY edge {data.policy.apyDeltaBps} bps · max trade{" "}
          {formatUsdc(data.policy.maxTradeUsdc)}.
        </p>
      </PageSection>

      <PageSection
        title="Recent money moves"
        description="Funding, profit sweeps, and emergency returns between treasury and desk."
        action={<SectionLink to="/activity">Activity trail →</SectionLink>}
      >
        {capital.isLoading ? (
          <SkeletonPanel rows={3} data-testid="desk-capital-loading" />
        ) : capital.error ? (
          <Surface className="p-6 text-sm text-muted-foreground">{capital.error}</Surface>
        ) : capital.capitalMoves.length === 0 ? (
          <Surface className="p-6 text-sm text-muted-foreground">
            No capital moves recorded yet.
          </Surface>
        ) : (
          <CapitalMovesList moves={capital.capitalMoves} />
        )}
      </PageSection>

      <PageSection
        title="Execution trail"
        action={
          <div className="flex gap-3">
            <SectionLink to="/desk/intents">Proposals →</SectionLink>
            <SectionLink to="/activity">Full activity →</SectionLink>
          </div>
        }
      >
        <Surface className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
            Proposals, trade tickets, and KeeperHub run proofs live in the public trail. Every
            filled proposal should anchor a registry ticket.
          </p>
          <Link
            to="/desk/intents"
            className="inline-flex items-center justify-center rounded-xl bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
          >
            View proposals
          </Link>
        </Surface>
      </PageSection>
    </Page>
  );
}

function WalletCard({
  title,
  description,
  address,
  testId,
}: {
  title: string;
  description: string;
  address: string | null;
  testId: string;
}): ReactElement {
  return (
    <Surface className="p-4" data-testid={testId}>
      <p className="text-[11px] font-medium text-muted-foreground mb-1">{title}</p>
      <p className="text-sm font-semibold text-foreground mb-2">{description}</p>
      {address ? (
        <a
          href={sepoliaAddressUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors break-all"
          title={address}
        >
          {truncateHash(address, 8, 6)}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">Address not configured</p>
      )}
    </Surface>
  );
}

function CapitalMovesList({
  moves,
}: {
  moves: Array<{
    id: string;
    direction: string;
    amountUsdc: number;
    txHash: string | null;
    explorerUrl: string | null;
    reason: string | null;
    createdAt: string;
  }>;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2" data-testid="desk-capital-moves-preview">
      {moves.map((m) => (
        <Surface key={m.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <StatusBadge
              label={m.direction.replace(/_/g, " ")}
              variant={
                m.direction === "topup"
                  ? "info"
                  : m.direction === "emergency_return"
                    ? "error"
                    : "success"
              }
            />
            <span className="text-sm tabular-nums font-medium text-foreground">
              {formatUsdc(m.amountUsdc)}
            </span>
            {m.reason ? (
              <span className="text-xs text-muted-foreground truncate max-w-[14rem]">
                {m.reason}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <TimestampDisplay timestamp={m.createdAt} />
            {m.txHash ? <ProofMonoLink value={m.txHash} href={m.explorerUrl} asTx /> : null}
          </div>
        </Surface>
      ))}
    </div>
  );
}
