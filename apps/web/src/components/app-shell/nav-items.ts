import {
  Activity,
  Archive,
  Bell,
  Eye,
  FileText,
  Landmark,
  type LucideIcon,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";

export interface AppNavItem {
  id: string;
  label: string;
  href: string;
  description: string;
  group: "Core flow" | "Reading" | "Business";
  icon: LucideIcon;
}

/** Primary product navigation — mirrors routeDefinitions used in the app shell. */
export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    id: "watch",
    label: "Watch",
    href: "/watch",
    description: "Monitor wallets, contracts, and protocols",
    group: "Core flow",
    icon: Eye,
  },
  {
    id: "alerts",
    label: "Alerts",
    href: "/alerts",
    description: "Market bulletins and desk signals",
    group: "Core flow",
    icon: Bell,
  },
  {
    id: "desk",
    label: "Desk",
    href: "/desk",
    description: "Review proposals and safety checks",
    group: "Core flow",
    icon: Landmark,
  },
  {
    id: "activity",
    label: "Activity",
    href: "/activity",
    description: "See what happened and verify it",
    group: "Core flow",
    icon: Activity,
  },
  {
    id: "digests",
    label: "Digest",
    href: "/digests/latest",
    description: "Latest intelligence brief",
    group: "Reading",
    icon: FileText,
  },
  {
    id: "publications",
    label: "Archive",
    href: "/publications",
    description: "Past reports and proof",
    group: "Reading",
    icon: Archive,
  },
  {
    id: "subscription",
    label: "Subscription",
    href: "/subscription",
    description: "Chronicle Pass & membership",
    group: "Business",
    icon: Ticket,
  },
  {
    id: "premium",
    label: "Premium",
    href: "/premium",
    description: "Buy deeper market intelligence",
    group: "Business",
    icon: Sparkles,
  },
  {
    id: "affiliates",
    label: "Affiliates",
    href: "/affiliates",
    description: "Referral earnings and payouts",
    group: "Business",
    icon: Users,
  },
];

export function isActiveNavPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // Watch list + friendly detail alias (/watch/:watchId)
  if (href === "/watch") {
    return pathname === "/watch" || pathname.startsWith("/watch/");
  }
  // Digest routes share the digests prefix
  if (href === "/digests/latest") {
    return pathname === "/digests/latest" || pathname.startsWith("/digests/");
  }
  // Premium list + onchain content-URI detail (/premium/watches/:id)
  if (href === "/premium") {
    return pathname === "/premium" || pathname.startsWith("/premium/");
  }
  // Subscription route
  if (href === "/subscription") {
    return pathname === "/subscription" || pathname.startsWith("/subscription/");
  }
  // Alert detail
  if (href === "/alerts") {
    return pathname === "/alerts" || pathname.startsWith("/alerts/");
  }
  // Desk status / intents / tickets
  if (href === "/desk") {
    return pathname === "/desk" || pathname.startsWith("/desk/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveActiveNavLabel(pathname: string): string {
  const match = APP_NAV_ITEMS.find((item) => isActiveNavPath(pathname, item.href));
  return match?.label ?? "Watch";
}
