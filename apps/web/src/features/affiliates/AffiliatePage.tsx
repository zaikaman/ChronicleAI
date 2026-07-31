import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge, TimestampDisplay } from "../../components/data-primitives.tsx";
import {
  Page,
  PageHeader,
  PageSection,
  StatTile,
  Surface,
} from "../../components/page-chrome.tsx";
import { PageSkeleton } from "../../components/ui/skeleton.tsx";
import { ButtonSpinner } from "../../components/ui/spinner.tsx";
import {
  baseSepoliaAddressUrl,
  sepoliaTxUrl,
  truncateHash,
} from "../../lib/explorer.ts";
import { useWallet } from "../wallet";
import { AffiliateAgentChat } from "./AffiliateAgentChat.tsx";
import { useAffiliateAgent, useAffiliateDashboard } from "./use-affiliate.ts";

function formatUsdc(n: number): string {
  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
      .format(n)
      .replace("$", "")
      .trim() + " USDC"
  );
}

export function AffiliatePage(): ReactElement {
  const wallet = useWallet();
  const address = wallet.isConnected && wallet.address ? wallet.address : null;

  const { stats, isLoading, error: dashError, refresh, setStats } =
    useAffiliateDashboard(address);
  const { messages, send, isSending, error: chatError, resetChat } =
    useAffiliateAgent(address, stats?.availableUsdc ?? 0);

  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Clear agent chat when wallet disconnects. Dashboard fetch is owned by React Query.
  useEffect(() => {
    if (!address) {
      resetChat();
    }
  }, [address, resetChat]);

  const referralUrl = useMemo(() => {
    if (!stats?.affiliate.referralLinkPath) return null;
    try {
      return `${window.location.origin}${stats.affiliate.referralLinkPath}`;
    } catch {
      return stats.affiliate.referralLinkPath;
    }
  }, [stats]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await wallet.connect();
    } catch {
      // useWallet surfaces errors
    } finally {
      setConnecting(false);
    }
  }, [wallet]);

  const copyLink = useCallback(async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [referralUrl]);

  const onAgentSend = useCallback(
    (text: string) => {
      void send(text, (next) => {
        if (next) setStats(next);
        else void refresh();
      });
    },
    [send, setStats, refresh],
  );

  return (
    <Page data-testid="affiliate-page">
      <PageHeader
        title="Affiliates"
        description="Share your link. When someone opens it and connects their wallet, they count as your referral. When they buy premium, you earn USDC. Withdrawals run through the payout agent on-chain via KeeperHub."
      />

      {!address ? (
        <PageSection title="Connect to continue">
          <Surface className="p-5 sm:p-6">
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              Connect the wallet you want to use as an affiliate. Your dashboard and payout agent
              open immediately — no separate registration or login.
            </p>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={connecting}
              className="rounded-xl bg-accent text-black px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <ButtonSpinner loading={connecting}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </ButtonSpinner>
            </button>
            {wallet.error ? (
              <p className="mt-3 text-sm text-rose-500" role="alert">
                {wallet.error}
              </p>
            ) : null}
          </Surface>
        </PageSection>
      ) : (
        <div className="flex flex-col gap-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
            <div className="text-sm text-muted-foreground">
              Wallet{" "}
              <a
                href={baseSepoliaAddressUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-foreground hover:underline"
              >
                {truncateHash(address, 8, 6)}
              </a>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isLoading}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Refresh
            </button>
          </div>

          {isLoading && !stats ? (
            <div className="mb-8">
              <PageSkeleton
                variant="stats"
                label="Loading affiliate dashboard"
                data-testid="affiliate-loading"
              />
            </div>
          ) : null}
          {dashError ? (
            <p className="text-sm text-rose-500 mb-8" role="alert">
              {dashError}
            </p>
          ) : null}

          {stats ? (
            <>
              <PageSection title="Earnings overview">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile label="Referred wallets" value={String(stats.referredCount)} />
                  <StatTile label="Total earned" value={formatUsdc(stats.totalEarnedUsdc)} />
                  <StatTile label="Withdrawn" value={formatUsdc(stats.totalWithdrawnUsdc)} />
                  <StatTile label="Available" value={formatUsdc(stats.availableUsdc)} />
                </div>
              </PageSection>

              {referralUrl ? (
                <PageSection
                  title="Your referral link"
                  description="Anyone who opens this link and connects a wallet is attributed to you (first touch). Premium purchases by those wallets credit your balance."
                >
                  <Surface className="p-5">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <code className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-mono text-foreground break-all">
                        {referralUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyLink()}
                        className="rounded-xl bg-accent text-black px-4 py-2.5 text-sm font-semibold shrink-0 hover:opacity-90 transition-opacity"
                      >
                        {copied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                    {stats.affiliate.referralCode ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Code:{" "}
                        <span className="font-mono text-foreground">
                          {stats.affiliate.referralCode}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Your link uses your wallet address as the ref. Share it as-is.
                      </p>
                    )}
                  </Surface>
                </PageSection>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-2 mb-10">
                <AffiliateAgentChat
                  messages={messages}
                  isSending={isSending}
                  error={chatError}
                  onSend={onAgentSend}
                />

                <div className="flex flex-col gap-4">
                  <Surface className="overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <h3 className="text-sm font-semibold text-foreground">Recent referrals</h3>
                    </div>
                    {stats.recentReferrals.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">
                        No referred wallets yet. Share your link.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border max-h-48 overflow-y-auto">
                        {stats.recentReferrals.map((r) => (
                          <li
                            key={r.referredWallet}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm"
                          >
                            <a
                              href={baseSepoliaAddressUrl(r.referredWallet)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {truncateHash(r.referredWallet, 6, 4)}
                            </a>
                            <span className="text-xs text-muted-foreground">
                              <TimestampDisplay timestamp={r.attributedAt} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Surface>

                  <Surface className="overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <h3 className="text-sm font-semibold text-foreground">Earnings</h3>
                    </div>
                    {stats.recentEarnings.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">
                        Credits appear when a referred wallet settles a premium payment.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border max-h-48 overflow-y-auto">
                        {stats.recentEarnings.map((e) => (
                          <li
                            key={e.id}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="tabular-nums font-medium">
                              +{formatUsdc(e.rewardAmount)}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {truncateHash(e.referredWallet, 4, 4)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Surface>

                  <Surface className="overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <h3 className="text-sm font-semibold text-foreground">Withdrawals</h3>
                    </div>
                    {stats.recentWithdrawals.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">
                        Ask the agent to withdraw — each payout is a real KeeperHub execution.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border max-h-48 overflow-y-auto">
                        {stats.recentWithdrawals.map((w) => (
                          <li key={w.id} className="px-4 py-2.5 flex flex-col gap-1 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="tabular-nums font-medium">
                                {formatUsdc(w.amount)}
                              </span>
                              <StatusBadge
                                label={w.status}
                                variant={
                                  w.status === "completed"
                                    ? "success"
                                    : w.status === "failed"
                                      ? "error"
                                      : w.status === "processing"
                                        ? "warning"
                                        : "default"
                                }
                              />
                            </div>
                            {w.payoutTxHash ? (
                              <a
                                href={w.explorerUrl ?? sepoliaTxUrl(w.payoutTxHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {truncateHash(w.payoutTxHash)}
                              </a>
                            ) : null}
                            {w.errorMessage ? (
                              <span className="text-xs text-rose-500">{w.errorMessage}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Surface>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Page>
  );
}
