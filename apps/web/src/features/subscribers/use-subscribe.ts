// Paid monthly x402 newsletter subscribe (footer CTA)
// Flow: email → connect wallet → issue challenge → EIP-712 sign → settle → entitlement

import { useCallback, useEffect, useRef, useState } from "react";
import { isEvmAddress, signX402Settlement, useWallet } from "../wallet";
import { API_BASE, fetchWithTimeout } from "../../lib/api.ts";
import { attributeReferralOnConnect, getStoredReferralRef } from "../../lib/referral.ts";

/** Matches server default NEWSLETTER_MONTHLY_PRICE_USDC. */
export const DEFAULT_NEWSLETTER_PRICE_USDC = 2;

export type SubscribeStep =
  | "idle"
  | "connecting"
  | "challenging"
  | "signing"
  | "settling"
  | "success"
  | "error";

export interface NewsletterSubscriptionSummary {
  id: string;
  email: string;
  status: string;
  currentPeriodEnd?: string | null;
  amountPerPeriod?: number;
  currency?: string;
}

export interface UseSubscribeResult {
  step: SubscribeStep;
  message: string | null;
  /** Display price (from last challenge or default 2 USDC). */
  priceAmount: number;
  priceCurrency: string;
  subscription: NewsletterSubscriptionSummary | null;
  /** True while any non-idle/success/error network or wallet step is running. */
  isBusy: boolean;
  /**
   * Start paid newsletter: connect wallet if needed, pay x402 (monthly USDC), activate entitlement.
   */
  subscribe: (email: string) => Promise<boolean>;
  reset: () => void;
}

function isValidEmail(email: string): boolean {
  // Practical client-side check; server validates strictly.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseErrorBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err.trim();
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

/**
 * If stored referral looks like an EVM address, pass it as referralAddress.
 * Affiliate codes are handled via first-touch attribution on wallet connect.
 */
function resolveReferralAddress(): string | undefined {
  const ref = getStoredReferralRef();
  if (ref && isEvmAddress(ref)) {
    return ref.toLowerCase();
  }
  return undefined;
}

export function useSubscribe(): UseSubscribeResult {
  const wallet = useWallet();
  const [step, setStep] = useState<SubscribeStep>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [priceAmount, setPriceAmount] = useState(DEFAULT_NEWSLETTER_PRICE_USDC);
  const [priceCurrency, setPriceCurrency] = useState("USDC");
  const [subscription, setSubscription] = useState<NewsletterSubscriptionSummary | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setStep("idle");
    setMessage(null);
    setSubscription(null);
    setPriceAmount(DEFAULT_NEWSLETTER_PRICE_USDC);
    setPriceCurrency("USDC");
  }, []);

  const subscribe = useCallback(
    async (email: string): Promise<boolean> => {
      const trimmed = email.trim();
      if (!trimmed) {
        setStep("error");
        setMessage("Please enter your email address.");
        return false;
      }
      if (!isValidEmail(trimmed)) {
        setStep("error");
        setMessage("Please enter a valid email address.");
        return false;
      }

      setMessage(null);
      setSubscription(null);

      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;

      try {
        // 1. Connect wallet
        let payer = wallet.address && isEvmAddress(wallet.address) ? wallet.address : null;
        if (!payer) {
          setStep("connecting");
          setMessage(`Connect a wallet to pay ${DEFAULT_NEWSLETTER_PRICE_USDC} USDC with x402…`);
          const connected = await wallet.connect();
          if (!isEvmAddress(connected)) {
            setStep("error");
            setMessage("Wallet did not return a valid account.");
            return false;
          }
          payer = connected;
        }

        void attributeReferralOnConnect(payer, wallet.signMessage);

        try {
          await wallet.ensureChain();
        } catch (err) {
          setStep("error");
          setMessage(
            err instanceof Error
              ? err.message
              : `Switch your wallet to ${wallet.targetChain.name} to continue.`,
          );
          return false;
        }

        // 2. Issue recurring newsletter challenge
        setStep("challenging");
        setMessage("Creating x402 payment challenge…");

        const referralAddress = resolveReferralAddress();
        const challengeResponse = await fetchWithTimeout(
          `${API_BASE}/subscribers/newsletter/subscribe`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              email: trimmed,
              payerReference: payer,
              ...(referralAddress ? { referralAddress } : {}),
            }),
          },
        );

        const challengeBody = (await challengeResponse.json().catch(() => ({}))) as {
          error?: string;
          challengeReference?: string;
          amountRequested?: number;
          currency?: string;
          challengeData?: Record<string, unknown>;
          paymentRecordId?: string;
          subscriptionId?: string;
          status?: string;
          expiresAt?: string;
        };

        if (!challengeResponse.ok) {
          setStep("error");
          setMessage(
            parseErrorBody(
              challengeBody,
              challengeResponse.status === 503
                ? "Newsletter payments are temporarily unavailable."
                : "Could not start newsletter subscription.",
            ),
          );
          return false;
        }

        const challengeReference = challengeBody.challengeReference;
        const nestedChallenge = challengeBody.challengeData;
        if (!challengeReference || !nestedChallenge) {
          setStep("error");
          setMessage("Server returned an incomplete payment challenge.");
          return false;
        }

        if (
          typeof challengeBody.amountRequested === "number" &&
          Number.isFinite(challengeBody.amountRequested) &&
          challengeBody.amountRequested > 0
        ) {
          setPriceAmount(challengeBody.amountRequested);
        }
        if (challengeBody.currency) {
          setPriceCurrency(challengeBody.currency);
        }

        // 3. Sign EIP-712 authorization
        setStep("signing");
        setMessage(
          `Approve ${challengeBody.amountRequested ?? DEFAULT_NEWSLETTER_PRICE_USDC} ${challengeBody.currency ?? "USDC"} in your wallet…`,
        );

        if (!nestedChallenge.domain || !nestedChallenge.types || !nestedChallenge.message) {
          setStep("error");
          setMessage("Challenge is missing EIP-712 typed data for x402 settlement.");
          return false;
        }

        const settlementReference = await signX402Settlement(nestedChallenge, wallet);

        // 4. Settle → activate entitlement
        setStep("settling");
        setMessage("Settling payment and activating your subscription…");

        const settleResponse = await fetchWithTimeout(
          `${API_BASE}/subscribers/newsletter/settlements`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              challengeReference,
              settlementReference,
            }),
          },
        );

        const settleBody = (await settleResponse.json().catch(() => ({}))) as {
          settled?: boolean;
          error?: string;
          paymentRecordId?: string;
          subscription?: {
            id?: string;
            email?: string;
            status?: string;
            currentPeriodEnd?: string | null;
            amountPerPeriod?: number;
            currency?: string;
          };
          verification?: {
            amountSettled?: number;
            currency?: string;
            errorMessage?: string;
          };
        };

        if (!settleResponse.ok || !settleBody.settled) {
          setStep("error");
          setMessage(
            settleBody.error ??
              settleBody.verification?.errorMessage ??
              parseErrorBody(settleBody, "Payment settlement failed."),
          );
          return false;
        }

        const sub = settleBody.subscription;
        const amountPerPeriod = sub?.amountPerPeriod;
        const currency =
          sub?.currency ?? settleBody.verification?.currency ?? "USDC";
        const summary: NewsletterSubscriptionSummary = {
          id: sub?.id ?? challengeBody.subscriptionId ?? "",
          email: sub?.email ?? trimmed,
          status: sub?.status ?? "active",
          currentPeriodEnd: sub?.currentPeriodEnd ?? null,
          ...(amountPerPeriod !== undefined ? { amountPerPeriod } : {}),
          ...(currency !== undefined ? { currency } : {}),
        };
        setSubscription(summary);

        const periodHint = summary.currentPeriodEnd
          ? ` Active through ${new Date(summary.currentPeriodEnd).toLocaleDateString()}.`
          : "";
        const paid =
          settleBody.verification?.amountSettled ??
          challengeBody.amountRequested ??
          DEFAULT_NEWSLETTER_PRICE_USDC;
        const cur = settleBody.verification?.currency ?? challengeBody.currency ?? "USDC";

        setStep("success");
        setMessage(
          `Subscribed — ${paid} ${cur}/month settled. Daily digests will go to ${summary.email}.${periodHint}`,
        );
        return true;
      } catch (err) {
        if (controller.signal.aborted) return false;
        setStep("error");
        setMessage(err instanceof Error ? err.message : "Subscription failed. Please try again.");
        return false;
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
        }
      }
    },
    [wallet],
  );

  const isBusy =
    step === "connecting" ||
    step === "challenging" ||
    step === "signing" ||
    step === "settling";

  return {
    step,
    message,
    priceAmount,
    priceCurrency,
    subscription,
    isBusy,
    subscribe,
    reset,
  };
}
