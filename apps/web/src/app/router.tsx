// Frontend app router with route definitions

import type { RouteDefinition } from "@chronicleai/schemas";
import { type RouteObject, createBrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";

// ── Page components ─────────────────────────────────────
import type React from "react";
import { AlertsPage } from "../features/alerts/AlertsPage.tsx";
import { HomePage } from "../features/home/HomePage.tsx";
import { LatestDigestPage } from "../features/digests/LatestDigestPage.tsx";
import { PremiumPage } from "../features/premium/PremiumPage.tsx";

function DigestPage(): React.ReactElement {
  return <LatestDigestPage />;
}

import { OperatorDashboardPage } from "../features/operator/OperatorDashboardPage.tsx";

function OperatorPage(): React.ReactElement {
  return <OperatorDashboardPage />;
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
