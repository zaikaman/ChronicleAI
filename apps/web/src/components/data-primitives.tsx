// Reusable data display components
import type React from "react";

// ── Metric Card ────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string | number;
  change?: {
    direction: "up" | "down" | "neutral";
    value: string;
  };
  "data-testid"?: string;
}

export function MetricCard({
  label,
  value,
  change,
  "data-testid": dataTestId = "metric-card",
}: MetricCardProps): React.ReactElement {
  const changeColor =
    change?.direction === "up"
      ? "var(--accent-success)"
      : change?.direction === "down"
        ? "var(--accent-error)"
        : "var(--fg-tertiary)";

  return (
    <div className="card" data-testid={dataTestId} style={{ minWidth: "160px" }}>
      <div
        className="text-tertiary"
        style={{
          fontSize: "var(--font-size-xs)",
          marginBottom: "0.25rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--fg-primary)" }}
      >
        {value}
      </div>
      {change ? (
        <div style={{ fontSize: "var(--font-size-xs)", color: changeColor, marginTop: "0.25rem" }}>
          {change.direction === "up" ? "\u2191" : change.direction === "down" ? "\u2193" : "\u2192"}{" "}
          {change.value}
        </div>
      ) : null}
    </div>
  );
}

// ── Status Badge ───────────────────────────────────────
interface StatusBadgeProps {
  label: string;
  variant?: "default" | "success" | "warning" | "error" | "info";
  "data-testid"?: string;
}

interface ColorSet {
  bg: string;
  fg: string;
  border: string;
}

const VARIANT_COLORS: Record<string, ColorSet> = {
  default: { bg: "rgba(113, 113, 122, 0.15)", fg: "#a1a1aa", border: "rgba(113, 113, 122, 0.2)" },
  success: { bg: "rgba(34, 197, 94, 0.1)", fg: "#22c55e", border: "rgba(34, 197, 94, 0.2)" },
  warning: { bg: "rgba(245, 158, 11, 0.1)", fg: "#f59e0b", border: "rgba(245, 158, 11, 0.2)" },
  error: { bg: "rgba(239, 68, 68, 0.1)", fg: "#ef4444", border: "rgba(239, 68, 68, 0.2)" },
  info: { bg: "rgba(59, 130, 246, 0.1)", fg: "#3b82f6", border: "rgba(59, 130, 246, 0.2)" },
};

export function StatusBadge({
  label,
  variant = "default",
  "data-testid": dataTestId = "status-badge",
}: StatusBadgeProps): React.ReactElement {
  const colors = (VARIANT_COLORS[variant] ?? VARIANT_COLORS.default) as ColorSet;

  return (
    <span
      data-testid={dataTestId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.125rem 0.5rem",
        borderRadius: "999px",
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {label}
    </span>
  );
}

// ── Source Reference ───────────────────────────────────
interface SourceReferenceProps {
  label: string;
  reference: string;
  href?: string;
  "data-testid"?: string;
}

export function SourceReference({
  label,
  reference,
  href,
  "data-testid": dataTestId = "source-reference",
}: SourceReferenceProps): React.ReactElement {
  return (
    <span
      data-testid={dataTestId}
      style={{ fontSize: "var(--font-size-xs)", color: "var(--fg-tertiary)" }}
    >
      {label}:{" "}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}
        >
          {reference}
        </a>
      ) : (
        <code style={{ color: "var(--fg-secondary)", fontFamily: "var(--font-mono)" }}>
          {reference}
        </code>
      )}
    </span>
  );
}

// ── Timestamp Display ──────────────────────────────────
interface TimestampDisplayProps {
  timestamp: string;
  format?: "relative" | "full" | "date" | "time";
  "data-testid"?: string;
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function TimestampDisplay({
  timestamp,
  format = "relative",
  "data-testid": dataTestId = "timestamp-display",
}: TimestampDisplayProps): React.ReactElement {
  const date = new Date(timestamp);

  let display: string;
  switch (format) {
    case "relative":
      display = formatRelativeTime(timestamp);
      break;
    case "full":
      display = date.toLocaleString();
      break;
    case "date":
      display = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      break;
    case "time":
      display = date.toLocaleTimeString();
      break;
  }

  return (
    <time
      dateTime={timestamp}
      data-testid={dataTestId}
      className="text-tertiary"
      style={{ fontSize: "var(--font-size-xs)" }}
    >
      {display}
    </time>
  );
}
