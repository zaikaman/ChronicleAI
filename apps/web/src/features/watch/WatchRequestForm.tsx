// Watch request form — calls the canonical KeeperHub Marketplace listing.

import { loadClientEnv } from "@chronicleai/config/client";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Surface } from "../../components/page-chrome.tsx";
import { API_BASE, fetchWithTimeout } from "../../lib/api.ts";
import { isEvmAddress, useWallet } from "../wallet";
import { AgentPaymentInstructions } from "./AgentPaymentInstructions.tsx";

type TargetKind = "contract" | "wallet";
type Visibility = "public" | "private";

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
  description: string;
}

const WALLET_FOCUS_OPTIONS: WatchFocusOption[] = [
  { key: "none", label: "Everything (no specific focus)", description: "" },
  { key: "transfers", label: "Large transfers & whale moves", description: "Watch for large transfers and whale-scale token moves involving this wallet." },
  { key: "cex", label: "Exchange inflows / outflows", description: "Watch for token movements between this wallet and centralized exchanges." },
];

const CONTRACT_FOCUS_OPTIONS: WatchFocusOption[] = [
  { key: "none", label: "Everything (no specific focus)", description: "" },
  { key: "swaps", label: "Swaps & trades", description: "Watch for token swaps and trades on this contract." },
  { key: "liquidations", label: "Liquidations", description: "Watch for liquidation events on this contract." },
  { key: "deposits", label: "Deposits & withdrawals", description: "Watch for deposits into and withdrawals from this protocol." },
  { key: "stablecoin", label: "Stablecoin mints & burns", description: "Watch for stablecoin mint and burn events on this contract." },
  { key: "cex", label: "Exchange inflows / outflows", description: "Watch for token movements between this contract and centralized exchanges." },
];

const DURATION_PRESETS = [
  { label: "1 hour (demo)", durationHours: 1 },
  { label: "1 day", durationHours: 24 },
  { label: "7 days", durationHours: 168 },
  { label: "30 days", durationHours: 720 },
] as const;

const TELEGRAM_BINDING_STORAGE_KEY = "chronicleai.watch.telegram-binding.v1";

type StoredTelegramBinding = {
  token: string;
  walletAddress: string | null;
};

interface PaymentAccept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

interface PaymentRequired {
  x402Version: number;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: PaymentAccept[];
}

interface PreparedMarketplaceCall {
  input: Record<string, unknown>;
  paymentRequired: PaymentRequired;
  amountUsdc: number;
}

interface SettledWatch {
  id?: string;
  status?: string;
  createTxHash?: string | null;
  createExplorerUrl?: string | null;
}

type FormStep = "idle" | "preparing" | "challenge_ready" | "settling" | "settled" | "error";

function decodePaymentRequired(response: Response): PaymentRequired {
  const encoded = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("X-PAYMENT-REQUIREMENTS");
  if (!encoded) throw new Error("KeeperHub did not return a payment challenge.");
  try {
    const decoded = JSON.parse(atob(encoded)) as PaymentRequired;
    if (!Array.isArray(decoded.accepts) || decoded.accepts.length === 0) throw new Error("empty accepts");
    return decoded;
  } catch {
    throw new Error("KeeperHub returned an invalid payment challenge.");
  }
}

function encodePaymentSignature(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function buildTelegramWalletLinkMessage(
  walletAddress: string,
  issuedAt: string,
  token: string,
): string {
  return [
    "ChronicleAI Telegram Watch Link",
    `Wallet: ${walletAddress.trim().toLowerCase()}`,
    `Issued-At: ${issuedAt}`,
    `Binding-Token: ${token.trim()}`,
    "Purpose: Link this wallet to my ChronicleAI Telegram Watch alerts",
  ].join("\n");
}

async function signMarketplacePayment(
  paymentRequired: PaymentRequired,
  wallet: ReturnType<typeof useWallet>,
): Promise<string> {
  const accepted = paymentRequired.accepts.find((item) => item.scheme === "exact");
  if (!accepted || accepted.network !== "eip155:8453") {
    throw new Error("This Watch listing currently accepts x402 USDC on Base Mainnet only.");
  }
  let from = wallet.address;
  if (!wallet.isConnected || !from) from = await wallet.connect();
  if (!from || !isEvmAddress(from)) throw new Error("Wallet did not return a valid account.");

  await wallet.ensureChain({
    ...wallet.targetChain,
    chainId: 8453,
    chainIdHex: "0x2105",
    name: "Base",
  });

  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + (accepted.maxTimeoutSeconds ?? 300);
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = `0x${Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const authorization = {
    from,
    to: accepted.payTo,
    value: BigInt(accepted.amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(validBefore),
    nonce,
  };
  const signature = await wallet.signTypedData({
    domain: {
      name: accepted.extra?.name ?? "USD Coin",
      version: accepted.extra?.version ?? "2",
      chainId: 8453,
      verifyingContract: accepted.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  return encodePaymentSignature({
    x402Version: paymentRequired.x402Version,
    resource: paymentRequired.resource,
    accepted,
    payload: {
      signature,
      authorization: {
        ...authorization,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
      },
    },
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
  const [telegramWalletAddress, setTelegramWalletAddress] = useState<string | null>(null);
  const [durationHours, setDurationHours] = useState(1);
  const [step, setStep] = useState<FormStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedMarketplaceCall | null>(null);
  const [settledWatch, setSettledWatch] = useState<SettledWatch | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  const telegramBotUsername = useMemo(() => {
    try {
      return loadClientEnv().telegramBotUsername ?? "chronicleai_bot";
    } catch {
      return "chronicleai_bot";
    }
  }, []);
  const telegramDeepLink = `https://t.me/${telegramBotUsername}`;
  const focusOptions = targetKind === "wallet" ? WALLET_FOCUS_OPTIONS : CONTRACT_FOCUS_OPTIONS;
  const currentFocus = focusOptions.find((option) => option.key === focusKey) ?? focusOptions[0]!;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TELEGRAM_BINDING_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<StoredTelegramBinding>;
      if (typeof stored.token === "string" && stored.token.trim()) {
        setTelegramBindingCode(stored.token.trim());
        setTelegramWalletAddress(
          typeof stored.walletAddress === "string" ? stored.walletAddress : null,
        );
      }
    } catch {
      // A blocked or malformed browser storage entry should not block Watch.
    }
  }, []);

  useEffect(() => {
    if (!telegramBindingCode.trim()) return;
    try {
      window.localStorage.setItem(
        TELEGRAM_BINDING_STORAGE_KEY,
        JSON.stringify({ token: telegramBindingCode.trim(), walletAddress: telegramWalletAddress }),
      );
    } catch {
      // The token remains usable in this tab even when persistent storage is blocked.
    }
  }, [telegramBindingCode, telegramWalletAddress]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const callMarketplace = useCallback(async (input: Record<string, unknown>, paymentSignature?: string) => {
    const response = await fetchWithTimeout(`${API_BASE}/keeperhub/marketplace/watch/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {}),
      },
      signal: controllerRef.current?.signal,
      body: JSON.stringify(input),
    });
    if (response.status === 402) {
      return { challenge: decodePaymentRequired(response) };
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Marketplace call failed (${response.status})`);
    return { result: body };
  }, []);

  const ensureTelegramWalletLink = useCallback(async (token: string, walletAddress: string) => {
    if (telegramWalletAddress?.toLowerCase() === walletAddress.toLowerCase()) return;

    const issuedAt = new Date().toISOString();
    const signature = await wallet.signMessage(
      buildTelegramWalletLinkMessage(walletAddress, issuedAt, token),
    );
    const response = await fetchWithTimeout(`${API_BASE}/telegram/binding/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, walletAddress, issuedAt, signature }),
      signal: controllerRef.current?.signal,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof body.error === "string" ? body.error : `Telegram wallet link failed (${response.status})`,
      );
    }
    setTelegramWalletAddress(walletAddress);
  }, [telegramWalletAddress, wallet.signMessage]);

  const disconnectTelegram = useCallback(async () => {
    const token = telegramBindingCode.trim();
    try {
      if (token) {
        const response = await fetchWithTimeout(`${API_BASE}/telegram/binding/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(
            typeof body.error === "string" ? body.error : `Telegram disconnect failed (${response.status})`,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Telegram");
      return;
    }
    setTelegramBindingCode("");
    setTelegramWalletAddress(null);
    try {
      window.localStorage.removeItem(TELEGRAM_BINDING_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }, [telegramBindingCode]);

  const handlePrepare = useCallback(async () => {
    setError(null);
    setNotice(null);
    setSettledWatch(null);
    if (inFlightRef.current) return;
    if (!isEvmAddress(targetContract.trim())) {
      setError(targetKind === "wallet" ? "Enter a valid EVM wallet address (0x…)." : "Enter a valid EVM contract address (0x…).");
      setStep("error");
      return;
    }
    if (!telegramBindingCode.trim()) {
      setError("A Telegram binding code is required. Open the bot, send /start, and paste the returned code.");
      setStep("error");
      return;
    }
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 90 * 24) {
      setError("Duration must be between 1 hour and 90 days.");
      setStep("error");
      return;
    }

    const input = {
      targetContract: targetContract.trim(),
      targetKind,
      focusKey,
      durationHours,
      visibility,
      telegramBindingCode: telegramBindingCode.trim(),
    };
    setStep("preparing");
    inFlightRef.current = true;
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    try {
      const walletAddress = wallet.isConnected && wallet.address ? wallet.address : await wallet.connect();
      await ensureTelegramWalletLink(telegramBindingCode.trim(), walletAddress);
      const response = await callMarketplace(input);
      if (!response.challenge) {
        const watch = (response.result?.watch ?? response.result) as SettledWatch;
        setSettledWatch(watch);
        setNotice("KeeperHub accepted the paid workflow. ChronicleAI is registering the Sepolia receipt and will begin monitoring asynchronously.");
        onSettled?.(watch.id ?? "");
        setStep("settled");
        return;
      }
      const accepted = response.challenge.accepts[0]!;
      setPrepared({ input, paymentRequired: response.challenge, amountUsdc: Number(accepted.amount) / 1_000_000 });
      setStep("challenge_ready");
    } catch (err) {
      if (controllerRef.current?.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to prepare the Marketplace Watch");
      setStep("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [callMarketplace, durationHours, ensureTelegramWalletLink, focusKey, onSettled, targetContract, targetKind, telegramBindingCode, visibility, wallet]);

  const handlePay = useCallback(async () => {
    if (!prepared) return;
    setError(null);
    setNotice(null);
    setStep("settling");
    try {
      const paymentSignature = await signMarketplacePayment(prepared.paymentRequired, wallet);
      const response = await callMarketplace(prepared.input, paymentSignature);
      if (response.challenge) throw new Error("KeeperHub returned another payment challenge. Check the wallet network and retry.");
      const watch = (response.result?.watch ?? response.result) as SettledWatch;
      setSettledWatch(watch);
      setNotice("Payment accepted on Base Mainnet. The Watch transaction and asynchronous monitoring are now handled by the Marketplace workflow.");
      onSettled?.(watch.id ?? "");
      setStep("settled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Marketplace payment failed");
      setStep("challenge_ready");
    }
  }, [callMarketplace, onSettled, prepared, wallet]);

  return (
    <Surface className="p-5 sm:p-6" data-testid={dataTestId}>
      <div className="mb-5">
        <h3 className="text-base font-semibold text-foreground m-0">Start a paid Watch</h3>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          KeeperHub Marketplace handles payment on Base Mainnet. ChronicleAI creates the registry receipt on Ethereum Sepolia, monitors Ethereum Mainnet, sends Telegram alerts, and publishes the final report asynchronously.
        </p>
        <AgentPaymentInstructions />
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-frame px-3 py-1 text-xs font-medium text-muted-foreground">
          <span aria-hidden="true">◉</span> KeeperHub Marketplace · Base Mainnet USDC · Sepolia registry proof
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2" data-testid="watch-target-kind">
          <span className="text-xs font-medium text-muted-foreground">Target type</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={toggleClass(targetKind === "wallet")} onClick={() => setTargetKind("wallet")} data-testid="watch-kind-wallet">Wallet</button>
            <button type="button" className={toggleClass(targetKind === "contract")} onClick={() => setTargetKind("contract")} data-testid="watch-kind-contract">Contract</button>
          </div>
          <span className="text-xs text-muted-foreground">{targetKind === "wallet" ? "Matches ERC-20 Transfer events involving this wallet." : "Monitors events associated with this contract."}</span>
        </div>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">{targetKind === "wallet" ? "Target wallet" : "Target contract"}</span>
          <input type="text" value={targetContract} onChange={(event) => setTargetContract(event.target.value)} placeholder="0x…" className="rounded-xl border border-border bg-frame px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" data-testid="watch-target-input" autoComplete="off" spellCheck={false} />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Watch focus <span className="font-normal">(included in the paid workflow input)</span></span>
          <select value={currentFocus.key} onChange={(event) => setFocusKey(event.target.value as WatchFocusKey)} className="rounded-xl border border-border bg-frame px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" data-testid="watch-focus-input">
            {focusOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{currentFocus.description || "Alerts describe each matched event; the final report summarizes the window."}</span>
        </label>

        <div className="flex flex-col gap-1.5 sm:col-span-2" data-testid="watch-visibility">
          <span className="text-xs font-medium text-muted-foreground">Alert visibility</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={toggleClass(visibility === "public")} onClick={() => setVisibility("public")} data-testid="watch-visibility-public">Public</button>
            <button type="button" className={toggleClass(visibility === "private")} onClick={() => setVisibility("private")} data-testid="watch-visibility-private">Private</button>
          </div>
          <span className="text-xs text-muted-foreground">{visibility === "public" ? "Registry and community alerts, plus an optional Telegram DM." : "Telegram DM alerts only; the create and report receipts remain onchain."}</span>
        </div>

        <div className="flex flex-col gap-3 sm:col-span-2 rounded-xl border border-border bg-frame/50 p-4" data-testid="watch-telegram-panel">
          <div>
            <p className="text-xs font-medium text-foreground m-0 mb-1">Telegram connection</p>
            <p className="text-xs text-muted-foreground m-0 leading-relaxed">Open <strong>@{telegramBotUsername}</strong> and send <code>/start</code> once. Paste the persistent token here; ChronicleAI will remember this Telegram chat and the wallet you use for Watch payments until you disconnect it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={telegramDeepLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors" data-testid="watch-telegram-open">Open @{telegramBotUsername}</a>
            {telegramBindingCode.trim() ? (
              <button type="button" onClick={() => void disconnectTelegram()} className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors" data-testid="watch-telegram-disconnect">Disconnect</button>
            ) : null}
          </div>
          {telegramBindingCode.trim() && telegramWalletAddress ? (
            <p className="m-0 rounded-lg border border-[color:var(--success)]/30 bg-[color:var(--success)]/10 px-3 py-2 text-xs text-foreground" role="status" data-testid="watch-telegram-connected">
              Connected · Telegram alerts and wallet <span className="font-mono">{telegramWalletAddress.slice(0, 6)}…{telegramWalletAddress.slice(-4)}</span> are remembered.
            </p>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Persistent Telegram token <span className="text-[var(--accent-error)]">*</span></span>
            <input type="password" value={telegramBindingCode} onChange={(event) => { setTelegramBindingCode(event.target.value.trim()); setTelegramWalletAddress(null); }} placeholder="ctai_…" className="rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-sm tracking-wider text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" data-testid="watch-telegram-code-input" autoComplete="off" spellCheck={false} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Campaign duration</span>
          <select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} className="rounded-xl border border-border bg-frame px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" data-testid="watch-duration-input">
            {DURATION_PRESETS.map((preset) => <option key={preset.durationHours} value={preset.durationHours}>{preset.label}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">Use 1 hour for the hackathon smoke test; monitoring and final report continue asynchronously.</span>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {step === "challenge_ready" && prepared ? (
          <button type="button" onClick={() => void handlePay()} className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity" data-testid="watch-pay-button">Pay {prepared.amountUsdc.toFixed(2)} USDC on Base</button>
        ) : (
          <button type="button" onClick={() => void handlePrepare()} disabled={step === "preparing" || step === "settling"} className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50" data-testid="watch-prepare-button">{step === "preparing" ? "Checking Marketplace…" : step === "settling" ? "Submitting payment…" : "Continue to KeeperHub payment"}</button>
        )}
        {step === "challenge_ready" && prepared ? <button type="button" onClick={() => { setPrepared(null); setError(null); setStep("idle"); }} className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors" data-testid="watch-edit-details-button">Edit details</button> : null}
        {step === "challenge_ready" && prepared ? <StatusBadge label={`${prepared.amountUsdc.toFixed(2)} USDC · Base Mainnet`} variant="info" /> : null}
        {step === "settled" ? <StatusBadge label="Marketplace payment accepted" variant="success" /> : null}
      </div>

      {error ? <p className="mt-3 text-sm text-[var(--accent-error)]" data-testid="watch-form-error" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-muted-foreground" data-testid="watch-form-notice" role="status">{notice}</p> : null}
      {settledWatch ? (
        <div className="mt-4 rounded-xl border border-border bg-frame/60 p-4 text-sm" data-testid="watch-form-success">
          <p className="font-medium text-foreground m-0 mb-1">Watch workflow accepted</p>
          <p className="text-muted-foreground m-0 mb-2">ChronicleAI is registering the Sepolia create receipt now.</p>
          {settledWatch.id ? <Link to={`/watch/${settledWatch.id}`} className="text-sm font-semibold text-foreground hover:text-muted-foreground transition-colors">Open campaign audit trail →</Link> : <p className="text-xs text-muted-foreground m-0">The campaign will appear in the list after the Marketplace workflow finishes registration.</p>}
        </div>
      ) : null}
    </Surface>
  );
}
