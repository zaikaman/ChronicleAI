// Recent activity panels component
// Displays recent publications and payment activity

import type React from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";

// ── Alert Panel ──────────────────────────────────────────

interface AlertEntry {
  id: string;
  title: string;
  summary: string;
  deliveryStatus: string;
  publishedAt: string;
}

interface AlertActivityPanelProps {
  alerts: AlertEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function AlertActivityPanel({
  alerts,
  isLoading = false,
  "data-testid": dataTestId = "alert-activity-panel",
}: AlertActivityPanelProps): React.ReactElement {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading alerts...
        </p>
      </div>
    );
  }

  return (
    <div data-testid={dataTestId}>
      <h4
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--fg-primary)",
          marginBottom: "0.75rem",
        }}
      >
        Recent Alerts
      </h4>

      {alerts.length === 0 ? (
        <div
          style={{
            padding: "1rem",
            textAlign: "center",
            background: "var(--bg-glass)",
            borderRadius: "8px",
            border: "1px solid var(--border-primary)",
          }}
        >
          <p style={{ color: "var(--fg-tertiary)", margin: 0, fontSize: "var(--font-size-xs)" }}>
            No alerts published yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {alerts.slice(0, 5).map((alert) => (
            <div
              key={alert.id}
              style={{
                padding: "0.75rem",
                background: "var(--bg-glass)",
                borderRadius: "8px",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  marginBottom: "0.25rem",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 500,
                    color: "var(--fg-primary)",
                    lineHeight: 1.3,
                  }}
                >
                  {alert.title}
                </span>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <StatusBadge label={alert.deliveryStatus} variant="info" />
                  <TimestampDisplay timestamp={alert.publishedAt} format="relative" />
                </div>
              </div>
              <p
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--fg-secondary)",
                  margin: 0,
                  lineHeight: 1.4,
                }}
              >
                {alert.summary.slice(0, 100)}
                {alert.summary.length > 100 ? "..." : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Digest Panel ─────────────────────────────────────────

interface DigestEntry {
  id: string;
  title: string;
  reportDate: string;
  publicationStatus: string;
}

interface DigestActivityPanelProps {
  digests: DigestEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function DigestActivityPanel({
  digests,
  isLoading = false,
  "data-testid": dataTestId = "digest-activity-panel",
}: DigestActivityPanelProps): React.ReactElement {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading digests...
        </p>
      </div>
    );
  }

  return (
    <div data-testid={dataTestId}>
      <h4
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--fg-primary)",
          marginBottom: "0.75rem",
        }}
      >
        Recent Digests
      </h4>

      {digests.length === 0 ? (
        <div
          style={{
            padding: "1rem",
            textAlign: "center",
            background: "var(--bg-glass)",
            borderRadius: "8px",
            border: "1px solid var(--border-primary)",
          }}
        >
          <p style={{ color: "var(--fg-tertiary)", margin: 0, fontSize: "var(--font-size-xs)" }}>
            No digests published yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {digests.slice(0, 5).map((digest) => (
            <div
              key={digest.id}
              style={{
                padding: "0.75rem",
                background: "var(--bg-glass)",
                borderRadius: "8px",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 500,
                    color: "var(--fg-primary)",
                  }}
                >
                  {digest.title.slice(0, 50)}
                </span>
                <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                  <StatusBadge label={digest.publicationStatus} variant="info" />
                  <span style={{ fontSize: "var(--font-size-xs)", color: "var(--fg-tertiary)" }}>
                    {new Date(digest.reportDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payment Panel ────────────────────────────────────────

interface PaymentEntry {
  id: string;
  paymentRoute: string;
  status: string;
  premiumItemId: string;
}

interface PaymentActivityPanelProps {
  payments: PaymentEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

function PaymentActivityPanel({
  payments,
  isLoading = false,
  "data-testid": dataTestId = "payment-activity-panel",
}: PaymentActivityPanelProps): React.ReactElement {
  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--fg-tertiary)", fontSize: "var(--font-size-sm)" }}>
          Loading payments...
        </p>
      </div>
    );
  }

  return (
    <div data-testid={dataTestId}>
      <h4
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--fg-primary)",
          marginBottom: "0.75rem",
        }}
      >
        Payment Activity
      </h4>

      {payments.length === 0 ? (
        <div
          style={{
            padding: "1rem",
            textAlign: "center",
            background: "var(--bg-glass)",
            borderRadius: "8px",
            border: "1px solid var(--border-primary)",
          }}
        >
          <p style={{ color: "var(--fg-tertiary)", margin: 0, fontSize: "var(--font-size-xs)" }}>
            No payment activity yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {payments.slice(0, 5).map((payment) => (
            <div
              key={payment.id}
              style={{
                padding: "0.75rem",
                background: "var(--bg-glass)",
                borderRadius: "8px",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <StatusBadge label={payment.paymentRoute.toUpperCase()} variant="info" />
                  <span
                    style={{
                      fontSize: "var(--font-size-xs)",
                      color: "var(--fg-tertiary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {payment.premiumItemId.slice(0, 12)}...
                  </span>
                </div>
                <StatusBadge
                  label={payment.status}
                  variant={
                    payment.status === "settled"
                      ? "success"
                      : payment.status === "failed" || payment.status === "expired"
                        ? "error"
                        : "warning"
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Combined Export ──────────────────────────────────────

interface CombinedActivityPanelsProps {
  alerts: AlertEntry[];
  digests: DigestEntry[];
  payments: PaymentEntry[];
  isLoading?: boolean;
  "data-testid"?: string;
}

export function RecentActivityPanels({
  alerts,
  digests,
  payments,
  isLoading = false,
  "data-testid": dataTestId = "recent-activity-panels",
}: CombinedActivityPanelsProps): React.ReactElement {
  return (
    <div data-testid={dataTestId}>
      <h3
        style={{
          fontSize: "var(--font-size-md)",
          fontWeight: 600,
          color: "var(--fg-primary)",
          marginBottom: "1rem",
        }}
      >
        Recent Activity
      </h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1.5rem",
        }}
      >
        <AlertActivityPanel alerts={alerts} isLoading={isLoading} />
        <DigestActivityPanel digests={digests} isLoading={isLoading} />
        <PaymentActivityPanel payments={payments} isLoading={isLoading} />
      </div>
    </div>
  );
}
