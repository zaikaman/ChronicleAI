// Chronicle Pass subscription routes — wallet auth + self-service management.
//
// Auth: POST /subscriptions/auth/{challenge,verify,logout} + GET .../session
// Management (HttpOnly session cookie required): /subscriptions/me/*

import type { SubscriptionAuthVerifyRequest } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";
import type { ChroniclePassAuthService } from "../services/chronicle-pass-auth-service.ts";
import {
  buildChroniclePassSessionClearCookie,
  buildChroniclePassSessionCookie,
  toSubscriptionSessionResponse,
} from "../services/chronicle-pass-auth-service.ts";
import type { ChroniclePassService } from "../services/chronicle-pass-service.ts";
import type {
  NewsletterChallengeResult,
  NewsletterSettleResult,
} from "../services/newsletter-subscription-service.ts";

function toChallengeResponse(result: NewsletterChallengeResult) {
  return {
    subscriptionId: result.subscription.id,
    email: result.subscription.email,
    status: result.subscription.status,
    challengeReference: result.challenge.challengeReference,
    paymentRoute: "x402" as const,
    amountRequested: result.challenge.amountRequested,
    currency: result.challenge.currency,
    expiresAt: result.challenge.expiresAt,
    challengeData: result.challenge.challengeData,
    paymentRecordId: result.paymentRecordId,
    billingPeriodDays: result.subscription.billing_period_days,
    agreementType: "recurring_newsletter" as const,
    periodKind: result.periodKind,
  };
}

function toSettleResponse(result: NewsletterSettleResult) {
  return {
    settled: result.settled,
    subscriptionId: result.subscription.id,
    paymentRecordId: result.paymentRecordId,
    verification: {
      amountSettled: result.verification.amountSettled,
      currency: result.verification.currency,
      settlementReference: result.verification.settlementReference,
      ...(result.verification.payerReference
        ? { payerReference: result.verification.payerReference }
        : {}),
      ...(result.verification.errorMessage
        ? { errorMessage: result.verification.errorMessage }
        : {}),
    },
  };
}

export function createSubscriptionRoutes(params: {
  authService: ChroniclePassAuthService;
  passService: ChroniclePassService;
  /** Secure cookies in production (HTTPS). */
  secureCookies: boolean;
}): RouterType {
  const router: RouterType = Router();

  const requirePassSession = async (
    req: Parameters<Parameters<RouterType["use"]>[1]>[0],
    res: Parameters<Parameters<RouterType["use"]>[1]>[1],
    next: Parameters<Parameters<RouterType["use"]>[1]>[2],
  ): Promise<void> => {
    try {
      const session = await params.authService.resolveSession(
        typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
      );
      if (!session) {
        res.status(401).json({ error: "Subscription session required — connect your wallet" });
        return;
      }
      res.locals.passWallet = session.wallet;
      next();
    } catch (error) {
      next(error);
    }
  };

  // ── Wallet auth ───────────────────────────────────────

  /** POST /subscriptions/auth/challenge — issue a short-lived signed-message challenge. */
  router.post("/subscriptions/auth/challenge", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const wallet = typeof body.wallet === "string" ? body.wallet : "";
      const chainId = typeof body.chainId === "number" ? body.chainId : undefined;
      if (!wallet.trim()) {
        res.status(400).json({ error: "wallet is required" });
        return;
      }
      const challenge = await params.authService.createChallenge({
        wallet,
        chainId,
        userAgent:
          typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        ip: req.ip,
      });
      res.status(201).json(challenge);
    } catch (error) {
      next(error);
    }
  });

  /** POST /subscriptions/auth/verify — verify signature and set the HttpOnly session cookie. */
  router.post("/subscriptions/auth/verify", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as SubscriptionAuthVerifyRequest;
      if (!body.wallet || !body.nonce || !body.message || !body.signature) {
        res.status(400).json({ error: "wallet, nonce, message, and signature are required" });
        return;
      }
      const session = await params.authService.verifyChallenge({
        wallet: body.wallet,
        nonce: body.nonce,
        message: body.message,
        signature: body.signature,
        ...(body.chainId !== undefined ? { chainId: body.chainId } : {}),
      });
      res.setHeader(
        "Set-Cookie",
        buildChroniclePassSessionCookie({
          token: session.token,
          maxAgeSeconds: params.authService.sessionTtlSeconds,
          secure: params.secureCookies,
        }),
      );
      res.json({
        authenticated: true,
        wallet: session.wallet,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      next(error);
    }
  });

  /** POST /subscriptions/auth/logout — revoke the session and clear the cookie. */
  router.post("/subscriptions/auth/logout", async (req, res, next) => {
    try {
      await params.authService.logout(
        typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
      );
      res.setHeader("Set-Cookie", buildChroniclePassSessionClearCookie(params.secureCookies));
      res.json({ authenticated: false, wallet: null, expiresAt: null });
    } catch (error) {
      next(error);
    }
  });

  /** GET /subscriptions/auth/session — current session summary (no side effects). */
  router.get("/subscriptions/auth/session", async (req, res, next) => {
    try {
      const session = await params.authService.resolveSession(
        typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
      );
      res.json(toSubscriptionSessionResponse(session));
    } catch (error) {
      next(error);
    }
  });

  // ── Management (authenticated) ────────────────────────

  /** GET /subscriptions/me — Chronicle Pass status, period, and preferences. */
  router.get("/subscriptions/me", requirePassSession, async (_req, res, next) => {
    try {
      const status = await params.passService.getStatusForWallet(res.locals.passWallet as string);
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  /** PATCH /subscriptions/me — update delivery email and digest/alert preferences. */
  router.patch("/subscriptions/me", requirePassSession, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === "string" ? body.email : undefined;
      const receivesDigests =
        body.receivesDigests === undefined ? undefined : Boolean(body.receivesDigests);
      const receivesAlerts =
        body.receivesAlerts === undefined ? undefined : Boolean(body.receivesAlerts);
      const status = await params.passService.updatePreferences({
        wallet: res.locals.passWallet as string,
        email,
        receivesDigests,
        receivesAlerts,
      });
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  /** POST /subscriptions/me/cancel — cancel at period end (access until current_period_end). */
  router.post("/subscriptions/me/cancel", requirePassSession, async (_req, res, next) => {
    try {
      const status = await params.passService.cancelAtPeriodEnd(res.locals.passWallet as string);
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  /** POST /subscriptions/me/resume — clear cancel-at-period-end. */
  router.post("/subscriptions/me/resume", requirePassSession, async (_req, res, next) => {
    try {
      const status = await params.passService.resume(res.locals.passWallet as string);
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  /** POST /subscriptions/me/renew — issue a new wallet-authorized x402 renewal challenge. */
  router.post("/subscriptions/me/renew", requirePassSession, async (_req, res, next) => {
    try {
      const result = await params.passService.renew(res.locals.passWallet as string);
      res.status(201).json(toChallengeResponse(result));
    } catch (error) {
      next(error);
    }
  });

  /** POST /subscriptions/me/settle — activate the renewed period after wallet settlement. */
  router.post("/subscriptions/me/settle", requirePassSession, async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const challengeReference =
        typeof body.challengeReference === "string" ? body.challengeReference : "";
      const settlementReference =
        typeof body.settlementReference === "string" ? body.settlementReference : "";
      if (!challengeReference || !settlementReference) {
        res.status(400).json({ error: "challengeReference and settlementReference are required" });
        return;
      }
      const result = await params.passService.settle({
        wallet: res.locals.passWallet as string,
        challengeReference,
        settlementReference,
      });
      if (!result.settled) {
        res.status(400).json(toSettleResponse(result));
        return;
      }
      res.json(toSettleResponse(result));
    } catch (error) {
      next(error);
    }
  });

  /** GET /subscriptions/me/payments — bounded, newest-first payment history. */
  router.get("/subscriptions/me/payments", requirePassSession, async (req, res, next) => {
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(50, Math.max(1, Math.floor(rawLimit)))
        : 20;
      const items = await params.passService.listPayments(res.locals.passWallet as string, limit);
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
