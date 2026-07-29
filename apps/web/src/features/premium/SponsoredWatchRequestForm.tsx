// Custom sponsored watch purchase form (Loop 4)
// Buyer submits a target contract + campaign window, pays via x402, gets dual on-chain trail.

import { type ReactElement, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { isEvmAddress, useWallet } from "../wallet";
import { settlePayment } from "./use-premium.ts";

import { API_BASE } from "../../lib/api.ts";
const WEB_PAYMENT_ROUTE = "x402" as const;

type FormStep =
  | "idle"
  | "preparing"
  | "challenge_ready"
  | "settling"
  | "settled"
  | "error";

interface PreparedChallenge {
  premiumItemId: string;
  paymentRecordId: string;
  challengeReference: string;
  amountRequested: number;
  currency: string;
  expiresAt: string;
  challengeData: Record<string, unknown>;
  campaign: {
    targetContract: string;
    watchSpecHash: string;
    startsAt: string;
    endsAt: string;
    durationDays: number;
    durationHours?: number;
  };
}

/** Preset campaign lengths — includes 1h short demo for dual-tx proof. */
const DURATION_PRESETS: Array<{ label: string; durationHours: number }> = [
  { label: "1 hour (demo)", durationHours: 1 },
  { label: "1 day", durationHours: 24 },
  { label: "7 days", durationHours: 168 },
  { label: "30 days", durationHours: 720 },
];

interface SettledWatch {
  id: string;
  targetContract: string;
  status: string;
  createTxHash?: string | null;
  createExplorerUrl?: string | null;
  startsAt?: string;
  endsAt?: string;
}

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

  const rawMessage = challengeData.message as Record<string, unknown>;
  const toRaw = rawMessage.to;
  if (typeof toRaw !== "string" || !isEvmAddress(toRaw)) {
    throw new Error("Challenge message is missing a valid treasury `to` address.");
  }
  if (typeof rawMessage.nonce !== "string" || !rawMessage.nonce.startsWith("0x")) {
    throw new Error("Challenge message is missing a valid bytes32 nonce.");
  }

  const message = {
    from,
    to: toRaw,
    value:
      typeof rawMessage.value === "bigint"
        ? rawMessage.value
        : BigInt(String(rawMessage.value ?? "0")),
    validAfter:
      typeof rawMessage.validAfter === "bigint"
        ? rawMessage.validAfter
        : BigInt(String(rawMessage.validAfter ?? "0")),
    validBefore:
      typeof rawMessage.validBefore === "bigint"
        ? rawMessage.validBefore
        : BigInt(String(rawMessage.validBefore ?? "0")),
    nonce: rawMessage.nonce as string,
  };

  const signature = await wallet.signTypedData({
    domain: {
      name: String(domain.name ?? ""),
      version: String(domain.version ?? "2"),
      chainId: domainChainId,
      verifyingContract: domain.verifyingContract,
    },
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
    value: message.value.toString(10),
    validAfter: message.validAfter.toString(10),
    validBefore: message.validBefore.toString(10),
    nonce: message.nonce,
  });
}

export function SponsoredWatchRequestForm({
  onSettled,
  "data-testid": dataTestId = "sponsored-watch-request-form",
}: {
  onSettled?: (watchId: string) => void;
  "data-testid"?: string;
}): ReactElement {
  const wallet = useWallet();
  const [targetContract, setTargetContract] = useState("");
  const [eventSignature, setEventSignature] = useState("");
  const [description, setDescription] = useState("");
  /** Default 1 hour short demo so create + report dual txs can complete in one session. */
  const [durationHours, setDurationHours] = useState(1);
  const [step, setStep] = useState<FormStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedChallenge | null>(null);
  const [settledWatch, setSettledWatch] = useState<SettledWatch | null>(null);

  const handlePrepare = useCallback(async () => {
    setError(null);
    setSettledWatch(null);

    if (!isEvmAddress(targetContract.trim())) {
      setError("Enter a valid EVM contract address (0x…).");
      setStep("error");
      return;
    }

    if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 90 * 24) {
      setError("Duration must be between 1 hour and 90 days.");
      setStep("error");
      return;
    }

    setStep("preparing");
    try {
      let payer = wallet.address;
      if (!payer) {
        payer = await wallet.connect();
      }

      const response = await fetch(`${API_BASE}/payments/sponsored-watch/challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetContract: targetContract.trim(),
          eventSignature: eventSignature.trim() || undefined,
          description: description.trim() || undefined,
          durationHours,
          paymentRoute: WEB_PAYMENT_ROUTE,
          payerReference: payer ?? undefined,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to prepare campaign (${response.status})`);
      }

      const data = (await response.json()) as PreparedChallenge;
      setPrepared(data);
      setStep("challenge_ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prepare sponsored watch");
      setStep("error");
    }
  }, [targetContract, eventSignature, description, durationHours, wallet]);

  const handlePay = useCallback(async () => {
    if (!prepared) return;
    setError(null);
    setStep("settling");
    try {
      const settlementReference = await signX402Settlement(prepared.challengeData, wallet);
      const settled = await settlePayment({
        challengeReference: prepared.challengeReference,
        settlementReference,
        paymentRoute: WEB_PAYMENT_ROUTE,
      });

      const watch = settled?.sponsoredWatch as SettledWatch | undefined;
      if (watch) {
        setSettledWatch(watch);
        onSettled?.(watch.id ?? "");
      }
      setStep("settled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settlement failed");
      setStep("error");
    }
  }, [prepared, wallet, onSettled]);

  return (
    <Surface className="p-5 sm:p-6" data-testid={dataTestId}>
      <div className="mb-5">
        <h3 className="text-base font-semibold text-foreground m-0">Request a sponsored watch</h3>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Pay to open a monitoring campaign on any contract. ChronicleAI writes an on-chain
          acceptance receipt, monitors the window, then publishes a final report with a second
          registry transaction.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Target contract</span>
          <input
            type="text"
            value={targetContract}
            onChange={(e) => setTargetContract(e.target.value)}
            placeholder="0x…"
            className="rounded-xl border border-border bg-frame px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            data-testid="watch-target-input"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">
            Event signature <span className="font-normal">(optional)</span>
          </span>
          <input
            type="text"
            value={eventSignature}
            onChange={(e) => setEventSignature(e.target.value)}
            placeholder="Transfer(address,address,uint256)"
            className="rounded-xl border border-border bg-frame px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            data-testid="watch-event-input"
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">
            Description <span className="font-normal">(optional)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What should ChronicleAI watch for?"
            className="rounded-xl border border-border bg-frame px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] resize-y min-h-[4.5rem]"
            data-testid="watch-description-input"
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Campaign duration</span>
          <select
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value))}
            className="rounded-xl border border-border bg-frame px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            data-testid="watch-duration-input"
          >
            {DURATION_PRESETS.map((preset) => (
              <option key={preset.durationHours} value={preset.durationHours}>
                {preset.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Use 1 hour for a short demo with create + report registry txs in one session.
          </span>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {step === "challenge_ready" && prepared ? (
          <button
            type="button"
            onClick={() => void handlePay()}
            className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
            data-testid="watch-pay-button"
          >
            Pay {prepared.amountRequested} {prepared.currency}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handlePrepare()}
            disabled={step === "preparing" || step === "settling"}
            className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            data-testid="watch-prepare-button"
          >
            {step === "preparing"
              ? "Preparing…"
              : step === "settling"
                ? "Settling…"
                : "Continue to payment"}
          </button>
        )}

        {step === "challenge_ready" && prepared ? (
          <StatusBadge
            label={`${
              prepared.campaign.durationHours != null && prepared.campaign.durationHours < 24
                ? `${prepared.campaign.durationHours}h`
                : `${prepared.campaign.durationDays}d`
            } · ${prepared.amountRequested} ${prepared.currency}`}
            variant="info"
          />
        ) : null}
        {step === "settled" ? <StatusBadge label="Campaign accepted" variant="success" /> : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--accent-error)]" data-testid="watch-form-error" role="alert">
          {error}
        </p>
      ) : null}

      {settledWatch ? (
        <div
          className="mt-4 rounded-xl border border-border bg-frame/60 p-4 text-sm"
          data-testid="watch-form-success"
        >
          <p className="font-medium text-foreground m-0 mb-1">Sponsored watch created</p>
          <p className="text-muted-foreground m-0 mb-2">
            Status <StatusBadge label={settledWatch.status} variant="info" />
          </p>
          {settledWatch.id ? (
            <Link
              to={`/premium/watches/${settledWatch.id}`}
              className="text-sm font-semibold text-foreground hover:text-muted-foreground transition-colors"
            >
              Open campaign audit trail →
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground m-0">
              Initializing campaign on-chain. It will appear in the campaigns list below shortly.
            </p>
          )}
        </div>
      ) : null}
    </Surface>
  );
}
