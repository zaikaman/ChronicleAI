/**
 * Server-side tool registry for the desk agent.
 * v1 uses pre-fetched snapshots (Option A). Tools remain callable for Option B
 * multi-round loops and for building context in the control plane.
 */

import type { DeskStrategy } from "@chronicleai/schemas";
import type {
  DeskAgentCapitalMoveSnapshot,
  DeskAgentContext,
  DeskAgentIntentSnapshot,
  DeskAgentMarkSnapshot,
  DeskAgentPolicySnapshot,
  DeskAgentSignalSnapshot,
} from "./types.ts";
import type { GasRegime } from "../types.ts";

export type DeskAgentToolName =
  | "get_desk_status"
  | "get_positions"
  | "list_signals"
  | "list_intents"
  | "list_capital_moves"
  | "get_policy_config";

export interface DeskAgentToolHandlers {
  get_desk_status: () => Promise<{
    equityUsdc: number | null;
    freeUsdc: number | null;
    healthFactor: number | null;
    paused: boolean;
    killSwitchArmed: boolean;
    gasRegime: GasRegime;
  }>;
  get_positions: (opts?: { live?: boolean }) => Promise<DeskAgentMarkSnapshot>;
  list_signals: (limit?: number) => Promise<DeskAgentSignalSnapshot[]>;
  list_intents: (limit?: number) => Promise<DeskAgentIntentSnapshot[]>;
  list_capital_moves: (limit?: number) => Promise<DeskAgentCapitalMoveSnapshot[]>;
  get_policy_config: () => Promise<DeskAgentPolicySnapshot>;
}

export const DESK_AGENT_TOOL_DESCRIPTIONS: Record<
  DeskAgentToolName,
  { description: string; sideEffects: "none" | "optional_mark_persist" }
> = {
  get_desk_status: {
    description: "Public desk status snapshot (equity, HF, pause, kill).",
    sideEffects: "none",
  },
  get_positions: {
    description: "Latest or live mark (inventory + Aave HF).",
    sideEffects: "optional_mark_persist",
  },
  list_signals: {
    description: "Recent signals with features and verdicts.",
    sideEffects: "none",
  },
  list_intents: {
    description: "Recent intents (status, strategy, errors).",
    sideEffects: "none",
  },
  list_capital_moves: {
    description: "Recent top-ups / sweeps / emergency returns.",
    sideEffects: "none",
  },
  get_policy_config: {
    description: "Public policy knobs (no secrets).",
    sideEffects: "none",
  },
};

/**
 * Build a full agent context by invoking all read tools once (Option A snapshot).
 */
export async function buildAgentContextFromTools(
  handlers: DeskAgentToolHandlers,
  opts: {
    chainId: number;
    deskWalletAddress: string | null;
    maxSignals: number;
    openByStrategy?: Partial<Record<DeskStrategy, boolean>>;
    lastFailedByStrategy?: DeskAgentContext["lastFailedByStrategy"];
    gasRegime?: GasRegime;
    gasGwei?: number | null;
  },
): Promise<DeskAgentContext> {
  const [status, mark, signals, intents, capitalMoves, policy] = await Promise.all([
    handlers.get_desk_status(),
    handlers.get_positions({ live: false }),
    handlers.list_signals(opts.maxSignals),
    handlers.list_intents(20),
    handlers.list_capital_moves(10),
    handlers.get_policy_config(),
  ]);

  const lastMove = capitalMoves[0];
  const lastCapitalSummary = lastMove
    ? `${lastMove.direction} ${lastMove.amountUsdc} USDC` +
      (lastMove.reason ? ` (${lastMove.reason})` : "")
    : null;

  const gasRegime: GasRegime =
    opts.gasRegime ?? status.gasRegime ?? policy.gasRegime ?? "normal";

  return {
    chainId: opts.chainId,
    deskWalletAddress: opts.deskWalletAddress,
    mark: {
      ...mark,
      equityUsdc: mark.equityUsdc ?? status.equityUsdc,
      freeUsdc: mark.freeUsdc ?? status.freeUsdc,
      healthFactor: mark.healthFactor ?? status.healthFactor,
    },
    policy: {
      ...policy,
      paused: policy.paused || status.paused,
      killSwitchArmed: policy.killSwitchArmed || status.killSwitchArmed,
      gasRegime,
    },
    signals,
    intents,
    openByStrategy: opts.openByStrategy ?? {},
    lastFailedByStrategy: opts.lastFailedByStrategy ?? {},
    capitalMoves,
    lastCapitalSummary,
    gasRegime,
    gasGwei: opts.gasGwei ?? null,
  };
}

/** Compact digest for desk_agent_runs.context_digest (no secrets). */
export function contextDigest(context: DeskAgentContext): Record<string, unknown> {
  return {
    chainId: context.chainId,
    equityUsdc: context.mark.equityUsdc,
    freeUsdc: context.mark.freeUsdc,
    freeLink: context.mark.freeLink,
    aaveLinkSupplied: context.mark.aaveLinkSupplied ?? null,
    minFreeUsdc: context.policy.minFreeUsdc ?? null,
    healthFactor: context.mark.healthFactor,
    gasRegime: context.gasRegime,
    paused: context.policy.paused,
    kill: context.policy.killSwitchArmed,
    signalCount: context.signals.length,
    signalTypes: context.signals.slice(0, 8).map((s) => s.signalType),
    openByStrategy: context.openByStrategy,
    lastCapital: context.lastCapitalSummary,
  };
}
