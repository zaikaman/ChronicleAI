// Shared labels for dual-rail payment discovery on premium UI.

export type PaymentRouteId = "x402" | "mpp" | string;

export interface PaymentRouteDisplay {
  id: string;
  /** Short badge text */
  badge: string;
  /** Human-readable label for panels */
  label: string;
  /** One-line audience hint */
  audience: string;
  badgeVariant: "info" | "default" | "success";
}

export function formatPaymentRoute(route: PaymentRouteId): PaymentRouteDisplay {
  const id = String(route).toLowerCase();
  if (id === "x402") {
    return {
      id: "x402",
      badge: "x402",
      label: "x402 (wallet)",
      audience: "Humans — USDC via browser wallet",
      badgeVariant: "info",
    };
  }
  if (id === "mpp") {
    return {
      id: "mpp",
      badge: "MPP",
      label: "MPP (agent)",
      audience: "Agents — Tempo HMAC micro-billing",
      badgeVariant: "default",
    };
  }
  if (id === "auto") {
    return {
      id: "auto",
      badge: "AUTO",
      label: "Auto Dual-Route (auto)",
      audience: "Dual — Auto-negotiated rail selection",
      badgeVariant: "success",
    };
  }
  return {
    id: String(route),
    badge: String(route).toUpperCase(),
    label: String(route),
    audience: "Payment route",
    badgeVariant: "default",
  };
}

export function sortPaymentRoutes(routes: readonly string[]): string[] {
  const order = ["x402", "mpp", "auto"];
  const unique = [...new Set(routes.map((r) => String(r).toLowerCase()))];
  return unique.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
