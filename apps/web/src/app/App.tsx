import type React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { Header } from "../components/header.tsx";
import { ThemeSwitch } from "../components/theme-switch.tsx";
import { SkipToContent } from "../components/skip-to-content.tsx";

/**
 * Layout shell only. Global providers (theme, wallet) live in main.tsx so
 * route changes never remount Wagmi / RainbowKit.
 */
export function App(): React.ReactElement {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-foreground antialiased selection:bg-accent selection:text-black">
      {/* Fixed frame */}
      <div className="site-frame site-frame--top" aria-hidden="true" />
      <div className="site-frame site-frame--bottom" aria-hidden="true" />
      <div className="site-frame site-frame--left" aria-hidden="true" />
      <div className="site-frame site-frame--right" aria-hidden="true" />

      {/* Corner decorations */}
      <svg className="site-corner site-corner--top-left" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z" fill="currentColor"/>
      </svg>
      <svg className="site-corner site-corner--top-right" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z" fill="currentColor"/>
      </svg>
      <svg className="site-corner site-corner--bottom-left" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z" fill="currentColor"/>
      </svg>
      <svg className="site-corner site-corner--bottom-right" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M5.50871e-06 0C-0.00788227 37.3001 8.99616 50.0116 50 50H5.50871e-06V0Z" fill="currentColor"/>
      </svg>

      <Header />
      <ThemeSwitch />
      <SkipToContent />

      <main
        id="main-content"
        className={
          isHomePage
            ? "flex-1 w-full"
            : "flex-1 pt-24 min-[850px]:pt-32 px-6 max-w-5xl mx-auto w-full pb-24"
        }
      >
        <Outlet />
      </main>

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
  );
}
