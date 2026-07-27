// Payment challenge panel component
// Shows payment route selection and real settlement (wallet EIP-712 / MPP HMAC)

import { type ReactElement, useMemo, useState } from "react";
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

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function getEthereum(): EthereumProvider | null {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return eth ?? null;
}

/**
 * Build an EIP-712 typed-data payload and sign it with the connected wallet.
 */
async function signX402Settlement(
  challengeData: Record<string, unknown>,
): Promise<string> {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error(
      "No EVM wallet detected. Install a wallet extension (e.g. MetaMask) or paste a signed EIP-712 JSON settlement.",
    );
  }

  const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts[0];
  if (!from) {
    throw new Error("Wallet did not return an account");
  }

  const domain = challengeData.domain as Record<string, unknown>;
  const types = challengeData.types as {
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };
  const message = {
    ...(challengeData.message as Record<string, unknown>),
    from,
  };

  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: types.TransferWithAuthorization,
    },
    primaryType: "TransferWithAuthorization",
    domain,
    message,
  };

  const signature = (await ethereum.request({
    method: "eth_signTypedData_v4",
    params: [from, JSON.stringify(typedData)],
  })) as string;

  return JSON.stringify({
    signature,
    from,
    to: message.to,
    value: message.value,
    validAfter: message.validAfter,
    validBefore: message.validBefore,
    nonce: message.nonce,
  });
}

/**
 * Compute MPP settlement reference using the shared client secret.
 * Machine clients set VITE_MPP_CLIENT_SECRET to the same value as server MPP_SECRET.
 */
async function buildMppSettlement(
  challengeReference: string,
  amountRequested: number,
  currency: string,
  expiresAt: string,
  clientSecret: string,
): Promise<string> {
  const payload = `${challengeReference}|${amountRequested}|${currency}|${expiresAt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hmac = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${expiresAt}:${hmac}`;
}

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
  const [manualSettlement, setManualSettlement] = useState("");
  const [mppClientSecret, setMppClientSecret] = useState(
    () => import.meta.env.VITE_MPP_CLIENT_SECRET ?? "",
  );

  const hasWallet = useMemo(() => typeof window !== "undefined" && !!getEthereum(), []);

  const handleCreateChallenge = async () => {
    if (!selectedRoute) return;

    setStep("challenging");
    setErrorMessage("");
    setManualSettlement("");

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

  const resolveSettlementReference = async (): Promise<string> => {
    if (manualSettlement.trim()) {
      return manualSettlement.trim();
    }

    if (!challengeData || !selectedRoute) {
      throw new Error("Challenge is not ready");
    }

    if (selectedRoute === "x402") {
      const nested = challengeData.challengeData as Record<string, unknown> | undefined;
      if (!nested?.domain || !nested?.types || !nested?.message) {
        throw new Error("Challenge is missing EIP-712 typed data for x402 settlement");
      }
      return signX402Settlement(nested);
    }

    // MPP: compute HMAC with shared client secret
    const secret = mppClientSecret.trim();
    if (!secret) {
      throw new Error(
        "MPP requires a client secret (VITE_MPP_CLIENT_SECRET) or a pasted settlement reference (expiresAt:hmac).",
      );
    }

    return buildMppSettlement(
      challengeData.challengeReference as string,
      (challengeData.amountRequested as number) ?? priceAmount,
      (challengeData.currency as string) ?? priceCurrency,
      challengeData.expiresAt as string,
      secret,
    );
  };

  const handleSettle = async () => {
    if (!challengeData) return;

    setStep("settling");
    setErrorMessage("");

    try {
      const settlementRef = await resolveSettlementReference();

      const result = await settlePayment({
        challengeReference: challengeData.challengeReference as string,
        settlementReference: settlementRef,
        paymentRoute: selectedRoute ?? "x402",
      });

      if (result && result.settled) {
        setStep("settled");
        onSettled(result.paymentRecordId as string);

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
              EVM EIP-712 subscription payment (wallet signature required)
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
              Machine-to-machine HMAC micro-billing
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

      {step === "challenging" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 0.75rem" }} />
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
            Creating payment challenge...
          </p>
        </div>
      )}

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

          {selectedRoute === "mpp" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--fg-tertiary)",
                  marginBottom: "0.25rem",
                }}
              >
                MPP client secret (same as server MPP_SECRET)
              </label>
              <input
                type="password"
                value={mppClientSecret}
                onChange={(e) => setMppClientSecret(e.target.value)}
                placeholder="Shared HMAC secret"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border-primary)",
                  background: "var(--bg-glass)",
                  color: "var(--fg-primary)",
                  fontSize: "var(--font-size-sm)",
                  marginBottom: "0.5rem",
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: "0.75rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-tertiary)",
                marginBottom: "0.25rem",
              }}
            >
              {selectedRoute === "x402"
                ? "Or paste signed EIP-712 JSON settlement"
                : "Or paste settlement reference (expiresAt:hmac)"}
            </label>
            <textarea
              value={manualSettlement}
              onChange={(e) => setManualSettlement(e.target.value)}
              rows={3}
              placeholder={
                selectedRoute === "x402"
                  ? '{"signature":"0x...","from":"0x...","to":"0x...","value":...,"validAfter":0,"validBefore":...,"nonce":"0x..."}'
                  : "2026-07-27T12:00:00.000Z:abcdef..."
              }
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "6px",
                border: "1px solid var(--border-primary)",
                background: "var(--bg-glass)",
                color: "var(--fg-primary)",
                fontSize: "var(--font-size-xs)",
                fontFamily: "var(--font-mono)",
                resize: "vertical",
              }}
            />
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
            {manualSettlement.trim()
              ? "Submit Settlement"
              : selectedRoute === "x402"
                ? hasWallet
                  ? "Sign & Settle with Wallet"
                  : "Submit Settlement (paste required)"
                : "Settle with HMAC Secret"}
          </button>

          {selectedRoute === "x402" && !hasWallet && !manualSettlement.trim() && (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-tertiary)",
              }}
            >
              No wallet detected. Paste a signed EIP-712 settlement JSON above, or install a
              browser wallet.
            </p>
          )}
        </div>
      )}

      {step === "settling" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 0.75rem" }} />
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
            Processing settlement...
          </p>
        </div>
      )}

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
            onClick={() => setStep(challengeData ? "challenge_ready" : "select")}
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
