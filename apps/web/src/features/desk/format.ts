// Desk display helpers — calm, editorial labels

export function formatUsdc(amount: number | null | undefined, fractionDigits = 2): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })} USDC`;
}

export function formatHealthFactor(hf: number | null | undefined): string {
  if (hf === null || hf === undefined || !Number.isFinite(hf)) {
    return "—";
  }
  // Aave uses a very large number for “no debt”
  if (hf > 100) return "∞";
  return hf.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function strategyLabel(strategy: string | null | undefined): string {
  switch (strategy) {
    case "risk_defend":
      return "Risk defend";
    case "yield_rotation":
      return "Yield rotation";
    case "oracle_amm":
      return "Oracle–AMM";
    default:
      return strategy ?? "Unknown strategy";
  }
}

export function signalTypeLabel(signalType: string | null | undefined): string {
  if (!signalType) return "Unspecified signal";
  return signalType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function intentStatusVariant(
  status: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "filled":
      return "success";
    case "executing":
    case "approved":
    case "proposed":
      return "info";
    case "deferred":
      return "warning";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "default";
  }
}

export function capitalDirectionLabel(direction: string): string {
  switch (direction) {
    case "topup":
      return "Top-up";
    case "sweep":
      return "Sweep";
    case "emergency_return":
      return "Emergency return";
    default:
      return direction.replace(/_/g, " ");
  }
}

export function capitalDirectionVariant(
  direction: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (direction) {
    case "topup":
      return "info";
    case "sweep":
      return "success";
    case "emergency_return":
      return "error";
    default:
      return "default";
  }
}

export function equityProgress(equity: number | null, target: number, max: number): {
  pctOfTarget: number;
  pctOfMax: number;
  band: "below_min" | "near_target" | "above_target" | "at_ceiling" | "unknown";
} {
  if (equity === null || !Number.isFinite(equity) || target <= 0) {
    return { pctOfTarget: 0, pctOfMax: 0, band: "unknown" };
  }
  const pctOfTarget = (equity / target) * 100;
  const pctOfMax = max > 0 ? (equity / max) * 100 : 0;
  let band: "below_min" | "near_target" | "above_target" | "at_ceiling" | "unknown" =
    "near_target";
  if (equity >= max) band = "at_ceiling";
  else if (equity > target * 1.05) band = "above_target";
  else if (equity < target * 0.8) band = "below_min";
  return { pctOfTarget, pctOfMax, band };
}

/** Extract ticket id from a content URI or absolute path. */
export function ticketIdFromReference(ref: string): string | null {
  try {
    const path = ref.includes("://") ? new URL(ref).pathname : ref;
    const match = path.match(/\/desk\/tickets\/([A-Za-z0-9_-]+)/);
    if (!match?.[1] || match[1] === "pending") return null;
    return match[1];
  } catch {
    return null;
  }
}
