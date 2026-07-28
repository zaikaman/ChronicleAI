// Payment challenge panel — human wallet path via x402 only.
// Machine-to-machine MPP remains available on the API; surface a link to the agent guide.

import { type ReactElement, useState } from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { isEvmAddress, shortenAddress, signX402Settlement, useWallet } from "../wallet";
import { createPaymentChallenge, settlePayment } from "./use-premium.ts";

const WEB_PAYMENT_ROUTE = "x402" as const;

interface PaymentChallengePanelProps {
  premiumItemId: string;
  priceAmount: number;
  priceCurrency: string;
  onSettled: (paymentRecordId: string, accessReceipt?: string) => void;
  onClose: () => void;
  /** Opens the page-level agent / MPP discovery panel (no fake MPP checkout). */
  onShowAgentGuide?: () => void;
  "data-testid"?: string;
}

type PaymentStep =
  | "select"
  | "challenging"
  | "challenge_ready"
  | "settling"
  | "settled"
  | "error";

export function PaymentChallengePanel({
  premiumItemId,
  priceAmount,
  priceCurrency,
  onSettled,
  onClose,
  onShowAgentGuide,
  "data-testid": dataTestId = "payment-panel",
}: PaymentChallengePanelProps): ReactElement {
  const wallet = useWallet();
  const [step, setStep] = useState<PaymentStep>("select");
  const [challengeData, setChallengeData] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [manualSettlement, setManualSettlement] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [premiumReceiptTx, setPremiumReceiptTx] = useState<string | null>(null);
  const [premiumReceiptExplorer, setPremiumReceiptExplorer] = useState<string | null>(null);

  const [switchingNetwork, setSwitchingNetwork] = useState(false);

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

  const handleSwitchNetwork = async () => {
    setSwitchingNetwork(true);
    setErrorMessage("");
    try {
      await wallet.ensureChain();
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : `Switch your wallet to ${wallet.targetChain.name} to continue.`,
      );
    } finally {
      setSwitchingNetwork(false);
    }
  };

  /**
   * Base Sepolia (or configured X402 target) is mandatory for x402 checkout.
   * Connect if needed, then force the correct chain before any payment step.
   * Challenge EIP-712 domain is authoritative when signing settlement.
   */
  const ensureReadyForPayment = async (): Promise<string> => {
    let boundPayer: string | undefined =
      wallet.address && isEvmAddress(wallet.address) ? wallet.address : undefined;

    if (!boundPayer) {
      setConnecting(true);
      try {
        const connected = await wallet.connect();
        if (!isEvmAddress(connected)) {
          throw new Error("Connect a wallet to continue with x402");
        }
        boundPayer = connected;
      } finally {
        setConnecting(false);
      }
    }

    try {
      await wallet.ensureChain();
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : `You must be on ${wallet.targetChain.name} to pay with x402.`,
      );
    }

    return boundPayer;
  };

  const handleCreateChallenge = async () => {
    setErrorMessage("");
    setManualSettlement("");

    let boundPayer: string;
    try {
      boundPayer = await ensureReadyForPayment();
    } catch (err) {
      setStep("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Connect a wallet to continue with x402",
      );
      return;
    }

    setStep("challenging");

    try {
      const result = await createPaymentChallenge({
        premiumItemId,
        paymentRoute: WEB_PAYMENT_ROUTE,
        payerReference: boundPayer,
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

    if (!challengeData) {
      throw new Error("Challenge is not ready");
    }

    const nested = challengeData.challengeData as Record<string, unknown> | undefined;
    if (!nested?.domain || !nested?.types || !nested?.message) {
      throw new Error("Challenge is missing EIP-712 typed data for x402 settlement");
    }
    return signX402Settlement(nested, wallet);
  };

  const handleSettle = async () => {
    if (!challengeData) return;

    setErrorMessage("");

    // Refuse to settle unless the wallet is on the payment chain.
    try {
      await ensureReadyForPayment();
    } catch (err) {
      setStep("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : `You must be on ${wallet.targetChain.name} to settle payment.`,
      );
      return;
    }

    setStep("settling");

    try {
      const settlementRef = await resolveSettlementReference();

      const result = await settlePayment({
        challengeReference: challengeData.challengeReference as string,
        settlementReference: settlementRef,
        paymentRoute: WEB_PAYMENT_ROUTE,
      });

      if (result && result.settled) {
        setStep("settled");
        const accessReceipt =
          typeof result.accessReceipt === "string" ? result.accessReceipt : undefined;
        const receiptProof = result.premiumReceipt as
          | {
              success?: boolean;
              registryTxHash?: string;
              explorerUrl?: string;
            }
          | undefined;
        if (receiptProof?.success && receiptProof.registryTxHash) {
          setPremiumReceiptTx(receiptProof.registryTxHash);
          setPremiumReceiptExplorer(
            typeof receiptProof.explorerUrl === "string" ? receiptProof.explorerUrl : null,
          );
        }
        onSettled(result.paymentRecordId as string, accessReceipt);

        setTimeout(() => {
          onClose();
        }, receiptProof?.success ? 3500 : 2000);
      } else {
        setStep("error");
        setErrorMessage((result as { error?: string })?.error ?? "Settlement failed");
      }
    } catch (err) {
      setStep("error");
      setErrorMessage(err instanceof Error ? err.message : "Settlement failed");
    }
  };

  const busy = connecting || switchingNetwork;
  const onWrongNetwork = wallet.isConnected && !wallet.isCorrectChain;

  return (
    <div
      className="card relative shadow-xs"
      data-testid={dataTestId}
      style={{ borderColor: "var(--accent)" }}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold text-foreground leading-snug">
          Payment Required
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-baseline gap-1">
          <span className="text-2xl font-bold text-accent">{priceAmount}</span>
          <span className="text-xs text-muted-foreground">{priceCurrency}</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Pay with USDC via wallet on {wallet.targetChain.name} (x402). Agents use MPP via the API
          — not this wallet flow.
        </p>
        {onShowAgentGuide ? (
          <button
            type="button"
            onClick={onShowAgentGuide}
            className="mt-2 text-xs font-medium text-foreground underline underline-offset-2 hover:text-accent transition-colors cursor-pointer bg-transparent border-none p-0"
            data-testid="payment-panel-agent-guide-link"
          >
            Agent / MPP purchase guide
          </button>
        ) : null}
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
              disabled={busy}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                fontWeight: 600,
                fontSize: "var(--font-size-xs)",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {connecting ? "Waiting…" : "Connect wallet"}
            </button>
          ) : onWrongNetwork ? (
            <button
              type="button"
              onClick={() => {
                void handleSwitchNetwork();
              }}
              disabled={switchingNetwork}
              data-testid="payment-switch-network"
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                fontWeight: 600,
                fontSize: "var(--font-size-xs)",
                cursor: switchingNetwork ? "wait" : "pointer",
              }}
            >
              {switchingNetwork ? "Switching…" : `Switch to ${wallet.targetChain.name}`}
            </button>
          ) : (
            <StatusBadge label="Ready" variant="success" />
          )}
        </div>
      </div>

      {errorMessage && step !== "error" ? (
        <p
          role="alert"
          data-testid="payment-network-error"
          style={{
            marginBottom: "0.75rem",
            fontSize: "var(--font-size-xs)",
            color: "var(--fg-error)",
            lineHeight: 1.45,
          }}
        >
          {errorMessage}
        </p>
      ) : null}

      {step === "select" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div
            style={{
              padding: "0.75rem",
              background: "var(--bg-glass)",
              color: "var(--fg-primary)",
              border: "1px solid var(--accent-primary)",
              borderRadius: "8px",
              fontWeight: 500,
              fontSize: "var(--font-size-sm)",
              textAlign: "left",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
              x402 ({wallet.targetChain.name})
            </div>
            <div style={{ fontSize: "var(--font-size-xs)", opacity: 0.8 }}>
              Pay with USDC via wallet EIP-712 authorization.{" "}
              {wallet.targetChain.name} is required.
            </div>
          </div>

          {onWrongNetwork ? (
            <button
              type="button"
              onClick={() => {
                void handleSwitchNetwork();
              }}
              disabled={switchingNetwork}
              data-testid="payment-continue-switch-network"
              style={{
                padding: "0.75rem",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "var(--font-size-sm)",
                cursor: switchingNetwork ? "wait" : "pointer",
                marginTop: "0.5rem",
                transition: "background 0.15s ease",
              }}
            >
              {switchingNetwork
                ? "Switching network…"
                : `Switch to ${wallet.targetChain.name} to continue`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreateChallenge}
              disabled={busy}
              style={{
                padding: "0.75rem",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "var(--font-size-sm)",
                cursor: busy ? "wait" : "pointer",
                marginTop: "0.5rem",
                transition: "background 0.15s ease",
              }}
            >
              {connecting
                ? "Waiting for wallet…"
                : !wallet.isConnected
                  ? "Connect wallet & continue"
                  : "Continue with x402"}
            </button>
          )}
        </div>
      )}

      {step === "challenging" && (
        <div
          style={{
            textAlign: "center",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <Spinner size="md" label="Creating payment challenge" />
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
            {wallet.address && (
              <div style={{ marginTop: "0.5rem" }}>
                <span style={{ color: "var(--fg-tertiary)" }}>Payer: </span>
                <span style={{ color: "var(--fg-secondary)" }}>{wallet.address}</span>
              </div>
            )}
          </div>

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

          {showAdvanced && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--fg-tertiary)",
                  marginBottom: "0.25rem",
                }}
              >
                Or paste signed EIP-712 JSON settlement
              </label>
              <textarea
                value={manualSettlement}
                onChange={(e) => setManualSettlement(e.target.value)}
                rows={3}
                placeholder='{"signature":"0x...","from":"0x...","to":"0x...","value":...,"validAfter":0,"validBefore":...,"nonce":"0x..."}'
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

          {onWrongNetwork ? (
            <button
              type="button"
              onClick={() => {
                void handleSwitchNetwork();
              }}
              disabled={switchingNetwork}
              data-testid="payment-settle-switch-network"
              style={{
                padding: "0.75rem",
                width: "100%",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "var(--font-size-sm)",
                cursor: switchingNetwork ? "wait" : "pointer",
                transition: "background 0.15s ease",
              }}
            >
              {switchingNetwork
                ? "Switching network…"
                : `Switch to ${wallet.targetChain.name} to settle`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSettle}
              disabled={busy}
              style={{
                padding: "0.75rem",
                width: "100%",
                background: "var(--accent-primary)",
                color: "#0a0a0a",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "var(--font-size-sm)",
                cursor: busy ? "wait" : "pointer",
                transition: "background 0.15s ease",
              }}
            >
              {manualSettlement.trim()
                ? "Submit Settlement"
                : wallet.isConnected
                  ? "Sign & Settle with Wallet"
                  : "Connect, Sign & Settle"}
            </button>
          )}
        </div>
      )}

      {step === "settling" && (
        <div
          style={{
            textAlign: "center",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <Spinner size="md" label="Settling payment" />
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--fg-secondary)" }}>
            Awaiting wallet signature and settling payment…
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
          {premiumReceiptTx ? (
            <p
              data-testid="premium-receipt-tx"
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--fg-secondary)",
                marginTop: "0.75rem",
                wordBreak: "break-all",
              }}
            >
              On-chain receipt:{" "}
              {premiumReceiptExplorer ? (
                <a
                  href={premiumReceiptExplorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-accent underline underline-offset-2"
                >
                  {premiumReceiptTx.slice(0, 10)}…{premiumReceiptTx.slice(-8)}
                </a>
              ) : (
                <span className="font-mono">
                  {premiumReceiptTx.slice(0, 10)}…{premiumReceiptTx.slice(-8)}
                </span>
              )}
            </p>
          ) : null}
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
