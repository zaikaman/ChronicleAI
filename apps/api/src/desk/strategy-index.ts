/**
 * Strategy priority order and evaluation helpers for v1 desk strategies.
 * risk_defend outranks yield_rotation and oracle_amm (policy-engine mirrors this).
 */

import type { DeskStrategy } from "@chronicleai/schemas";
import { STRATEGY_PRIORITY } from "./policy-engine.ts";

export { STRATEGY_PRIORITY };

/** All v1 strategies in priority order. */
export const V1_STRATEGIES: readonly DeskStrategy[] = [
  "risk_defend",
  "yield_rotation",
  "oracle_amm",
] as const;

export function isV1Strategy(value: string): value is DeskStrategy {
  return (V1_STRATEGIES as readonly string[]).includes(value);
}

/**
 * Pick the first strategy in priority order that has a non-ignore plan
 * and is not blocked by open single-flight.
 */
export function pickStrategyOrder(
  openByStrategy: Partial<Record<DeskStrategy, boolean>>,
  candidates: DeskStrategy[] = [...V1_STRATEGIES],
): DeskStrategy[] {
  const ordered = [...candidates].sort(
    (a, b) => STRATEGY_PRIORITY.indexOf(a) - STRATEGY_PRIORITY.indexOf(b),
  );
  // Prefer evaluating defend even if something else is open (policy allows)
  return ordered.filter((s) => {
    if (s === "risk_defend") return true;
    return !openByStrategy[s];
  });
}
