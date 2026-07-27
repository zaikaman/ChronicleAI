// Frontend app router with route definitions

import type { RouteDefinition } from "@chronicleai/schemas";
import { type RouteObject, createBrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";

import type React from "react";
import { AlertsPage } from "../features/alerts/AlertsPage.tsx";
import { LatestDigestPage } from "../features/digests/LatestDigestPage.tsx";
import { HomePage } from "../features/home/HomePage.tsx";
import { PremiumPage } from "../features/premium/PremiumPage.tsx";
import { ActivityPage } from "../features/activity/ActivityPage.tsx";
import { PublicationsPage } from "../features/publications/PublicationsPage.tsx";

function DigestPage(): React.ReactElement {
  return <LatestDigestPage />;
}

// ── Route definitions ───────────────────────────────────
export const routeDefinitions: RouteDefinition[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "publications", path: "/publications", label: "Archive" },
  { id: "alerts", path: "/alerts", label: "Alerts" },
  { id: "digests", path: "/digests/latest", label: "Digest" },
  { id: "premium", path: "/premium", label: "Premium" },
  { id: "activity", path: "/activity", label: "Activity" },
];

const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "publications", element: <PublicationsPage /> },
      { path: "alerts", element: <AlertsPage /> },
      { path: "digests/latest", element: <DigestPage /> },
      { path: "premium", element: <PremiumPage /> },
      { path: "activity", element: <ActivityPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
