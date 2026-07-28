/**
 * P3-5: Hover/focus prefetch for lazy route chunks.
 * Mirrors the same dynamic import() paths as the router so Vite shares chunks.
 */

export type PrefetchablePath =
  | "/"
  | "/publications"
  | "/alerts"
  | "/digests/latest"
  | "/desk"
  | "/premium"
  | "/affiliates"
  | "/activity";

const PREFETCHERS: Record<string, () => Promise<unknown>> = {
  "/": () => import("../features/home/HomePage.tsx"),
  "/publications": () => import("../features/publications/PublicationsPage.tsx"),
  "/alerts": () => import("../features/alerts/AlertsPage.tsx"),
  "/digests/latest": () => import("../features/digests/DigestDetailPage.tsx"),
  "/desk": () => import("../features/desk/DeskStatusPage.tsx"),
  "/premium": () => import("../features/premium/PremiumPage.tsx"),
  "/affiliates": () => import("../features/affiliates/AffiliatePage.tsx"),
  "/activity": () => import("../features/activity/ActivityPage.tsx"),
};

/** Paths that have a dedicated lazy chunk prefetcher. */
export const PREFETCHABLE_PATHS = Object.keys(PREFETCHERS);

const prefetched = new Set<string>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Normalize a nav href to a top-level route key used by PREFETCHERS.
 * Detail routes fall back to their list/section chunk.
 */
export function resolvePrefetchKey(href: string): string | null {
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  if (PREFETCHERS[path]) return path;
  if (path.startsWith("/alerts/")) return "/alerts";
  if (path.startsWith("/digests/")) return "/digests/latest";
  if (path.startsWith("/desk/")) return "/desk";
  if (path.startsWith("/premium/")) return "/premium";
  return null;
}

/**
 * Prefetch the lazy route module for a path (no-op if already loaded or unknown).
 * Safe to call from hover/focus handlers — errors are swallowed.
 */
export function prefetchRoute(href: string): void {
  const key = resolvePrefetchKey(href);
  if (!key || prefetched.has(key)) return;

  const existing = inFlight.get(key);
  if (existing) return;

  const load = PREFETCHERS[key];
  if (!load) return;

  const promise = load()
    .then(() => {
      prefetched.add(key);
    })
    .catch(() => {
      // Prefetch is best-effort; navigation will retry the import.
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
}
