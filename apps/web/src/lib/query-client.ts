// Shared TanStack Query client — lives outside the wallet stack so app data
// caching works even when RainbowKit/wagmi are deferred.

import { QueryClient } from "@tanstack/react-query";

/**
 * Module-level client so route / StrictMode remounts do not wipe cache mid-session.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
