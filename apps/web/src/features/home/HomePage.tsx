// Home page with latest alerts preview

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { AlertCard } from "../alerts/AlertCard.tsx";
import { useAlerts } from "../alerts/use-alerts.ts";
import { useLatestDigest } from "../digests/use-latest-digest.ts";
import { usePremiumTeasers } from "../premium/use-premium.ts";
import { PremiumTeaserCard } from "../premium/PremiumTeaserCard.tsx";

export function HomePage(): ReactElement {
  const { alerts, isLoading, error, refetch } = useAlerts(3);
  const { state: digestState } = useLatestDigest();
  const { items: premiumItems, isLoading: premiumLoading } = usePremiumTeasers();

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
          Autonomous on-chain intelligence monitoring, alert publication, and daily market intelligence
          anchored with on-chain proof-of-publication.
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
            to="/digests/latest"
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
            Latest Digest
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

      {/* Latest Digest Preview Section */}
      <section style={{ marginBottom: "3rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600 }}>Latest Digest</h2>
          <Link
            to="/digests/latest"
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--accent-primary)",
              textDecoration: "none",
            }}
          >
            View full digest &rarr;
          </Link>
        </div>

        {digestState.status === "loading" ? (
          <LoadingState message="Loading latest digest..." />
        ) : digestState.status === "not-found" ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              background: "var(--bg-glass)",
              borderRadius: "8px",
              border: "1px solid var(--border-primary)",
            }}
          >
            <p style={{ color: "var(--fg-tertiary)", margin: 0 }}>
              No daily digest published yet. Digests are generated on schedule.
            </p>
          </div>
        ) : digestState.status === "error" ? (
          <RetryState title="Digest unavailable" message={digestState.error} onRetry={() => {}} />
        ) : (
          <div
            style={{
              padding: "1.5rem",
              background: "var(--bg-glass)",
              borderRadius: "8px",
              border: "1px solid var(--border-primary)",
            }}
          >
            <h3
              style={{
                fontSize: "var(--font-size-md)",
                fontWeight: 600,
                marginBottom: "0.5rem",
                color: "var(--fg-primary)",
              }}
            >
              {digestState.data.title}
            </h3>
            <p
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--fg-secondary)",
                lineHeight: 1.5,
                marginBottom: "1rem",
              }}
            >
              {digestState.data.summary.slice(0, 200)}...
            </p>
            {digestState.data.registryTxHash && (
              <div
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--fg-tertiary)",
                  fontFamily: "monospace",
                }}
              >
                Registry: {digestState.data.registryTxHash.slice(0, 10)}...
              </div>
            )}
          </div>
        )}
      </section>

      {/* Premium Intelligence Teasers Section */}
      <section style={{ marginBottom: "3rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600 }}>Premium Intelligence</h2>
          <Link
            to="/premium"
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--accent-primary)",
              textDecoration: "none",
            }}
          >
            Browse all &rarr;
          </Link>
        </div>

        {premiumLoading ? (
          <LoadingState message="Loading premium items..." />
        ) : premiumItems.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              background: "var(--bg-glass)",
              borderRadius: "8px",
              border: "1px solid var(--border-primary)",
            }}
          >
            <p style={{ color: "var(--fg-tertiary)", margin: 0 }}>
              Premium intelligence items coming soon. Subscribe to access deep analysis and sponsored monitoring.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "1rem",
            }}
          >
            {premiumItems.slice(0, 2).map((item) => (
              <PremiumTeaserCard
                key={item.id}
                item={item}
                onAccess={() => {}}
              />
            ))}
          </div>
        )}
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
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600 }}>Latest Alerts</h2>
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
          <RetryState title="Failed to load alerts" message={error} onRetry={refetch} />
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
