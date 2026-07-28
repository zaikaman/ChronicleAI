import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge.tsx";

interface AppStatusBarProps {
  sectionLabel: string;
  sectionDescription?: string;
}

/**
 * Thin context strip under the top nav — same role as PalletMan's connection bar.
 * Surfaces which desk section the reader is in and that the feed is live.
 */
export function AppStatusBar({
  sectionLabel,
  sectionDescription,
}: AppStatusBarProps): ReactNode {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-frame text-sm shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Radio className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden="true" />
        <span className="text-muted-foreground truncate">
          <span className="text-foreground font-medium">{sectionLabel}</span>
          {sectionDescription ? (
            <span className="hidden sm:inline">
              {" "}
              · {sectionDescription}
            </span>
          ) : null}
        </span>
      </div>

      <Badge variant="success" className="ml-auto shrink-0">
        Live
      </Badge>
    </div>
  );
}
