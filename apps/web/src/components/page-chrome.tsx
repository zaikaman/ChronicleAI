import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Shared product page chrome.
 * Every product route should use these so titles, sections, and surfaces stay consistent.
 */

// ── Page root ──────────────────────────────────────────

interface PageProps {
  children: ReactNode;
  "data-testid"?: string;
  className?: string;
}

/** Root wrapper for a product page body (AppShell already supplies max-width + padding). */
export function Page({
  children,
  "data-testid": dataTestId,
  className = "",
}: PageProps): ReactNode {
  return (
    <div data-testid={dataTestId} className={className}>
      {children}
    </div>
  );
}

// ── Page header ────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-side meta (counts, badges, actions) */
  meta?: ReactNode;
  /** Optional row below title (status chips, etc.) */
  below?: ReactNode;
  className?: string;
}

/**
 * Left-aligned product page title.
 * Title: Space Grotesk, 2xl/3xl semibold. Description: muted sm. No centered heroes, no kickers.
 */
export function PageHeader({
  title,
  description,
  meta,
  below,
  className = "",
}: PageHeaderProps): ReactNode {
  return (
    <header className={`mb-8 ${className}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground text-balance"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {description}
            </p>
          ) : null}
        </div>
        {meta ? (
          <div className="flex items-center gap-2 shrink-0 text-sm text-muted-foreground font-medium">
            {meta}
          </div>
        ) : null}
      </div>
      {below ? <div className="mt-3 flex flex-wrap items-center gap-2">{below}</div> : null}
    </header>
  );
}

// ── Back link (detail pages) ───────────────────────────

interface PageBackLinkProps {
  to: string;
  children: ReactNode;
  className?: string;
}

export function PageBackLink({ to, children, className = "" }: PageBackLinkProps): ReactNode {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4 ${className}`}
    >
      <span aria-hidden="true">←</span>
      {children}
    </Link>
  );
}

// ── Section ────────────────────────────────────────────

interface PageSectionProps {
  title?: string;
  description?: string;
  /** Right-side action (e.g. “All alerts →”) */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function PageSection({
  title,
  description,
  action,
  children,
  className = "",
  "data-testid": dataTestId,
}: PageSectionProps): ReactNode {
  return (
    <section data-testid={dataTestId} className={`mb-10 last:mb-0 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-base font-semibold text-foreground tracking-tight">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground max-w-2xl leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Surface card ───────────────────────────────────────

interface SurfaceProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "section" | "li";
  "data-testid"?: string;
}

/** Frame surface: border + rounded-2xl + bg-frame. Use for cards, panels, empty panel shells. */
export function Surface({
  children,
  className = "",
  as: Tag = "div",
  "data-testid": dataTestId,
}: SurfaceProps): ReactNode {
  return (
    <Tag
      data-testid={dataTestId}
      className={`rounded-2xl border border-border bg-frame ${className}`}
    >
      {children}
    </Tag>
  );
}

// ── Stat tile ──────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string | number;
}

export function StatTile({ label, value }: StatTileProps): ReactNode {
  return (
    <Surface className="p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </Surface>
  );
}

// ── Inline section link ────────────────────────────────

interface SectionLinkProps {
  to: string;
  children: ReactNode;
}

export function SectionLink({ to, children }: SectionLinkProps): ReactNode {
  return (
    <Link
      to={to}
      className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
    >
      {children}
    </Link>
  );
}

// ── Mono meta chip ─────────────────────────────────────

interface MetaChipProps {
  children: ReactNode;
  className?: string;
}

export function MetaChip({ children, className = "" }: MetaChipProps): ReactNode {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-lg border border-border/40 ${className}`}
    >
      {children}
    </span>
  );
}

// ── Content URI footer ─────────────────────────────────

interface ContentUriProps {
  uri: string;
}

export function ContentUriFooter({ uri }: ContentUriProps): ReactNode {
  return (
    <div className="mt-8 flex justify-center">
      <span className="inline-flex max-w-full items-center gap-2 px-4 py-2.5 bg-muted/40 border border-border text-muted-foreground rounded-xl text-xs sm:text-sm font-mono break-all">
        {uri}
      </span>
    </div>
  );
}
