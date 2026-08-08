import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Page, PageHeader, PageSection } from "../../components/page-chrome.tsx";
import { PaginationControls } from "../../components/pagination-controls.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { SubscriptionAnalyticsPanel } from "../activity/SubscriptionAnalyticsPanel.tsx";
import { useAgentActivity } from "../activity/use-agent-activity.ts";
import { CHRONICLE_PASS_PRICE_USDC } from "../subscription/use-subscription.ts";
import { useWallet } from "../wallet";
import { AgentPaymentsPanel } from "./AgentPaymentsPanel.tsx";
import { PaymentRequiredModal } from "./PaymentRequiredModal.tsx";
import { PremiumContentView } from "./PremiumContentView.tsx";
import { PremiumTeaserCard, isPassCoveredContentType } from "./PremiumTeaserCard.tsx";
import {
  loadPremiumAccessReceipt,
  storePremiumAccessReceipt,
  usePremiumItemAccess,
  usePremiumTeasers,
} from "./use-premium.ts";

export function PremiumPage(): ReactElement {
  const wallet = useWallet();
  const { data: activityData } = useAgentActivity();
  const {
    items,
    unlockedItemIds,
    pagination: itemsPagination,
    setPage: setItemsPage,
    isLoading,
    error,
    refetch,
    passEntitled,
  } = usePremiumTeasers(wallet.address ?? undefined, 12);
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
  const [paymentPromptDismissed, setPaymentPromptDismissed] = useState(false);
  /** Re-render when receipts are stored so cards flip to Purchased. */
  const [receiptVersion, setReceiptVersion] = useState(0);
  /** Expand agent MPP guide (dual CTA + panel toggle). */
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const unlockedIds = useMemo(() => {
    void receiptVersion;
    const ids = new Set<string>(unlockedItemIds);
    for (const item of items) {
      // Active Chronicle Pass unlocks every covered editorial item.
      if (
        passEntitled &&
        isPassCoveredContentType((item as { contentType?: string }).contentType)
      ) {
        ids.add(item.id);
      }
      if (loadPremiumAccessReceipt(item.id)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [items, unlockedItemIds, receiptVersion, passEntitled]);

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
        title="Premium intelligence"
        description="Deep dives, historical analysis, and the full editorial archive are included with Chronicle Pass — or buy any single report with your wallet. Sponsored watches and machine-readable feeds are priced separately."
        meta={
          !isLoading && !error ? (
            <span>
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
          ) : undefined
        }
        below={
          <>
            {passEntitled ? (
              <StatusBadge label="Chronicle Pass active" variant="success" />
            ) : (
              <StatusBadge label="Chronicle Pass · $4.99/mo" variant="info" />
            )}
            <StatusBadge label="Agent payments" variant="default" />
          </>
        }
      />

      {/* Chronicle Pass banner / upgrade CTA */}
      <div
        className={`mb-8 rounded-2xl border p-5 sm:p-6 ${
          passEntitled ? "border-emerald-500/30 bg-emerald-500/10" : "border-accent/30 bg-accent/5"
        }`}
        data-testid="pass-banner"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {passEntitled
                ? "Chronicle Pass active — every deep dive and the full archive are unlocked."
                : `Chronicle Pass — ${CHRONICLE_PASS_PRICE_USDC.toFixed(2)} USDC/month for every deep dive and the full archive.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {passEntitled
                ? "Your pass covers human editorial intelligence. Machine feeds and sponsored watches stay separate."
                : "Buy individual reports with your wallet (from 0.50 USDC), or get Chronicle Pass for every deep dive and the full archive."}
            </p>
          </div>
          {!passEntitled ? (
            <Link
              to="/subscription"
              className="shrink-0 inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              data-testid="pass-upgrade-link"
            >
              Get Chronicle Pass
            </Link>
          ) : (
            <Link
              to="/subscription"
              className="shrink-0 inline-flex items-center justify-center rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-accent/40"
              data-testid="pass-manage-link"
            >
              Manage subscription
            </Link>
          )}
        </div>
      </div>

      {activityData?.subscriptionAnalytics ? (
        <div className="mb-8">
          <SubscriptionAnalyticsPanel analytics={activityData.subscriptionAnalytics} />
        </div>
      ) : null}

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
            description="Paid reports appear here as ChronicleAI finds important patterns worth a deeper look."
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
                  passEntitled={passEntitled}
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
    </Page>
  );
}
