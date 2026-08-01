// KeeperHub desk routes (signed with the X-ChronicleAI-* HMAC headers):
// POST /keeperhub/desk/signals
// POST /keeperhub/desk/capital
// POST /keeperhub/desk/tick
// POST /keeperhub/desk/agent-tick
// POST /keeperhub/desk/execution-result
// POST /keeperhub/desk/kill

import { Router, type Router as RouterType } from "express";
import { badRequest } from "../errors.ts";
import type { DeskControlPlane } from "../desk/control-plane.ts";
import type { DeskSignalIngestService } from "../desk/signal-ingest-service.ts";

export function createKeeperhubDeskRoutes(deps: {
  signalIngest: DeskSignalIngestService;
  controlPlane: DeskControlPlane;
}): RouterType {
  const router: RouterType = Router();
  const { signalIngest, controlPlane } = deps;

  /**
   * POST /keeperhub/desk/signals
   *
   * Ingest desk poll/event features from KeeperHub workflows.
   * Quality bar (section 9.3): Sepolia-only, numeric features, dedupe_key, source proofs.
   */
  router.post("/keeperhub/desk/signals", async (req, res, next) => {
    try {
      const payload = req.body as Record<string, unknown>;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const result = await signalIngest.ingest(payload);

      if (result.statusCode === 400) {
        next(badRequest(result.message));
        return;
      }

      if (result.statusCode >= 500) {
        res.status(result.statusCode).json({
          accepted: false,
          message: result.message,
        });
        return;
      }

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        deduped: result.deduped ?? false,
        ...(result.signal
          ? {
              signal: {
                id: result.signal.id,
                signalType: result.signal.signalType,
                chainId: result.signal.chainId,
                severity: result.signal.severity,
                policyVerdict: result.signal.policyVerdict,
                dedupeKey: result.signal.dedupeKey,
                features: result.signal.features,
              },
            }
          : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /keeperhub/desk/capital
   *
   * Run Loop 7 capital manager tick (top-up / sweep / emergency).
   * Optional body fields override live marks:
   *   treasuryUsdc, freeUsdcOnDesk, deskEquityUsdc, treasuryEthBalance
   */
  router.post("/keeperhub/desk/capital", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const result = await controlPlane.runCapitalTick(body);
      const capital = result.capital;
      const status =
        capital.errorMessage && capital.decision.action === "none" ? 200 : 200;

      res.status(status).json({
        ok: !capital.errorMessage || capital.decision.action !== "none",
        decision: capital.decision,
        move: capital.move
          ? {
              id: capital.move.id,
              direction: capital.move.direction,
              amountUsdc: capital.move.amount_usdc,
              txHash: capital.move.tx_hash,
              explorerUrl: capital.move.explorer_url,
              createdAt: capital.move.created_at,
            }
          : undefined,
        txHash: capital.txHash,
        explorerUrl: capital.explorerUrl,
        keeperHubRunId: capital.keeperHubRunId,
        registryTxHash: capital.registryTxHash,
        errorMessage: capital.errorMessage,
        mark: result.mark
          ? {
              asOf: result.mark.asOf,
              equityUsdc: result.mark.equityUsdc,
              usdc: result.mark.usdc,
              healthFactor: result.mark.aave.healthFactor,
            }
          : null,
        markError: result.markError,
        treasuryUsdc: result.treasuryUsdc,
        treasuryEth: result.treasuryEth,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /keeperhub/desk/tick
   *
   * Heartbeat + mandatory LLM agent + evaluate only agent-authorized strategies.
   * Body:
   *   source?: "api" | "scheduler" | "workflow"
   *   execute?: boolean — when true, run KH workflows for proposed intents
   *   evaluateKill?: boolean — default true
   *   forceKill?: boolean
   *   signalLimit?: number
   *   agentProposal?: precomputed proposal (skips LLM call; still policy-gated)
   */
  router.post("/keeperhub/desk/tick", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const result = await controlPlane.runDeskTick(body);

      res.status(200).json({
        ok: true,
        heartbeat: {
          id: result.heartbeat.id,
          source: result.heartbeat.source,
          createdAt: result.heartbeat.created_at,
        },
        mark: result.mark
          ? {
              asOf: result.mark.asOf,
              equityUsdc: result.mark.equityUsdc,
              usdc: result.mark.usdc,
              healthFactor: result.mark.aave.healthFactor,
            }
          : null,
        markError: result.markError,
        evaluations: result.evaluations,
        executions: result.executions.map((e) => ({
          intentId: e.intent.id,
          status: e.intent.status,
          strategy: e.intent.strategy,
          keeperHubRunId: e.intent.keeper_hub_run_id,
          txHash: e.receipt?.txHash,
          explorerUrl: e.receipt?.explorerUrl,
          ticketId: e.ticket?.ticket.id,
          ticketHash: e.ticket?.ticketHash,
          errorMessage: e.errorMessage,
        })),
        kill: result.kill
          ? {
              tripped: result.kill.tripped,
              state: result.kill.state,
              txHash: result.kill.receipt?.txHash,
              keeperHubRunId: result.kill.receipt?.keeperHubRunId,
              errorMessage: result.kill.errorMessage,
            }
          : undefined,
        agent: result.agentProposal
          ? {
              action: result.agentProposal.action,
              strategy: result.agentProposal.strategy,
              notionalUsdc: result.agentProposal.notionalUsdc,
              confidence: result.agentProposal.confidence,
              thesis: result.agentProposal.thesis,
              forceDefendOverride: Boolean(result.agentProposal.forceDefendOverride),
              forceMaintenanceOverride: Boolean(
                result.agentProposal.forceMaintenanceOverride,
              ),
              runId: result.agentRunId,
              skippedRisk: result.agentSkippedRisk,
            }
          : undefined,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /keeperhub/desk/agent-tick
   *
   * Force agent + strategy cycle (signed).
   * Body:
   *   execute?: boolean
   *   evaluateKill?: boolean
   *   signalLimit?: number
   */
  router.post("/keeperhub/desk/agent-tick", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const agentOnly = await controlPlane.runAgentOnly(body);
      const tick = await controlPlane.runDeskTick({
        source: "api",
        execute: body.execute === true || body.execute === "true",
        evaluateKill: body.evaluateKill !== false && body.evaluateKill !== "false",
        agentProposal: agentOnly.proposal,
        signalLimit: body.signalLimit,
      });

      res.status(200).json({
        ok: true,
        agent: {
          action: agentOnly.proposal.action,
          strategy: agentOnly.proposal.strategy,
          notionalUsdc: agentOnly.proposal.notionalUsdc,
          confidence: agentOnly.proposal.confidence,
          thesis: agentOnly.proposal.thesis,
          declineReasons: agentOnly.proposal.declineReasons,
          forceDefendOverride: Boolean(agentOnly.proposal.forceDefendOverride),
          forceMaintenanceOverride: Boolean(
            agentOnly.proposal.forceMaintenanceOverride,
          ),
          runId: agentOnly.agentRunId,
          safeDefault: agentOnly.safeDefault,
          errorMessage: agentOnly.errorMessage,
        },
        evaluations: tick.evaluations,
        executions: tick.executions.map((e) => ({
          intentId: e.intent.id,
          status: e.intent.status,
          strategy: e.intent.strategy,
          keeperHubRunId: e.intent.keeper_hub_run_id,
          txHash: e.receipt?.txHash,
          errorMessage: e.errorMessage,
        })),
        mark: tick.mark
          ? {
              asOf: tick.mark.asOf,
              equityUsdc: tick.mark.equityUsdc,
              healthFactor: tick.mark.aave.healthFactor,
            }
          : null,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /keeperhub/desk/execution-result
   *
   * KeeperHub / workflow callback with fill metadata.
   * Body:
   *   intentId: string
   *   success: boolean
   *   keeperHubRunId?: string
   *   fills?: [{ txHash, step, ... }]  — required when success=true
   *   errorMessage?: string
   *   publishTicket?: boolean (default true)
   *   hfAfter?: number
   *   signalType?: string
   *   signalFeatures?: object
   */
  router.post("/keeperhub/desk/execution-result", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      if (typeof body.intentId !== "string" || !body.intentId.trim()) {
        next(badRequest("intentId is required"));
        return;
      }

      if (typeof body.success !== "boolean") {
        next(badRequest("success must be a boolean"));
        return;
      }

      try {
        const result = await controlPlane.applyExecutionResult(body);
        res.status(200).json({
          ok: true,
          intent: {
            id: result.intent.id,
            strategy: result.intent.strategy,
            status: result.intent.status,
            notionalUsdc: result.intent.notional_usdc,
            keeperHubRunId: result.intent.keeper_hub_run_id,
            errorMessage: result.intent.error_message,
          },
          ticket: result.ticket
            ? {
                id: result.ticket.ticket.id,
                ticketHash: result.ticket.ticketHash,
                signalHash: result.ticket.signalHash,
                intentHash: result.ticket.intentHash,
                contentUri: result.ticket.contentUri,
                txHash: result.ticket.registryTxHash,
                explorerUrl: result.ticket.explorerUrl,
                summary: result.ticket.summary,
              }
            : undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "execution-result failed";
        if (message.includes("not found")) {
          res.status(404).json({ ok: false, error: message });
          return;
        }
        if (
          message.includes("required") ||
          message.includes("Illegal") ||
          message.includes("mock")
        ) {
          next(badRequest(message));
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /keeperhub/desk/kill
   *
   * Arm kill switch (signed). Optional trip to execute emergency workflow.
   * Body:
   *   reason?: string
   *   trip?: boolean — when true, run kill-switch workflow after arming
   *   freeUsdcOnDesk?: number
   *   withdrawLink?: boolean
   */
  router.post("/keeperhub/desk/kill", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const result = await controlPlane.armKill(body);

      res.status(200).json({
        ok: true,
        state: result.state,
        trip: result.trip
          ? {
              tripped: result.trip.tripped,
              txHash: result.trip.receipt?.txHash,
              explorerUrl: result.trip.receipt?.explorerUrl,
              keeperHubRunId: result.trip.receipt?.keeperHubRunId,
              errorMessage: result.trip.errorMessage,
            }
          : undefined,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
