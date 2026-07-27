// Frontend app router with route definitions

import { createBrowserRouter, type RouteObject } from "react-router-dom";
import type { RouteDefinition } from "@chronicleai/schemas";
import { App } from "./App.tsx";

// ── Placeholder page components ─────────────────────────
import type React from "react";

function PlaceholderPage({ title }: { title: string }): React.ReactElement {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>{title}</h2>
      <p style={{ color: "#a1a1aa" }}>Coming soon in a future phase.</p>
    </div>
  );
}

function HomePage(): React.ReactElement {
  return <PlaceholderPage title="ChronicleAI" />;
}

function AlertsPage(): React.ReactElement {
  return <PlaceholderPage title="Public Alerts" />;
}

function DigestPage(): React.ReactElement {
  return <PlaceholderPage title="Latest Digest" />;
}

function PremiumPage(): React.ReactElement {
  return <PlaceholderPage title="Premium Intelligence" />;
}

function OperatorPage(): React.ReactElement {
  return <PlaceholderPage title="Operator Dashboard" />;
}

// ── Route definitions ───────────────────────────────────
export const routeDefinitions: RouteDefinition[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "alerts", path: "/alerts", label: "Alerts" },
  { id: "digests", path: "/digests/latest", label: "Latest Digest" },
  { id: "premium", path: "/premium", label: "Premium" },
  { id: "operator", path: "/operator", label: "Operator", requiresAuth: true },
];

const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "alerts", element: <AlertsPage /> },
      { path: "digests/latest", element: <DigestPage /> },
      { path: "premium", element: <PremiumPage /> },
      { path: "operator", element: <OperatorPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
