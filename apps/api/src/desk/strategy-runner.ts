/**
 * Strategy runner: signal features → plan → policy → intent → KH workflow → ticket.
 * Wires the three v1 strategies (risk_defend, yield_rotation, oracle_amm).
 */

import type { DeskAgentProposal, DeskStrategy } from "@chronicleai/schemas";
import type { DeskIntentRow, ExecutionLogRepository } from "@chronicleai/db";
import type { ExecutionBridge, DeskWorkflowReceipt } from "./execution-bridge.ts";
import {
  isDeskWorkflowExecutionError,
} from "./execution-bridge.ts";
import type { IntentService } from "./intent-service.ts";
import type { PolicyEngine } from "./policy-engine.ts";
import type { TicketService, TicketPublishResult } from "./ticket-service.ts";
import { softAppendExecutionLog } from "../services/keeperhub-execution-log.ts";
import {
  buildRoutingDetailsFromExecutionRouting,
  resolveExecutionRouting,
  type RoutingDetails,
  type RoutingPolicyEnv,
} from "../services/routing-metadata.ts";
import { createRiskDefendStrategy } from "./strategy-risk.ts";
import {
  createYieldRotationStrategy,
  isFreeLinkPowderLegs,
} from "./strategy-rotation.ts";
import { createOracleAmmStrategy } from "./strategy-oracle-amm.ts";
import {
  AAVE_MAX_UINT256,
  buildWorkflowInputForPlan,
  workflowActionForStrategy,
} from "./workflow-inputs.ts";
import { combineNotional } from "./agent/map-proposal.ts";
import {
  toExecutionAuditLogDetails,
  type DeskAuditGasRegime,
  type DeskExecutionAuditV1,
} from "./execution-audit.ts";
import { createExecutionAuditBuilder } from "./execution-audit-builder.ts";
import type { KhSimulatePreflight } from "./kh-simulate-preflight.ts";
import type {
  DeskPolicyConfig,
  DeskPolicySnapshot,
  DeskSignalFeatures,
  GasRegime,
  PolicyDecision,
  StrategyPlan,
} from "./types.ts";

export interface StrategyInventory {
  freeUsdc: number;
  freeLink?: number | undefined;
  freeWeth?: number | undefined;
  linkUsdPrice?: number | null | undefined;
  ethUsdPrice?: number | null | undefined;
  totalCollateralUsd?: number | undefined;
  totalDebtUsd?: number | undefined;
  aaveLinkSupplied?: number | undefined;
  morphoUsdc?: number | undefined;
  deskEquityUsdc: number;
}

export interface StrategyEvaluateInput {
  strategy: DeskStrategy;
  features: DeskSignalFeatures;
  inventory: StrategyInventory;
  gasRegime: GasRegime;
  killSwitchArmed: boolean;
  openByStrategy: Partial<Record<DeskStrategy, boolean>>;
  hasAnyOpenIntent?: boolean | undefined;
  lastFailedAtMsByStrategy?: Partial<Record<DeskStrategy, number>> | undefined;
  signalId?: string | null | undefined;
  nowMs?: number | undefined;
  /**
   * When set, plan notional is capped by min(plan, agent, policy max)
   * before policy evaluation. Stored on policy_snapshot.agent.
   */
  agentProposal?: DeskAgentProposal | undefined;
  agentNotionalCapUsdc?: number | undefined;
  /**
   * Last successful maintenance fill (ms). When omitted, cadence maintenance
   * is allowed immediately if other inventory conditions hold.
   */
  lastMaintenanceAtMs?: number | null | undefined;
  /**
   * When set, skip strategy.plan() and use this plan (e.g. event microtrade).
   * Still runs policy + intent propose.
   */
  planOverride?: StrategyPlan | undefined;
}

export interface StrategyEvaluateResult {
  plan: StrategyPlan;
  policy?: PolicyDecision | undefined;
  intent?: DeskIntentRow | undefined;
}

export interface StrategyExecuteResult {
  intent: DeskIntentRow;
  receipt?: DeskWorkflowReceipt | undefined;
  ticket?: TicketPublishResult | undefined;
  errorMessage?: string | undefined;
  /** Layer C audit spine assembled during execute (always when execute runs). */
  executionAudit?: DeskExecutionAuditV1 | undefined;
}

export interface StrategyRunner {
  /** Pure plan for one strategy (no DB / no KH). */
  plan(
    strategy: DeskStrategy,
    features: DeskSignalFeatures,
    inventory: StrategyInventory,
    nowMs?: number,
  ): StrategyPlan;

  /**
   * Plan → policy → propose intent when allowed.
   * Does not execute on-chain.
   */
  evaluateAndPropose(input: StrategyEvaluateInput): Promise<StrategyEvaluateResult>;

  /**
   * Execute an approved/proposed intent via KeeperHub workflow, mark filled/failed,
   * optionally publish trade ticket.
   */
  executeIntent(params: {
    intentId: string;
    deskAddress: string;
    inventory: StrategyInventory;
    publishTicket?: boolean | undefined;
    signalType?: string | undefined;
    signalFeatures?: Record<string, unknown> | undefined;
    /**
     * Live on-chain USDC balance of the desk wallet read at execution time.
     * When provided (and below the mark's freeUsdc), the into_aave_link
     * rotation swap + supply are resized to it so the token pull can never
     * exceed the wallet balance (avoids Uniswap 'STF' safe-transfer reverts).
     */
    liveUsdcBalance?: number | undefined;
  }): Promise<StrategyExecuteResult>;
}

export function createStrategyRunner(deps: {
  config: DeskPolicyConfig;
  policy: PolicyEngine;
  intents: IntentService;
  executionBridge?: ExecutionBridge | null | undefined;
  tickets?: TicketService | null | undefined;
  execLogRepo?: ExecutionLogRepository | null | undefined;
  /**
   * Private routing policy env (Phase 2). When set, intent logs and ticket
   * policy include routing metadata for Activity / product surface.
   */
  routingPolicyEnv?: RoutingPolicyEnv | null | undefined;
  /**
   * Layer A: optional KeeperHub DE dry-run of the full active workflow path
   * (all material writes: approve + swap + aave + …) before execute.
   * When null/disabled, C+B path is unchanged.
   */
  khSimulatePreflight?: KhSimulatePreflight | null | undefined;
}): StrategyRunner {
  const risk = createRiskDefendStrategy(deps.config);
  const rotation = createYieldRotationStrategy(deps.config);
  const oracle = createOracleAmmStrategy(deps.config);

  function deskRoutingDetails(action?: string): RoutingDetails | null {
    if (!deps.routingPolicyEnv) return null;
    // Phase 4 control-plane enum: kill always private; desk writes follow DESK flag.
    const routing = resolveExecutionRouting({
      subject:
        action === "kill_switch"
          ? { kind: "kill_switch" }
          : { kind: "desk", strategy: "oracle_amm" },
      env: deps.routingPolicyEnv,
    });
    return buildRoutingDetailsFromExecutionRouting(routing, deps.routingPolicyEnv);
  }

  function plan(
    strategy: DeskStrategy,
    features: DeskSignalFeatures,
    inventory: StrategyInventory,
    nowMs?: number,
    lastMaintenanceAtMs?: number | null,
  ): StrategyPlan {
    switch (strategy) {
      case "risk_defend":
        return risk.plan({
          healthFactor: features.hf ?? null,
          totalCollateralUsd: inventory.totalCollateralUsd ?? features.totalCollateralUsd ?? 0,
          totalDebtUsd: inventory.totalDebtUsd ?? features.totalDebtUsd ?? 0,
          freeUsdc: inventory.freeUsdc,
          freeLink: inventory.freeLink,
          linkUsdPrice: inventory.linkUsdPrice,
          freeWeth: inventory.freeWeth,
          maxTradeUsdc: deps.config.maxTradeUsdc,
        });
      case "yield_rotation":
        return rotation.plan({
          idleUsdcApyBps: features.idleUsdcApyBps ?? 0,
          aaveSupplyApyBps: features.aaveSupplyApyBps ?? 0,
          morphoApyBps: features.morphoApyBps,
          consecutiveEdgePolls: features.consecutiveEdgePolls ?? 0,
          freeUsdc: inventory.freeUsdc,
          aaveLinkSupplied: inventory.aaveLinkSupplied,
          freeLink: inventory.freeLink,
          totalCollateralUsd:
            inventory.totalCollateralUsd ?? features.totalCollateralUsd,
          totalDebtUsd: inventory.totalDebtUsd ?? features.totalDebtUsd,
          linkUsdPrice: inventory.linkUsdPrice,
          morphoUsdc: inventory.morphoUsdc,
          maxTradeUsdc: deps.config.maxTradeUsdc,
          lastMaintenanceAtMs,
          nowMs,
        });
      case "oracle_amm":
        return oracle.plan({
          oraclePrice: features.oraclePrice ?? 0,
          ammPrice: features.ammPrice ?? 0,
          oracleUpdatedAtMs: features.oracleUpdatedAtMs,
          freeUsdc: inventory.freeUsdc,
          freeWeth: inventory.freeWeth ?? 0,
          ethUsdForInventory: inventory.ethUsdPrice,
          maxTradeUsdc: deps.config.maxTradeUsdc,
          nowMs,
        });
      default: {
        const _exhaustive: never = strategy;
        throw new Error(`Unknown strategy: ${_exhaustive}`);
      }
    }
  }

  return {
    plan(strategy, features, inventory, nowMs) {
      return plan(strategy, features, inventory, nowMs, undefined);
    },

    async evaluateAndPropose(input) {
      const proposed =
        input.planOverride ??
        plan(
          input.strategy,
          input.features,
          input.inventory,
          input.nowMs,
          input.lastMaintenanceAtMs,
        );

      if (proposed.action === "ignore") {
        return { plan: proposed };
      }

      // Agent notional is a soft cap into policy sizing (policy may shrink further).
      const agentCappedNotional = combineNotional({
        planNotionalUsdc: proposed.notionalUsdc,
        agentNotionalCapUsdc: input.agentNotionalCapUsdc,
        policyMaxTradeUsdc: deps.config.maxTradeUsdc,
      });

      // If agent explicitly capped to 0 on a risk-increasing path, skip intent.
      // Maintenance free-powder is risk-decreasing and may proceed without agent notional.
      if (
        input.agentNotionalCapUsdc != null &&
        input.agentNotionalCapUsdc <= 0 &&
        proposed.riskIncreasing
      ) {
        return {
          plan: {
            action: "ignore",
            reasonCodes: [
              ...proposed.reasonCodes,
              "agent_notional_zero",
            ],
          },
        };
      }

      const sizedPlan: Extract<StrategyPlan, { action: "propose" }> = {
        ...proposed,
        notionalUsdc: agentCappedNotional > 0 ? agentCappedNotional : proposed.notionalUsdc,
      };

      const decision = deps.policy.evaluate({
        strategy: sizedPlan.strategy,
        riskIncreasing: sizedPlan.riskIncreasing,
        proposedNotionalUsdc: sizedPlan.notionalUsdc,
        deskEquityUsdc: input.inventory.deskEquityUsdc,
        freeUsdc: input.inventory.freeUsdc,
        openByStrategy: input.openByStrategy,
        hasAnyOpenIntent: input.hasAnyOpenIntent,
        gasRegime: input.gasRegime,
        killSwitchArmed: input.killSwitchArmed,
        lastFailedAtMsByStrategy: input.lastFailedAtMsByStrategy,
        simulatedHfAfter: sizedPlan.simulatedHfAfter,
        oracleUpdatedAtMs: input.features.oracleUpdatedAtMs,
        nowMs: input.nowMs,
      });

      if (!decision.allow) {
        return { plan: sizedPlan, policy: decision };
      }

      const snapshot: DeskPolicySnapshot = {
        ...decision.policySnapshot,
        notionalUsdc: decision.sizedNotionalUsdc,
        reasonCodes: [
          ...decision.reasonCodes,
          ...sizedPlan.reasonCodes,
          ...(input.agentProposal ? ["agent_proposal"] : []),
        ],
      };

      if (input.agentProposal) {
        snapshot.agent = input.agentProposal;
      }

      const intent = await deps.intents.propose({
        signalId: input.signalId,
        strategy: sizedPlan.strategy,
        notionalUsdc: decision.sizedNotionalUsdc,
        legs: sizedPlan.legs,
        reasonCodes: sizedPlan.reasonCodes,
        policySnapshot: snapshot,
      });

      return { plan: sizedPlan, policy: decision, intent };
    },

    async executeIntent(params) {
      const intent = await deps.intents.findById(params.intentId);
      if (!intent) {
        throw new Error(`Desk intent not found: ${params.intentId}`);
      }

      const intentStartedAt = new Date().toISOString();
      const routingForIntent = deskRoutingDetails();
      const audit = createExecutionAuditBuilder();

      // Layer C preflight from frozen intent policy snapshot (already evaluated).
      const snap =
        intent.policy_snapshot && typeof intent.policy_snapshot === "object"
          ? (intent.policy_snapshot as DeskPolicySnapshot)
          : null;
      const gasRegimeRaw = snap?.gasRegime;
      const gasRegime: DeskAuditGasRegime | null =
        gasRegimeRaw === "normal" ||
        gasRegimeRaw === "elevated" ||
        gasRegimeRaw === "critical"
          ? gasRegimeRaw
          : null;
      audit.recordPolicyPreflight({
        at: intentStartedAt,
        allow: true,
        reasonCodes: [
          ...(intent.reason_codes ?? []),
          ...(Array.isArray(snap?.reasonCodes) ? snap.reasonCodes : []),
        ],
        simulatedHfAfter:
          typeof snap?.simulatedHfAfter === "number"
            ? snap.simulatedHfAfter
            : null,
        gasRegime,
        notionalUsdc: intent.notional_usdc,
        strategy: intent.strategy,
      });

      const logIntent = async (
        status: "started" | "succeeded" | "failed",
        message: string,
        details: Record<string, unknown> = {},
      ) => {
        const auditSnapshot = audit.hasStages() ? audit.snapshot() : null;
        await softAppendExecutionLog(deps.execLogRepo, {
          action_type: "desk_intent",
          entity_type: "desk_intent",
          entity_id: intent.id,
          status,
          message,
          details: {
            strategy: intent.strategy,
            notionalUsdc: intent.notional_usdc,
            ...(routingForIntent ?? {}),
            ...(auditSnapshot ? toExecutionAuditLogDetails(auditSnapshot) : {}),
            ...details,
          },
          started_at: intentStartedAt,
          completed_at: status === "started" ? null : new Date().toISOString(),
        });
      };

      await logIntent("started", `Desk intent ${intent.id} executing (${intent.strategy})`);

      if (!deps.executionBridge) {
        const failMsg =
          "Execution bridge not configured (set KEEPERHUB_API_KEY + strategy workflow IDs)";
        audit.recordSubmit({
          status: "failed",
          errorMessage: failMsg,
          routing: routingForIntent?.routing ?? null,
          routingStrict: routingForIntent?.routingStrict ?? null,
          routingProvider: routingForIntent?.routingProvider ?? null,
          chainId: routingForIntent?.chainId ?? null,
        });
        audit.recordOutcome({
          status: "failed",
          errorMessage: failMsg,
          txHashes: [],
        });
        const executionAudit = audit.build();
        const failed = await deps.intents.markFailed(intent.id, failMsg);
        await logIntent("failed", failMsg, { reason: "bridge_not_configured" });
        return {
          intent: failed,
          errorMessage: failed.error_message ?? undefined,
          executionAudit,
        };
      }

      const strategy = intent.strategy as DeskStrategy;
      const legs = (intent.legs ?? []) as import("./types.ts").DeskLeg[];
      const planLike: Extract<StrategyPlan, { action: "propose" }> = {
        action: "propose",
        strategy,
        notionalUsdc: intent.notional_usdc,
        legs,
        reasonCodes: intent.reason_codes ?? [],
        riskIncreasing: strategy !== "risk_defend",
        severity: 50,
        policyVerdict: strategy === "risk_defend" ? "defend" : "trade",
      };

      let workflowInput: Record<string, unknown>;
      // Free-wallet LINK→USDC powder uses the single-leg oracle_arb workflow
      // (same path as capital free_inventory free_link) — not Aave rotate.
      const freeLinkPowder =
        strategy === "yield_rotation" &&
        (isFreeLinkPowderLegs(legs) ||
          (intent.reason_codes ?? []).includes("out_of_free_link"));
      // Only USDC-spending rotate-in (USDC→LINK swap + Aave supply) can be
      // capped by the live wallet USDC balance. Exits (out_of_aave_link) and
      // free-LINK powder spend LINK, not USDC — capping their effective
      // notional would shrink the near-full max-uint withdraw detection and
      // reintroduce 1-wei over-size withdraw reverts.
      const rotateIntoAave =
        strategy === "yield_rotation" &&
        !freeLinkPowder &&
        legs.some(
          (l) => l.note === "rotate_usdc_to_link" || l.action === "supply",
        ) &&
        legs.some((l) => l.protocol === "uniswap");
      // Live-balance truth: never let a rotate-in spend more USDC than the
      // wallet holds at execution time (marks can lag a spent wallet and a
      // swap pull would revert with Uniswap 'STF' safe-transfer-failed).
      const liveUsdc =
        rotateIntoAave &&
        params.liveUsdcBalance != null &&
        Number.isFinite(params.liveUsdcBalance) &&
        params.liveUsdcBalance >= 0
          ? params.liveUsdcBalance
          : null;
      const freeUsdcForSizing =
        liveUsdc != null
          ? Math.min(params.inventory.freeUsdc, liveUsdc)
          : params.inventory.freeUsdc;
      // Resize the LINK estimate with the capped notional so the supply leg
      // never asks for more LINK than the (capped) swap can produce.
      const effectiveNotional =
        liveUsdc != null
          ? Math.min(
              intent.notional_usdc,
              freeUsdcForSizing,
              deps.config.maxTradeUsdc,
            )
          : intent.notional_usdc;
      const linkPrice = params.inventory.linkUsdPrice;
      const estimatedLink =
        linkPrice != null && linkPrice > 0
          ? effectiveNotional / linkPrice
          : undefined;
      try {
        workflowInput = buildWorkflowInputForPlan({
          plan: planLike,
          deskAddress: params.deskAddress,
          freeUsdc: freeUsdcForSizing,
          maxTradeUsdc: deps.config.maxTradeUsdc,
          estimatedLinkHuman: estimatedLink,
          linkBalanceHuman: freeLinkPowder
            ? params.inventory.freeLink
            : (params.inventory.aaveLinkSupplied ?? params.inventory.freeLink),
          intentId: intent.id,
          basisBps:
            typeof intent.policy_snapshot === "object" &&
            intent.policy_snapshot &&
            "basisBps" in (intent.policy_snapshot as object)
              ? Number((intent.policy_snapshot as { basisBps?: number }).basisBps)
              : undefined,
          freeLinkPowder,
        });
        // Near-full Aave exit: use max-uint withdraw so Pool settles exact aToken
        // balance (avoids 1-wei over-size reverts from mark/price float).
        if (
          strategy === "yield_rotation" &&
          !freeLinkPowder &&
          workflowInput.direction === "out_of_aave_link" &&
          params.inventory.aaveLinkSupplied != null &&
          params.inventory.aaveLinkSupplied > 0 &&
          estimatedLink != null &&
          estimatedLink >= params.inventory.aaveLinkSupplied * 0.99
        ) {
          workflowInput.amountLink = AAVE_MAX_UINT256;
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Failed to build workflow input";
        audit.recordSubmit({
          status: "failed",
          errorMessage: msg,
          workflowAction: freeLinkPowder
            ? "oracle_arb"
            : workflowActionForStrategy(strategy),
        });
        audit.recordOutcome({
          status: "failed",
          errorMessage: msg,
          txHashes: [],
        });
        const executionAudit = audit.build();
        const failed = await deps.intents.markFailed(intent.id, msg);
        await logIntent("failed", msg, { reason: "workflow_input_build_failed" });
        return { intent: failed, errorMessage: msg, executionAudit };
      }

      const action = freeLinkPowder
        ? "oracle_arb"
        : workflowActionForStrategy(strategy);

      // Layer A — optional KH dry-run (simulate:true only; never DE broadcast).
      let khGasEstimate: string | null = null;
      const khSim = deps.khSimulatePreflight;
      if (khSim?.isEnabled()) {
        // Full active-path dry-run (approve + swap + aave + …), not primary-only.
        const simResult = await khSim.simulateWorkflow({
          strategy,
          workflowAction: action,
          workflowInput,
          deskAddress: params.deskAddress,
          freeLinkPowder,
        });
        audit.recordKhSimulate(simResult.khSimulate);
        if (
          typeof simResult.khSimulate.gasEstimate === "string" &&
          simResult.khSimulate.gasEstimate.length > 0
        ) {
          khGasEstimate = simResult.khSimulate.gasEstimate;
        }

        if (simResult.shouldBlock) {
          const blockReason =
            simResult.blockReason ?? "kh_simulate_would_revert";
          const failMsg =
            simResult.khSimulate.revertReason?.trim() ||
            simResult.khSimulate.errorMessage?.trim() ||
            blockReason;
          const pre = audit.snapshot().stages.preflight;
          audit.setPreflight({
            ...pre,
            status: "failed",
            notes: blockReason,
          });
          audit.recordSubmit({
            status: "skipped",
            workflowAction: action,
            errorMessage: failMsg,
            idempotencyKey: `desk-intent-${intent.id}`,
            routing: routingForIntent?.routing ?? null,
            routingStrict: routingForIntent?.routingStrict ?? null,
            routingProvider: routingForIntent?.routingProvider ?? null,
            chainId: routingForIntent?.chainId ?? null,
          });
          audit.recordOutcome({
            status: "skipped",
            errorMessage: failMsg,
            txHashes: [],
            gasEstimateVsUsed: khGasEstimate
              ? { estimate: khGasEstimate, used: null }
              : null,
          });
          const executionAudit = audit.build();
          const failed = await deps.intents.markFailed(intent.id, failMsg);
          await logIntent("failed", failMsg, {
            reason: blockReason,
            kh_simulate_status: simResult.khSimulate.status,
            would_revert: simResult.khSimulate.wouldRevert ?? null,
          });
          return {
            intent: failed,
            errorMessage: failed.error_message ?? failMsg,
            executionAudit,
          };
        }
      }

      try {
        await deps.intents.markExecuting(intent.id);
        const receipt = await deps.executionBridge.execute(action, workflowInput, {
          wait: true,
          idempotencyKey: `desk-intent-${intent.id}`,
        });

        if (receipt.executionAudit?.submit) {
          audit.mergeSubmit(receipt.executionAudit.submit);
        }
        if (receipt.executionAudit?.outcome) {
          audit.mergeOutcome(receipt.executionAudit.outcome);
        } else {
          // Bridge without fragments (tests/mocks) — still record spine from receipt.
          audit.recordSubmit({
            status: "started",
            keeperHubRunId: receipt.keeperHubRunId,
            workflowAction: action,
            idempotencyKey: `desk-intent-${intent.id}`,
            routing: routingForIntent?.routing ?? null,
            routingStrict: routingForIntent?.routingStrict ?? null,
            routingProvider: routingForIntent?.routingProvider ?? null,
            chainId: routingForIntent?.chainId ?? null,
          });
        }

        if (!receipt.txHash) {
          const failMsg =
            `Strategy workflow completed without tx hash (refusing to log fake fill)` +
            (receipt.status ? ` status=${receipt.status}` : "") +
            (receipt.keeperHubRunId ? ` run=${receipt.keeperHubRunId}` : "");
          audit.recordOutcome({
            status: "failed",
            terminalKhStatus: receipt.status,
            txHashes: [],
            errorMessage: failMsg,
            gasUsed: receipt.gasUsed ?? null,
            gasUsedWei: receipt.gasUsedWei ?? null,
            gasEstimateVsUsed:
              khGasEstimate || receipt.gasUsed
                ? {
                    estimate: khGasEstimate,
                    used: receipt.gasUsed ?? null,
                  }
                : null,
          });
          const executionAudit = audit.build();
          const failed = await deps.intents.markFailed(
            intent.id,
            failMsg,
            receipt.keeperHubRunId,
          );
          await logIntent("failed", failMsg, {
            reason: "no_tx_hash",
            keeper_hub_run_id: receipt.keeperHubRunId,
            executedViaKeeperHub: true,
            action,
            workflow_status: receipt.status,
          });
          return {
            intent: failed,
            receipt,
            errorMessage: failed.error_message ?? undefined,
            executionAudit,
          };
        }

        // Ensure outcome is filled when mock bridge omitted fragments.
        if (!receipt.executionAudit?.outcome) {
          const hashes =
            receipt.txHashes && receipt.txHashes.length > 0
              ? receipt.txHashes
              : [receipt.txHash];
          audit.recordOutcome({
            status: "filled",
            terminalKhStatus: receipt.status,
            txHashes: hashes,
            explorerUrls: receipt.explorerUrls ??
              (receipt.explorerUrl ? [receipt.explorerUrl] : undefined),
            gasUsed: receipt.gasUsed ?? null,
            gasUsedWei: receipt.gasUsedWei ?? null,
            gasEstimateVsUsed:
              khGasEstimate || receipt.gasUsed
                ? {
                    estimate: khGasEstimate,
                    used: receipt.gasUsed ?? null,
                  }
                : null,
          });
        } else if (khGasEstimate) {
          // Bridge attached outcome — still surface dry-run estimate when present.
          const current = audit.snapshot().stages.outcome;
          if (!current.gasEstimateVsUsed?.estimate) {
            audit.mergeOutcome({
              ...current,
              gasEstimateVsUsed: {
                estimate: khGasEstimate,
                used: current.gasUsed ?? current.gasEstimateVsUsed?.used ?? null,
              },
            });
          }
        }

        const executionAudit = audit.build();
        const filled = await deps.intents.markFilled(
          intent.id,
          receipt.keeperHubRunId,
        );

        let ticket: TicketPublishResult | undefined;
        if (params.publishTicket !== false && deps.tickets) {
          const basePolicy =
            (filled.policy_snapshot ?? {}) as Record<string, unknown>;
          const routing = deskRoutingDetails(action);
          ticket = await deps.tickets.publish({
            intentId: filled.id,
            strategy,
            signal: {
              type: params.signalType ?? strategy,
              features: params.signalFeatures ?? {},
            },
            legs,
            fills: (() => {
              const hashes =
                receipt.txHashes && receipt.txHashes.length > 0
                  ? receipt.txHashes
                  : [receipt.txHash];
              const explorers = receipt.explorerUrls ?? [];
              return hashes
                .filter((h) => typeof h === "string" && h.length > 0)
                .map((txHash, step) => ({
                  txHash,
                  step,
                  explorerUrl:
                    (explorers[step] && explorers[step]!.length > 0
                      ? explorers[step]
                      : step === 0
                        ? receipt.explorerUrl
                        : undefined) ?? undefined,
                  keeperHubRunId: receipt.keeperHubRunId,
                }));
            })(),
            policy: {
              ...basePolicy,
              ...(routing ?? {}),
              ...(routing
                ? { execution_routing: routing.routing }
                : {}),
            },
            notionalUsdc: filled.notional_usdc,
            executionAudit,
          });
        }

        await logIntent("succeeded", `Desk intent filled via ${action}`, {
          action,
          keeper_hub_run_id: receipt.keeperHubRunId,
          tx_hash: receipt.txHash,
          explorer_url: receipt.explorerUrl,
          gas_used: receipt.gasUsed ?? null,
          executedViaKeeperHub: true,
          ticketId: ticket?.ticket?.id ?? null,
          ticketRegistryTxHash: ticket?.registryTxHash ?? null,
          ...(liveUsdc != null
            ? {
                live_usdc_capped_notional: effectiveNotional,
                live_usdc_balance: liveUsdc,
              }
            : {}),
        });

        return { intent: filled, receipt, ticket, executionAudit };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Strategy execution failed";

        if (isDeskWorkflowExecutionError(error)) {
          audit.mergeSubmit(error.executionAudit.submit);
          if (error.executionAudit.outcome) {
            audit.mergeOutcome(error.executionAudit.outcome);
          } else {
            audit.recordOutcome({
              status: error.timedOut ? "timeout" : "failed",
              errorMessage: msg,
              txHashes: [],
            });
          }
        } else {
          const current = audit.snapshot();
          if (current.stages.submit.status === "skipped") {
            audit.recordSubmit({
              status: "failed",
              workflowAction: action,
              errorMessage: msg,
              idempotencyKey: `desk-intent-${intent.id}`,
            });
          }
          audit.recordOutcome({
            status: "failed",
            errorMessage: msg,
            txHashes: current.stages.outcome.txHashes ?? [],
          });
        }

        const executionAudit = audit.build();
        const runId = isDeskWorkflowExecutionError(error)
          ? error.keeperHubRunId
          : null;
        const failed = await deps.intents.markFailed(
          intent.id,
          msg,
          runId ?? undefined,
        );
        await logIntent("failed", msg, {
          reason: "execution_failed",
          action,
          error_message: msg,
          ...(runId ? { keeper_hub_run_id: runId } : {}),
          ...(isDeskWorkflowExecutionError(error) && error.timedOut
            ? { timed_out: true }
            : {}),
        });
        return { intent: failed, errorMessage: msg, executionAudit };
      }
    },
  };
}
