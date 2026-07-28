/**
 * Capital urgency copy + prioritization (Role E).
 * Explains top-up/sweep decisions; never executes capital moves itself.
 */

import type { CapitalAction, CapitalDecision } from "../types.ts";

export interface CapitalUrgencyInput {
  decision: CapitalDecision;
  deskEquityUsdc: number;
  freeUsdcOnDesk: number;
  treasuryUsdc: number;
  minAumUsdc: number;
  targetAumUsdc: number;
  maxAumUsdc: number;
  profitSweepUsdc: number;
  /** Optional agent hint: fund before open */
  pendingRiskIncreasingOpen?: boolean | undefined;
}

export interface CapitalUrgencyCopy {
  headline: string;
  body: string;
  priority: "low" | "medium" | "high" | "critical";
  /** Soft recommendation only — capital-manager policy still executes. */
  recommendFundBeforeOpen: boolean;
}

/**
 * Deterministic editorial copy for capital ticks (no LLM required for v2 base).
 * Optional LLM polish can wrap this later without changing policy ownership.
 */
export function explainCapitalDecision(input: CapitalUrgencyInput): CapitalUrgencyCopy {
  const d = input.decision;
  const action: CapitalAction = d.action;

  if (action === "topup") {
    const critical = input.deskEquityUsdc < input.minAumUsdc;
    return {
      headline: critical ? "Top-up required — book under min AUM" : "Top-up approved",
      body:
        `Desk equity ${input.deskEquityUsdc.toFixed(2)} USDC is below target ${input.targetAumUsdc} ` +
        `(min ${input.minAumUsdc}). Transfer ${d.amountUsdc} USDC from treasury ` +
        `(${input.treasuryUsdc.toFixed(2)} available). Reason: ${d.reason}.`,
      priority: critical ? "critical" : "high",
      recommendFundBeforeOpen: Boolean(input.pendingRiskIncreasingOpen) || critical,
    };
  }

  if (action === "sweep") {
    return {
      headline: "Profit sweep",
      body:
        `Free USDC on desk ${input.freeUsdcOnDesk.toFixed(2)} exceeds sweep threshold ` +
        `${input.profitSweepUsdc}. Returning ${d.amountUsdc} USDC to treasury. Reason: ${d.reason}.`,
      priority: "medium",
      recommendFundBeforeOpen: false,
    };
  }

  if (action === "emergency_return") {
    return {
      headline: "Emergency capital return",
      body:
        `Emergency path: ${d.amountUsdc} USDC toward treasury. Reason: ${d.reason}. ` +
        `Desk equity was ${input.deskEquityUsdc.toFixed(2)}.`,
      priority: "critical",
      recommendFundBeforeOpen: false,
    };
  }

  if (action === "free_inventory") {
    const source = d.inventorySource ?? "on-desk inventory";
    return {
      headline: "Free USDC inventory — on-desk unwind",
      body:
        `Free USDC on desk ${input.freeUsdcOnDesk.toFixed(2)} is below the inventory floor. ` +
        `Unwinding ~${d.amountUsdc} USDC via ${source} (not treasury mint). Reason: ${d.reason}.`,
      priority: "high",
      recommendFundBeforeOpen: Boolean(input.pendingRiskIncreasingOpen),
    };
  }

  // none
  const thin =
    input.deskEquityUsdc < input.targetAumUsdc &&
    input.deskEquityUsdc >= input.minAumUsdc;
  const freeShort =
    d.reason.includes("free_usdc") ||
    d.reason.includes("insufficient_collateral_to_free");
  return {
    headline: freeShort ? "Free USDC shortfall — no capital path" : "No capital move",
    body:
      `Book steady at equity ${input.deskEquityUsdc.toFixed(2)} USDC ` +
      `(target ${input.targetAumUsdc}, max ${input.maxAumUsdc}). Reason: ${d.reason}.`,
    priority: freeShort ? "high" : thin ? "medium" : "low",
    recommendFundBeforeOpen:
      Boolean(input.pendingRiskIncreasingOpen) &&
      input.freeUsdcOnDesk < 5,
  };
}
