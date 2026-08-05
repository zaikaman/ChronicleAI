import { ACTIVE_INTELLIGENCE_CHAIN_ID } from "@chronicleai/config/chains";
import type { PublicAlertResponse } from "@chronicleai/schemas";
import type React from "react";
import { Link } from "react-router-dom";
import {
  SourceReference,
  StatusBadge,
  TimestampDisplay,
} from "../../components/data-primitives.tsx";
import { PublicationProof } from "../../components/publication-proof.tsx";
import { chainLabel, txExplorerUrl } from "../../lib/explorer.ts";
import {
  alertActionStepLabel,
  alertHasSignalStep,
  alertKindBadgeLabel,
  alertSourceOriginLabel,
  isDeskTriggerAlert,
} from "./alert-card-presentation.ts";

interface AlertCardProps {
  alert: PublicAlertResponse;
  /** When false, renders as a plain card (e.g. already on the detail page). Default true. */
  linkable?: boolean;
  "data-testid"?: string;
}

function getConfidenceVariant(
  confidence?: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (confidence) {
    case "high":
      return "success";
    case "medium":
      return "warning";
    case "low":
      return "error";
    default:
      return "default";
  }
}

function getStatusVariant(status: string): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "published":
      return "success";
    case "queued":
      return "info";
    case "failed":
      return "error";
    case "partial_failure":
      return "warning";
    default:
      return "default";
  }
}

function formatEventType(eventType?: string): string | null {
  if (!eventType) return null;
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDirection(direction?: string): string | null {
  if (!direction || direction === "unknown") return null;
  return direction
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function chipClassName(): string {
  return "text-[11px] font-medium px-2 py-0.5 rounded-lg bg-muted border border-border/40 text-muted-foreground";
}

function formatCausalLabel(value?: string | null): string {
  if (!value) return "Not recorded";
  const readableLabels: Record<string, string> = {
    oracle_basis: "Price difference",
    apy_delta: "Yield difference",
    health_factor: "Position safety",
    gas_regime: "Network fees",
    trade: "Act",
    defend: "Protect position",
    defer: "Wait",
    filled: "Completed",
    submitted: "Submitted",
    pending: "In progress",
    deferred: "Waiting",
    ignored: "Not taken",
    failed: "Failed",
  };
  if (readableLabels[value]) return readableLabels[value];
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function signalStatusCopy(alert: PublicAlertResponse): string {
  if (!alertHasSignalStep(alert)) {
    return isDeskTriggerAlert(alert) ? "Desk decision recorded" : "No separate check";
  }
  switch (alert.signalStatus) {
    case "created":
      return "Condition recorded";
    case "failed":
      return "Condition check failed";
    case "pending":
      return "Checking condition";
    default:
      return "No separate check";
  }
}

function signalStatusVariant(
  alert: PublicAlertResponse,
): "default" | "success" | "warning" | "error" | "info" {
  if (!alertHasSignalStep(alert)) return "default";
  switch (alert.signalStatus) {
    case "created":
      return "success";
    case "failed":
      return "error";
    case "pending":
      return "info";
    default:
      return "default";
  }
}

function actionStatusVariant(
  status?: PublicAlertResponse["actionStatus"],
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "filled":
      return "success";
    case "submitted":
    case "pending":
      return "info";
    case "deferred":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function noActionReason(alert: PublicAlertResponse): string | null {
  if (alert.policyVerdict === "defer" || alert.actionStatus === "deferred") {
    return "The desk decided to wait, so no trade was made. This alert keeps the recorded evidence.";
  }
  if (!alertHasSignalStep(alert) && alert.actionStatus === "pending") {
    return "The desk made this decision directly; proof of execution is still pending.";
  }
  if (alert.signalStatus === "not_eligible" && !isDeskTriggerAlert(alert)) {
    return "The event was recorded, but this kind of event does not trigger a desk action.";
  }
  if (alert.signalStatus === "failed") {
    return "The alert is visible, but its decision details could not be added yet. The original record is unchanged.";
  }
  if (alert.actionStatus === "ignored") {
    return "The condition was recorded, but the desk chose not to act.";
  }
  if (alert.actionStatus === "failed") {
    return "The desk action did not complete. The alert and decision remain recorded.";
  }
  return null;
}

function CausalChain({
  alert,
  linkable,
}: {
  alert: PublicAlertResponse;
  linkable: boolean;
}): React.ReactElement | null {
  const hasCausalData = Boolean(
    alert.signalStatus ||
      alert.signalType ||
      alert.policyVerdict ||
      alert.actionStatus ||
      alert.intentId ||
      alert.ticketId ||
      alert.transactionHash ||
      alert.actionTransactionHash ||
      isDeskTriggerAlert(alert),
  );
  if (!hasCausalData) return null;

  const showSignal = alertHasSignalStep(alert);
  const proof = alert.causalChain?.proof;
  const proofHref = proof?.explorerUrl ?? alert.actionExplorerUrl ?? alert.explorerUrl;
  const reason = noActionReason(alert);
  const isDeferred = alert.policyVerdict === "defer" || alert.actionStatus === "deferred";
  const actionLabel = alertActionStepLabel(alert);
  const actionTxHash = alert.actionTransactionHash ?? alert.transactionHash;
  const actionTxHref = actionTxHash
    ? (alert.actionExplorerUrl ??
      (/^0x[0-9a-fA-F]{64}$/.test(actionTxHash)
        ? txExplorerUrl(alert.publicationChainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID, actionTxHash)
        : null))
    : null;
  const actionHref =
    !isDeferred && !linkable
      ? alert.ticketId
        ? `/desk/tickets/${encodeURIComponent(alert.ticketId)}`
        : alert.intentId
          ? `/activity?entityId=${encodeURIComponent(alert.intentId)}&entityType=desk_intent`
          : actionTxHref
      : null;

  return (
    <div
      className="mt-4 rounded-xl border border-border/60 bg-muted/15 p-4"
      data-testid="alert-causal-chain"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Decision details
        </p>
        <StatusBadge
          label={signalStatusCopy(alert)}
          variant={signalStatusVariant(alert)}
          data-testid="alert-signal-status"
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs"
        data-testid="alert-causal-steps"
        aria-label={
          showSignal
            ? "Alert, Condition, Desk decision, Result, Evidence"
            : "Alert, Desk decision, Result, Evidence"
        }
      >
        <span className={`${chipClassName()} text-foreground`}>Alert</span>

        {showSignal ? (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              →
            </span>
            <span className={chipClassName()} data-testid="alert-causal-signal-step">
              Condition{alert.signalType ? ` · ${formatCausalLabel(alert.signalType)}` : ""}
            </span>
          </>
        ) : null}

        <span className="text-muted-foreground" aria-hidden="true">
          →
        </span>
        <span className={chipClassName()} data-testid="alert-causal-decision-step">
          Desk decision{alert.policyVerdict ? ` · ${formatCausalLabel(alert.policyVerdict)}` : ""}
        </span>

        <span className="text-muted-foreground" aria-hidden="true">
          →
        </span>
        {isDeferred ? (
          <span
            className={chipClassName()}
            data-testid="alert-causal-action-step"
            title="A waiting decision does not produce a trade"
          >
            {actionLabel}
          </span>
        ) : actionHref ? (
          actionHref.startsWith("/") ? (
            <Link
              to={actionHref}
              className={`${chipClassName()} hover:border-accent/60 hover:text-foreground transition-colors`}
              data-testid="alert-action-link"
              onClick={(event) => event.stopPropagation()}
            >
              {actionLabel}
            </Link>
          ) : (
            <a
              href={actionHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`${chipClassName()} hover:border-accent/60 hover:text-foreground transition-colors`}
              data-testid="alert-action-link"
              onClick={(event) => event.stopPropagation()}
            >
              {actionLabel}
            </a>
          )
        ) : (
          <span className={chipClassName()} data-testid="alert-causal-action-step">
            {actionLabel}
          </span>
        )}

        <span className="text-muted-foreground" aria-hidden="true">
          →
        </span>
        {proofHref ? (
          <a
            href={proofHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${chipClassName()} hover:border-accent/60 hover:text-foreground transition-colors`}
            data-testid="alert-proof-link"
            onClick={(event) => event.stopPropagation()}
          >
            Proof
          </a>
        ) : (
          <span className={chipClassName()} data-testid="alert-proof-pending">
            Proof · pending
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {alert.policyVerdict ? (
          <span data-testid="alert-policy-verdict">
            Decision:{" "}
            <strong className="text-foreground">{formatCausalLabel(alert.policyVerdict)}</strong>
          </span>
        ) : null}
        {alert.actionStatus ? (
          <span data-testid="alert-action-status">
            Result:{" "}
            <StatusBadge
              label={formatCausalLabel(alert.actionStatus)}
              variant={actionStatusVariant(alert.actionStatus)}
            />
          </span>
        ) : null}
        {actionTxHash ? (
          actionTxHref && !linkable ? (
            <a
              href={actionTxHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-foreground underline decoration-transparent underline-offset-2 hover:text-accent hover:decoration-current transition-colors"
              title={`Open action transaction ${actionTxHash} on the block explorer`}
              data-testid="alert-tx-link"
              onClick={(event) => event.stopPropagation()}
            >
              tx {actionTxHash.slice(0, 10)}…{actionTxHash.slice(-6)}
            </a>
          ) : (
            <code
              className="font-mono text-[11px] text-foreground"
              title={actionTxHash}
              data-testid="alert-tx-hash"
            >
              tx {actionTxHash.slice(0, 10)}…{actionTxHash.slice(-6)}
            </code>
          )
        ) : null}
      </div>

      {reason ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{reason}</p>
      ) : null}
    </div>
  );
}

export function AlertCard({
  alert,
  linkable = true,
  "data-testid": dataTestId = "alert-card",
}: AlertCardProps): React.ReactElement {
  const desk = isDeskTriggerAlert(alert);
  const eventLabel = formatEventType(alert.eventType);
  const kindBadge = alertKindBadgeLabel(alert);
  const sourceOrigin = alertSourceOriginLabel(alert);
  const sourceChainLabel =
    typeof alert.chainId === "number" ? `Detected on: ${chainLabel(alert.chainId)}` : null;
  const publicationLabel = `Published on: ${chainLabel(
    alert.publicationChainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID,
  )}`;

  const content = (
    <>
      <div className="flex justify-between items-start mb-4 gap-4">
        <h3 className="text-xl font-semibold text-foreground leading-snug">{alert.title}</h3>
        <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
          <StatusBadge
            label={kindBadge}
            variant={desk ? "info" : "default"}
            data-testid="alert-kind-badge"
          />
          {alert.confidence ? (
            <StatusBadge
              label={`${alert.confidence} confidence`}
              variant={getConfidenceVariant(alert.confidence)}
            />
          ) : null}
          <StatusBadge
            label={alert.deliveryStatus}
            variant={getStatusVariant(alert.deliveryStatus)}
          />
        </div>
      </div>

      <p className="text-muted-foreground text-sm leading-relaxed mb-4">{alert.summary}</p>

      {(eventLabel ||
        sourceOrigin ||
        sourceChainLabel ||
        publicationLabel ||
        alert.protocol ||
        alert.flowContext?.direction ||
        alert.flowContext?.fromLabel ||
        alert.flowContext?.toLabel) && (
        <div className="flex flex-wrap gap-2 mb-4" data-testid="alert-flow-chips">
          {sourceOrigin ? (
            <span className={chipClassName()} data-testid="alert-source-origin">
              {sourceOrigin}
            </span>
          ) : null}
          {eventLabel ? <span className={chipClassName()}>{eventLabel}</span> : null}
          {sourceChainLabel ? (
            <span className={chipClassName()} data-testid="alert-source-chain">
              {sourceChainLabel}
            </span>
          ) : null}
          <span className={chipClassName()} data-testid="alert-publication-chain">
            {publicationLabel}
          </span>
          {alert.protocol ? <span className={chipClassName()}>{alert.protocol}</span> : null}
          {formatDirection(alert.flowContext?.direction) ? (
            <span className={chipClassName()} data-testid="alert-direction-chip">
              {formatDirection(alert.flowContext?.direction)}
            </span>
          ) : null}
          {alert.flowContext?.fromLabel ? (
            <span className={chipClassName()} data-testid="alert-from-label-chip">
              From: {alert.flowContext.fromLabel}
            </span>
          ) : null}
          {alert.flowContext?.toLabel ? (
            <span className={chipClassName()} data-testid="alert-to-label-chip">
              To: {alert.flowContext.toLabel}
            </span>
          ) : null}
        </div>
      )}

      <PublicationProof
        registryTxHash={alert.registryTxHash}
        contentHash={alert.contentHash}
        sourceEventHash={alert.sourceEventHash}
        gasUsed={alert.gasUsed}
        gasUsedWei={alert.gasUsedWei}
        keeperHubRunId={alert.keeperHubRunId}
        explorerUrl={alert.explorerUrl}
        chainId={alert.publicationChainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID}
        compact={linkable}
        data-testid="alert-publication-proof"
      />

      <CausalChain alert={alert} linkable={linkable} />

      <div className="flex flex-wrap gap-4 items-center text-xs text-muted-foreground border-t border-border/20 pt-4 mt-4">
        {alert.publishedAt ? (
          <TimestampDisplay timestamp={alert.publishedAt} data-testid="alert-timestamp" />
        ) : null}

        {alert.generationProvider ? (
          <span className="flex items-center gap-1">
            Generated by:{" "}
            <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">
              {alert.generationProvider}
            </code>
          </span>
        ) : null}

        {alert.sourceReferences?.length > 0 ? (
          <div className="flex gap-2 flex-wrap items-center min-[850px]:ml-auto">
            {alert.sourceReferences.map((ref, i) => {
              const txMatch = ref.match(/0x[0-9a-fA-F]{64}/);
              const refTxHash = txMatch ? txMatch[0] : null;
              const refHref = refTxHash
                ? txExplorerUrl(alert.chainId ?? ACTIVE_INTELLIGENCE_CHAIN_ID, refTxHash)
                : undefined;
              return (
                <SourceReference
                  key={`${refTxHash ?? "reference"}-${ref}`}
                  label="Source"
                  reference={ref}
                  {...(refHref ? { href: refHref } : {})}
                  data-testid={`source-ref-${i}`}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );

  const className =
    "block bg-frame border border-border rounded-2xl p-6 hover:border-accent/40 transition-all duration-300 shadow-xs hover:shadow-md motion-reduce:transition-none";

  if (linkable) {
    return (
      <Link to={`/alerts/${alert.id}`} className={className} data-testid={dataTestId}>
        {content}
      </Link>
    );
  }

  return (
    <div className={className} data-testid={dataTestId}>
      {content}
    </div>
  );
}
