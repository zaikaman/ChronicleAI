// Payment challenge panel component
// Shows payment route selection and settlement feedback

import { type ReactElement, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { createPaymentChallenge, settlePayment } from "./use-premium.ts";

interface PaymentChallengePanelProps {
  premiumItemId: string;
  priceAmount: number;
  priceCurrency: string;
  onSettled: (paymentRecordId: string) => void;
  onClose: () => void;
  "data-testid"?: string;
}

type PaymentStep = "select" | "challenging" | "challenge_ready" | "settling" | "settled" | "error";

export function PaymentChallengePanel({
  premiumItemId,
  priceAmount,
  priceCurrency,
  onSettled,
  onClose,
  "data-testid": dataTestId = "payment-panel",
}: PaymentChallengePanelProps): ReactElement {
  const [selectedRoute, setSelectedRoute] = useState<"x402" | "mpp" | null>(null);
  const [step, setStep] = useState<PaymentStep>("select");
  const [challengeData, setChallengeData] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const handleCreateChallenge = async () => {
    if (!selectedRoute) return;

    setStep("challenging");
    setErrorMessage("");

    try {
      const result = await createPaymentChallenge({
        premiumItemId,
        paymentRoute: selectedRoute,
      });

      if (result) {
        setChallengeData(result);
        setStep("challenge_ready");
      } else {
        setStep("error");
        setErrorMessage("Failed to create challenge");
      }
    } catch (err) {
      setStep("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to create challenge");
    }
  };

  const handleSettle = async () => {
    if (!challengeData) return;

    setStep("settling");
    setErrorMessage("");

    try {
      const settlementRef =
        selectedRoute === "x402" ? `0xsettlement_${Date.now()}` : `mpp:hmac_${Date.now()}`;

      const result = await settlePayment({
        challengeReference: challengeData.challengeReference as string,
        settlementReference: settlementRef,
        paymentRoute: selectedRoute ?? "x402",
      });

      if (result && result.settled) {
        setStep("settled");
        onSettled(result.paymentRecordId as string);

        // Auto-close after 2 seconds
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setStep("error");
        setErrorMessage((result as { error?: string })?.error ?? "Settlement failed");
      }
    } catch (err) {
      setStep("error");
      setErrorMessage(err instanceof Error ? err.message : "Settlement failed");
    }
  };

  return (
    <div
      className="card"
      data-testid={dataTestId}
      style={{
        border: "1px solid var(--accent-primary)",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            color: "var(--fg-primary)",
          }}
        >
          Payment Required
        </h3>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--fg-tertiary)",
            cursor: "pointer",
            fontSize: "var(--font-size-lg)",
            padding: "0.25rem",
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.25rem",
            marginBottom: "0.5rem",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 700,
              color: "var(--accent-primary)",
            }}
          >
            {priceAmount}
          </span>
          <span style={{ color: "var(--fg-tertiary)" }}>{priceCurrency}</span>
        </div>
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
          Select a payment method to access this premium content.
        </p>
      </div>

      {/* Step: Select payment route */}
      {step === "select" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => setSelectedRoute("x402")}
            style={{
              padding: "0.75rem",
              background: selectedRoute === "x402" ? "var(--accent-primary)" : "var(--bg-glass)",
              color: selectedRoute === "x402" ? "white" : "var(--fg-primary)",
              border: `1px solid ${selectedRoute === "x402" ? "var(--accent-primary)" : "var(--border-primary)"}`,
              borderRadius: "8px",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>x402 (Base)</div>
            <div style={{ fontSize: "var(--font-size-xs)", opacity: 0.8 }}>
              EVM subscription payment on Base network
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedRoute("mpp")}
            style={{
              padding: "0.75rem",
              background: selectedRoute === "mpp" ? "var(--accent-primary)" : "var(--bg-glass)",
              color: selectedRoute === "mpp" ? "white" : "var(--fg-primary)",
              border: `1px solid ${selectedRoute === "mpp" ? "var(--accent-primary)" : "var(--border-primary)"}`,
              borderRadius: "8px",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>MPP (Tempo)</div>
            <div style={{ fontSize: "var(--font-size-xs)", opacity: 0.8 }}>
              Machine-to-machine micro-billing
            </div>
          </button>

          <button
            type="button"
            onClick={handleCreateChallenge}
            disabled={!selectedRoute}
            style={{
              padding: "0.75rem",
              background: selectedRoute ? "var(--accent-primary)" : "var(--bg-glass)",
              color: selectedRoute ? "white" : "var(--fg-tertiary)",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              cursor: selectedRoute ? "pointer" : "not-allowed",
              marginTop: "0.5rem",
              transition: "background 0.15s ease",
            }}
          >
            Continue with {selectedRoute?.toUpperCase() ?? "..."}
          </button>
        </div>
      )}

      {/* Step: Challenging */}
      {step === "challenging" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 0.75rem" }} />
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
            Creating payment challenge...
          </p>
        </div>
      )}

      {/* Step: Challenge ready */}
      {step === "challenge_ready" && challengeData && (
        <div>
          <div
            style={{
              padding: "0.75rem",
              background: "var(--bg-glass)",
              borderRadius: "8px",
              border: "1px solid var(--border-primary)",
              marginBottom: "1rem",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              wordBreak: "break-all",
            }}
          >
            <div style={{ marginBottom: "0.5rem" }}>
              <span style={{ color: "var(--fg-tertiary)" }}>Challenge: </span>
              <span style={{ color: "var(--fg-secondary)" }}>
                {challengeData.challengeReference as string}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--fg-tertiary)" }}>Expires: </span>
              <span style={{ color: "var(--fg-secondary)" }}>
                {new Date(challengeData.expiresAt as string).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSettle}
            style={{
              padding: "0.75rem",
              width: "100%",
              background: "var(--accent-primary)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--accent-primary-hover)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--accent-primary)";
            }}
          >
            Simulate Settlement
          </button>
        </div>
      )}

      {/* Step: Settling */}
      {step === "settling" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 0.75rem" }} />
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
            Processing settlement...
          </p>
        </div>
      )}

      {/* Step: Settled */}
      {step === "settled" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <StatusBadge label="Payment Settled" variant="success" />
          <p
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--fg-secondary)",
              marginTop: "0.75rem",
            }}
          >
            Content unlocked. Redirecting...
          </p>
        </div>
      )}

      {/* Step: Error */}
      {step === "error" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <StatusBadge label="Error" variant="error" />
          <p
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--fg-error)",
              marginTop: "0.75rem",
            }}
          >
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => setStep("select")}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--bg-glass)",
              color: "var(--fg-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "6px",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              marginTop: "0.75rem",
            }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
