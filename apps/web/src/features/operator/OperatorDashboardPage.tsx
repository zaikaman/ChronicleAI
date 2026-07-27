import { type ReactElement, useMemo } from "react";
import { Lock } from "lucide-react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { ExecutionLogTable } from "./ExecutionLogTable.tsx";
import { OperatorMetricGrid } from "./OperatorMetricGrid.tsx";
import { PayoutLogsTable } from "./PayoutLogsTable.tsx";
import { RecentActivityPanels } from "./RecentActivityPanels.tsx";
import { TreasuryStatusPanel } from "./TreasuryStatusPanel.tsx";
import { useOperatorAudit } from "./use-operator-audit.ts";

export function OperatorDashboardPage(): ReactElement {
  const { data, isLoading, error, isUnauthenticated, refetch } = useOperatorAudit();

  const metrics = useMemo(() => {
    if (!data) return null;

    const totalRevenue =
      data.payments.filter((p) => p.status === "settled").reduce((sum, p) => sum + 1, 0) * 5;

    return {
      totalRevenue,
      totalAlerts: data.alerts.length,
      totalDigests: data.digests.length,
      totalPaidRequests: data.payments.filter((p) => p.status === "settled").length,
      totalQualifiedEvents: data.alerts.length + 5,
      estimatedGenerationCost: data.alerts.length * 0.5,
      estimatedTransactionCost: data.alerts.length * 0.1 + data.digests.length * 0.2,
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
        <div className="max-w-md mx-auto my-16 text-center bg-frame border border-border p-8 rounded-2xl shadow-sm flex flex-col items-center">
          <Lock className="w-12 h-12 text-accent mb-6" />
          <h2 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>
            Authentication Required
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            The operator dashboard requires a valid authentication token. Please set the
            VITE_OPERATOR_TOKEN environment variable with your operator bearer token.
          </p>
          <p className="text-xs font-mono p-4 bg-muted border border-border rounded-xl text-foreground break-all select-all">
            VITE_OPERATOR_TOKEN=your_token_here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="operator-dashboard-page" className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>
            Operator Console
          </h1>
          <p className="text-muted-foreground text-sm">
            Monitor agent sustainability, revenue, costs, and execution health
          </p>
        </div>
      </div>

      {isLoading ? (
        <LoadingState message="Loading operator dashboard..." data-testid="dashboard-loading" />
      ) : error ? (
        <div className="mb-8">
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
        <div className="flex flex-col gap-8">
          {/* Treasury Status */}
          <section>
            <TreasuryStatusPanel treasury={data.treasury} />
          </section>

          {/* Metric Grid */}
          {metrics && (
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-4">
                Key Metrics
              </h2>
              <OperatorMetricGrid metrics={metrics} />
            </section>
          )}

          {/* Recent Activity */}
          <section>
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
          <section>
            <PayoutLogsTable payouts={payoutEntries} />
          </section>

          {/* Execution Logs */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Execution Logs
            </h2>
            <ExecutionLogTable logs={executionLogs} />
          </section>
        </div>
      )}
    </div>
  );
}
