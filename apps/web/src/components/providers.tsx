import { ReducedMotionProvider } from "@/lib/motion";
import { ThemeProvider } from "@/components/theme-provider";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Root providers outside the router.
 * QueryClient is always mounted (feature hooks + dedupe/cache).
 * WalletProvider lives inside App (needs react-router location) and defers
 * RainbowKit/wagmi until connect or payment routes.
 */
export function Providers({ children }: { children: ReactNode }): ReactNode {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ReducedMotionProvider>{children}</ReducedMotionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
