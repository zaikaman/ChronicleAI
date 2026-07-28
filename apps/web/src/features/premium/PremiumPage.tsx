import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Page, PageHeader, PageSection } from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { AgentPaymentsPanel } from "./AgentPaymentsPanel.tsx";
import { PaymentChallengePanel } from "./PaymentChallengePanel.tsx";
import { PremiumContentView } from "./PremiumContentView.tsx";
import { PremiumTeaserCard } from "./PremiumTeaserCard.tsx";
import { SponsoredWatchList } from "./SponsoredWatchList.tsx";
import { SponsoredWatchRequestForm } from "./SponsoredWatchRequestForm.tsx";
import {
  loadPremiumAccessReceipt,
  storePremiumAccessReceipt,
  usePremiumItemAccess,
  usePremiumTeasers,
  useSponsoredWatches,
} from "./use-premium.ts";

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
  const {
    watches: sponsoredWatches,
    isLoading: watchesLoading,
    refetch: refetchWatches,
  } = useSponsoredWatches();

  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [currentItemTitle, setCurrentItemTitle] = useState("");
  const [currentItemPrice, setCurrentItemPrice] = useState(0);
  const [currentItemCurrency, setCurrentItemCurrency] = useState("USDC");
  const [showContent, setShowContent] = useState(false);
  const [settledPaymentId, setSettledPaymentId] = useState<string | null>(null);
  /** Re-render when receipts are stored so cards flip to Purchased. */
  const [receiptVersion, setReceiptVersion] = useState(0);
  /** Expand agent MPP guide (dual CTA + panel toggle). */
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const unlockedIds = useMemo(() => {
    void receiptVersion;
    const ids = new Set<string>();
    for (const item of items) {
      if (loadPremiumAccessReceipt(item.id)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [items, receiptVersion]);

  // Prefer server 402 challenge amounts when present; otherwise keep teaser price.
  useEffect(() => {
    if (!paymentChallenge) {
      return;
    }
    if (
      typeof paymentChallenge.amountRequested === "number" &&
      Number.isFinite(paymentChallenge.amountRequested) &&
      paymentChallenge.amountRequested > 0
    ) {
      setCurrentItemPrice(paymentChallenge.amountRequested);
    }
    if (paymentChallenge.currency) {
      setCurrentItemCurrency(paymentChallenge.currency);
    }
  }, [paymentChallenge]);

  // Open the report panel when paid content arrives (no setState-during-render).
  useEffect(() => {
    if (premiumContent && !isAccessLoading) {
      setShowContent(true);
    }
  }, [premiumContent, isAccessLoading]);

  const handleAccessItem = useCallback(
    async (itemId: string) => {
      setSelectedItemId(itemId);
      setShowPaymentPanel(false);
      setShowContent(false);
      setSettledPaymentId(null);

      const item = items.find((i) => i.id === itemId);
      if (item) {
        setCurrentItemTitle(item.title);
        setCurrentItemPrice(item.priceAmount);
        setCurrentItemCurrency(item.priceCurrency);
      }

      await accessItem(itemId);
    },
    [items, accessItem],
  );

  const handleShowPayment = useCallback(() => {
    setShowPaymentPanel(true);
    if (paymentChallenge) {
      if (
        typeof paymentChallenge.amountRequested === "number" &&
        Number.isFinite(paymentChallenge.amountRequested) &&
        paymentChallenge.amountRequested > 0
      ) {
        setCurrentItemPrice(paymentChallenge.amountRequested);
      }
      if (paymentChallenge.currency) {
        setCurrentItemCurrency(paymentChallenge.currency);
      }
    }
  }, [paymentChallenge]);

  const handleShowAgentGuide = useCallback(() => {
    setAgentGuideOpen(true);
    // Scroll after layout paints the expanded panel.
    window.requestAnimationFrame(() => {
      document.getElementById("agent-payments")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const handleSettled = useCallback(
    (paymentRecordId: string, accessReceipt?: string) => {
      setSettledPaymentId(paymentRecordId);
      setShowPaymentPanel(false);

      if (selectedItemId && accessReceipt) {
        storePremiumAccessReceipt(selectedItemId, accessReceipt);
        setReceiptVersion((v) => v + 1);
      }

      if (selectedItemId) {
        // Re-fetch with the signed receipt (not bare payer identity)
        window.setTimeout(() => {
          void accessItem(selectedItemId, accessReceipt);
        }, 400);
      }
    },
    [selectedItemId, accessItem],
  );

  const reportTitle =
    (premiumContent &&
      typeof premiumContent.title === "string" &&
      premiumContent.title.trim()) ||
    currentItemTitle;

  return (
    <Page data-testid="premium-page">
      <PageHeader
        title="Premium Intelligence"
        description="Unlock deep analysis, historical feeds, and sponsor contract monitoring. Humans pay with USDC via wallet (x402 on Base Sepolia). Desk operations run on Ethereum Sepolia; treasury rebalances via Circle CCTP. Agents pay the same catalog with MPP (Tempo HMAC) through the API."
        meta={
          !isLoading && !error ? (
            <span>
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
          ) : undefined
        }
        below={
          <>
            <StatusBadge label="x402 · wallet" variant="info" />
            <StatusBadge label="MPP · agent" variant="default" />
          </>
        }
      />

      <div className="mb-8" id="agent-payments">
        <AgentPaymentsPanel open={agentGuideOpen} onOpenChange={setAgentGuideOpen} />
      </div>

      {showContent && premiumContent ? (
        <div className="mb-8 scroll-mt-24" id="premium-unlocked-report">
          <PremiumContentView
            content={premiumContent}
            title={reportTitle}
            onClose={() => setShowContent(false)}
          />
        </div>
      ) : null}

      {showPaymentPanel && paymentChallenge ? (
        <div className="mb-8">
          <PaymentChallengePanel
            premiumItemId={paymentChallenge.premiumItemId}
            priceAmount={currentItemPrice}
            priceCurrency={currentItemCurrency}
            onSettled={handleSettled}
            onClose={() => setShowPaymentPanel(false)}
            onShowAgentGuide={handleShowAgentGuide}
          />
        </div>
      ) : null}

      {isPaymentRequired && !showPaymentPanel ? (
        <div
          className="p-6 sm:p-8 bg-frame border border-border rounded-2xl mb-8 text-center"
          data-testid="payment-required-cta"
        >
          <p className="text-muted-foreground text-sm mb-1">
            Payment is required to access this content.
          </p>
          <p className="text-xs text-muted-foreground mb-5 max-w-md mx-auto leading-relaxed">
            Wallet checkout uses x402. Automated agents should use MPP via the API guide below.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleShowPayment}
              className="px-5 py-2.5 bg-accent hover:opacity-90 text-black rounded-xl font-semibold text-sm cursor-pointer transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="pay-x402-cta"
            >
              Pay {currentItemPrice} {currentItemCurrency} with wallet (x402)
            </button>
            <button
              type="button"
              onClick={handleShowAgentGuide}
              className="px-5 py-2.5 border border-border bg-background hover:border-accent/40 text-foreground rounded-xl font-semibold text-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="pay-mpp-agent-cta"
            >
              Agent / MPP purchase
            </button>
          </div>
        </div>
      ) : null}

      {accessError && !isPaymentRequired ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl mb-6 text-rose-500 text-sm">
          {accessError}
        </div>
      ) : null}

      {settledPaymentId && !premiumContent && isAccessLoading ? (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl mb-6 text-emerald-600 dark:text-emerald-400 text-sm">
          Payment settled successfully. Unlocking content…
        </div>
      ) : null}

      <PageSection title="Available items">
        {isLoading ? (
          <LoadingState
            message="Loading premium items..."
            variant="grid"
            count={4}
            data-testid="premium-loading"
          />
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
            description="Premium intelligence items will appear here when clusters and digests mint paid reports. Each item supports x402 (wallet) and MPP (agent) rails when productized."
            data-testid="premium-empty"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <PremiumTeaserCard
                key={item.id}
                item={item}
                unlocked={unlockedIds.has(item.id)}
                isLoading={isAccessLoading && selectedItemId === item.id}
                onAccess={handleAccessItem}
                data-testid={`premium-card-${item.id}`}
              />
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Request a sponsored watch"
        description="Submit any contract address and campaign window. Humans settle via x402; agents can use MPP on the same product endpoints. KeeperHub writes create and report receipts on-chain."
        className="pt-2 border-t border-border"
      >
        <SponsoredWatchRequestForm
          onSettled={() => {
            void refetchWatches();
          }}
        />
      </PageSection>

      <PageSection
        title="Sponsored campaigns"
        description="Contract watches with dual on-chain audit trails — create and report transactions."
        className="pt-2 border-t border-border"
      >
        <SponsoredWatchList watches={sponsoredWatches} isLoading={watchesLoading} />
      </PageSection>
    </Page>
  );
}
