// Lightweight Suspense fallback for lazy-loaded product routes.
// Skeleton (not spinner) so navigation feels like content is arriving, not stalled.

import type { ReactElement } from "react";
import { PageSkeleton } from "./ui/skeleton.tsx";

export function RouteFallback(): ReactElement {
  return (
    <PageSkeleton
      variant="route"
      label="Loading page"
      data-testid="route-fallback"
    />
  );
}
