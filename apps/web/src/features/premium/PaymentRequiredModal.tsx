import { type MouseEvent, type ReactElement, useEffect, useRef } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { PaymentChallengePanel } from "./PaymentChallengePanel.tsx";
import type { PremiumItemAccessResult } from "./use-premium.ts";

type PaymentChallenge = NonNullable<PremiumItemAccessResult["paymentChallenge"]>;

interface PaymentRequiredModalProps {
  open: boolean;
  showPaymentPanel: boolean;
  itemTitle: string;
  priceAmount: number;
  priceCurrency: string;
  paymentChallenge: PaymentChallenge;
  onShowPayment: () => void;
  onShowAgentGuide: () => void;
  onSettled: (paymentRecordId: string, accessReceipt?: string) => void;
  onClose: () => void;
}

function formatPrice(amount: number): string {
  return Number.isFinite(amount) ? String(amount) : "0";
}

export function PaymentRequiredModal({
  open,
  showPaymentPanel,
  itemTitle,
  priceAmount,
  priceCurrency,
  paymentChallenge,
  onShowPayment,
  onShowAgentGuide,
  onSettled,
  onClose,
}: PaymentRequiredModalProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Payment required"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={handleBackdropClick}
      style={{ display: open ? "flex" : "none" }}
      className="fixed inset-0 m-0 flex h-full w-full max-w-none items-center justify-center bg-transparent p-4 text-foreground backdrop:bg-black/60 sm:p-6"
      data-testid="payment-required-modal"
    >
      {showPaymentPanel ? (
        <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto sm:max-h-[calc(100vh-3rem)]">
          <PaymentChallengePanel
            premiumItemId={paymentChallenge.premiumItemId}
            priceAmount={priceAmount}
            priceCurrency={priceCurrency}
            onSettled={onSettled}
            onClose={onClose}
            onShowAgentGuide={onShowAgentGuide}
          />
        </div>
      ) : (
        <div
          role="document"
          className="w-full max-w-md rounded-2xl border border-border bg-frame p-6 sm:p-8"
          data-testid="payment-required-cta"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <StatusBadge label="Premium report" variant="info" />
              <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-foreground">
                Unlock this report
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-xl leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Close payment dialog"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Choose a payment path to read the full analysis.
          </p>
          {itemTitle ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Unlock <span className="font-medium text-foreground">{itemTitle}</span> with a
              one-time payment.
            </p>
          ) : null}

          <div className="mt-6 flex items-baseline gap-2 border-y border-border py-4">
            <span className="text-3xl font-semibold tabular-nums tracking-tight text-accent">
              {formatPrice(priceAmount)}
            </span>
            <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {priceCurrency}
            </span>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={onShowPayment}
              className="w-full cursor-pointer rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="pay-x402-cta"
            >
              Pay {priceAmount} {priceCurrency} with wallet
            </button>
            <button
              type="button"
              onClick={onShowAgentGuide}
              className="w-full cursor-pointer rounded-xl border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="pay-mpp-agent-cta"
            >
              Agent/API purchase guide
            </button>
          </div>

          <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
            People can use the wallet checkout. Automated agents should use the API guide.
          </p>
        </div>
      )}
    </dialog>
  );
}
