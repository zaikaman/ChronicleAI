import {
  Activity,
  Archive,
  Bell,
  FileText,
  Landmark,
  type LucideIcon,
  Sparkles,
  Users,
} from "lucide-react";

export interface AppNavItem {
  id: string;
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
}

/** Primary product navigation — mirrors routeDefinitions used in the app shell. */
export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    id: "alerts",
    label: "Alerts",
    href: "/alerts",
    description: "Live public market bulletins",
    icon: Bell,
  },
  {
    id: "digests",
    label: "Digest",
    href: "/digests/latest",
    description: "Latest daily intelligence report",
    icon: FileText,
  },
  {
    id: "publications",
    label: "Archive",
    href: "/publications",
    description: "All publications in one feed",
    icon: Archive,
  },
  {
    id: "desk",
    label: "Desk",
    href: "/desk",
    description: "Capital book, intents & trade tickets",
    icon: Landmark,
  },
  {
    id: "premium",
    label: "Premium",
    href: "/premium",
    description: "Paid deep analysis & sponsorships",
    icon: Sparkles,
  },
  {
    id: "affiliates",
    label: "Affiliates",
    href: "/affiliates",
    description: "Referral dashboard & payout agent",
    icon: Users,
  },
  {
    id: "activity",
    label: "Activity",
    href: "/activity",
    description: "Public on-chain agent trail",
    icon: Activity,
  },
];

export function isActiveNavPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // Digest routes share the digests prefix
  if (href === "/digests/latest") {
    return pathname === "/digests/latest" || pathname.startsWith("/digests/");
  }
  // Premium detail watches
  if (href === "/premium") {
    return pathname === "/premium" || pathname.startsWith("/premium/");
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
  return match?.label ?? "Desk";
}
