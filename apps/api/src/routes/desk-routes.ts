// Public desk product routes (no auth):
// GET /desk/status
// GET /desk/positions
// GET /desk/intents
// GET /desk/tickets
// GET /desk/tickets/:id
// GET /desk/capital-moves

import { Router, type Router as RouterType } from "express";
import { badRequest, notFound } from "../errors.ts";
import {
  type DeskControlPlane,
  toPublicCapitalMove,
  toPublicIntent,
  toPublicTicketNarrative,
} from "../desk/control-plane.ts";
import { parsePaginationQuery } from "../lib/pagination.ts";

export function createDeskRoutes(controlPlane: DeskControlPlane): RouterType {
  const router: RouterType = Router();

  /**
   * GET /desk/status
   *
   * Equity, HF, paused, last heartbeat, kill-switch state, policy knobs, last agent.
   */
  router.get("/desk/status", async (_req, res, next) => {
    try {
      const status = await controlPlane.getStatus();
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /desk/agent/latest
   *
   * Public last LLM agent proposal summary (thesis, confidence, action).
   */
  router.get("/desk/agent/latest", async (_req, res, next) => {
    try {
      const agent = await controlPlane.getLatestAgent();
      res.json({
        agent,
        agentEnabled: controlPlane.isAgentEnabled(),
        agentBlockedReason: controlPlane.getAgentBlockedReason(),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /desk/positions
   *
   * Latest desk position snapshot (DB). Optional ?live=1 re-marks via RPC.
   */
  router.get("/desk/positions", async (req, res, next) => {
    try {
      const live =
        req.query.live === "1" ||
        req.query.live === "true" ||
        req.query.live === "yes";

      if (live) {
        try {
          const mark = await controlPlane.markLive(true);
          res.json({
            live: true,
            position: {
              asOf: mark.asOf,
              deskAddress: mark.deskAddress,
              usdc: mark.usdc,
              weth: mark.weth,
              link: mark.link,
              equityUsdc: mark.equityUsdc,
              healthFactor: mark.aave.healthFactor,
              aave: mark.aave,
              ethUsd: mark.ethUsd ?? null,
              linkUsd: mark.linkUsd ?? null,
            },
          });
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Live mark failed";
          // Fall through to latest snapshot with error note
          const latest = await controlPlane.getLatestPosition();
          res.json({
            live: false,
            liveError: message,
            position: latest
              ? {
                  id: latest.id,
                  asOf: latest.as_of,
                  deskAddress: latest.desk_address,
                  usdc: latest.usdc,
                  weth: latest.weth,
                  link: latest.link,
                  equityUsdc: latest.equity_usdc,
                  aave: latest.aave,
                  morpho: latest.morpho,
                  lido: latest.lido,
                  createdAt: latest.created_at,
                }
              : null,
          });
          return;
        }
      }

      const latest = await controlPlane.getLatestPosition();
      res.json({
        live: false,
        position: latest
          ? {
              id: latest.id,
              asOf: latest.as_of,
              deskAddress: latest.desk_address,
              usdc: latest.usdc,
              weth: latest.weth,
              link: latest.link,
              equityUsdc: latest.equity_usdc,
              aave: latest.aave,
              morpho: latest.morpho,
              lido: latest.lido,
              createdAt: latest.created_at,
            }
          : null,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /desk/intents
   *
   * Page-based intents (public summary — no full legs / policy snapshot).
   * Query: page (default 1), limit (default 20, max 100).
   */
  router.get("/desk/intents", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        next(badRequest(parsed.error));
        return;
      }

      const page = await controlPlane.listIntentsPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      res.json({
        intents: page.items.map(toPublicIntent),
        pagination: {
          page: page.page,
          limit: page.limit,
          total: page.total,
          totalPages: page.totalPages,
          hasNextPage: page.hasNextPage,
          hasPreviousPage: page.hasPreviousPage,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /desk/tickets
   *
   * Page-based trade tickets (public narrative). Optional ?signalHash= for
   * alert → “Desk acted” correlation (returns at most one ticket, no pagination).
   */
  router.get("/desk/tickets", async (req, res, next) => {
    try {
      const signalHashRaw = req.query.signalHash;
      const keeperHubRunIdRaw = req.query.keeperHubRunId;
      const txHashRaw = req.query.txHash;

      const signalHash =
        typeof signalHashRaw === "string" && signalHashRaw.trim().length > 0
          ? signalHashRaw.trim()
          : undefined;
      const keeperHubRunId =
        typeof keeperHubRunIdRaw === "string" && keeperHubRunIdRaw.trim().length > 0
          ? keeperHubRunIdRaw.trim()
          : undefined;
      const txHash =
        typeof txHashRaw === "string" && txHashRaw.trim().length > 0
          ? txHashRaw.trim()
          : undefined;

      if (signalHash || keeperHubRunId || txHash) {
        let ticket = null;
        if (keeperHubRunId) {
          ticket = await controlPlane.findTicketByKeeperHubRunId(keeperHubRunId);
        }
        if (!ticket && txHash) {
          ticket = await controlPlane.findTicketByTxHash(txHash);
        }
        if (!ticket && signalHash) {
          ticket = await controlPlane.findTicketBySignalHash(signalHash);
        }
        res.json({
          tickets: ticket ? [toPublicTicketNarrative(ticket)] : [],
          pagination: {
            page: 1,
            limit: 1,
            total: ticket ? 1 : 0,
            totalPages: ticket ? 1 : 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });
        return;
      }

      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 15,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        next(badRequest(parsed.error));
        return;
      }

      const page = await controlPlane.listTicketsPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      res.json({
        tickets: page.items.map(toPublicTicketNarrative),
        pagination: {
          page: page.page,
          limit: page.limit,
          total: page.total,
          totalPages: page.totalPages,
          hasNextPage: page.hasNextPage,
          hasPreviousPage: page.hasPreviousPage,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /desk/tickets/:id
   *
   * Editorial ticket: signal → decision → legs → proofs (public).
   * Full machine-readable payload remains premium-only.
   */
  router.get("/desk/tickets/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!id || typeof id !== "string") {
        next(badRequest("ticket id is required"));
        return;
      }

      const ticket = await controlPlane.getTicket(id);
      if (!ticket) {
        next(notFound("Desk ticket not found"));
        return;
      }

      const narrative = toPublicTicketNarrative(ticket);

      res.json({
        ticket: narrative,
        // Public surface: proof-first, no full canonical payload
        proofs: {
          ticketHash: ticket.ticket_hash,
          signalHash: ticket.signal_hash,
          intentHash: ticket.intent_hash,
          txHash: ticket.tx_hash,
          explorerUrl: ticket.explorer_url,
          keeperHubRunId: ticket.keeper_hub_run_id,
          contentUri: ticket.content_uri,
          fillTxHashes: narrative.fillTxHashes,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /desk/capital-moves
   *
   * Top-ups / sweeps / emergency returns (public audit trail, page-based).
   * Query: page (default 1), limit (default 15, max 100).
   */
  router.get("/desk/capital-moves", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 15,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        next(badRequest(parsed.error));
        return;
      }

      const page = await controlPlane.listCapitalMovesPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      res.json({
        capitalMoves: page.items.map(toPublicCapitalMove),
        pagination: {
          page: page.page,
          limit: page.limit,
          total: page.total,
          totalPages: page.totalPages,
          hasNextPage: page.hasNextPage,
          hasPreviousPage: page.hasPreviousPage,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
