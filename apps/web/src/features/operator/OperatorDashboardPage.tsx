// Operator dashboard page
// Displays treasury status, metrics, recent activity, payout logs, and execution logs

import { type ReactElement, useMemo } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { ExecutionLogTable } from "./ExecutionLogTable.tsx";
import { OperatorMetricGrid } from "./OperatorMetricGrid.tsx";
import { PayoutLogsTable } from "./PayoutLogsTable.tsx";
import { RecentActivityPanels } from "./RecentActivityPanels.tsx";
import { TreasuryStatusPanel } from "./TreasuryStatusPanel.tsx";
import { useOperatorAudit } from "./use-operator-audit.ts";

export function OperatorDashboardPage(): ReactElement {
  const { data, isLoading, error, isUnauthenticated, refetch } = useOperatorAudit();

  // Calculate metrics from audit data
  const metrics = useMemo(() => {
    if (!data) return null;

    const totalRevenue =
      data.payments.filter((p) => p.status === "settled").reduce((sum, p) => sum + 1, 0) * 5; // Estimate $5 per settled payment

    return {
      totalRevenue,
      totalAlerts: data.alerts.length,
      totalDigests: data.digests.length,
      totalPaidRequests: data.payments.filter((p) => p.status === "settled").length,
      totalQualifiedEvents: data.alerts.length + 5, // Rough estimate
      estimatedGenerationCost: data.alerts.length * 0.5, // $0.50 per alert
      estimatedTransactionCost: data.alerts.length * 0.1 + data.digests.length * 0.2, // $0.10 per alert tx, $0.20 per digest tx
    };
  }, [data]);

  const executionLogs = useMemo(() => {
    if (!data) return [];
    return data.executionLogs.map((log) => ({
      id: log.id,
      actionType: log.actionType,
      entityType: log.entityType,
      entityId: log.entityId,
      status: log.status,
      message: log.message,
      createdAt: log.createdAt,
    }));
  }, [data]);

  const payoutEntries = useMemo(() => {
    if (!data || !data.payouts) return [];
    return data.payouts.map((p: any) => ({
      id: p.id,
      payoutPeriodHash: p.payoutPeriodHash,
      recipient: p.recipient,
      amount: p.amount,
      reasonHash: p.reasonHash,
      payoutTxHash: p.payoutTxHash,
      registryTxHash: p.registryTxHash,
      status: p.status,
      createdAt: p.createdAt,
    }));
  }, [data]);

  if (isUnauthenticated) {
    return (
      <div data-testid="operator-dashboard-page">
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            maxWidth: "500px",
            margin: "4rem auto",
          }}
        >
          <div
            style={{
              fontSize: "3rem",
              marginBottom: "1rem",
            }}
          >
            {"\u{1F512}"}
          </div>
          <h2
            style={{
              fontSize: "var(--font-size-xl)",
              fontWeight: 700,
              marginBottom: "0.5rem",
              color: "var(--fg-primary)",
            }}
          >
            Authentication Required
          </h2>
          <p
            style={{
              color: "var(--fg-secondary)",
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.6,
              marginBottom: "1.5rem",
            }}
          >
            The operator dashboard requires a valid authentication token. Please set the
            VITE_OPERATOR_TOKEN environment variable with your operator bearer token.
          </p>
          <p
            style={{
              color: "var(--fg-tertiary)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              padding: "0.75rem",
              background: "var(--bg-glass)",
              borderRadius: "8px",
              border: "1px solid var(--border-primary)",
            }}
          >
            VITE_OPERATOR_TOKEN=your_token_here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="operator-dashboard-page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 700,
              marginBottom: "0.5rem",
            }}
          >
            Operator Dashboard
          </h1>
          <p
            style={{
              color: "var(--fg-secondary)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            Monitor agent sustainability, revenue, costs, and execution health
          </p>
        </div>
      </div>

      {isLoading ? (
        <LoadingState message="Loading operator dashboard..." data-testid="dashboard-loading" />
      ) : error ? (
        <div style={{ marginBottom: "2rem" }}>
          <RetryState
            title="Failed to load dashboard"
            message={error}
            onRetry={refetch}
            data-testid="dashboard-error"
          />
        </div>
      ) : !data ? (
        <EmptyState
          title="No dashboard data"
          description="Operator dashboard data will appear here once the system has activity to report."
          data-testid="dashboard-empty"
        />
      ) : (
        <>
          {/* Treasury Status */}
          <section style={{ marginBottom: "2rem" }}>
            <TreasuryStatusPanel treasury={data.treasury} />
          </section>

          {/* Metric Grid */}
          {metrics && (
            <section style={{ marginBottom: "2rem" }}>
              <h2
                style={{
                  fontSize: "var(--font-size-lg)",
                  fontWeight: 600,
                  color: "var(--fg-primary)",
                  marginBottom: "1rem",
                }}
              >
                Key Metrics
              </h2>
              <OperatorMetricGrid metrics={metrics} />
            </section>
          )}

          {/* Recent Activity */}
          <section style={{ marginBottom: "2rem" }}>
            <RecentActivityPanels
              alerts={data.alerts}
              digests={data.digests.map((d) => ({
                id: d.id,
                title: d.title,
                reportDate: d.reportDate,
                publicationStatus: d.publicationStatus,
              }))}
              payments={data.payments.map((p) => ({
                id: p.id,
                paymentRoute: p.paymentRoute,
                status: p.status,
                premiumItemId: p.premiumItemId,
              }))}
            />
          </section>

          {/* Payout Logs */}
          <section style={{ marginBottom: "2rem" }}>
            <PayoutLogsTable payouts={payoutEntries} />
          </section>

          {/* Execution Logs */}
          <section style={{ marginBottom: "2rem" }}>
            <h2
              style={{
                fontSize: "var(--font-size-lg)",
                fontWeight: 600,
                color: "var(--fg-primary)",
                marginBottom: "1rem",
              }}
            >
              Execution Logs
            </h2>
            <ExecutionLogTable logs={executionLogs} />
          </section>
        </>
      )}
    </div>
  );
}
