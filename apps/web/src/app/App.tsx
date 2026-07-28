import type React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "../components/app-shell/AppShell.tsx";
import { Header } from "../components/header.tsx";
import { SmoothScroll } from "../components/smooth-scroll.tsx";
import { ThemeSwitch } from "../components/theme-switch.tsx";
import { SkipToContent } from "../components/skip-to-content.tsx";
import { ReferralCapture } from "../features/referral/ReferralCapture.tsx";
import { WalletProvider } from "../features/wallet";

/**
 * Layout shell. Theme + React Query live in main.tsx Providers.
 * WalletProvider is here (under the router) so it can defer RainbowKit/wagmi
 * based on route; the layout element does not remount on child navigations.
 *
 * Landing (`/`) keeps the marketing header + site frame + Lenis smooth scroll.
 * Product routes use the studio-style AppShell (top nav + sidebar) with native
 * nested scrolling — Lenis must stay off there or it eats the wheel.
 */
export function App(): React.ReactElement {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  return (
    <WalletProvider>
      <div
        className={
          isHomePage
            ? "min-h-screen flex flex-col bg-background font-sans text-foreground antialiased selection:bg-accent selection:text-black"
            : "h-dvh max-h-dvh flex flex-col bg-background font-sans text-foreground antialiased selection:bg-accent selection:text-black overflow-hidden"
        }
      >
        {/* Lenis only on marketing home — product shell scrolls inside #main-content */}
        <SmoothScroll enabled={isHomePage} />

        <ReferralCapture />
        <SkipToContent />

        {isHomePage ? (
          <>
            {/* Fixed frame — marketing only */}
            <div className="site-frame site-frame--top" aria-hidden="true" />
            <div className="site-frame site-frame--bottom" aria-hidden="true" />
            <div className="site-frame site-frame--left" aria-hidden="true" />
            <div className="site-frame site-frame--right" aria-hidden="true" />

            <svg
              className="site-corner site-corner--top-left"
              width="50"
              height="50"
              viewBox="0 0 50 50"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z"
                fill="currentColor"
              />
            </svg>
            <svg
              className="site-corner site-corner--top-right"
              width="50"
              height="50"
              viewBox="0 0 50 50"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z"
                fill="currentColor"
              />
            </svg>
            <svg
              className="site-corner site-corner--bottom-left"
              width="50"
              height="50"
              viewBox="0 0 50 50"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z"
                fill="currentColor"
              />
            </svg>
            <svg
              className="site-corner site-corner--bottom-right"
              width="50"
              height="50"
              viewBox="0 0 50 50"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z"
                fill="currentColor"
              />
            </svg>

            <Header />
            <ThemeSwitch />

            <main id="main-content" className="flex-1 w-full">
              <Outlet />
            </main>
          </>
        ) : (
          <>
            <ThemeSwitch />
            <AppShell>
              <Outlet />
            </AppShell>
          </>
        )}

        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--background)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            },
          }}
        />
      </div>
    </WalletProvider>
  );
}
