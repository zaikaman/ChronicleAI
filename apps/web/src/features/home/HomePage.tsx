// Home page with latest alerts preview

import { Link } from "react-router-dom";
import { useAlerts } from "../alerts/use-alerts.ts";
import { AlertCard } from "../alerts/AlertCard.tsx";
import { LoadingState, EmptyState, RetryState } from "../../components/state-views.tsx";
import type { ReactElement } from "react";

export function HomePage(): ReactElement {
  const { alerts, isLoading, error, refetch } = useAlerts(3);

  return (
    <div>
      {/* Hero Section */}
      <section
        style={{
          textAlign: "center",
          padding: "4rem 2rem",
          marginBottom: "3rem",
        }}
      >
        <h1
          style={{
            fontSize: "var(--font-size-3xl)",
            fontWeight: 700,
            marginBottom: "1rem",
            background: "linear-gradient(135deg, #6366f1 0%, #818cf8 50%, #a78bfa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          ChronicleAI
        </h1>
        <p
          style={{
            fontSize: "var(--font-size-lg)",
            color: "var(--fg-secondary)",
            maxWidth: "600px",
            margin: "0 auto 2rem",
            lineHeight: 1.6,
          }}
        >
          Autonomous on-chain intelligence monitoring and alert publication.
          Real-time alerts for significant blockchain events.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
          <Link
            to="/alerts"
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--accent-primary)",
              color: "white",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              textDecoration: "none",
              transition: "background 0.15s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--accent-primary-hover)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--accent-primary)";
            }}
          >
            View Alerts
          </Link>
          <Link
            to="/premium"
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--bg-glass)",
              color: "var(--fg-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "8px",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--bg-glass-hover)";
              e.currentTarget.style.borderColor = "var(--border-hover)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--bg-glass)";
              e.currentTarget.style.borderColor = "var(--border-primary)";
            }}
          >
            Premium Intelligence
          </Link>
        </div>
      </section>

      {/* Latest Alerts Section */}
      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600 }}>
            Latest Alerts
          </h2>
          <Link
            to="/alerts"
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--accent-primary)",
              textDecoration: "none",
            }}
          >
            View all &rarr;
          </Link>
        </div>

        {isLoading ? (
          <LoadingState message="Loading latest alerts..." />
        ) : error ? (
          <RetryState
            title="Failed to load alerts"
            message={error}
            onRetry={refetch}
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            description="Monitoring active. Alerts will appear when significant on-chain events are detected."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
