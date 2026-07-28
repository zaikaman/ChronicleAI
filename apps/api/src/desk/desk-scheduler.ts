/**
 * In-process Chronicle Desk scheduler (Loop 7 capital + mandatory LLM agent + strategy).
 *
 * Complements KeeperHub-signed POST /keeperhub/desk/capital and /tick so the
 * desk can top up, sweep, and execute approved strategy intents without an
 * external cron. Policy gates (cooldowns, max AUM, single-flight, etc.) still
 * apply inside capital-manager and strategy-runner.
 *
 * Order (plan §5.4):
 *   1. CCTP rebalance (resume + tick) when a worker is wired
 *   2. Capital manager tick
 *   3. Strategy tick (always runs LLM agent first — no legacy path)
 */

import type { DeskControlPlane } from "./control-plane.ts";

/** Minimal CCTP worker surface used as the first autonomy phase. */
export type DeskSchedulerCctpPhase = {
  cycle: () => Promise<unknown>;
  isInFlight?: () => boolean;
};

export type DeskSchedulerOptions = {
  controlPlane: DeskControlPlane;
  /** Wake interval in ms. */
  intervalMs: number;
  /**
   * When true, strategy tick passes execute=true (KeeperHub workflow runs).
   * When false, evaluate/propose only (dry run).
   */
  execute: boolean;
  /**
   * @deprecated LLM agent is always mandatory. Kept for call-site compatibility;
   * ignored (always treated as true).
   */
  agentEnabled?: boolean;
  /**
   * Optional CCTP rebalance phase. When set, each scheduler tick runs
   * resumeInFlight + policy tick before capital (Base → Sepolia).
   */
  cctp?: DeskSchedulerCctpPhase | null;
  /** Optional clock for tests. */
  now?: () => Date;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  /**
   * When false, start() is a no-op (e.g. DESK_WALLET_ADDRESS missing).
   * Default true.
   */
  enabled?: boolean;
};

export type DeskSchedulerHandle = {
  /** Run one capital + agent + strategy cycle (awaits completion). */
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
  /** True while a tick is in flight. */
  isInFlight: () => boolean;
};

/**
 * Create an in-process scheduler that keeps the desk heartbeat fresh, runs
 * Loop 7 capital decisions, the mandatory LLM agent, and strategy intents.
 */
export function createDeskScheduler(options: DeskSchedulerOptions): DeskSchedulerHandle {
  const log = options.log ?? console;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  const enabled = options.enabled !== false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      // 1) CCTP rebalance — Base → Sepolia before any same-chain capital move
      if (options.cctp) {
        try {
          await options.cctp.cycle();
        } catch (error) {
          log.error(
            `[desk-scheduler] cctp cycle failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      // 2) Capital manager — top-up / sweep / emergency eligibility (code-owned)
      try {
        const capital = await options.controlPlane.runCapitalTick({});
        const action = capital.capital.decision.action;
        const amount = capital.capital.decision.amountUsdc;
        const reason = capital.capital.decision.reason;
        const tx = capital.capital.txHash;
        if (action !== "none") {
          log.info(
            `[desk-scheduler] capital action=${action} amountUsdc=${amount} reason=${reason}` +
              (tx ? ` tx=${tx}` : "") +
              (capital.capital.errorMessage
                ? ` error=${capital.capital.errorMessage}`
                : ""),
          );
        } else {
          log.info(
            `[desk-scheduler] capital action=none reason=${reason}` +
              (capital.mark
                ? ` equityUsdc=${capital.mark.equityUsdc}`
                : "") +
              (capital.treasuryUsdc != null
                ? ` treasuryUsdc=${capital.treasuryUsdc}`
                : ""),
          );
        }
      } catch (error) {
        log.error(
          `[desk-scheduler] capital tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // 3) Strategy tick — always runs mandatory LLM agent inside control plane
      //    (no signal→intent bypass). Capital is independent of agent readiness.
      try {
        const agentReady = options.controlPlane.isAgentEnabled();
        if (!agentReady) {
          const blocked =
            options.controlPlane.getAgentBlockedReason?.() ?? "agent_not_ready";
          log.warn(
            `[desk-scheduler] agent fail-closed (${blocked}) — strategy path holds unless force-defend`,
          );
        }

        const deskTick = await options.controlPlane.runDeskTick({
          source: "scheduler",
          execute: options.execute,
          evaluateKill: true,
        });
        const evalCount = deskTick.evaluations.length;
        const execCount = deskTick.executions.length;
        const killArmed = deskTick.kill?.tripped === true;
        const agentAction = deskTick.agentProposal?.action ?? "unknown";
        log.info(
          `[desk-scheduler] strategy execute=${String(options.execute)} ` +
            `agent=${agentAction}` +
            (deskTick.agentProposal?.strategy
              ? ` strategy=${deskTick.agentProposal.strategy}`
              : "") +
            ` evaluations=${evalCount} executions=${execCount}` +
            (deskTick.mark ? ` equityUsdc=${deskTick.mark.equityUsdc}` : "") +
            (killArmed ? " kill=tripped" : "") +
            (deskTick.agentSkippedRisk ? " agent=hold" : "") +
            (deskTick.markError ? ` markError=${deskTick.markError}` : ""),
        );
        for (const ev of deskTick.evaluations) {
          if (ev.planAction !== "ignore") {
            const policyPart =
              ev.policyAllow === true
                ? " policyAllow=true"
                : ev.policyAllow === false
                  ? " policyAllow=false"
                  : "";
            // Surface deny / gate codes after the first plan reasons (slice was hiding them).
            const reasons = ev.reasonCodes ?? [];
            const reasonPart =
              reasons.length > 0
                ? ` reasons=${reasons.slice(0, 8).join(",")}`
                : "";
            log.info(
              `[desk-scheduler] eval strategy=${ev.strategy} action=${ev.planAction}` +
                (ev.intentId ? ` intent=${ev.intentId}` : " intent=none") +
                policyPart +
                reasonPart,
            );
          }
        }
        for (const ex of deskTick.executions) {
          log.info(
            `[desk-scheduler] execution intent=${ex.intent.id} status=${ex.intent.status}` +
              (ex.receipt?.keeperHubRunId
                ? ` run=${ex.receipt.keeperHubRunId}`
                : "") +
              (ex.receipt?.txHash ? ` tx=${ex.receipt.txHash}` : "") +
              (ex.errorMessage ? ` error=${ex.errorMessage}` : ""),
          );
        }
      } catch (error) {
        log.error(
          `[desk-scheduler] strategy tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    tick,
    isInFlight: () => inFlight,
    start() {
      if (!enabled) {
        log.info(
          "[desk-scheduler] disabled (missing DESK_WALLET_ADDRESS or DESK_SCHEDULE_ENABLED=false)",
        );
        return;
      }
      if (timer !== undefined) return;
      // Fire once on boot so funding / signals are acted on without waiting a full interval.
      void tick();
      timer = setInterval(() => {
        void tick();
      }, options.intervalMs);
      timer.unref?.();
      log.info(
        `[desk-scheduler] started (wake every ${options.intervalMs}ms, execute=${String(options.execute)}, agent=mandatory)`,
      );
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
