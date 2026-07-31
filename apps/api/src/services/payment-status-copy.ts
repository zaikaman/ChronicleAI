import type { PaymentRecordRow } from "@chronicleai/db";

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
    useGrouping: false,
  }).format(amount);
}

function getFailureMessage(logDetails: unknown, logMessage: string | null | undefined): string {
  if (logDetails && typeof logDetails === "object" && !Array.isArray(logDetails)) {
    const errorMessage = (logDetails as { errorMessage?: unknown }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.trim()) return errorMessage;
  }
  return logMessage ?? "";
}

/**
 * Convert internal settlement diagnostics into concise copy safe for the public
 * Activity feed. Do not expose facilitator URLs, wallet addresses, or raw RPC
 * errors to anonymous readers.
 */
export function paymentFailureReason(
  payment: Pick<
    PaymentRecordRow,
    "status" | "amount_requested" | "amount_settled" | "currency" | "payment_route"
  >,
  diagnostic?: { details?: unknown; message?: string | null },
): string | undefined {
  const currency = payment.currency ?? "USDC";

  if (payment.status === "expired") {
    return "The payment window expired before the charge was completed.";
  }

  if (payment.status === "underpaid") {
    const requested = payment.amount_requested;
    const settled = payment.amount_settled;
    if (typeof requested === "number" && typeof settled === "number") {
      return `The payer sent ${formatAmount(settled)} ${currency}, but ${formatAmount(requested)} ${currency} was required.`;
    }
    return `The payer sent less ${currency} than this item requires.`;
  }

  if (payment.status !== "failed") return undefined;

  const rawMessage = getFailureMessage(diagnostic?.details, diagnostic?.message).toLowerCase();

  if (
    /insufficient|not enough|exceeds? (?:the )?(?:available )?balance|balance is too low|insufficient funds/.test(
      rawMessage,
    ) &&
    (payment.payment_route === "x402" || /usdc|token|payment|transfer/.test(rawMessage))
  ) {
    return `The payer wallet did not have enough ${currency} to cover this charge.`;
  }

  if (/user rejected|user denied|rejected the request|cancelled|canceled/.test(rawMessage)) {
    return "The wallet rejected or cancelled the payment.";
  }

  if (/signature|eip-712|authorization|nonce|invalid payer/.test(rawMessage)) {
    return "The wallet authorization could not be verified. Start a new payment attempt and sign the fresh request.";
  }

  if (/expired/.test(rawMessage)) {
    return "The payment window expired before the charge was completed.";
  }

  return `The ${payment.payment_route.toUpperCase()} payment was not completed. Check the payer wallet and try again.`;
}
