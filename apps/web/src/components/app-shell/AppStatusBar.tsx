import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge.tsx";

interface AppStatusBarProps {
  sectionLabel: string;
  sectionDescription?: string;
}

/**
 * Thin context strip under the top nav.
 * Surfaces the current product section and whether it is live, published, or product-focused.
 */
export function AppStatusBar({ sectionLabel, sectionDescription }: AppStatusBarProps): ReactNode {
  const isLiveSurface = ["Alerts", "Desk", "Activity"].includes(sectionLabel);
  const status = isLiveSurface
    ? { label: "Live feed", variant: "success" as const }
    : sectionLabel === "Premium" || sectionLabel === "Affiliates"
      ? { label: "Product", variant: "default" as const }
      : { label: "Published", variant: "default" as const };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-frame text-sm shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Radio className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden="true" />
        <span className="text-muted-foreground truncate">
          <span className="text-foreground font-medium">{sectionLabel}</span>
          {sectionDescription ? (
            <span className="hidden sm:inline"> · {sectionDescription}</span>
          ) : null}
        </span>
      </div>

      <Badge variant={status.variant} className="ml-auto shrink-0">
        {status.label}
      </Badge>
    </div>
  );
}
