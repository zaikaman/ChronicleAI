// Frontend app router with route-level code splitting (React.lazy + Suspense).

import type { RouteDefinition } from "@chronicleai/schemas";
import { type ComponentType, type ReactElement, Suspense, lazy } from "react";
import { type RouteObject, createBrowserRouter } from "react-router-dom";
import { RouteFallback } from "../components/route-fallback.tsx";
import { App } from "./App.tsx";

// ── Lazy product pages (each becomes its own chunk) ─────
// Keep the shell (App) eager; pages load on navigation.

const HomePage = lazy(() =>
  import("../features/home/HomePage.tsx").then((m) => ({ default: m.HomePage })),
);
const PublicationsPage = lazy(() =>
  import("../features/publications/PublicationsPage.tsx").then((m) => ({
    default: m.PublicationsPage,
  })),
);
const AlertsPage = lazy(() =>
  import("../features/alerts/AlertsPage.tsx").then((m) => ({ default: m.AlertsPage })),
);
const AlertDetailPage = lazy(() =>
  import("../features/alerts/AlertDetailPage.tsx").then((m) => ({
    default: m.AlertDetailPage,
  })),
);
const DigestDetailPage = lazy(() =>
  import("../features/digests/DigestDetailPage.tsx").then((m) => ({
    default: m.DigestDetailPage,
  })),
);
const DeskStatusPage = lazy(() =>
  import("../features/desk/DeskStatusPage.tsx").then((m) => ({
    default: m.DeskStatusPage,
  })),
);
const DeskIntentsPage = lazy(() =>
  import("../features/desk/DeskIntentsPage.tsx").then((m) => ({
    default: m.DeskIntentsPage,
  })),
);
const DeskTicketPage = lazy(() =>
  import("../features/desk/DeskTicketPage.tsx").then((m) => ({
    default: m.DeskTicketPage,
  })),
);
const PremiumPage = lazy(() =>
  import("../features/premium/PremiumPage.tsx").then((m) => ({ default: m.PremiumPage })),
);
const SubscriptionPage = lazy(() =>
  import("../features/subscription/SubscriptionPage.tsx").then((m) => ({
    default: m.SubscriptionPage,
  })),
);
const WatchPage = lazy(() =>
  import("../features/watch/WatchPage.tsx").then((m) => ({ default: m.WatchPage })),
);
const SponsoredWatchDetailPage = lazy(() =>
  import("../features/premium/SponsoredWatchDetailPage.tsx").then((m) => ({
    default: m.SponsoredWatchDetailPage,
  })),
);
const AffiliatePage = lazy(() =>
  import("../features/affiliates/AffiliatePage.tsx").then((m) => ({
    default: m.AffiliatePage,
  })),
);
const ActivityPage = lazy(() =>
  import("../features/activity/ActivityPage.tsx").then((m) => ({
    default: m.ActivityPage,
  })),
);
const TransactionsTxtPage = lazy(() =>
  import("../features/activity/TransactionsTxtPage.tsx").then((m) => ({
    default: m.TransactionsTxtPage,
  })),
);

function withSuspense(Page: ComponentType): ReactElement {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Page />
    </Suspense>
  );
}

// ── Route definitions ───────────────────────────────────
export const routeDefinitions: RouteDefinition[] = [
  { id: "home", path: "/", label: "Home" },
  { id: "watch", path: "/watch", label: "Watch" },
  { id: "publications", path: "/publications", label: "Archive" },
  { id: "alerts", path: "/alerts", label: "Alerts" },
  { id: "digests", path: "/digests/latest", label: "Digest" },
  { id: "desk", path: "/desk", label: "Desk" },
  { id: "premium", path: "/premium", label: "Premium" },
  { id: "subscription", path: "/subscription", label: "Subscription" },
  { id: "affiliates", path: "/affiliates", label: "Affiliates" },
  { id: "activity", path: "/activity", label: "Activity" },
  { id: "transactions-txt", path: "/transactions.txt", label: "transactions.txt" },
];

const routes: RouteObject[] = [
  {
    path: "/transactions.txt",
    element: withSuspense(TransactionsTxtPage),
  },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: withSuspense(HomePage) },
      { path: "publications", element: withSuspense(PublicationsPage) },
      { path: "alerts", element: withSuspense(AlertsPage) },
      // HTTPS content URI targets for on-chain registry proofs
      { path: "alerts/:alertId", element: withSuspense(AlertDetailPage) },
      { path: "digests/latest", element: withSuspense(DigestDetailPage) },
      { path: "digests/:digestId", element: withSuspense(DigestDetailPage) },
      { path: "desk", element: withSuspense(DeskStatusPage) },
      { path: "desk/intents", element: withSuspense(DeskIntentsPage) },
      { path: "desk/tickets/:ticketId", element: withSuspense(DeskTicketPage) },
      { path: "watch", element: withSuspense(WatchPage) },
      { path: "watch/:watchId", element: withSuspense(SponsoredWatchDetailPage) },
      { path: "premium", element: withSuspense(PremiumPage) },
      { path: "subscription", element: withSuspense(SubscriptionPage) },
      // HTTPS content-URI target baked into onchain publishSponsoredReport proofs
      { path: "premium/watches/:watchId", element: withSuspense(SponsoredWatchDetailPage) },
      { path: "affiliates", element: withSuspense(AffiliatePage) },
      { path: "activity", element: withSuspense(ActivityPage) },
      { path: "transactions.txt", element: withSuspense(TransactionsTxtPage) },
    ],
  },
];

export const router = createBrowserRouter(routes);
