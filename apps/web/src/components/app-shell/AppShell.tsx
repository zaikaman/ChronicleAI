import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppNav } from "./AppNav.tsx";
import { AppSidebar } from "./AppSidebar.tsx";
import { resolveActiveNavLabel } from "./nav-items.ts";

interface AppShellProps {
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getSidebarFocusableElements(): HTMLElement[] {
  const sidebar = document.getElementById("app-sidebar");
  if (!sidebar) return [];

  return Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Full-height product chrome for non-landing routes.
 * Layout vocabulary cloned from PalletMan Studio: top nav + status strip + sidebar + scrollable main.
 */
export function AppShell({ children }: AppShellProps): ReactNode {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasSidebarOpenRef = useRef(false);

  const sectionLabel = resolveActiveNavLabel(location.pathname);
  const { pathname } = location;

  // Close mobile drawer + reset scroll on route change
  useEffect(() => {
    setSidebarOpen(false);
    if (!pathname) return;
    const main = document.getElementById("main-content");
    if (main) main.scrollTop = 0;
  }, [pathname]);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarOpen) {
      setSidebarOpen(false);
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSidebarOpen(true);
  }, [sidebarOpen]);

  // Move focus into the drawer on open and return it to the opener on close.
  useEffect(() => {
    if (!sidebarOpen) {
      if (!wasSidebarOpenRef.current) return;
      wasSidebarOpenRef.current = false;

      const target = sidebarTriggerRef.current ?? restoreFocusRef.current;
      restoreFocusRef.current = null;
      const frame = window.requestAnimationFrame(() => {
        if (target?.isConnected && !target.hasAttribute("disabled")) {
          target.focus();
        }
      });
      return () => window.cancelAnimationFrame(frame);
    }

    wasSidebarOpenRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const [firstFocusable] = getSidebarFocusableElements();
      firstFocusable?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarOpen]);

  // Escape closes the drawer; Tab stays inside the modal navigation.
  useEffect(() => {
    if (!sidebarOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = getSidebarFocusableElements();
      if (focusable.length === 0) {
        e.preventDefault();
        document.getElementById("app-sidebar")?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!document.getElementById("app-sidebar")?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-background overflow-hidden">
      <AppNav
        sidebarOpen={sidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        menuButtonRef={sidebarTriggerRef}
        sectionLabel={sectionLabel}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <AppSidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-background outline-none"
        >
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 pb-24">{children}</div>
        </main>
      </div>
    </div>
  );
}
