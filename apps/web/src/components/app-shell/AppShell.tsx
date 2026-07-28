import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppNav } from "./AppNav.tsx";
import { AppSidebar } from "./AppSidebar.tsx";
import { AppStatusBar } from "./AppStatusBar.tsx";
import { APP_NAV_ITEMS, resolveActiveNavLabel } from "./nav-items.ts";

interface AppShellProps {
  children: ReactNode;
}

/**
 * Full-height product chrome for non-landing routes.
 * Layout vocabulary cloned from PalletMan Studio: top nav + status strip + sidebar + scrollable main.
 */
export function AppShell({ children }: AppShellProps): ReactNode {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sectionLabel = resolveActiveNavLabel(location.pathname);
  const sectionDescription =
    APP_NAV_ITEMS.find((item) => item.label === sectionLabel)?.description;

  // Close mobile drawer + reset scroll on route change
  useEffect(() => {
    setSidebarOpen(false);
    const main = document.getElementById("main-content");
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  // Escape closes drawer
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-background overflow-hidden">
      <AppNav
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        sectionLabel={sectionLabel}
      />
      <AppStatusBar
        sectionLabel={sectionLabel}
        {...(sectionDescription !== undefined
          ? { sectionDescription }
          : {})}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <AppSidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-background outline-none"
        >
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 pb-24">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
