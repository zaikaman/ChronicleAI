// Premium x402 desk feed:
// GET /premium/desk/intents
// GET /premium/desk/tickets/:id
// GET /premium/desk/stream
//
// Access: HMAC access receipt issued after settling payment for the desk-feed product.
// Without a valid receipt → 402 with product id + challenge discovery.

import { Router, type Router as RouterType } from "express";
import { badRequest, notFound } from "../errors.ts";
import {
  type DeskControlPlane,
  toPremiumIntent,
  toPremiumTicket,
  toPublicCapitalMove,
} from "../desk/control-plane.ts";
import type { DeskFeedAccessGate } from "../desk/desk-feed-product.ts";
import { PRIVATE_ROUTING_PRODUCT_DESCRIPTION } from "../services/routing-metadata.ts";

function parseLimit(raw: unknown, fallback = 50): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(200, Math.floor(n));
}

export function createPremiumDeskRoutes(deps: {
  controlPlane: DeskControlPlane;
  deskFeedGate: DeskFeedAccessGate;
}): RouterType {
  const router: RouterType = Router();
  const { controlPlane, deskFeedGate } = deps;

  async function requireDeskFeedAccess(
    req: {
      headers: Record<string, string | string[] | undefined>;
      query: Record<string, unknown>;
    },
    res: {
      status: (code: number) => { json: (body: unknown) => void };
    },
  ): Promise<boolean> {
    const access = await deskFeedGate.verifyAccess({
      authorizationHeader:
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : undefined,
      receiptHeader: req.headers["x-premium-access-receipt"],
      receiptQuery: req.query.receipt as string | string[] | undefined,
      cookieHeader:
        typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
    });

    if (access.allowed) {
      return true;
    }

    const product = access.product;
    res.status(402).json({
      error: "Payment required",
      message:
        "Premium desk feed requires a settled x402 payment. " +
        "Create a challenge via POST /payments/challenges with premiumItemId, settle, then retry with the access receipt. " +
        PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
      paymentRoute: "x402",
      supportedPaymentRoutes: product.payment_routes,
      premiumItemId: product.id,
      slug: product.slug,
      priceAmount: product.price_amount,
      priceCurrency: product.price_currency,
      title: product.title,
      summaryPublic: product.summary_public,
      executionRouting: PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
      agentPaymentsDiscovery: "/payments",
      endpoints: {
        challenge: "POST /payments/challenges",
        settle: "POST /payments/settlements",
        intents: "GET /premium/desk/intents",
        ticket: "GET /premium/desk/tickets/:id",
        stream: "GET /premium/desk/stream",
      },
    });
    return false;
  }

  /**
   * GET /premium/desk/intents
   *
   * Full intent + leg detail + policy snapshot (paid).
   */
  router.get("/premium/desk/intents", async (req, res, next) => {
    try {
      const allowed = await requireDeskFeedAccess(req, res);
      if (!allowed) return;

      const limit = parseLimit(req.query.limit);
      const rows = await controlPlane.listIntents(limit);
      res.json({
        intents: rows.map(toPremiumIntent),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/desk/tickets/:id
   *
   * Full ticket payload + hashes (paid).
   */
  router.get("/premium/desk/tickets/:id", async (req, res, next) => {
    try {
      const allowed = await requireDeskFeedAccess(req, res);
      if (!allowed) return;

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

      res.json({
        ticket: toPremiumTicket(ticket),
        hashes: {
          ticketHash: ticket.ticket_hash,
          signalHash: ticket.signal_hash,
          intentHash: ticket.intent_hash,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /premium/desk/stream
   *
   * Machine-readable desk feed snapshot (paid): status + recent intents +
   * tickets + capital moves in one payload for agents.
   */
  router.get("/premium/desk/stream", async (req, res, next) => {
    try {
      const allowed = await requireDeskFeedAccess(req, res);
      if (!allowed) return;

      const limit = parseLimit(req.query.limit, 25);
      const [status, intents, tickets, capitalMoves] = await Promise.all([
        controlPlane.getStatus(),
        controlPlane.listIntents(limit),
        controlPlane.listTickets(limit),
        controlPlane.listCapitalMoves(limit),
      ]);

      res.json({
        feed: "chronicle-desk",
        generatedAt: new Date().toISOString(),
        /** Product / OpenAPI description for agent consumers. */
        description: PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
        executionRouting: {
          description: PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
          policy: status.privateRouting ?? null,
        },
        status,
        intents: intents.map(toPremiumIntent),
        tickets: tickets.map(toPremiumTicket),
        capitalMoves: capitalMoves.map(toPublicCapitalMove),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
