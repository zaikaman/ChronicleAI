// Routing badge: Private route / Public — icon + text (not color-only).
// Product copy: private submission path, not "MEV-proof."

import type React from "react";

export type RoutingMode = "private_mempool" | "public" | string;

export interface RoutingBadgeProps {
  /** routing mode from execution log / ticket / payout. */
  routing?: RoutingMode | null;
  /** Prefer server-provided label when present. */
  label?: string | null;
  /**
   * When routing was only requested (routingApplied unknown), show
   * "Private route (requested)" unless an explicit label is provided.
   */
  routingApplied?: string | null;
  routingRequested?: string | null;
  "data-testid"?: string;
  className?: string;
}

function resolveLabel(props: RoutingBadgeProps): string {
  if (props.label && props.label.trim().length > 0) return props.label.trim();

  const mode =
    props.routing ??
    props.routingRequested ??
    (props.routingApplied === "private_mempool" ? "private_mempool" : null);

  if (!mode || mode === "public") return "Public";
  if (mode === "private_mempool") {
    if (
      props.routingApplied === "private_mempool" ||
      props.routingApplied === "public"
    ) {
      return props.routingApplied === "private_mempool"
        ? "Private route"
        : "Public";
    }
    // Requested but not confirmed applied
    if (props.routingApplied === "unknown" || props.routingApplied == null) {
      return "Private route (requested)";
    }
    return "Private route";
  }
  return String(mode);
}

function isPrivate(label: string): boolean {
  return label.toLowerCase().includes("private");
}

/**
 * Badge for Activity execution table, payouts, tickets.
 * Always includes text; optional lock/globe glyph for non-color-only a11y.
 */
export function RoutingBadge({
  routing,
  label,
  routingApplied,
  routingRequested,
  "data-testid": dataTestId = "routing-badge",
  className,
}: RoutingBadgeProps): React.ReactElement {
  const text = resolveLabel({
    routing,
    label,
    routingApplied,
    routingRequested,
  });
  const privateRoute = isPrivate(text);

  const colors = privateRoute
    ? {
        bg: "rgba(59, 130, 246, 0.1)",
        fg: "#60a5fa",
        border: "rgba(59, 130, 246, 0.25)",
      }
    : {
        bg: "rgba(113, 113, 122, 0.12)",
        fg: "#a1a1aa",
        border: "rgba(113, 113, 122, 0.2)",
      };

  return (
    <span
      data-testid={dataTestId}
      title={
        privateRoute
          ? "KeeperHub private submission path (Flashbots Protect · Sepolia)"
          : "Public mempool submission"
      }
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.125rem 0.5rem",
        borderRadius: "999px",
        fontSize: "var(--font-size-xs, 11px)",
        fontWeight: 500,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ fontSize: "0.7em", lineHeight: 1 }}>
        {privateRoute ? "🔒" : "○"}
      </span>
      <span>{text}</span>
    </span>
  );
}
