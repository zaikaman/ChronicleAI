// Frontend app router with route definitions

import type { RouteDefinition } from "@chronicleai/schemas";
import { type RouteObject, createBrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";

import { AlertsPage } from "../features/alerts/AlertsPage.tsx";
import { AlertDetailPage } from "../features/alerts/AlertDetailPage.tsx";
import { DigestDetailPage } from "../features/digests/DigestDetailPage.tsx";
import { HomePage } from "../features/home/HomePage.tsx";
import { PremiumPage } from "../features/premium/PremiumPage.tsx";
import { SponsoredWatchDetailPage } from "../features/premium/SponsoredWatchDetailPage.tsx";
import { ActivityPage } from "../features/activity/ActivityPage.tsx";
import { PublicationsPage } from "../features/publications/PublicationsPage.tsx";

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
      // HTTPS content URI targets for on-chain registry proofs
      { path: "alerts/:alertId", element: <AlertDetailPage /> },
      { path: "digests/latest", element: <DigestDetailPage /> },
      { path: "digests/:digestId", element: <DigestDetailPage /> },
      { path: "premium", element: <PremiumPage /> },
      { path: "premium/watches/:watchId", element: <SponsoredWatchDetailPage /> },
      { path: "activity", element: <ActivityPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
