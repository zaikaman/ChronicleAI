import { type ReactElement, useCallback, useState } from "react";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { PaymentChallengePanel } from "./PaymentChallengePanel.tsx";
import { PremiumContentView } from "./PremiumContentView.tsx";
import { PremiumTeaserCard } from "./PremiumTeaserCard.tsx";
import { SponsoredWatchList } from "./SponsoredWatchList.tsx";
import { usePremiumItemAccess, usePremiumTeasers, useSponsoredWatches } from "./use-premium.ts";

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
  const { watches: sponsoredWatches } = useSponsoredWatches();

  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [currentItemTitle, setCurrentItemTitle] = useState("");
  const [currentItemPrice, setCurrentItemPrice] = useState(0);
  const [currentItemCurrency, setCurrentItemCurrency] = useState("USDC");
  const [showContent, setShowContent] = useState(false);
  const [settledPaymentId, setSettledPaymentId] = useState<string | null>(null);

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

  if (premiumContent && !showContent && isAccessLoading === false) {
    setTimeout(() => setShowContent(true), 100);
  }

  return (
    <div data-testid="premium-page" className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>
            Premium Intelligence
          </h1>
          <p className="text-muted-foreground text-sm">
            Unlock deep analysis, historical feeds, and sponsor contract monitoring campaigns.
          </p>
        </div>
      </div>

      {/* Show premium content when unlocked */}
      {showContent && premiumContent && (
        <div className="mb-8">
          <PremiumContentView
            content={premiumContent as Record<string, unknown>}
            title={currentItemTitle}
            onClose={() => setShowContent(false)}
          />
        </div>
      )}

      {/* Payment challenge panel */}
      {showPaymentPanel && paymentChallenge && (
        <div className="mb-8">
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
        <div className="p-8 bg-muted/20 border border-border rounded-2xl mb-8 text-center shadow-xs">
          <p className="text-muted-foreground mb-4">
            Payment is required to access this content.
          </p>
          <button
            type="button"
            onClick={handleShowPayment}
            className="px-6 py-3 bg-accent hover:bg-accent/80 text-black rounded-xl font-bold text-sm cursor-pointer transition-colors shadow-sm"
          >
            Pay {currentItemPrice} {currentItemCurrency}
          </button>
        </div>
      )}

      {/* Access error */}
      {accessError && !isPaymentRequired && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl mb-6 text-rose-500 text-sm">
          {accessError}
        </div>
      )}

      {/* Settled payment notification */}
      {settledPaymentId && !premiumContent && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl mb-6 text-emerald-500 text-sm">
          Payment settled successfully. Unlocking content...
        </div>
      )}

      {/* Premium items listing */}
      <section className="mb-12">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-foreground">Available Items</h2>
          <span className="text-muted-foreground text-sm font-medium">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
      <section className="mt-12 pt-8 border-t border-border/20">
        <SponsoredWatchList watches={sponsoredWatches} />
      </section>
    </div>
  );
}
