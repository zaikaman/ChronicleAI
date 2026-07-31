import { type ReactElement, useMemo } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import {
  MetaChip,
  Page,
  PageHeader,
  PageSection,
  Surface,
} from "../../components/page-chrome.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { useAlerts } from "../alerts/use-alerts.ts";
import { useDigests } from "../digests/use-digests.ts";
import { usePremiumTeasers } from "../premium/use-premium.ts";

interface PublicationCardProps {
  type: "digest" | "alert" | "premium";
  id: string;
  title: string;
  summary: string;
  date?: string;
  status?: string;
  href: string;
  meta: Record<string, string>;
}

const TYPE_STYLES: Record<
  PublicationCardProps["type"],
  { label: string; className: string }
> = {
  digest: {
    label: "Digest",
    className: "bg-accent/15 text-foreground border-accent/30",
  },
  alert: {
    label: "Alert",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25",
  },
  premium: {
    label: "Premium",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  },
};

function PublicationCard({
  type,
  id,
  title,
  summary,
  date,
  status,
  href,
  meta,
}: PublicationCardProps): ReactElement {
  const typeStyle = TYPE_STYLES[type];
  return (
    <Surface
      as="article"
      key={`${type}-${id}`}
      className="p-5 hover:border-accent/40 transition-colors duration-200"
    >
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${typeStyle.className}`}
        >
          {typeStyle.label}
        </span>
        <div className="flex items-center gap-3">
          {date ? <TimestampDisplay timestamp={date} /> : null}
          {status && status !== "available" ? (
            <StatusBadge
              label={status}
              variant={
                status === "published"
                  ? "success"
                  : status === "partial_failure"
                    ? "warning"
                    : "default"
              }
            />
          ) : null}
        </div>
      </div>

      <h3 className="text-lg font-semibold text-foreground mb-2 leading-snug">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed mb-4">{summary}</p>

      <div className="flex justify-between items-center flex-wrap gap-3 pt-4 border-t border-border/40">
        <div className="flex flex-wrap gap-2">
          {Object.entries(meta).map(([key, value]) => (
            <MetaChip key={key}>
              {key}: {value.length > 30 ? `${value.slice(0, 16)}…` : value}
            </MetaChip>
          ))}
        </div>
        <Link
          to={href}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          Read more →
        </Link>
      </div>
    </Surface>
  );
}

export function PublicationsPage(): ReactElement {
  const {
    alerts,
    pagination: alertsPagination,
    setPage: setAlertsPage,
    isLoading: alertsLoading,
    error: alertsError,
    refetch: refetchAlerts,
  } = useAlerts(15);
  const {
    digests,
    pagination: digestsPagination,
    setPage: setDigestsPage,
    isLoading: digestsLoading,
    error: digestsError,
    refetch: refetchDigests,
  } = useDigests(10);
  const {
    items: premiumItems,
    pagination: premiumPagination,
    setPage: setPremiumPage,
    isLoading: premiumLoading,
    error: premiumError,
    refetch: refetchPremium,
  } = usePremiumTeasers(undefined, 10);

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => alert.deliveryStatus !== "draft"),
    [alerts],
  );

  const totalCount =
    alertsPagination.total + digestsPagination.total + premiumPagination.total;
  const isLoading = alertsLoading || digestsLoading || premiumLoading;
  const hasError = alertsError || digestsError || premiumError;

  const refetchAll = () => {
    refetchAlerts();
    refetchDigests();
    refetchPremium();
  };

  return (
    <Page data-testid="publications-page">
      <PageHeader
        title="Publications Archive"
        description="The complete archive of ChronicleAI intelligence — public alerts, digests, and premium analysis."
        meta={
          !isLoading && !hasError ? (
            <span>
              {totalCount} item{totalCount !== 1 ? "s" : ""}
            </span>
          ) : undefined
        }
      />

      {hasError && visibleAlerts.length === 0 && digests.length === 0 && premiumItems.length === 0 ? (
        <RetryState
          title="Failed to load publications"
          message={alertsError ?? digestsError ?? premiumError ?? "Unknown error"}
          onRetry={refetchAll}
        />
      ) : (
        <div className="flex flex-col gap-10">
          <PageSection
            title="Public alerts"
            description="Real-time capital-flow and stress publications."
          >
            {alertsLoading && visibleAlerts.length === 0 ? (
              <LoadingState message="Loading alerts..." variant="cards" count={3} />
            ) : alertsError && visibleAlerts.length === 0 ? (
              <RetryState
                title="Failed to load alerts"
                message={alertsError}
                onRetry={refetchAlerts}
              />
            ) : visibleAlerts.length === 0 ? (
              <EmptyState
                title="No alerts yet"
                description="Public alerts will appear here once ChronicleAI publishes them."
              />
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {visibleAlerts.map((alert) => (
                    <PublicationCard
                      key={`alert-${alert.id}`}
                      type="alert"
                      id={alert.id}
                      title={alert.title}
                      summary={alert.summary}
                      date={alert.publishedAt}
                      status={alert.deliveryStatus}
                      href={`/alerts/${alert.id}`}
                      meta={{
                        ...(alert.generationProvider
                          ? { "Generated by": alert.generationProvider }
                          : {}),
                        ...(alert.confidence ? { Confidence: alert.confidence } : {}),
                        ...(alert.eventType
                          ? { Event: alert.eventType.replace(/_/g, " ") }
                          : {}),
                        ...(typeof alert.chainId === "number"
                          ? { Chain: String(alert.chainId) }
                          : {}),
                      }}
                    />
                  ))}
                </div>
                <PaginationControls
                  pagination={alertsPagination}
                  onPageChange={setAlertsPage}
                  disabled={alertsLoading}
                  data-testid="publications-alerts-pagination"
                />
              </>
            )}
          </PageSection>

          <PageSection
            title="Daily digests"
            description="Published market narratives with on-chain registry proofs."
          >
            {digestsLoading && digests.length === 0 ? (
              <LoadingState message="Loading digests..." variant="cards" count={3} />
            ) : digestsError && digests.length === 0 ? (
              <RetryState
                title="Failed to load digests"
                message={digestsError}
                onRetry={refetchDigests}
              />
            ) : digests.length === 0 ? (
              <EmptyState
                title="No digests yet"
                description="Daily digests will appear here once published."
              />
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {digests.map((digest) => (
                    <PublicationCard
                      key={`digest-${digest.id}`}
                      type="digest"
                      id={digest.id}
                      title={digest.title}
                      summary={digest.summary.slice(0, 200)}
                      date={digest.publishedAt ?? digest.reportDate}
                      status={digest.publicationStatus}
                      href={`/digests/${digest.id}`}
                      meta={{
                        ...(digest.registryTxHash
                          ? { "Registry Tx": digest.registryTxHash }
                          : {}),
                        ...(digest.keeperHubRunId
                          ? { "KeeperHub run": digest.keeperHubRunId }
                          : {}),
                      }}
                    />
                  ))}
                </div>
                <PaginationControls
                  pagination={digestsPagination}
                  onPageChange={setDigestsPage}
                  disabled={digestsLoading}
                  data-testid="publications-digests-pagination"
                />
              </>
            )}
          </PageSection>

          <PageSection
            title="Premium intelligence"
            description="Paid deep dives and productized reports."
          >
            {premiumLoading && premiumItems.length === 0 ? (
              <LoadingState message="Loading premium items..." variant="cards" count={3} />
            ) : premiumError && premiumItems.length === 0 ? (
              <RetryState
                title="Failed to load premium items"
                message={premiumError}
                onRetry={refetchPremium}
              />
            ) : premiumItems.length === 0 ? (
              <EmptyState
                title="No premium items yet"
                description="Premium analysis will appear here when productized."
              />
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {premiumItems.map((item) => (
                    <PublicationCard
                      key={`premium-${item.id}`}
                      type="premium"
                      id={item.id}
                      title={item.title}
                      summary={item.summaryPublic}
                      status="available"
                      href="/premium"
                      meta={{
                        Price: `${item.priceAmount} ${item.priceCurrency}`,
                      }}
                    />
                  ))}
                </div>
                <PaginationControls
                  pagination={premiumPagination}
                  onPageChange={setPremiumPage}
                  disabled={premiumLoading}
                  data-testid="publications-premium-pagination"
                />
              </>
            )}
          </PageSection>
        </div>
      )}
    </Page>
  );
}
