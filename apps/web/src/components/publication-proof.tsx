/** IDEA proof-of-publication panel: registry tx, content hash, source hash, gas, KeeperHub status. */

import type { ReactElement, ReactNode } from "react";
import { formatGasUsed, sepoliaTxUrl, truncateHash } from "../lib/explorer.ts";

export interface PublicationProofProps {
  registryTxHash?: string | null | undefined;
  contentHash?: string | null | undefined;
  sourceEventHash?: string | null | undefined;
  sourceEventRoot?: string | null | undefined;
  gasUsed?: string | null | undefined;
  gasUsedWei?: string | null | undefined;
  keeperHubRunId?: string | null | undefined;
  explorerUrl?: string | null | undefined;
  /** Compact single-row layout for list cards / activity rows. */
  compact?: boolean | undefined;
  "data-testid"?: string | undefined;
}

function MonoValue({
  value,
  title,
  href,
}: {
  value: string;
  title?: string | undefined;
  href?: string | undefined;
}): ReactElement {
  const display = truncateHash(value);
  const className = "font-mono text-[11px] sm:text-xs text-foreground break-all";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} text-accent hover:underline`}
        title={title ?? value}
        onClick={(e) => e.stopPropagation()}
      >
        {display}
      </a>
    );
  }
  return (
    <code className={className} title={title ?? value}>
      {display}
    </code>
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

/**
 * Editorial proof strip for alerts / digests.
 * Renders only when at least one proof field is present.
 */
export function PublicationProof({
  registryTxHash,
  contentHash,
  sourceEventHash,
  sourceEventRoot,
  gasUsed,
  gasUsedWei,
  keeperHubRunId,
  explorerUrl,
  compact = false,
  "data-testid": dataTestId = "publication-proof",
}: PublicationProofProps): ReactElement | null {
  const sourceHash = sourceEventHash ?? sourceEventRoot;
  const gasLabel = formatGasUsed(gasUsed);
  const hasKeeperHub = Boolean(keeperHubRunId || registryTxHash);
  const hasAny =
    Boolean(registryTxHash) ||
    Boolean(contentHash) ||
    Boolean(sourceHash) ||
    Boolean(gasLabel) ||
    Boolean(keeperHubRunId);

  if (!hasAny) return null;

  // Registry proofs land on Ethereum Sepolia (ops rail), not Base payment rail.
  const txHref =
    explorerUrl ?? (registryTxHash ? sepoliaTxUrl(registryTxHash) : undefined);

  if (compact) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]"
        data-testid={dataTestId}
      >
        {hasKeeperHub ? (
          <span
            className="rounded-full bg-accent/15 text-accent px-2 py-0.5 font-semibold tracking-wide uppercase"
            data-testid="executed-via-keeperhub"
          >
            {keeperHubRunId ? "Executed via KeeperHub" : "On-chain proof"}
          </span>
        ) : (
          <span
            className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
            data-testid="local-publish-status"
          >
            Local publish
          </span>
        )}
        {registryTxHash ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>tx</span>
            <MonoValue
              value={registryTxHash}
              title={registryTxHash}
              {...(txHref ? { href: txHref } : {})}
            />
          </span>
        ) : null}
        {contentHash ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>content</span>
            <MonoValue value={contentHash} title={contentHash} />
          </span>
        ) : null}
        {sourceHash ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span>{sourceEventRoot ? "root" : "source"}</span>
            <MonoValue value={sourceHash} title={sourceHash} />
          </span>
        ) : null}
        {gasLabel ? (
          <span className="text-muted-foreground" data-testid="gas-used">
            {gasLabel}
          </span>
        ) : null}
        {keeperHubRunId ? (
          <code
            className="font-mono text-muted-foreground"
            title={keeperHubRunId}
            data-testid="keeperhub-run-id"
          >
            run{" "}
            {keeperHubRunId.length > 16
              ? `${keeperHubRunId.slice(0, 10)}…${keeperHubRunId.slice(-4)}`
              : keeperHubRunId}
          </code>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="mt-4 rounded-xl border border-border bg-muted/20 p-4 flex flex-col gap-2.5"
      data-testid={dataTestId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground tracking-wide">
          Proof of publication
        </p>
        {hasKeeperHub ? (
          <span
            className="rounded-full bg-accent/15 text-accent px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase"
            data-testid="executed-via-keeperhub"
          >
            {keeperHubRunId ? "Executed via KeeperHub" : "Anchored on-chain"}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Local publish
          </span>
        )}
      </div>

      {registryTxHash ? (
        <ProofRow label="Registry proof">
          <MonoValue
            value={registryTxHash}
            title={
              explorerUrl
                ? `${registryTxHash} (KeeperHub registry — may differ from the source event chain)`
                : registryTxHash
            }
            {...(txHref ? { href: txHref } : {})}
          />
        </ProofRow>
      ) : null}

      {contentHash ? (
        <ProofRow label="Content hash">
          <MonoValue value={contentHash} title={contentHash} />
        </ProofRow>
      ) : null}

      {sourceHash ? (
        <ProofRow label={sourceEventRoot ? "Source event root" : "Source event"}>
          <MonoValue value={sourceHash} title={sourceHash} />
        </ProofRow>
      ) : null}

      {gasLabel ? (
        <ProofRow label="Gas used">
          <span className="text-xs text-foreground" data-testid="gas-used">
            {gasLabel}
            {gasUsedWei ? (
              <span className="text-muted-foreground ml-2 font-mono text-[11px]">
                ({truncateHash(gasUsedWei, 8, 4)} wei)
              </span>
            ) : null}
          </span>
        </ProofRow>
      ) : null}

      {keeperHubRunId ? (
        <ProofRow label="KeeperHub run">
          <code
            className="font-mono text-xs text-foreground break-all"
            title={keeperHubRunId}
            data-testid="keeperhub-run-id"
          >
            {keeperHubRunId}
          </code>
        </ProofRow>
      ) : null}
    </div>
  );
}
