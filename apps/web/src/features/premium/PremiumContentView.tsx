// Premium content view — full paid report after settlement.
// API returns PremiumItemFull with nested contentPrivate; unwrap and render editorially.

import type { PaginationMeta } from "@chronicleai/schemas";
import type React from "react";
import { useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { chainLabel } from "../../lib/explorer.ts";

interface PremiumContentViewProps {
  content: Record<string, unknown>;
  title: string;
  onClose: () => void;
  "data-testid"?: string;
}

interface ContentSection {
  title?: string;
  body?: string;
  findings?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Prefer nested contentPrivate (API shape); fall back to top-level private payload. */
function resolvePrivatePayload(content: Record<string, unknown>): Record<string, unknown> {
  const nested = content.contentPrivate ?? content.content_private;
  if (isRecord(nested)) return nested;
  return content;
}

function formatContentType(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function shortTx(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

const TABLE_PAGE_SIZE = 10;

function getPageSlice<T>(
  rows: T[],
  requestedPage: number,
  limit = TABLE_PAGE_SIZE,
): { rows: T[]; pagination: PaginationMeta } {
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);

  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    pagination: {
      page,
      limit,
      total: rows.length,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

function SectionBlock({ section }: { section: ContentSection }): React.ReactElement | null {
  const title = typeof section.title === "string" ? section.title.trim() : "";
  const body = typeof section.body === "string" ? section.body.trim() : "";
  const findings = Array.isArray(section.findings)
    ? section.findings.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    : [];

  if (!title && !body && findings.length === 0) return null;

  return (
    <section className="pb-6 mb-6 border-b border-border last:border-0 last:mb-0 last:pb-0">
      {title ? (
        <h4 className="text-base font-semibold text-foreground mb-3 text-balance">{title}</h4>
      ) : null}
      {body ? (
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap max-w-prose text-pretty">
          {body}
        </p>
      ) : null}
      {findings.length > 0 ? (
        <ul className="mt-3 space-y-2.5 list-none p-0 m-0">
          {findings.map((finding, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: ordered findings list
              key={i}
              className="flex gap-3 text-sm text-foreground/90 leading-relaxed"
            >
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                aria-hidden
              />
              <span className="min-w-0 break-words">{finding}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function EventsTable({ events }: { events: unknown[] }): React.ReactElement | null {
  const [page, setPage] = useState(1);
  const rows = events.filter(isRecord);
  if (rows.length === 0) return null;
  const pageSlice = getPageSlice(rows, page);

  return (
    <section className="mt-2">
      <h4 className="text-base font-semibold text-foreground mb-3">Source events</h4>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Type", "Protocol", "Network", "Magnitude", "Tx", "Captured"].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageSlice.rows.map((row, idx) => {
              const eventType = String(row.eventType ?? row.event_type ?? "—");
              const protocol = String(row.protocol ?? "—");
              const network = String(row.network ?? row.chainId ?? "—");
              const mag =
                isRecord(row.magnitude) && typeof row.magnitude.value === "number"
                  ? `${row.magnitude.value} ${String(row.magnitude.unit ?? "")}`.trim()
                  : "—";
              const tx =
                typeof row.transactionHash === "string"
                  ? row.transactionHash
                  : typeof row.transaction_hash === "string"
                    ? row.transaction_hash
                    : null;
              const captured = String(row.capturedAt ?? row.captured_at ?? "—");

              return (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered event snapshot
                  key={idx}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2.5 text-foreground whitespace-nowrap">{eventType}</td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{protocol}</td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{network}</td>
                  <td className="px-3 py-2.5 font-mono text-foreground whitespace-nowrap">{mag}</td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                    {tx ? shortTx(tx) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {captured.length > 19 ? captured.slice(0, 19).replace("T", " ") : captured}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationControls
        pagination={pageSlice.pagination}
        onPageChange={setPage}
        data-testid="premium-source-events-pagination"
      />
    </section>
  );
}

function FeedEntriesTable({ entries }: { entries: unknown[] }): React.ReactElement | null {
  const [page, setPage] = useState(1);
  const rows = entries.filter(isRecord);
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) return null;
  const pageSlice = getPageSlice(rows, page);

  return (
    <section className="mt-2">
      <h4 className="text-base font-semibold text-foreground mb-3">Feed entries</h4>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2.5 text-left font-medium text-muted-foreground capitalize whitespace-nowrap"
                >
                  {col.replace(/([A-Z])/g, " $1").trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageSlice.rows.map((row, idx) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered feed rows
                key={idx}
                className="border-b border-border last:border-0"
              >
                {columns.map((col) => {
                  const val = row[col];
                  return (
                    <td
                      key={col}
                      className={`px-3 py-2.5 text-muted-foreground ${
                        typeof val === "number" ? "font-mono text-foreground" : ""
                      }`}
                    >
                      {val == null ? "—" : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationControls
        pagination={pageSlice.pagination}
        onPageChange={setPage}
        data-testid="premium-feed-entries-pagination"
      />
    </section>
  );
}

function SponsoredWatchDetails({
  targetContract,
  watchSpecHash,
  startsAt,
  endsAt,
  durationDays,
  durationHours,
  eventSignature,
  description,
  status,
  watchId,
  reportTitle,
  reportSummary,
  reportHighlights,
  reportAnalysis,
  createExplorerUrl,
  reportExplorerUrl,
  createTxHash,
  reportTxHash,
}: {
  targetContract: string;
  watchSpecHash?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  durationDays?: number | null;
  durationHours?: number | null;
  eventSignature?: string | null;
  description?: string | null;
  status?: string | null;
  watchId?: string | null;
  reportTitle?: string | null;
  reportSummary?: string | null;
  reportHighlights?: string[];
  reportAnalysis?: string | null;
  createExplorerUrl?: string | null;
  reportExplorerUrl?: string | null;
  createTxHash?: string | null;
  reportTxHash?: string | null;
}): React.ReactElement {
  const watchStatus = status ?? "accepted";
  const statusVariant =
    watchStatus === "completed"
      ? "success"
      : watchStatus === "monitoring"
        ? "warning"
        : watchStatus === "failed"
          ? "error"
          : "info";

  return (
    <div className="space-y-6 mb-6">
      <section className="p-5 rounded-xl border border-accent/30 bg-accent/5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div>
            <h4 className="text-base font-semibold text-foreground">
              {reportTitle ?? "Sponsored Contract Watch"}
            </h4>
            <p className="text-xs text-muted-foreground">
              {watchStatus === "completed"
                ? "Monitoring window completed · Report generated"
                : "Active monitoring campaign registered on-chain"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge label={watchStatus} variant={statusVariant} />
            {watchId ? (
              <a
                href={`/premium/watches/${watchId}`}
                className="px-3 py-1 text-xs font-medium border border-border rounded-lg bg-background hover:bg-muted text-foreground transition-colors"
              >
                View Full Watch Page &rarr;
              </a>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-muted-foreground block mb-1">Target Contract</span>
            <a
              href={`https://sepolia.etherscan.io/address/${targetContract}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-accent hover:underline break-all"
            >
              {targetContract}
            </a>
          </div>

          {watchSpecHash ? (
            <div>
              <span className="text-muted-foreground block mb-1">Watch Spec Hash</span>
              <span className="font-mono text-foreground break-all">{watchSpecHash}</span>
            </div>
          ) : null}

          {startsAt && endsAt ? (
            <div>
              <span className="text-muted-foreground block mb-1">Monitoring Window</span>
              <span className="text-foreground font-medium">
                {startsAt.slice(0, 19).replace("T", " ")} &rarr; {endsAt.slice(0, 19).replace("T", " ")}
              </span>
            </div>
          ) : null}

          {durationHours || durationDays ? (
            <div>
              <span className="text-muted-foreground block mb-1">Campaign Duration</span>
              <span className="text-foreground font-medium">
                {durationHours ? `${durationHours} hour(s)` : `${durationDays} day(s)`}
              </span>
            </div>
          ) : null}

          {eventSignature ? (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground block mb-1">Event Filter</span>
              <code className="px-2 py-1 rounded bg-muted font-mono text-foreground text-[11px]">
                {eventSignature}
              </code>
            </div>
          ) : null}

          {description ? (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground block mb-1">Description</span>
              <p className="text-muted-foreground">{description}</p>
            </div>
          ) : null}
        </div>
      </section>

      {reportSummary ? (
        <section className="p-5 rounded-xl border border-border bg-card space-y-3">
          <h4 className="text-base font-semibold text-foreground">Executive Summary</h4>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {reportSummary}
          </p>
        </section>
      ) : null}

      {reportHighlights && reportHighlights.length > 0 ? (
        <section className="p-5 rounded-xl border border-border bg-card space-y-3">
          <h4 className="text-base font-semibold text-foreground">Campaign Key Takeaways</h4>
          <ul className="space-y-2 text-sm text-muted-foreground list-none p-0 m-0">
            {reportHighlights.map((highlight) => (
              <li key={highlight} className="flex gap-2.5 items-start">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reportAnalysis ? (
        <section className="p-5 rounded-xl border border-border bg-card space-y-3">
          <h4 className="text-base font-semibold text-foreground">Detailed Observation Analysis</h4>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {reportAnalysis}
          </p>
        </section>
      ) : null}

      {(createTxHash || reportTxHash) ? (
        <section className="p-4 rounded-xl border border-border/60 bg-muted/20 text-xs font-mono space-y-2">
          <span className="font-sans font-semibold text-foreground block">On-Chain Audit Trail</span>
          {createTxHash ? (
            <div>
              <span className="text-muted-foreground">Create Tx: </span>
              {createExplorerUrl ? (
                <a href={createExplorerUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
                  {createTxHash}
                </a>
              ) : (
                <span className="text-foreground break-all">{createTxHash}</span>
              )}
            </div>
          ) : null}
          {reportTxHash ? (
            <div>
              <span className="text-muted-foreground">Report Tx: </span>
              {reportExplorerUrl ? (
                <a href={reportExplorerUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
                  {reportTxHash}
                </a>
              ) : (
                <span className="text-foreground break-all">{reportTxHash}</span>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function PremiumContentView({
  content,
  title,
  onClose,
  "data-testid": dataTestId = "premium-content",
}: PremiumContentViewProps): React.ReactElement {
  const privatePayload = resolvePrivatePayload(content);
  const displayTitle =
    (typeof content.title === "string" && content.title.trim()) || title || "Premium report";

  const contentType = formatContentType(content.contentType ?? content.content_type);
  const confidence =
    typeof privatePayload.confidence === "string" ? privatePayload.confidence : null;
  const eventCount =
    typeof privatePayload.eventCount === "number"
      ? privatePayload.eventCount
      : Array.isArray(privatePayload.events)
        ? privatePayload.events.length
        : null;
  const generationProvider =
    typeof privatePayload.generationProvider === "string"
      ? privatePayload.generationProvider
      : null;
  const usedLlm = privatePayload.usedLlm === true;
  const sourceChainId =
    typeof content.sourceChainId === "number"
      ? content.sourceChainId
      : typeof content.source_chain_id === "number"
        ? content.source_chain_id
        : typeof privatePayload.sourceChainId === "number"
          ? privatePayload.sourceChainId
          : undefined;

  const sections: ContentSection[] = Array.isArray(privatePayload.sections)
    ? (privatePayload.sections as ContentSection[])
    : [];
  const analysis =
    typeof privatePayload.analysis === "string" && privatePayload.analysis.trim()
      ? privatePayload.analysis.trim()
      : null;
  const events = Array.isArray(privatePayload.events) ? privatePayload.events : [];
  const feedEntries = Array.isArray(privatePayload.feedEntries)
    ? privatePayload.feedEntries
    : [];

  const targetContract =
    typeof privatePayload.targetContract === "string"
      ? privatePayload.targetContract
      : typeof (privatePayload.watchSpec as Record<string, unknown> | undefined)?.targetContract === "string"
        ? String((privatePayload.watchSpec as Record<string, unknown>).targetContract)
        : null;
  const watchSpecHash =
    typeof privatePayload.watchSpecHash === "string" ? privatePayload.watchSpecHash : null;
  const startsAt =
    typeof privatePayload.startsAt === "string" ? privatePayload.startsAt : null;
  const endsAt =
    typeof privatePayload.endsAt === "string" ? privatePayload.endsAt : null;
  const durationDays =
    typeof privatePayload.durationDays === "number" ? privatePayload.durationDays : null;
  const durationHours =
    typeof privatePayload.durationHours === "number" ? privatePayload.durationHours : null;
  const watchSpec = isRecord(privatePayload.watchSpec) ? privatePayload.watchSpec : null;
  const eventSignature =
    typeof watchSpec?.eventSignature === "string" ? watchSpec.eventSignature : null;
  const description =
    typeof watchSpec?.description === "string" ? watchSpec.description : null;

  const watchStatus = typeof privatePayload.status === "string" ? privatePayload.status : null;
  const watchId = typeof privatePayload.watchId === "string" ? privatePayload.watchId : null;
  const reportTitle = typeof privatePayload.reportTitle === "string" ? privatePayload.reportTitle : null;
  const reportSummary = typeof privatePayload.reportSummary === "string" ? privatePayload.reportSummary : null;
  const reportHighlights = Array.isArray(privatePayload.reportHighlights)
    ? (privatePayload.reportHighlights as string[])
    : undefined;
  const reportAnalysis = typeof privatePayload.reportAnalysis === "string" ? privatePayload.reportAnalysis : null;
  const createExplorerUrl = typeof privatePayload.createExplorerUrl === "string" ? privatePayload.createExplorerUrl : null;
  const reportExplorerUrl = typeof privatePayload.reportExplorerUrl === "string" ? privatePayload.reportExplorerUrl : null;
  const createTxHash = typeof privatePayload.createTxHash === "string" ? privatePayload.createTxHash : null;
  const reportTxHash = typeof privatePayload.reportTxHash === "string" ? privatePayload.reportTxHash : null;

  const hasBody =
    sections.length > 0 ||
    analysis != null ||
    events.length > 0 ||
    feedEntries.length > 0 ||
    targetContract != null;

  return (
    <article
      className="bg-frame border border-border rounded-2xl overflow-hidden"
      data-testid={dataTestId}
    >
      <header className="px-5 sm:px-6 py-5 border-b border-border flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label="Unlocked" variant="success" />
            {contentType ? <StatusBadge label={contentType} variant="info" /> : null}
            {confidence ? (
              <StatusBadge
                label={`${confidence} confidence`}
                variant={
                  confidence === "high"
                    ? "success"
                    : confidence === "medium"
                      ? "warning"
                      : "error"
                }
              />
            ) : null}
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground leading-snug text-balance">
            {displayTitle}
          </h2>
          <div className="flex flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
            {eventCount != null ? (
              <span className="px-2 py-0.5 rounded-lg bg-muted border border-border/40">
                {eventCount} source event{eventCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {sourceChainId !== undefined ? (
              <span className="px-2 py-0.5 rounded-lg bg-muted border border-border/40">
                Source: {chainLabel(sourceChainId)}
              </span>
            ) : null}
            {generationProvider && usedLlm ? (
              <span className="px-2 py-0.5 rounded-lg bg-muted border border-border/40 font-mono">
                via {generationProvider}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-end sm:self-start shrink-0 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors cursor-pointer"
          aria-label="Close unlocked report"
        >
          Close
        </button>
      </header>

      <div className="px-5 sm:px-6 py-6">
        {!hasBody ? (
          <p className="text-sm text-muted-foreground" data-testid="premium-content-empty">
            This purchase unlocked the item, but no private report body was returned. Retry Access
            with your payment receipt, or contact support if it persists.
          </p>
        ) : (
          <>
            {targetContract ? (
              <SponsoredWatchDetails
                targetContract={targetContract}
                watchSpecHash={watchSpecHash}
                startsAt={startsAt}
                endsAt={endsAt}
                durationDays={durationDays}
                durationHours={durationHours}
                eventSignature={eventSignature}
                description={description}
                status={watchStatus}
                watchId={watchId}
                reportTitle={reportTitle}
                reportSummary={reportSummary}
                reportHighlights={reportHighlights}
                reportAnalysis={reportAnalysis}
                createExplorerUrl={createExplorerUrl}
                reportExplorerUrl={reportExplorerUrl}
                createTxHash={createTxHash}
                reportTxHash={reportTxHash}
              />
            ) : null}

            {sections.map((section, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ordered report sections
              <SectionBlock key={idx} section={section} />
            ))}

            {analysis ? (
              <section className="pb-6 mb-6 border-b border-border last:border-0 last:mb-0 last:pb-0">
                <h4 className="text-base font-semibold text-foreground mb-3">Analysis</h4>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap max-w-prose text-pretty">
                  {analysis}
                </p>
              </section>
            ) : null}

            {feedEntries.length > 0 ? <FeedEntriesTable entries={feedEntries} /> : null}
            {events.length > 0 ? <EventsTable events={events} /> : null}
          </>
        )}
      </div>
    </article>
  );
}
