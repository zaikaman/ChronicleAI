// Premium teaser card component

import type { PremiumItemTeaserResponse } from "@chronicleai/schemas";
import type React from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";

interface PremiumTeaserCardProps {
  item: PremiumItemTeaserResponse;
  onAccess: (itemId: string) => void;
  "data-testid"?: string;
}

export function PremiumTeaserCard({
  item,
  onAccess,
  "data-testid": dataTestId = "premium-teaser-card",
}: PremiumTeaserCardProps): React.ReactElement {
  return (
    <div
      className="card"
      data-testid={dataTestId}
      style={{
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        cursor: "default",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 20px rgba(99, 102, 241, 0.15)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
          gap: "1rem",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: "var(--fg-primary)",
            lineHeight: 1.3,
          }}
        >
          {item.title}
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, flexWrap: "wrap" }}>
          {item.paymentRoutes.map((route) => (
            <StatusBadge
              key={route}
              label={route.toUpperCase()}
              variant="info"
            />
          ))}
        </div>
      </div>

      <p
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--fg-secondary)",
          lineHeight: 1.6,
          marginBottom: "1rem",
        }}
      >
        {item.summaryPublic}
      </p>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "var(--font-size-sm)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.25rem" }}>
          <span
            style={{
              fontSize: "var(--font-size-xl)",
              fontWeight: 700,
              color: "var(--accent-primary)",
            }}
          >
            {item.priceAmount}
          </span>
          <span style={{ color: "var(--fg-tertiary)" }}>{item.priceCurrency}</span>
        </div>

        <button
          type="button"
          onClick={() => onAccess(item.id)}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--accent-primary)",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--accent-primary-hover)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--accent-primary)";
          }}
          data-testid={`access-btn-${item.id}`}
        >
          Access
        </button>
      </div>
    </div>
  );
}
