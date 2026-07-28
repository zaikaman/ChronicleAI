// Payment challenge panel
// Route selection + real settlement (wallet EIP-712 for x402 / MPP paste for machines)
//
// Security: MPP_SECRET never ships to the browser. MPP is machine-to-machine;
// the browser only accepts a pre-computed settlement reference (expiresAt:hmac)
// produced by a server-side machine client that holds MPP_SECRET. Humans should
// use x402 (wallet signature).

import { type ReactElement, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { isEvmAddress, shortenAddress, useWallet } from "../wallet";
import { createPaymentChallenge, settlePayment } from "./use-premium.ts";

interface PaymentChallengePanelProps {
  premiumItemId: string;
  priceAmount: number;
  priceCurrency: string;
  onSettled: (paymentRecordId: string, accessReceipt?: string) => void;
  onClose: () => void;
  "data-testid"?: string;
}

type PaymentStep = "select" | "challenging" | "challenge_ready" | "settling" | "settled" | "error";

/**
 * Build an EIP-712 typed-data payload and sign it with the connected wallet.
 * Ensures the wallet is on the challenge chain before signing.
 */
async function signX402Settlement(
  challengeData: Record<string, unknown>,
  wallet: ReturnType<typeof useWallet>,
): Promise<string> {
  let from = wallet.address;
  if (!wallet.isConnected || !from) {
    from = await wallet.connect();
  }
  if (!from || !isEvmAddress(from)) {
    throw new Error("Wallet did not return a valid account.");
  }

  const domain = challengeData.domain as Record<string, unknown>;
  const types = challengeData.types as {
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };

  // Prefer chain from challenge domain so client and server stay aligned.
  const domainChainId =
    typeof domain.chainId === "number"
      ? domain.chainId
      : typeof domain.chainId === "string"
        ? Number(domain.chainId)
        : wallet.targetChain.chainId;

  if (Number.isInteger(domainChainId) && domainChainId > 0) {
    await wallet.ensureChain({
      ...wallet.targetChain,
      chainId: domainChainId,
      chainIdHex: `0x${domainChainId.toString(16)}`,
      name:
        domainChainId === wallet.targetChain.chainId
          ? wallet.targetChain.name
          : `Chain ${domainChainId}`,
    });
  } else {
    await wallet.ensureChain();
  }

  const message = {
    ...(challengeData.message as Record<string, unknown>),
    from,
  } as Record<string, unknown> & { from: string };

  // viem/wagmi signTypedData — do not include EIP712Domain in types
  const signature = await wallet.signTypedData({
    domain,
    types: {
      TransferWithAuthorization: types.TransferWithAuthorization,
    },
    primaryType: "TransferWithAuthorization",
    message,
  });

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

export function PaymentChallengePanel({
  premiumItemId,
  priceAmount,
  priceCurrency,
  onSettled,
  onClose,
  "data-testid": dataTestId = "payment-panel",
}: PaymentChallengePanelProps): ReactElement {
  const wallet = useWallet();
  const [selectedRoute, setSelectedRoute] = useState<"x402" | "mpp" | null>(null);
  const [step, setStep] = useState<PaymentStep>("select");
  const [challengeData, setChallengeData] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [manualSettlement, setManualSettlement] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleConnectWallet = async () => {
    setConnecting(true);
    setErrorMessage("");
    try {
      // Opens RainbowKit modal; resolves only after the user picks a wallet
      await wallet.connect();
      await wallet.ensureChain();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  };

  const handleCreateChallenge = async () => {
    if (!selectedRoute) return;

    let boundPayer: string | undefined =
      wallet.address && isEvmAddress(wallet.address) ? wallet.address : undefined;

    // x402 human path: open connect modal if needed, then bind payerReference
    if (selectedRoute === "x402" && !boundPayer) {
      try {
        setConnecting(true);
        const connected = await wallet.connect();
        if (isEvmAddress(connected)) {
          boundPayer = connected;
        }
      } catch (err) {
        setStep("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Connect a wallet to continue with x402",
        );
        return;
      } finally {
        setConnecting(false);
      }
    }

    setStep("challenging");
    setErrorMessage("");
    setManualSettlement("");

    try {
      const payerReference =
        selectedRoute === "x402" && boundPayer && isEvmAddress(boundPayer)
          ? boundPayer
          : undefined;

      const result = await createPaymentChallenge({
        premiumItemId,
        paymentRoute: selectedRoute,
        ...(payerReference ? { payerReference } : {}),
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
      return signX402Settlement(nested, wallet);
    }

    throw new Error(
      "MPP is machine-to-machine: paste a settlement reference (expiresAt:hmac) from a server-side machine client that holds MPP_SECRET. Humans should use x402 with a wallet.",
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
        const accessReceipt =
          typeof result.accessReceipt === "string" ? result.accessReceipt : undefined;
        onSettled(result.paymentRecordId as string, accessReceipt);

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

      {/* Wallet status strip */}
      <div
        data-testid="payment-wallet-status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.65rem 0.75rem",
          marginBottom: "1rem",
          borderRadius: "8px",
          border: "1px solid var(--border-primary)",
          background: "var(--bg-glass)",
          fontSize: "var(--font-size-xs)",
        }}
      >
        <div style={{ color: "var(--fg-secondary)", minWidth: 0 }}>
          {wallet.isConnected && wallet.address ? (
            <>
              <div style={{ fontWeight: 600, color: "var(--fg-primary)", marginBottom: "0.15rem" }}>
                Paying as {shortenAddress(wallet.address)}
              </div>
              <div>
                Network:{" "}
                {wallet.isCorrectChain
                  ? wallet.targetChain.name
                  : `Wrong network — switch to ${wallet.targetChain.name}`}
              </div>
            </>
          ) : (
            <span>
              Connect a wallet to pay with x402 (USDC on {wallet.targetChain.name}). Opens a
              wallet picker modal — nothing connects until you choose one.
            </span>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {!wallet.isConnected ? (
            <button
              type="button"
              onClick={handleConnectWallet}
              disabled={connecting}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                fontWeight: 600,
                fontSize: "var(--font-size-xs)",
                cursor: connecting ? "wait" : "pointer",
              }}
            >
              {connecting ? "Waiting…" : "Connect wallet"}
            </button>
          ) : !wallet.isCorrectChain ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  await wallet.ensureChain();
                } catch (err) {
                  setErrorMessage(err instanceof Error ? err.message : "Failed to switch network");
                }
              }}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                fontWeight: 600,
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
              }}
            >
              Switch network
            </button>
          ) : (
            <StatusBadge label="Ready" variant="success" />
          )}
        </div>
      </div>

      {step === "select" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => setSelectedRoute("x402")}
            style={{
              padding: "0.75rem",
              background: selectedRoute === "x402" ? "var(--accent-primary)" : "var(--bg-glass)",
              color: selectedRoute === "x402" ? "#0a0a0a" : "var(--fg-primary)",
              border: `1px solid ${selectedRoute === "x402" ? "var(--accent-primary)" : "var(--border-primary)"}`,
              borderRadius: "8px",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
              x402 ({wallet.targetChain.name})
            </div>
            <div style={{ fontSize: "var(--font-size-xs)", opacity: 0.8 }}>
              Pay with USDC via wallet EIP-712 authorization
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedRoute("mpp")}
            style={{
              padding: "0.75rem",
              background: selectedRoute === "mpp" ? "var(--accent-primary)" : "var(--bg-glass)",
              color: selectedRoute === "mpp" ? "#0a0a0a" : "var(--fg-primary)",
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
              Machine-to-machine HMAC (paste settlement from server-side client)
            </div>
          </button>

          <button
            type="button"
            onClick={handleCreateChallenge}
            disabled={!selectedRoute || connecting}
            style={{
              padding: "0.75rem",
              background: selectedRoute ? "var(--accent-primary)" : "var(--bg-glass)",
              color: selectedRoute ? "#0a0a0a" : "var(--fg-tertiary)",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              cursor: selectedRoute && !connecting ? "pointer" : "not-allowed",
              marginTop: "0.5rem",
              transition: "background 0.15s ease",
            }}
          >
            {connecting
              ? "Waiting for wallet…"
              : selectedRoute === "x402" && !wallet.isConnected
                ? "Connect wallet & continue"
                : `Continue with ${selectedRoute?.toUpperCase() ?? "..."}`}
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
            {wallet.address && selectedRoute === "x402" && (
              <div style={{ marginTop: "0.5rem" }}>
                <span style={{ color: "var(--fg-tertiary)" }}>Payer: </span>
                <span style={{ color: "var(--fg-secondary)" }}>{wallet.address}</span>
              </div>
            )}
          </div>

          {selectedRoute === "mpp" && (
            <p
              style={{
                marginBottom: "0.75rem",
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-secondary)",
                lineHeight: 1.45,
              }}
            >
              MPP uses a server-only shared secret (<code>MPP_SECRET</code>). The browser never
              receives it. Compute{" "}
              <code>HMAC-SHA256(challengeRef|amount|currency|expiresAt)</code> in a machine
              client and paste <code>expiresAt:hmac</code> below, or call{" "}
              <code>POST /payments/settlements</code> from that client directly.
            </p>
          )}

          {selectedRoute === "x402" && (
            <p
              style={{
                marginBottom: "0.75rem",
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-secondary)",
                lineHeight: 1.45,
              }}
            >
              Your wallet will sign a USDC <code>TransferWithAuthorization</code> for{" "}
              {priceAmount} {priceCurrency} on {wallet.targetChain.name}. No gas is required for
              the signature; settlement submits the authorization on-chain.
            </p>
          )}

          {(selectedRoute === "mpp" || showAdvanced) && (
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
                  : "Settlement reference (expiresAt:hmac) — required"}
              </label>
              <textarea
                value={manualSettlement}
                onChange={(e) => setManualSettlement(e.target.value)}
                rows={3}
                placeholder={
                  selectedRoute === "x402"
                    ? '{"signature":"0x...","from":"0x...","to":"0x...","value":...,"validAfter":0,"validBefore":...,"nonce":"0x..."}'
                    : "2026-07-28T12:00:00.000Z:abcdef..."
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
          )}

          {selectedRoute === "x402" && (
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                background: "none",
                border: "none",
                color: "var(--fg-tertiary)",
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
                padding: 0,
                marginBottom: "0.75rem",
                textDecoration: "underline",
              }}
            >
              {showAdvanced ? "Hide advanced paste" : "Advanced: paste signed settlement JSON"}
            </button>
          )}

          <button
            type="button"
            onClick={handleSettle}
            disabled={selectedRoute === "mpp" && !manualSettlement.trim()}
            style={{
              padding: "0.75rem",
              width: "100%",
              background:
                selectedRoute === "mpp" && !manualSettlement.trim()
                  ? "var(--bg-glass)"
                  : "var(--accent-primary)",
              color:
                selectedRoute === "mpp" && !manualSettlement.trim()
                  ? "var(--fg-tertiary)"
                  : "#0a0a0a",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "var(--font-size-sm)",
              cursor:
                selectedRoute === "mpp" && !manualSettlement.trim()
                  ? "not-allowed"
                  : "pointer",
              transition: "background 0.15s ease",
            }}
          >
            {manualSettlement.trim()
              ? "Submit Settlement"
              : selectedRoute === "x402"
                ? wallet.isConnected
                  ? "Sign & Settle with Wallet"
                  : "Connect, Sign & Settle"
                : "Paste MPP Settlement to Continue"}
          </button>

          {selectedRoute === "mpp" && !manualSettlement.trim() && (
            <p
              style={{
                marginTop: "0.5rem",
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-tertiary)",
              }}
            >
              Prefer x402 for human wallet payments. MPP settlements are produced by machine
              clients that hold the server-side <code>MPP_SECRET</code>.
            </p>
          )}
        </div>
      )}

      {step === "settling" && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <div className="loading-spinner" style={{ margin: "0 auto 0.75rem" }} />
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
            {selectedRoute === "x402"
              ? "Awaiting wallet signature and settling payment…"
              : "Processing settlement..."}
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
