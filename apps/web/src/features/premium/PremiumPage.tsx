// Premium page with item listing, payment gating, content display, and sponsored watch status

import { type ReactElement, useState, useCallback } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { PremiumTeaserCard } from "./PremiumTeaserCard.tsx";
import { PaymentChallengePanel } from "./PaymentChallengePanel.tsx";
import { PremiumContentView } from "./PremiumContentView.tsx";
import { SponsoredWatchList, type SponsoredWatchModel } from "./SponsoredWatchList.tsx";
import { usePremiumTeasers, usePremiumItemAccess } from "./use-premium.ts";

export function PremiumPage(): ReactElement {
  const { items, isLoading, error, refetch } = usePremiumTeasers();
  const {
    isLoading: isAccessLoading,
    error: accessError,
    data: premiumContent,
    accessItem,
    isPaymentRequired,
    paymentChallenge,
  } = usePremiumItemAccess();

  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [currentItemTitle, setCurrentItemTitle] = useState("");
  const [currentItemPrice, setCurrentItemPrice] = useState(0);
  const [currentItemCurrency, setCurrentItemCurrency] = useState("USDC");
  const [showContent, setShowContent] = useState(false);
  const [settledPaymentId, setSettledPaymentId] = useState<string | null>(null);

  // Mock sponsored watches for display
  const [sponsoredWatches] = useState<SponsoredWatchModel[]>([
    {
      id: "watch-demo-001",
      targetContract: "0x1234567890abcdef1234567890abcdef12345678",
      status: "monitoring",
      createTxHash: "0x" + "a".repeat(64),
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      endsAt: new Date(Date.now() + 6 * 86400000).toISOString(),
    },
    {
      id: "watch-demo-002",
      targetContract: "0xabcdef1234567890abcdef1234567890abcdef12",
      status: "completed",
      createTxHash: "0x" + "b".repeat(64),
      reportTxHash: "0x" + "c".repeat(64),
      startsAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      endsAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ]);

  const handleAccessItem = useCallback(
    async (itemId: string) => {
      setSelectedItemId(itemId);
      setShowPaymentPanel(false);
      setShowContent(false);
      setSettledPaymentId(null);

      const item = items.find((i) => i.id === itemId);
      if (item) {
        setCurrentItemTitle(item.title);
      }

      await accessItem(itemId);
    },
    [items, accessItem],
  );

  const handleShowPayment = useCallback(() => {
    setShowPaymentPanel(true);
    if (paymentChallenge) {
      setCurrentItemPrice(paymentChallenge.amountRequested);
      setCurrentItemCurrency(paymentChallenge.currency);
    }
  }, [paymentChallenge]);

  const handleSettled = useCallback(
    (paymentRecordId: string) => {
      setSettledPaymentId(paymentRecordId);
      setShowPaymentPanel(false);

      // After settlement, try to access the item again
      if (selectedItemId) {
        setTimeout(() => {
          accessItem(selectedItemId);
        }, 500);
      }
    },
    [selectedItemId, accessItem],
  );

  const handleViewContent = useCallback(() => {
    setShowContent(true);
  }, []);

  // Check if we should show content after settlement
  if (premiumContent && !showContent && isAccessLoading === false) {
    // Auto-show content when we have it
    setTimeout(() => setShowContent(true), 100);
  }

  return (
    <div data-testid="premium-page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, marginBottom: "0.5rem" }}>
            Premium Intelligence
          </h1>
          <p style={{ color: "var(--fg-secondary)", fontSize: "var(--font-size-sm)" }}>
            Unlock deep analysis, historical feeds, and sponsor contract monitoring
          </p>
        </div>
      </div>

      {/* Show premium content when unlocked */}
      {showContent && premiumContent && (
        <div style={{ marginBottom: "2rem" }}>
          <PremiumContentView
            content={premiumContent as Record<string, unknown>}
            title={currentItemTitle}
            onClose={() => setShowContent(false)}
          />
        </div>
      )}

      {/* Payment challenge panel */}
      {showPaymentPanel && paymentChallenge && (
        <div style={{ marginBottom: "2rem" }}>
          <PaymentChallengePanel
            premiumItemId={paymentChallenge.premiumItemId}
            priceAmount={currentItemPrice}
            priceCurrency={currentItemCurrency}
            onSettled={handleSettled}
            onClose={() => setShowPaymentPanel(false)}
          />
        </div>
      )}

      {/* Payment required state */}
      {isPaymentRequired && !showPaymentPanel && (
        <div
          style={{
            padding: "1.5rem",
            background: "var(--bg-glass)",
            borderRadius: "8px",
            border: "1px solid var(--border-primary)",
            marginBottom: "2rem",
            textAlign: "center",
          }}
        >
          <p style={{ color: "var(--fg-secondary)", marginBottom: "1rem" }}>
            Payment is required to access this content.
          </p>
          <button
            type="button"
            onClick={handleShowPayment}
            style={{
              padding: "0.75rem 1.5rem",
              background: "var(--accent-primary)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
            }}
          >
            Pay {currentItemPrice} {currentItemCurrency}
          </button>
        </div>
      )}

      {/* Access error */}
      {accessError && !isPaymentRequired && (
        <div
          style={{
            padding: "1rem",
            background: "rgba(239, 68, 68, 0.1)",
            borderRadius: "8px",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            marginBottom: "1rem",
            color: "var(--fg-error)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {accessError}
        </div>
      )}

      {/* Settled payment notification */}
      {settledPaymentId && !premiumContent && (
        <div
          style={{
            padding: "1rem",
            background: "rgba(34, 197, 94, 0.1)",
            borderRadius: "8px",
            border: "1px solid rgba(34, 197, 94, 0.3)",
            marginBottom: "1rem",
            color: "var(--fg-success)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          Payment settled successfully. Unlocking content...
        </div>
      )}

      {/* Premium items listing */}
      <section style={{ marginBottom: "3rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600 }}>Available Items</h2>
          <span className="text-tertiary" style={{ fontSize: "var(--font-size-sm)" }}>
            {items.length} item{items.length !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <LoadingState message="Loading premium items..." data-testid="premium-loading" />
        ) : error ? (
          <RetryState
            title="Failed to load premium items"
            message={error}
            onRetry={refetch}
            data-testid="premium-error"
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No premium items available"
            description="Premium intelligence items will appear here when they are published."
            data-testid="premium-empty"
          />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "1rem",
            }}
          >
            {items.map((item) => (
              <PremiumTeaserCard
                key={item.id}
                item={item}
                onAccess={handleAccessItem}
                data-testid={`premium-card-${item.id}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* Sponsored watches section */}
      <section>
        <SponsoredWatchList watches={sponsoredWatches} />
      </section>
    </div>
  );
}
