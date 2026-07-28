import type { ReactElement } from "react";
import { baseSepoliaAddressUrl, truncateHash } from "../../lib/explorer.ts";
import { StatusBadge } from "../../components/data-primitives.tsx";

export interface ReferralPartner {
  referralAddress: string;
  displayName: string | null;
  referralCode: string | null;
  affiliateStatus: string | null;
  settledPaymentCount: number;
  attributedVolume: number;
  currency: string;
  newsletterSubscriptionCount: number;
}

export interface ReferralAttributionData {
  partners: ReferralPartner[];
  totalReferredVolume: number;
  totalReferredPayments: number;
  currency: string;
}

interface ReferralAttributionPanelProps {
  attribution: ReferralAttributionData;
  "data-testid"?: string;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.length === 3 ? currency : "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function statusVariant(
  status: string | null,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "approved":
      return "success";
    case "pending":
      return "warning";
    case "suspended":
      return "error";
    default:
      return "default";
  }
}

export function ReferralAttributionPanel({
  attribution,
  "data-testid": dataTestId = "referral-attribution-panel",
}: ReferralAttributionPanelProps): ReactElement {
  if (attribution.partners.length === 0) {
    return (
      <div
        data-testid={dataTestId}
        className="rounded-2xl border border-border bg-frame p-6 text-sm text-muted-foreground"
      >
        No referral attribution yet. When a payment or newsletter intent includes an approved
        affiliate wallet, settled volume will appear here with partner identity and totals.
      </div>
    );
  }

  return (
    <div data-testid={dataTestId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground tabular-nums">
            {attribution.totalReferredPayments}
          </span>{" "}
          referred settlements
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="font-semibold text-foreground tabular-nums">
            {formatMoney(attribution.totalReferredVolume, attribution.currency)}
          </span>{" "}
          attributed volume
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="font-semibold text-foreground tabular-nums">
            {attribution.partners.length}
          </span>{" "}
          partner{attribution.partners.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-frame">
        <table className="w-full text-sm text-left border-collapse min-w-[36rem]">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-medium">Partner</th>
              <th className="px-4 py-3 font-medium">Wallet</th>
              <th className="px-4 py-3 font-medium text-right">Settlements</th>
              <th className="px-4 py-3 font-medium text-right">Volume</th>
              <th className="px-4 py-3 font-medium text-right">Newsletters</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {attribution.partners.map((partner) => (
              <tr
                key={partner.referralAddress}
                className="border-b border-border/60 last:border-0"
                data-testid={`referral-row-${partner.referralAddress}`}
              >
                <td className="px-4 py-3 align-middle">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-medium text-foreground truncate">
                      {partner.displayName ?? "Unregistered partner"}
                    </span>
                    {partner.referralCode ? (
                      <code className="font-mono text-[11px] text-muted-foreground">
                        ref={partner.referralCode}
                      </code>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 align-middle">
                  <a
                    href={baseSepoliaAddressUrl(partner.referralAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-accent hover:underline"
                    title={partner.referralAddress}
                  >
                    {truncateHash(partner.referralAddress, 8, 6)}
                  </a>
                </td>
                <td className="px-4 py-3 align-middle text-right tabular-nums text-foreground">
                  {partner.settledPaymentCount}
                </td>
                <td className="px-4 py-3 align-middle text-right tabular-nums text-foreground">
                  {formatMoney(partner.attributedVolume, partner.currency)}
                </td>
                <td className="px-4 py-3 align-middle text-right tabular-nums text-foreground">
                  {partner.newsletterSubscriptionCount}
                </td>
                <td className="px-4 py-3 align-middle">
                  {partner.affiliateStatus ? (
                    <StatusBadge
                      label={partner.affiliateStatus}
                      variant={statusVariant(partner.affiliateStatus)}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">unlisted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
