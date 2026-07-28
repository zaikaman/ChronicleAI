import { Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { prefetchRoute } from "@/lib/route-prefetch.ts";
import { APP_NAV_ITEMS, isActiveNavPath } from "./nav-items.ts";

interface AppSidebarProps {
  open: boolean;
  onNavigate?: () => void;
}

/**
 * Left product nav — PalletMan sidebar vocabulary adapted to ChronicleAI sections.
 * Search filters sections; active item uses chartreuse accent (black on lime).
 */
export function AppSidebar({ open, onNavigate }: AppSidebarProps): ReactNode {
  const location = useLocation();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return APP_NAV_ITEMS;
    return APP_NAV_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <>
      {/* Mobile backdrop */}
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-label="Close navigation"
          onClick={onNavigate}
        />
      ) : null}

      <aside
        id="app-sidebar"
        className={`
          flex flex-col border-r border-border bg-frame w-64 shrink-0 h-full
          fixed md:static inset-y-0 left-0 z-40
          transition-transform duration-200 ease-out
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        aria-label="Product navigation"
      >
        {/* Mobile drawer header with close */}
        <div className="md:hidden flex items-center justify-between gap-2 px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background shrink-0">
              CAI
            </div>
            <span className="text-sm font-semibold text-foreground">Sections</span>
          </div>
          <button
            type="button"
            onClick={onNavigate}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3 border-b border-border">
          <label className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search sections…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-w-0"
              aria-label="Search sections"
            />
          </label>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-0.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No sections match
            </p>
          ) : (
            filtered.map((item) => {
              const active = isActiveNavPath(location.pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  onClick={onNavigate}
                  onMouseEnter={() => prefetchRoute(item.href)}
                  onFocus={() => prefetchRoute(item.href)}
                  title={item.description}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-sm transition group ${
                    active
                      ? "bg-accent text-black font-medium"
                      : "text-foreground hover:bg-muted"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${
                      active ? "text-black" : "text-muted-foreground group-hover:text-foreground"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    <span
                      className={`block text-xs font-normal truncate mt-0.5 ${
                        active ? "text-black/70" : "text-muted-foreground"
                      }`}
                    >
                      {item.description}
                    </span>
                  </span>
                </Link>
              );
            })
          )}
        </nav>

        <div className="p-3 border-t border-border">
          <p className="px-1 text-[11px] text-muted-foreground leading-relaxed">
            Verified desk · proofs on-chain
          </p>
        </div>
      </aside>
    </>
  );
}
