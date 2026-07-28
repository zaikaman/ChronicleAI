/**
 * Map a validated DeskAgentProposal → strategy selection + notional + legsHint filter.
 */

import type { DeskAgentLegsHint, DeskAgentProposal, DeskStrategy } from "@chronicleai/schemas";

/** Legs hints allowed per strategy. */
export const LEGS_HINT_BY_STRATEGY: Record<DeskStrategy, readonly DeskAgentLegsHint[]> = {
  risk_defend: ["repay_debt", "withdraw_risk", "none"],
  yield_rotation: [
    "usdc_to_link",
    "link_to_usdc",
    "aave_supply_link",
    "aave_withdraw_link",
    "none",
  ],
  oracle_amm: ["usdc_to_weth", "weth_to_usdc", "none"],
};

export interface MappedAgentDecision {
  /** Whether the control plane should skip risk-increasing evaluate/execute. */
  skipRiskIncreasing: boolean;
  /** Strategy the runner should prefer (null = no agent-driven strategy). */
  preferredStrategy: DeskStrategy | null;
  /** Agent notional cap fed into sizeNotional (0 when hold/defer). */
  notionalCapUsdc: number;
  /** Filtered legsHint for the preferred strategy. */
  legsHint: DeskAgentLegsHint[];
  /** True when action is defend or strategy is risk_defend. */
  isDefend: boolean;
  /** Whether agent wants a risk-increasing open (propose with non-defend strategy). */
  riskIncreasingProposal: boolean;
  proposal: DeskAgentProposal;
}

/**
 * Apply min-confidence gate: propose below threshold → treat as hold
 * (caller still applies critical-HF force-defend separately).
 */
export function applyMinConfidence(
  proposal: DeskAgentProposal,
  minConfidence: number,
): DeskAgentProposal {
  if (proposal.action !== "propose") return proposal;
  if (proposal.confidence >= minConfidence) return proposal;
  return {
    ...proposal,
    action: "hold",
    strategy: null,
    notionalUsdc: 0,
    legsHint: ["none"],
    declineReasons: [
      ...proposal.declineReasons,
      `below_min_confidence:${proposal.confidence.toFixed(2)}<${minConfidence}`,
    ],
  };
}

export function mapProposalToDecision(proposal: DeskAgentProposal): MappedAgentDecision {
  const action = proposal.action;

  if (action === "hold" || action === "defer") {
    return {
      skipRiskIncreasing: true,
      preferredStrategy: null,
      notionalCapUsdc: 0,
      legsHint: ["none"],
      isDefend: false,
      riskIncreasingProposal: false,
      proposal,
    };
  }

  if (action === "defend" || proposal.strategy === "risk_defend") {
    const strategy: DeskStrategy = "risk_defend";
    const allowed = new Set(LEGS_HINT_BY_STRATEGY[strategy]);
    const legsHint = proposal.legsHint.filter((h) => allowed.has(h));
    return {
      skipRiskIncreasing: false,
      preferredStrategy: strategy,
      notionalCapUsdc: Math.max(0, proposal.notionalUsdc),
      legsHint: legsHint.length > 0 ? legsHint : ["repay_debt"],
      isDefend: true,
      riskIncreasingProposal: false,
      proposal: {
        ...proposal,
        action: "defend",
        strategy,
      },
    };
  }

  // propose with yield / oracle
  const strategy = proposal.strategy;
  if (!strategy) {
    return {
      skipRiskIncreasing: true,
      preferredStrategy: null,
      notionalCapUsdc: 0,
      legsHint: ["none"],
      isDefend: false,
      riskIncreasingProposal: false,
      proposal: {
        ...proposal,
        action: "hold",
        notionalUsdc: 0,
        declineReasons: [...proposal.declineReasons, "propose_missing_strategy"],
      },
    };
  }

  const allowed = new Set(LEGS_HINT_BY_STRATEGY[strategy]);
  const legsHint = proposal.legsHint.filter((h) => allowed.has(h));

  return {
    skipRiskIncreasing: false,
    preferredStrategy: strategy,
    notionalCapUsdc: Math.max(0, proposal.notionalUsdc),
    legsHint: legsHint.length > 0 ? legsHint : ["none"],
    isDefend: false,
    // yield_rotation / oracle_amm only reach this branch (risk_defend handled above).
    riskIncreasingProposal: true,
    proposal,
  };
}

/**
 * Safety override: when HF is critical and desk is not paused, force defend
 * even if the agent said hold/defer.
 */
export function applyForceDefendOverride(
  proposal: DeskAgentProposal,
  opts: {
    healthFactor: number | null | undefined;
    hfCritical: number;
    paused: boolean;
    forceDefendEnabled: boolean;
  },
): DeskAgentProposal {
  if (!opts.forceDefendEnabled || opts.paused) return proposal;
  const hf = opts.healthFactor;
  if (hf == null || !Number.isFinite(hf) || hf >= opts.hfCritical) {
    return proposal;
  }
  if (proposal.action === "defend" && proposal.strategy === "risk_defend") {
    return proposal;
  }
  // Agent wanted hold/defer or a non-defend propose while HF is critical → override.
  return {
    ...proposal,
    action: "defend",
    strategy: "risk_defend",
    // Keep a positive notional hint if agent had one; runner sizes from free USDC.
    notionalUsdc: proposal.notionalUsdc > 0 ? proposal.notionalUsdc : 0,
    legsHint: ["repay_debt"],
    forceDefendOverride: true,
    declineReasons: proposal.declineReasons.filter((r) => !r.startsWith("below_min_confidence")),
    riskNotes: [
      ...proposal.riskNotes,
      `force_defend_hf_critical:hf=${hf}<${opts.hfCritical}`,
    ],
    thesis:
      proposal.forceDefendOverride || proposal.action === "defend"
        ? proposal.thesis
        : `Code force-defend: health factor ${hf.toFixed(3)} is below critical ${opts.hfCritical}. Agent said ${proposal.action}; desk must delever. ${proposal.thesis}`.slice(
            0,
            800,
          ),
  };
}

/** min(plan, agent, policyMax) for notional sizing. */
export function combineNotional(opts: {
  planNotionalUsdc: number;
  agentNotionalCapUsdc: number | null | undefined;
  policyMaxTradeUsdc: number;
}): number {
  let n = Math.max(0, opts.planNotionalUsdc);
  if (opts.agentNotionalCapUsdc != null && Number.isFinite(opts.agentNotionalCapUsdc)) {
    if (opts.agentNotionalCapUsdc > 0) {
      n = Math.min(n, opts.agentNotionalCapUsdc);
    }
    // agent cap 0 with propose shouldn't open — caller handles via skip
  }
  n = Math.min(n, opts.policyMaxTradeUsdc);
  return n;
}

/**
 * Safety override: when free USDC is below the inventory floor and freeable
 * inventory exists (Aave LINK preferred, else free-wallet LINK), force a
 * yield_rotation propose so maintenance free-powder can run even if the agent
 * said hold/defer or proposed a forever-in yield thesis on absurd APYs.
 */
export function applyForceMaintenanceOverride(
  proposal: DeskAgentProposal,
  opts: {
    freeUsdc: number;
    minFreeUsdc: number;
    /** Freeable Aave LINK human units (or estimate from collateral/price). */
    aaveLinkSupplied: number;
    /** Free (wallet) LINK human units — used when Aave is empty. */
    freeLink?: number | undefined;
    linkUsdPrice: number | null | undefined;
    totalCollateralUsd?: number | undefined;
    totalDebtUsd?: number | undefined;
    maintenanceNotionalUsdc: number;
    maxTradeUsdc: number;
    paused: boolean;
    killSwitchArmed: boolean;
    /** When true (default), override is enabled. */
    forceMaintenanceEnabled?: boolean | undefined;
  },
): DeskAgentProposal {
  if (opts.forceMaintenanceEnabled === false) return proposal;
  if (opts.paused || opts.killSwitchArmed) return proposal;

  const free = Math.max(0, opts.freeUsdc);
  const minFree = Math.max(0, opts.minFreeUsdc);
  if (free + 1e-9 >= minFree) return proposal;

  const price =
    opts.linkUsdPrice != null && opts.linkUsdPrice > 0 ? opts.linkUsdPrice : null;
  if (price == null) return proposal;

  let aaveLink = Math.max(0, opts.aaveLinkSupplied);
  if (aaveLink <= 0) {
    const debt = opts.totalDebtUsd ?? 0;
    const collat = opts.totalCollateralUsd ?? 0;
    if (debt < 0.01 && collat > 0) {
      aaveLink = collat / price;
    }
  }
  const freeLink = Math.max(0, opts.freeLink ?? 0);
  const aaveFreeableUsd = aaveLink > 0 ? aaveLink * price : 0;
  const freeLinkUsd = freeLink > 0 ? freeLink * price : 0;

  // Prefer Aave unwind; fall back to free-wallet LINK when Aave is empty.
  const useAave = aaveFreeableUsd >= 0.5;
  const useFreeLink = !useAave && freeLinkUsd >= 0.5;
  if (!useAave && !useFreeLink) return proposal;

  const freeableUsd = useAave ? aaveFreeableUsd : freeLinkUsd;
  const notional = Math.min(
    opts.maintenanceNotionalUsdc,
    opts.maxTradeUsdc,
    freeableUsd,
    Math.max(minFree - free, opts.maintenanceNotionalUsdc),
  );
  if (notional <= 0) return proposal;

  const legsHint: DeskAgentLegsHint[] = useAave
    ? ["aave_withdraw_link", "link_to_usdc"]
    : ["link_to_usdc"];
  const sourceNote = useAave
    ? `force_maintenance_free_usdc_shortfall:free=${free}<${minFree};source=aave_link`
    : `force_maintenance_free_usdc_shortfall:free=${free}<${minFree};source=free_link`;
  const pathLabel = useAave
    ? `Partial Aave LINK withdraw→USDC (~${notional.toFixed(2)} USDC)`
    : `Free-wallet LINK→USDC (~${notional.toFixed(2)} USDC)`;

  // Already proposing maintenance-shaped yield_rotation — keep / stamp override.
  if (
    proposal.action === "propose" &&
    proposal.strategy === "yield_rotation" &&
    proposal.legsHint.some((h) => h === "aave_withdraw_link" || h === "link_to_usdc")
  ) {
    return {
      ...proposal,
      notionalUsdc: proposal.notionalUsdc > 0 ? proposal.notionalUsdc : notional,
      legsHint:
        proposal.legsHint.filter((h) => h === "aave_withdraw_link" || h === "link_to_usdc")
          .length > 0
          ? proposal.legsHint
          : legsHint,
      forceMaintenanceOverride: true,
      riskNotes: [
        ...proposal.riskNotes.filter((n) => !n.startsWith("force_maintenance")),
        sourceNote,
      ],
    };
  }

  return {
    ...proposal,
    action: "propose",
    strategy: "yield_rotation",
    notionalUsdc: notional,
    legsHint,
    forceMaintenanceOverride: true,
    declineReasons: proposal.declineReasons.filter(
      (r) => !r.startsWith("below_min_confidence"),
    ),
    riskNotes: [...proposal.riskNotes, sourceNote],
    thesis:
      `Code force-maintenance: free USDC ${free.toFixed(2)} is below floor ${minFree}. ` +
      `${pathLabel} restores dry powder. ` +
      `Agent said ${proposal.action}. ${proposal.thesis}`.slice(0, 800),
  };
}
