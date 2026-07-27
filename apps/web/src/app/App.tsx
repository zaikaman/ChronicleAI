import type React from "react";
// Application shell with navigation, layout, and toast provider
import { NavLink, Outlet } from "react-router-dom";
import { Toaster } from "sonner";

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/alerts", label: "Alerts" },
  { to: "/digests/latest", label: "Digest" },
  { to: "/premium", label: "Premium" },
  { to: "/operator", label: "Operator" },
] as const;

export function App(): React.ReactElement {
  return (
    <div className="app-layout">
      <nav className="nav" role="navigation" aria-label="Main navigation">
        <span className="nav-brand">ChronicleAI</span>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="app-content">
        <Outlet />
      </main>

      <footer
        style={{
          textAlign: "center",
          padding: "var(--space-6)",
          borderTop: "1px solid var(--border-primary)",
          fontSize: "var(--font-size-xs)",
          color: "var(--fg-tertiary)",
        }}
      >
        ChronicleAI &mdash; Autonomous On-Chain Intelligence
      </footer>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--bg-glass)",
            backdropFilter: "var(--glass-blur)",
            border: "1px solid var(--border-primary)",
            color: "var(--fg-primary)",
          },
        }}
      />
    </div>
  );
}
