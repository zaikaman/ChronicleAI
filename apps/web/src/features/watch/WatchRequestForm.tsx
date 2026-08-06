// Watch request form — buyer submits a target address + campaign window,
// pays via x402, and gets a dual on-chain audit trail.

import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadClientEnv } from "@chronicleai/config/client";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { isEvmAddress, useWallet } from "../wallet";
import { settlePayment } from "../premium/use-premium.ts";

import { API_BASE, fetchWithTimeout } from "../../lib/api.ts";
const WEB_PAYMENT_ROUTE = "x402" as const;

type FormStep =
  | "idle"
  | "preparing"
  | "challenge_ready"
  | "settling"
  | "settled"
  | "error";

type TargetKind = "contract" | "wallet";
type Visibility = "public" | "private";

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
    targetKind?: TargetKind;
    visibility?: Visibility;
  };
}

/** Preset campaign lengths — includes 1h short demo for dual-tx proof. */
const DURATION_PRESETS: Array<{ label: string; durationHours: number }> = [
  { label: "1 hour (demo)", durationHours: 1 },
  { label: "1 day", durationHours: 24 },
  { label: "7 days", durationHours: 168 },
  { label: "30 days", durationHours: 720 },
];

type WatchFocusKey =
  | "none"
  | "transfers"
  | "swaps"
  | "liquidations"
  | "deposits"
  | "stablecoin"
  | "cex";

interface WatchFocusOption {
  key: WatchFocusKey;
  label: string;
  /** Preset instruction written into the watch spec + final report narrative. */
  description: string;
}

/** Watch focus presets for wallet targets (ERC-20 transfer matching). */
const WALLET_FOCUS_OPTIONS: WatchFocusOption[] = [
  { key: "none", label: "Everything (no specific focus)", description: "" },
  {
    key: "transfers",
    label: "Large transfers & whale moves",
    description: "Watch for large transfers and whale-scale token moves involving this wallet.",
  },
  {
    key: "cex",
    label: "Exchange inflows / outflows",
    description: "Watch for token movements between this wallet and centralized exchanges.",
  },
];

/** Watch focus presets for contract / protocol targets. */
const CONTRACT_FOCUS_OPTIONS: WatchFocusOption[] = [
  { key: "none", label: "Everything (no specific focus)", description: "" },
  {
    key: "swaps",
    label: "Swaps & trades",
    description: "Watch for token swaps and trades on this contract.",
  },
  {
    key: "liquidations",
    label: "Liquidations",
    description: "Watch for liquidation events on this contract.",
  },
  {
    key: "deposits",
    label: "Deposits & withdrawals",
    description: "Watch for deposits into and withdrawals from this protocol.",
  },
  {
    key: "stablecoin",
    label: "Stablecoin mints & burns",
    description: "Watch for stablecoin mint and burn events on this contract.",
  },
  {
    key: "cex",
    label: "Exchange inflows / outflows",
    description: "Watch for token movements between this contract and centralized exchanges.",
  },
];

interface SettledWatch {
  id: string;
  targetContract: string;
  status: string;
  createTxHash?: string | null;
  createExplorerUrl?: string | null;
  startsAt?: string;
  endsAt?: string;
  targetKind?: TargetKind;
  visibility?: Visibility;
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

const toggleClass = (active: boolean) =>
  [
    "inline-flex items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors border",
    active
      ? "bg-foreground text-background border-foreground"
      : "bg-frame text-muted-foreground border-border hover:text-foreground",
  ].join(" ");

export function WatchRequestForm({
  onSettled,
  "data-testid": dataTestId = "sponsored-watch-request-form",
}: {
  onSettled?: (watchId: string) => void;
  "data-testid"?: string;
}): ReactElement {
  const wallet = useWallet();
  const [targetKind, setTargetKind] = useState<TargetKind>("contract");
  const [targetContract, setTargetContract] = useState("");
  const [focusKey, setFocusKey] = useState<WatchFocusKey>("none");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [telegramBindingCode, setTelegramBindingCode] = useState("");
  /** Default 1 hour short demo so create + report dual txs can complete in one session. */
  const [durationHours, setDurationHours] = useState(1);
  const [step, setStep] = useState<FormStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedChallenge | null>(null);
  const [settledWatch, setSettledWatch] = useState<SettledWatch | null>(null);
  const prepareControllerRef = useRef<AbortController | null>(null);

  const telegramBotUsername = useMemo(() => {
    try {
      return loadClientEnv().telegramBotUsername ?? "ChronicleAIBot";
    } catch {
      return "ChronicleAIBot";
    }
  }, []);
  const telegramDeepLink = `https://t.me/${telegramBotUsername}`;
  const focusOptions =
    targetKind === "wallet" ? WALLET_FOCUS_OPTIONS : CONTRACT_FOCUS_OPTIONS;
  const currentFocus = focusOptions.find((opt) => opt.key === focusKey) ?? focusOptions[0]!;

  useEffect(() => {
    return () => prepareControllerRef.current?.abort();
  }, []);

  const handlePrepare = useCallback(async () => {
    setError(null);
    setSettledWatch(null);

    if (!isEvmAddress(targetContract.trim())) {
      setError(
        targetKind === "wallet"
          ? "Enter a valid EVM wallet address (0x…)."
          : "Enter a valid EVM contract address (0x…).",
      );
      setStep("error");
      return;
    }

    if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 90 * 24) {
      setError("Duration must be between 1 hour and 90 days.");
      setStep("error");
      return;
    }

    if (visibility === "private" && !telegramBindingCode.trim()) {
      setError("Private watches require a Telegram binding code. Send /start to the bot first.");
      setStep("error");
      return;
    }

    setStep("preparing");
    prepareControllerRef.current?.abort();
    const controller = new AbortController();
    prepareControllerRef.current = controller;
    try {
      let payer = wallet.address;
      if (!payer) {
        payer = await wallet.connect();
      }

      const response = await fetchWithTimeout(
        `${API_BASE}/payments/sponsored-watch/challenges`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            targetContract: targetContract.trim(),
            description: currentFocus.description || undefined,
            durationHours,
            targetKind,
            visibility,
            telegramBindingCode: telegramBindingCode.trim() || undefined,
            paymentRoute: WEB_PAYMENT_ROUTE,
            payerReference: payer ?? undefined,
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to prepare campaign (${response.status})`);
      }

      const data = (await response.json()) as PreparedChallenge;
      setPrepared(data);
      setStep("challenge_ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to prepare sponsored watch");
      setStep("error");
    } finally {
      if (prepareControllerRef.current === controller) {
        prepareControllerRef.current = null;
      }
    }
  }, [
    targetContract,
    targetKind,
    focusKey,
    currentFocus,
    durationHours,
    visibility,
    telegramBindingCode,
    wallet,
  ]);

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
        <h3 className="text-base font-semibold text-foreground m-0">Request a watch</h3>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Pay to open a monitoring campaign on any wallet, contract, or protocol. ChronicleAI
          writes an on-chain acceptance receipt, monitors the window, alerts you on Telegram, then
          publishes a final report with a second registry transaction.
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-frame px-3 py-1 text-xs font-medium text-muted-foreground">
          <span aria-hidden="true">🌐</span> Monitors Ethereum Mainnet · paid in USDC
          (x402)
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2" data-testid="watch-target-kind">
          <span className="text-xs font-medium text-muted-foreground">Target type</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={toggleClass(targetKind === "wallet")}
              onClick={() => setTargetKind("wallet")}
              data-testid="watch-kind-wallet"
            >
              Wallet
            </button>
            <button
              type="button"
              className={toggleClass(targetKind === "contract")}
              onClick={() => setTargetKind("contract")}
              data-testid="watch-kind-contract"
            >
              Contract
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            {targetKind === "wallet"
              ? "Matches ERC-20 Transfer events on Ethereum Mainnet where this wallet is from or to."
              : "Protocol = contract address + optional focus preset. Monitored on Ethereum Mainnet."}
          </span>
        </div>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">
            {targetKind === "wallet" ? "Target wallet" : "Target contract"}
          </span>
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
            Watch focus <span className="font-normal">(optional)</span>
          </span>
          <select
            value={currentFocus.key}
            onChange={(e) => setFocusKey(e.target.value as WatchFocusKey)}
            className="rounded-xl border border-border bg-frame px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            data-testid="watch-focus-input"
          >
            {focusOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {currentFocus.description
              ? currentFocus.description
              : "Alerts describe each matched event; the final report summarizes the window."}
          </span>
        </label>

        <div className="flex flex-col gap-1.5 sm:col-span-2" data-testid="watch-visibility">
          <span className="text-xs font-medium text-muted-foreground">Alert visibility</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={toggleClass(visibility === "public")}
              onClick={() => setVisibility("public")}
              data-testid="watch-visibility-public"
            >
              Public
            </button>
            <button
              type="button"
              className={toggleClass(visibility === "private")}
              onClick={() => setVisibility("private")}
              data-testid="watch-visibility-private"
            >
              Private
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            {visibility === "public"
              ? "Alerts publish to the registry (provably real) and the community Telegram channel. Add a binding code to also get them DM'd to you."
              : "Alerts go to your Telegram only. Create + report txs still stay onchain."}
          </span>
        </div>

        <div
          className="flex flex-col gap-3 sm:col-span-2 rounded-xl border border-border bg-frame/50 p-4"
          data-testid="watch-telegram-panel"
        >
          <div>
            <p className="text-xs font-medium text-foreground m-0 mb-1">Connect Telegram</p>
            <p className="text-xs text-muted-foreground m-0 leading-relaxed">
              Send /start to the bot, then paste the code it replies with.
              {visibility === "private"
                ? " Required for private watches."
                : " Optional for public — enter it to also receive alerts by DM."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={telegramDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              data-testid="watch-telegram-open"
            >
              Open @{telegramBotUsername}
            </a>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Binding code
              {visibility === "private" ? (
                <span className="text-[var(--accent-error)]"> *</span>
              ) : (
                <span className="font-normal"> (optional)</span>
              )}
            </span>
            <input
              type="text"
              value={telegramBindingCode}
              onChange={(e) => setTelegramBindingCode(e.target.value.toUpperCase())}
              placeholder="ABCD12"
              className="rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-sm tracking-wider text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] uppercase"
              data-testid="watch-telegram-code-input"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

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
          <p className="font-medium text-foreground m-0 mb-1">Watch created</p>
          <p className="text-muted-foreground m-0 mb-2">
            Status <StatusBadge label={settledWatch.status} variant="info" />
          </p>
          {settledWatch.id ? (
            <Link
              to={`/watch/${settledWatch.id}`}
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
