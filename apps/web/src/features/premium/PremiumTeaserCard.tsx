import type { PremiumItemTeaserResponse } from "@chronicleai/schemas";
import type React from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";
import { ButtonSpinner } from "../../components/ui/spinner.tsx";
import { formatPaymentRoute, sortPaymentRoutes } from "./payment-route-labels.ts";

interface PremiumTeaserCardProps {
  item: PremiumItemTeaserResponse & {
    contentType?: string;
    slug?: string;
  };
  onAccess: (itemId: string) => void;
  /** True when a session receipt exists for this item (already paid). */
  unlocked?: boolean;
  isLoading?: boolean;
  "data-testid"?: string;
}

function formatContentType(raw?: string): string | null {
  if (!raw?.trim()) return null;
  return raw
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function formatPrice(amount: number, currency: string): { amount: string; currency: string } {
  const formatted =
    Number.isFinite(amount) && amount % 1 !== 0
      ? amount.toFixed(2)
      : String(Number.isFinite(amount) ? amount : 0);
  return { amount: formatted, currency: currency || "USDC" };
}

export function PremiumTeaserCard({
  item,
  onAccess,
  unlocked = false,
  isLoading = false,
  "data-testid": dataTestId = "premium-teaser-card",
}: PremiumTeaserCardProps): React.ReactElement {
  const contentType = formatContentType(item.contentType);
  const price = formatPrice(item.priceAmount, item.priceCurrency);
  const routes = sortPaymentRoutes(item.paymentRoutes ?? []);

  return (
    <article
      className="group bg-frame border border-border rounded-2xl p-6 flex flex-col h-full transition-all duration-300 hover:border-accent/40 hover:shadow-md"
      data-testid={dataTestId}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {unlocked ? <StatusBadge label="Purchased" variant="success" /> : null}
        {contentType ? <StatusBadge label={contentType} variant="info" /> : null}
        {routes.map((route) => {
          const display = formatPaymentRoute(route);
          return (
            <StatusBadge
              key={route}
              label={display.badge}
              variant={display.badgeVariant}
              data-testid={`payment-route-badge-${route}`}
            />
          );
        })}
      </div>

      <h3 className="text-lg font-semibold text-foreground leading-snug text-balance mb-3">
        {item.title}
      </h3>

      <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1 text-pretty">
        {item.summaryPublic}
      </p>

      {routes.length > 0 ? (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {routes.map((r) => formatPaymentRoute(r).label).join(" · ")}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-4 pt-4 border-t border-border mt-auto">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-2xl font-semibold tabular-nums text-accent tracking-tight">
            {price.amount}
          </span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {price.currency}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onAccess(item.id)}
          disabled={isLoading}
          className={
            unlocked
              ? "shrink-0 px-4 py-2.5 bg-accent text-black hover:opacity-90 rounded-xl font-semibold text-sm cursor-pointer transition-opacity disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              : "shrink-0 px-4 py-2.5 bg-foreground text-background hover:bg-foreground/90 rounded-xl font-semibold text-sm cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          }
          data-testid={`access-btn-${item.id}`}
        >
          <ButtonSpinner loading={isLoading}>
            {isLoading ? "Opening…" : unlocked ? "Read report" : "Access"}
          </ButtonSpinner>
        </button>
      </div>
    </article>
  );
}
