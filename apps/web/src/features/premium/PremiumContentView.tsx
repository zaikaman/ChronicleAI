// Premium content view — full paid report after settlement.
// API returns PremiumItemFull with nested contentPrivate; unwrap and render editorially.

import type React from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";

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
  const rows = events.filter(isRecord);
  if (rows.length === 0) return null;

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
            {rows.map((row, idx) => {
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
    </section>
  );
}

function FeedEntriesTable({ entries }: { entries: unknown[] }): React.ReactElement | null {
  const rows = entries.filter(isRecord);
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) return null;

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
            {rows.map((row, idx) => (
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
    </section>
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

  const hasBody =
    sections.length > 0 || analysis != null || events.length > 0 || feedEntries.length > 0;

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
