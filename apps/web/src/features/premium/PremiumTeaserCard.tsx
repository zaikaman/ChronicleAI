import type { PremiumItemTeaserResponse } from "@chronicleai/schemas";
import type React from "react";
import { StatusBadge } from "../../components/data-primitives.tsx";

interface PremiumTeaserCardProps {
  item: PremiumItemTeaserResponse;
  onAccess: (itemId: string) => void;
  "data-testid"?: string;
}

export function PremiumTeaserCard({
  item,
  onAccess,
  "data-testid": dataTestId = "premium-teaser-card",
}: PremiumTeaserCardProps): React.ReactElement {
  return (
    <div
      className="bg-frame border border-border rounded-2xl p-6 hover:border-accent/40 hover:shadow-md transition-all duration-300 flex flex-col justify-between"
      data-testid={dataTestId}
    >
      <div>
        <div className="flex justify-between items-start mb-3 gap-4">
          <h3 className="text-lg font-semibold text-foreground leading-snug">
            {item.title}
          </h3>
          <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
            {item.paymentRoutes.map((route) => (
              <StatusBadge key={route} label={route.toUpperCase()} variant="info" />
            ))}
          </div>
        </div>

        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          {item.summaryPublic}
        </p>
      </div>

      <div className="flex justify-between items-center text-sm border-t border-border/10 pt-4 mt-auto">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-accent">
            {item.priceAmount}
          </span>
          <span className="text-muted-foreground text-xs">{item.priceCurrency}</span>
        </div>

        <button
          type="button"
          onClick={() => onAccess(item.id)}
          className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded-xl font-semibold text-sm cursor-pointer transition-colors"
          data-testid={`access-btn-${item.id}`}
        >
          Access
        </button>
      </div>
    </div>
  );
}
