// Frontend app router with route definitions

import type { RouteDefinition } from "@chronicleai/schemas";
import { type RouteObject, createBrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";

// ── Page components ─────────────────────────────────────
import type React from "react";
import { AlertsPage } from "../features/alerts/AlertsPage.tsx";
import { HomePage } from "../features/home/HomePage.tsx";

function DigestPage(): React.ReactElement {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Latest Digest</h2>
      <p style={{ color: "#a1a1aa" }}>Coming soon in a future phase.</p>
    </div>
  );
}

function PremiumPage(): React.ReactElement {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Premium Intelligence</h2>
      <p style={{ color: "#a1a1aa" }}>Coming soon in a future phase.</p>
    </div>
  );
}

function OperatorPage(): React.ReactElement {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Operator Dashboard</h2>
      <p style={{ color: "#a1a1aa" }}>Coming soon in a future phase.</p>
    </div>
  );
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
