// Chronicle Pass management page — wallet-authenticated self-service.
// States: disconnected wallet, session loading, active, past-due, canceling,
// expired/cancelled (upgrade), renewing, failed actions, payment history.

import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { Page, PageHeader, PageSection, Surface } from "../../components/page-chrome.tsx";
import { EmptyState, LoadingState, RetryState } from "../../components/state-views.tsx";
import { ButtonSpinner } from "../../components/ui/spinner.tsx";
import { shortenAddress, useWallet } from "../wallet";
import {
  CHRONICLE_PASS_PRICE_USDC,
  type SubscriptionActionResult,
  useSubscription,
} from "./use-subscription.ts";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value) % 1 === 0 ? String(value) : Number(value).toFixed(2);
}

function shortReference(ref: string | null | undefined): string {
  if (!ref) return "—";
  if (ref.length <= 18) return ref;
  return `${ref.slice(0, 10)}…${ref.slice(-6)}`;
}

const PASS_BENEFITS = [
  "Every human deep dive, as it publishes",
  "Historical premium items and the full editorial archive",
  "Premium digest delivery by email",
  "Cancel anytime — access continues to the end of your period",
];

function passStatusBadge(status: string): {
  label: string;
  variant: "default" | "success" | "warning" | "error" | "info";
} {
  switch (status) {
    case "active":
      return { label: "Active", variant: "success" };
    case "canceling":
      return { label: "Canceling at period end", variant: "warning" };
    case "past_due":
      return { label: "Past due", variant: "error" };
    case "expired":
      return { label: "Expired", variant: "error" };
    case "cancelled":
      return { label: "Cancelled", variant: "default" };
    case "pending":
      return { label: "Awaiting first payment", variant: "info" };
    default:
      return { label: "No active pass", variant: "default" };
  }
}

function ActionFeedback({
  action,
}: { action: SubscriptionActionResult | null }): ReactElement | null {
  if (!action || action.status === "idle") return null;
  if (action.status === "running") {
    return (
      <output className="block mt-4 text-sm text-muted-foreground">
        Working… confirm the transaction in your wallet when prompted.
      </output>
    );
  }
  if (action.status === "error") {
    return (
      <p
        className="mt-4 text-sm text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3"
        role="alert"
      >
        {action.message}
      </p>
    );
  }
  return (
    <output className="block mt-4 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
      {action.message}
    </output>
  );
}

export function SubscriptionPage(): ReactElement {
  const wallet = useWallet();
  const subscription = useSubscription();
  const [action, setAction] = useState<SubscriptionActionResult | null>(null);
  const [email, setEmail] = useState(subscription.status?.email ?? "");
  const [receivesDigests, setReceivesDigests] = useState(true);
  const [receivesAlerts, setReceivesAlerts] = useState(true);

  const status = subscription.status;

  // Populate the prefs form once from the loaded status (status is null on the
  // first render while the query loads, so initialize lazily rather than at
  // useState time).
  const prefsSyncedRef = useRef(false);
  useEffect(() => {
    if (!status || prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;
    setEmail(status.email ?? "");
    setReceivesDigests(status.receivesDigests ?? true);
    setReceivesAlerts(status.receivesAlerts ?? true);
  }, [status]);
  const isEntitled = status?.entitled === true;
  const passStatus = status?.passStatus ?? "none";

  const handleAuthenticate = async () => {
    setAction({ status: "running", message: null });
    const ok = await subscription.authenticate();
    setAction(
      ok
        ? { status: "success", message: "Wallet connected — your Chronicle Pass is loaded." }
        : { status: "error", message: "Wallet connection was rejected or failed. Try again." },
    );
  };

  const handleCancel = async () => {
    setAction({ status: "running", message: null });
    const result = await subscription.cancel();
    setAction(result);
  };

  const handleResume = async () => {
    setAction({ status: "running", message: null });
    const result = await subscription.resume();
    setAction(result);
  };

  const handleRenew = async () => {
    setAction({ status: "running", message: null });
    const result = await subscription.renew();
    setAction(result);
  };

  const handleSubscribe = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAction({ status: "running", message: null });
    const result = await subscription.subscribe(email);
    setAction(result);
  };

  const handleSavePreferences = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAction({ status: "running", message: null });
    const result = await subscription.updatePreferences({
      email,
      receivesDigests,
      receivesAlerts,
    });
    setAction(result);
  };

  const badge = passStatusBadge(passStatus);

  return (
    <Page data-testid="subscription-page">
      <PageHeader
        title="Chronicle Pass"
        description="Your $4.99/month pass to every human deep dive, the full editorial archive, and premium digest delivery. Renewals are wallet-authorized — we never charge silently."
        meta={
          <span className="text-sm font-medium text-muted-foreground">
            {CHRONICLE_PASS_PRICE_USDC.toFixed(2)} USDC / month
          </span>
        }
        below={
          <>
            <StatusBadge label="Wallet-authenticated" variant="info" />
            {isEntitled ? <StatusBadge label="Entitled" variant="success" /> : null}
          </>
        }
      />

      {subscription.isSessionLoading ? (
        <LoadingState
          message="Checking your session…"
          variant="cards"
          count={2}
          data-testid="subscription-loading"
        />
      ) : !subscription.isAuthenticated ? (
        <Surface className="p-6 sm:p-8" data-testid="subscription-wallet-gate">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-foreground">
                Connect your wallet to manage your Pass
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xl">
                Chronicle Pass is bound to the wallet that pays. Signing a short message proves you
                control it — no passwords, no email login. You can then renew, cancel, update
                delivery preferences, and review payment history.
              </p>
              <ul className="mt-4 space-y-2">
                {PASS_BENEFITS.map((benefit) => (
                  <li
                    key={benefit}
                    className="flex items-start gap-2.5 text-sm text-muted-foreground"
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                      aria-hidden
                    />
                    {benefit}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => void handleAuthenticate()}
              disabled={subscription.isSessionLoading}
              data-testid="subscription-connect-btn"
              className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent text-black font-semibold text-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <ButtonSpinner loading={subscription.isSessionLoading}>Connect wallet</ButtonSpinner>
            </button>
          </div>
          <ActionFeedback action={action} />
        </Surface>
      ) : subscription.isStatusLoading ? (
        <LoadingState
          message="Loading your Chronicle Pass…"
          variant="cards"
          count={3}
          data-testid="subscription-status-loading"
        />
      ) : subscription.statusError ? (
        <RetryState
          title="Failed to load your subscription"
          message={subscription.statusError}
          onRetry={subscription.refresh}
          data-testid="subscription-status-error"
        />
      ) : status ? (
        <>
          {/* Status + period */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
            <Surface className="lg:col-span-2 p-6" data-testid="subscription-status-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <StatusBadge label={badge.label} variant={badge.variant} />
                  {isEntitled ? <StatusBadge label="Access unlocked" variant="success" /> : null}
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {wallet.address ? shortenAddress(wallet.address) : null}
                </span>
              </div>

              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Price</p>
                  <p className="text-xl font-semibold tabular-nums text-foreground">
                    {formatAmount(status.amountPerPeriod)}{" "}
                    <span className="text-xs font-medium text-muted-foreground">
                      {status.currency}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Current period</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(status.currentPeriodStart)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Period ends</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(status.currentPeriodEnd)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Next renewal</p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(status.nextRenewalAt)}
                  </p>
                </div>
              </div>

              {status.periodsPaid > 0 ? (
                <p className="mt-5 text-xs text-muted-foreground">
                  {status.periodsPaid} paid period{status.periodsPaid === 1 ? "" : "s"}
                  {status.lastSettledAt
                    ? ` · last settled ${formatDate(status.lastSettledAt)}`
                    : ""}
                </p>
              ) : null}

              <ActionFeedback action={action} />
            </Surface>

            <Surface className="p-6" data-testid="subscription-actions-card">
              <h3 className="text-base font-semibold text-foreground mb-4">Manage</h3>
              <div className="flex flex-col gap-3">
                {passStatus === "canceling" ? (
                  <button
                    type="button"
                    onClick={() => void handleResume()}
                    data-testid="subscription-resume-btn"
                    className="w-full rounded-xl bg-foreground text-background px-4 py-2.5 text-sm font-semibold hover:bg-foreground/90 transition-colors cursor-pointer"
                  >
                    Resume subscription
                  </button>
                ) : null}

                {(passStatus === "active" || passStatus === "past_due") &&
                !status.cancelAtPeriodEnd ? (
                  <button
                    type="button"
                    onClick={() => void handleRenew()}
                    data-testid="subscription-renew-btn"
                    className="w-full rounded-xl bg-accent text-black px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Renew now · {formatAmount(status.amountPerPeriod)} {status.currency}
                  </button>
                ) : null}

                {isEntitled && passStatus !== "canceling" ? (
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    data-testid="subscription-cancel-btn"
                    className="w-full rounded-xl border border-border bg-background text-foreground px-4 py-2.5 text-sm font-semibold hover:border-rose-500/40 hover:text-rose-500 transition-colors cursor-pointer"
                  >
                    Cancel at period end
                  </button>
                ) : null}
              </div>

              {passStatus === "past_due" ? (
                <p className="mt-4 text-xs leading-relaxed text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2.5">
                  Your period has lapsed. Renew to keep full access — your wallet will authorize the
                  payment.
                </p>
              ) : null}

              {passStatus === "canceling" ? (
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground bg-muted/40 border border-border rounded-xl px-3 py-2.5">
                  Access continues until {formatDate(status.currentPeriodEnd)}. Renew before then to
                  keep your pass without interruption.
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void subscription.logout()}
                data-testid="subscription-logout-btn"
                className="mt-4 w-full rounded-xl text-muted-foreground hover:text-foreground text-xs font-medium px-4 py-2 transition-colors cursor-pointer"
              >
                Disconnect wallet
              </button>
            </Surface>
          </section>

          {/* Upgrade state */}
          {passStatus === "none" ||
          passStatus === "expired" ||
          passStatus === "cancelled" ||
          passStatus === "pending" ? (
            <PageSection
              title="Get Chronicle Pass"
              description="Subscribe with this wallet — $4.99 USDC/month, authorized by you."
              data-testid="subscription-upgrade-section"
            >
              <Surface className="p-6 sm:p-8">
                <form
                  onSubmit={(e) => void handleSubscribe(e)}
                  data-testid="subscription-subscribe-form"
                >
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@protocol.xyz"
                      aria-label="Email for premium digests"
                      className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="submit"
                      disabled={action?.status === "running"}
                      data-testid="subscription-subscribe-btn"
                      className="shrink-0 rounded-xl bg-accent text-black px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <ButtonSpinner loading={action?.status === "running"}>
                        Start Chronicle Pass · {CHRONICLE_PASS_PRICE_USDC.toFixed(2)} USDC/mo
                      </ButtonSpinner>
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                    You'll authorize a one-time USDC payment in your wallet. Renewal happens only
                    when you choose to renew.
                  </p>
                </form>
                <ActionFeedback action={action} />
              </Surface>
            </PageSection>
          ) : null}

          {/* Delivery preferences */}
          {passStatus !== "none" ? (
            <PageSection
              title="Delivery preferences"
              description="Where premium digests and alerts are delivered, and what you receive."
              data-testid="subscription-prefs-section"
            >
              <Surface className="p-6 sm:p-8">
                <form
                  onSubmit={(e) => void handleSavePreferences(e)}
                  data-testid="subscription-prefs-form"
                >
                  <div className="flex flex-col gap-4">
                    <div>
                      <label
                        htmlFor="subscription-email"
                        className="text-sm font-medium text-foreground block mb-1.5"
                      >
                        Delivery email
                      </label>
                      <input
                        id="subscription-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full max-w-md rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4">
                      <label className="flex items-center gap-3 text-sm text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={receivesDigests}
                          onChange={(e) => setReceivesDigests(e.target.checked)}
                          className="h-4 w-4 rounded border-border accent-[var(--accent-primary)]"
                        />
                        Premium digest delivery
                      </label>
                      <label className="flex items-center gap-3 text-sm text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={receivesAlerts}
                          onChange={(e) => setReceivesAlerts(e.target.checked)}
                          className="h-4 w-4 rounded border-border accent-[var(--accent-primary)]"
                        />
                        Free alert notifications
                      </label>
                    </div>
                    <div>
                      <button
                        type="submit"
                        disabled={action?.status === "running"}
                        data-testid="subscription-prefs-save"
                        className="rounded-xl bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Save preferences
                      </button>
                    </div>
                  </div>
                </form>
                <ActionFeedback action={action} />
              </Surface>
            </PageSection>
          ) : null}

          {/* Payment history */}
          <PageSection
            title="Payment history"
            description="Recent settled and pending payments for this wallet."
            data-testid="subscription-payments-section"
          >
            {subscription.isPaymentsLoading ? (
              <LoadingState message="Loading payments…" variant="cards" count={1} />
            ) : subscription.payments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Payments for this wallet will appear here after your first settlement."
                data-testid="subscription-payments-empty"
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border bg-frame">
                <table
                  className="w-full text-sm border-collapse"
                  data-testid="subscription-payments-table"
                >
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      {["Date", "Status", "Amount", "Settlement"].map((col) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {subscription.payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDate(payment.settledAt ?? payment.requestedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={payment.status}
                            variant={
                              payment.status === "settled"
                                ? "success"
                                : payment.status === "expired" || payment.status === "failed"
                                  ? "error"
                                  : "default"
                            }
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-foreground whitespace-nowrap">
                          {formatAmount(payment.amountSettled ?? payment.amountRequested)}{" "}
                          {payment.currency ?? "USDC"}
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                          {shortReference(payment.settlementReference)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PageSection>

          <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
            Chronicle Pass covers human editorial intelligence. Sponsored watches, machine-readable
            feeds, and API products are priced separately — see the{" "}
            <Link
              to="/premium"
              className="font-medium text-accent underline underline-offset-2 hover:opacity-80"
            >
              Premium page
            </Link>{" "}
            for those.
          </p>
        </>
      ) : (
        <RetryState
          title="Nothing to show"
          message="Could not load subscription state."
          onRetry={subscription.refresh}
        />
      )}
    </Page>
  );
}
