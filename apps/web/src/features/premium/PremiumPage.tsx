import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Page, PageHeader, PageSection } from "../../components/page-chrome.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { useWallet } from "../wallet";
import { AgentPaymentsPanel } from "./AgentPaymentsPanel.tsx";
import { PaymentRequiredModal } from "./PaymentRequiredModal.tsx";
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
  const wallet = useWallet();
  const {
    items,
    unlockedItemIds,
    pagination: itemsPagination,
    setPage: setItemsPage,
    isLoading,
    error,
    refetch,
  } = usePremiumTeasers(wallet.address ?? undefined, 12);
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
    pagination: watchesPagination,
    setPage: setWatchesPage,
    isLoading: watchesLoading,
    refetch: refetchWatches,
  } = useSponsoredWatches(10);

  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [currentItemTitle, setCurrentItemTitle] = useState("");
  const [currentItemPrice, setCurrentItemPrice] = useState(0);
  const [currentItemCurrency, setCurrentItemCurrency] = useState("USDC");
  const [showContent, setShowContent] = useState(false);
  const [settledPaymentId, setSettledPaymentId] = useState<string | null>(null);
  const [paymentPromptDismissed, setPaymentPromptDismissed] = useState(false);
  /** Re-render when receipts are stored so cards flip to Purchased. */
  const [receiptVersion, setReceiptVersion] = useState(0);
  /** Expand agent MPP guide (dual CTA + panel toggle). */
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const unlockedIds = useMemo(() => {
    void receiptVersion;
    const ids = new Set<string>(unlockedItemIds);
    for (const item of items) {
      if (loadPremiumAccessReceipt(item.id)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [items, unlockedItemIds, receiptVersion]);

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

  useEffect(() => {
    if (!showContent || !premiumContent) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const report = document.getElementById("premium-unlocked-report");
      if (!report || typeof report.scrollIntoView !== "function") return;

      const prefersReducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      report.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showContent, premiumContent]);

  const handleAccessItem = useCallback(
    async (itemId: string) => {
      setSelectedItemId(itemId);
      setShowPaymentPanel(false);
      setShowContent(false);
      setSettledPaymentId(null);
      setPaymentPromptDismissed(false);

      const item = items.find((i) => i.id === itemId);
      if (item) {
        setCurrentItemTitle(item.title);
        setCurrentItemPrice(item.priceAmount);
        setCurrentItemCurrency(item.priceCurrency);
      }

      await accessItem(itemId, undefined, wallet.address ?? undefined);
    },
    [items, accessItem, wallet.address],
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
    setPaymentPromptDismissed(true);
    setShowPaymentPanel(false);
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
      setPaymentPromptDismissed(true);

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
    (premiumContent && typeof premiumContent.title === "string" && premiumContent.title.trim()) ||
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

      {paymentChallenge ? (
        <PaymentRequiredModal
          open={isPaymentRequired && !paymentPromptDismissed}
          showPaymentPanel={showPaymentPanel}
          itemTitle={currentItemTitle}
          priceAmount={currentItemPrice}
          priceCurrency={currentItemCurrency}
          paymentChallenge={paymentChallenge}
          onShowPayment={handleShowPayment}
          onShowAgentGuide={handleShowAgentGuide}
          onSettled={handleSettled}
          onClose={() => {
            setShowPaymentPanel(false);
            setPaymentPromptDismissed(true);
          }}
        />
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
          <>
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
            <PaginationControls
              pagination={itemsPagination}
              onPageChange={setItemsPage}
              disabled={isLoading}
              data-testid="premium-items-pagination"
            />
          </>
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
        <PaginationControls
          pagination={watchesPagination}
          onPageChange={setWatchesPage}
          disabled={watchesLoading}
          data-testid="sponsored-watches-pagination"
        />
      </PageSection>
    </Page>
  );
}
