// ChronicleAI Newspaper-style homepage — the self-hosted publication landing page

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import { AlertCard } from "../alerts/AlertCard.tsx";
import { useAlerts } from "../alerts/use-alerts.ts";
import { useLatestDigest } from "../digests/use-latest-digest.ts";
import { PremiumTeaserCard } from "../premium/PremiumTeaserCard.tsx";
import { usePremiumTeasers } from "../premium/use-premium.ts";

export function HomePage(): ReactElement {
  const { alerts, isLoading, error, refetch } = useAlerts(5);
  const { state: digestState } = useLatestDigest();
  const { items: premiumItems, isLoading: premiumLoading } = usePremiumTeasers();

  return (
    <div className="newspaper-layout">
      {/* ── Newspaper Masthead ─────────────────────────── */}
      <header className="newspaper-masthead">
        <div className="masthead-accent-line" />
        <h1 className="masthead-title">ChronicleAI</h1>
        <p className="masthead-subtitle">
          Autonomous On-Chain Intelligence &mdash; Daily Market Report
        </p>
        <div className="masthead-meta">
          <span>{new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          <span className="masthead-dot">&bull;</span>
          <span>Edition #1</span>
          <span className="masthead-dot">&bull;</span>
          <span>Anchored on Ethereum Sepolia</span>
        </div>
        <div className="masthead-quicknav">
          <Link to="/alerts" className="quicknav-link">Alerts</Link>
          <Link to="/digests/latest" className="quicknav-link">Digest</Link>
          <Link to="/publications" className="quicknav-link">Archive</Link>
          <Link to="/premium" className="quicknav-link">Premium</Link>
        </div>
        <div className="masthead-accent-line" />
      </header>

      {/* ── Lead Story: Latest Digest ──────────────────── */}
      <section className="newspaper-lead-story">
        <div className="lead-story-label">Today's Intelligence Report</div>

        {digestState.status === "loading" ? (
          <LoadingState message="Loading today's report..." />
        ) : digestState.status === "not-found" ? (
          <div className="lead-story-empty">
            <h2>No Report Published Yet</h2>
            <p>The first daily intelligence digest will appear here once generated. ChronicleAI monitors on-chain activity around the clock.</p>
          </div>
        ) : digestState.status === "error" ? (
          <RetryState title="Report unavailable" message={digestState.error} onRetry={() => {}} />
        ) : (
          <article className="lead-story-article">
            <h2 className="lead-story-headline">{digestState.data.title}</h2>
            <div className="lead-story-byline">
              <span>ChronicleAI Intelligence Desk</span>
              <span className="masthead-dot">&bull;</span>
              <span>{digestState.data.publishedAt ? new Date(digestState.data.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : digestState.data.reportDate}</span>
              {digestState.data.registryTxHash && (
                <>
                  <span className="masthead-dot">&bull;</span>
                  <a href={`https://sepolia.basescan.org/tx/${digestState.data.registryTxHash}`} target="_blank" rel="noopener noreferrer" className="on-chain-proof-link">
                    On-Chain Proof
                  </a>
                </>
              )}
            </div>
            <p className="lead-story-summary">{digestState.data.summary}</p>
            {digestState.data.highlights.length > 0 && (
              <ul className="lead-story-highlights">
                {digestState.data.highlights.slice(0, 3).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            <Link to="/digests/latest" className="lead-story-cta">
              Read Full Report &rarr;
            </Link>
          </article>
        )}
      </section>

      {/* ── Two-Column Layout ──────────────────────────── */}
      <div className="newspaper-two-column">
        {/* Left Column: Latest Alerts */}
        <section className="newspaper-column">
          <div className="column-header">
            <h2>Market Alerts</h2>
            <Link to="/alerts" className="column-header-link">View All &rarr;</Link>
          </div>

          {isLoading ? (
            <LoadingState message="Loading alerts..." />
          ) : error ? (
            <RetryState title="Failed to load alerts" message={error} onRetry={refetch} />
          ) : alerts.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              description="Alerts will appear when significant on-chain events are detected."
            />
          ) : (
            <div className="alerts-news-feed">
              {alerts.map((alert) => (
                <article key={alert.id} className="alert-news-item">
                  <div className="alert-news-header">
                    <StatusBadge label={alert.deliveryStatus} variant={alert.deliveryStatus === "published" ? "success" : "default"} />
                    {alert.publishedAt && <TimestampDisplay timestamp={alert.publishedAt} />}
                  </div>
                  <h3 className="alert-news-title">{alert.title}</h3>
                  <p className="alert-news-summary">{alert.summary}</p>
                  <div className="alert-news-footer">
                    {alert.generationProvider && (
                      <span className="alert-news-provider">Generated by <code>{alert.generationProvider}</code></span>
                    )}
                    {alert.confidence && (
                      <StatusBadge label={`${alert.confidence} confidence`} variant={alert.confidence === "high" ? "success" : alert.confidence === "medium" ? "warning" : "error"} />
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Right Column: Premium & Info */}
        <aside className="newspaper-sidebar">
          {/* Premium Intelligence */}
          <div className="sidebar-section">
            <h3>Premium Intelligence</h3>
            {premiumLoading ? (
              <LoadingState message="Loading..." />
            ) : premiumItems.length === 0 ? (
              <p className="sidebar-empty">Premium content coming soon.</p>
            ) : (
              <div className="sidebar-premium-items">
                {premiumItems.slice(0, 2).map((item) => (
                  <PremiumTeaserCard key={item.id} item={item} onAccess={() => {}} />
                ))}
              </div>
            )}
            <Link to="/premium" className="sidebar-link">Browse All Premium &rarr;</Link>
          </div>

          {/* On-Chain Registry Info */}
          <div className="sidebar-section">
            <h3>Verification</h3>
            <p className="sidebar-text">
              All published content is anchored on the Ethereum Sepolia testnet via the Chronicle Registry smart contract. Each alert and digest carries an on-chain proof-of-publication.
            </p>
            {digestState.status === "success" && digestState.data.registryTxHash && (
              <div className="sidebar-registry-hash">
                <span className="sidebar-label">Latest Registry Tx:</span>
                <a href={`https://sepolia.basescan.org/tx/${digestState.data.registryTxHash}`} target="_blank" rel="noopener noreferrer" className="sidebar-hash-link">
                  {digestState.data.registryTxHash.slice(0, 16)}...
                </a>
              </div>
            )}
          </div>

          {/* About ChronicleAI */}
          <div className="sidebar-section">
            <h3>About ChronicleAI</h3>
            <p className="sidebar-text">
              An autonomous on-chain agent that monitors blockchain activity, generates market intelligence, and publishes verified reports. Operates as a circular economy, funding its own operations through x402 and MPP micropayments.
            </p>
            <Link to="/operator" className="sidebar-link">Operator Dashboard &rarr;</Link>
          </div>
        </aside>
      </div>

      {/* ── Bottom Banner ──────────────────────────────── */}
      <footer className="newspaper-footer">
        <div className="newspaper-footer-accent" />
        <div className="newspaper-footer-content">
          <span className="newspaper-footer-brand">ChronicleAI</span>
          <span>Autonomous On-Chain Intelligence</span>
          <span className="masthead-dot">&bull;</span>
          <span>Powered by KeeperHub &amp; Chronicle Registry</span>
        </div>
        <div className="newspaper-footer-accent" />
      </footer>
    </div>
  );
}
