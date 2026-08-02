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
  group: "Core flow" | "Reading" | "Business";
  icon: LucideIcon;
}

/** Primary product navigation — mirrors routeDefinitions used in the app shell. */
export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    id: "alerts",
    label: "Alerts",
    href: "/alerts",
    description: "Public bulletins that feed the desk",
    group: "Core flow",
    icon: Bell,
  },
  {
    id: "desk",
    label: "Desk",
    href: "/desk",
    description: "Signal → policy → action review",
    group: "Core flow",
    icon: Landmark,
  },
  {
    id: "activity",
    label: "Activity",
    href: "/activity",
    description: "Public execution and proof trail",
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
    description: "Past publications and proof records",
    group: "Reading",
    icon: Archive,
  },
  {
    id: "premium",
    label: "Premium",
    href: "/premium",
    description: "Paid intelligence and sponsorships",
    group: "Business",
    icon: Sparkles,
  },
  {
    id: "affiliates",
    label: "Affiliates",
    href: "/affiliates",
    description: "Referral dashboard and payout history",
    group: "Business",
    icon: Users,
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
