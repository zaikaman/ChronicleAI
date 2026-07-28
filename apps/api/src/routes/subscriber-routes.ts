// Public email subscription routes + recurring x402 monthly newsletter agreements

import type { EmailSubscriberRepository } from "@chronicleai/db";
import type { EmailSubscriberSource } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";
import {
  toNewsletterSubscriptionResponse,
  type NewsletterSubscriptionService,
} from "../services/newsletter-subscription-service.ts";

const ALLOWED_SOURCES = new Set<EmailSubscriberSource>(["web", "api", "premium", "import"]);

export function createSubscriberRoutes(
  subscriberRepo: EmailSubscriberRepository,
  newsletterService?: NewsletterSubscriptionService | null,
): RouterType {
  const router: RouterType = Router();

  /**
   * POST /subscribers
   * Free SMTP opt-in for alerts (and optional free digests when not using paid newsletter).
   * Body: { email, receivesDigests?, receivesAlerts?, payerReference?, source? }
   */
  router.post("/subscribers", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Request body is required" });
        return;
      }

      const email = typeof body.email === "string" ? body.email : "";
      if (!email.trim()) {
        res.status(400).json({ error: "email is required" });
        return;
      }

      const receivesDigests =
        body.receivesDigests === undefined ? true : Boolean(body.receivesDigests);
      const receivesAlerts =
        body.receivesAlerts === undefined ? true : Boolean(body.receivesAlerts);

      let source: EmailSubscriberSource = "web";
      if (body.source !== undefined) {
        if (
          typeof body.source !== "string" ||
          !ALLOWED_SOURCES.has(body.source as EmailSubscriberSource)
        ) {
          res.status(400).json({ error: "source must be one of: web, api, premium, import" });
          return;
        }
        source = body.source as EmailSubscriberSource;
      }

      const subscribeInput: {
        email: string;
        receivesDigests: boolean;
        receivesAlerts: boolean;
        source: EmailSubscriberSource;
        payerReference?: string | null;
      } = {
        email,
        receivesDigests,
        receivesAlerts,
        source,
      };
      if (typeof body.payerReference === "string") {
        subscribeInput.payerReference = body.payerReference;
      }

      const result = await subscriberRepo.subscribe(subscribeInput);

      if (!result.ok) {
        const status = result.error.statusCode || 500;
        res.status(status).json({ error: result.error.message, code: result.error.code });
        return;
      }

      const { subscriber, reactivated, created } = result.value;
      res.status(created ? 201 : 200).json({
        email: subscriber.email,
        status: subscriber.status,
        receivesDigests: subscriber.receives_digests,
        receivesAlerts: subscriber.receives_alerts,
        reactivated,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /subscribers/unsubscribe
   * Body: { email? } or { token? } — at least one required
   */
  router.post("/subscribers/unsubscribe", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const token = typeof body.token === "string" ? body.token.trim() : "";

      if (!email && !token) {
        res.status(400).json({ error: "email or token is required" });
        return;
      }

      const result = token
        ? await subscriberRepo.unsubscribeByToken(token)
        : await subscriberRepo.unsubscribeByEmail(email);

      if (!result.ok) {
        const status = result.error.statusCode || 500;
        res.status(status).json({ error: result.error.message, code: result.error.code });
        return;
      }

      if (!result.value) {
        res.status(404).json({ error: "Subscriber not found" });
        return;
      }

      res.json({
        email: result.value.email,
        status: result.value.status,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /subscribers/unsubscribe?token=...
   * One-click / email-link unsubscribe (browser-friendly).
   */
  router.get("/subscribers/unsubscribe", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
      const email = typeof req.query.email === "string" ? req.query.email.trim() : "";

      if (!token && !email) {
        res.status(400).json({ error: "token or email query parameter is required" });
        return;
      }

      const result = token
        ? await subscriberRepo.unsubscribeByToken(token)
        : await subscriberRepo.unsubscribeByEmail(email);

      if (!result.ok) {
        const status = result.error.statusCode || 500;
        res.status(status).json({ error: result.error.message, code: result.error.code });
        return;
      }

      if (!result.value) {
        res.status(404).json({ error: "Subscriber not found" });
        return;
      }

      res.json({
        email: result.value.email,
        status: result.value.status,
        message: "You have been unsubscribed from ChronicleAI email updates.",
      });
    } catch (error) {
      next(error);
    }
  });

  // ── Recurring x402 monthly newsletter ─────────────────

  /**
   * POST /subscribers/newsletter/subscribe
   * Start a recurring x402 agreement: issues an initial-period payment challenge.
   * Body: { email, payerReference?, referralAddress? }
   */
  router.post("/subscribers/newsletter/subscribe", async (req, res, next) => {
    try {
      if (!newsletterService) {
        res.status(503).json({ error: "Newsletter subscription service is not configured" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === "string" ? body.email : "";
      if (!email.trim()) {
        res.status(400).json({ error: "email is required" });
        return;
      }

      const result = await newsletterService.startSubscribe({
        email,
        payerReference:
          typeof body.payerReference === "string" ? body.payerReference : undefined,
        referralAddress:
          typeof body.referralAddress === "string" ? body.referralAddress : undefined,
      });

      res.status(201).json({
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
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /subscribers/newsletter/renew
   * Issue a renewal challenge for the next billing period.
   * Body: { email? } or { payerWallet? }
   */
  router.post("/subscribers/newsletter/renew", async (req, res, next) => {
    try {
      if (!newsletterService) {
        res.status(503).json({ error: "Newsletter subscription service is not configured" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await newsletterService.startRenewal({
        email: typeof body.email === "string" ? body.email : undefined,
        payerWallet: typeof body.payerWallet === "string" ? body.payerWallet : undefined,
      });

      res.status(201).json({
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
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /subscribers/newsletter/settlements
   * Settle an x402 newsletter challenge and activate/extend the billing period.
   * Body: { challengeReference, settlementReference }
   */
  router.post("/subscribers/newsletter/settlements", async (req, res, next) => {
    try {
      if (!newsletterService) {
        res.status(503).json({ error: "Newsletter subscription service is not configured" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const challengeReference =
        typeof body.challengeReference === "string" ? body.challengeReference : "";
      const settlementReference =
        typeof body.settlementReference === "string" ? body.settlementReference : "";

      if (!challengeReference) {
        res.status(400).json({ error: "challengeReference is required" });
        return;
      }
      if (!settlementReference) {
        res.status(400).json({ error: "settlementReference is required" });
        return;
      }

      const result = await newsletterService.settle({
        challengeReference,
        settlementReference,
      });

      if (!result.settled) {
        res.status(400).json({
          settled: false,
          error: result.verification.errorMessage ?? "Settlement failed",
          paymentRecordId: result.paymentRecordId,
          subscription: toNewsletterSubscriptionResponse(result.subscription),
          verification: {
            amountSettled: result.verification.amountSettled,
            currency: result.verification.currency,
            settlementReference: result.verification.settlementReference,
          },
        });
        return;
      }

      res.json({
        settled: true,
        subscription: toNewsletterSubscriptionResponse(result.subscription),
        paymentRecordId: result.paymentRecordId,
        verification: {
          amountSettled: result.verification.amountSettled,
          currency: result.verification.currency,
          settlementReference: result.verification.settlementReference,
          ...(result.verification.payerReference
            ? { payerReference: result.verification.payerReference }
            : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /subscribers/newsletter/status?email=... | ?payerWallet=...
   */
  router.get("/subscribers/newsletter/status", async (req, res, next) => {
    try {
      if (!newsletterService) {
        res.status(503).json({ error: "Newsletter subscription service is not configured" });
        return;
      }

      const email = typeof req.query.email === "string" ? req.query.email : undefined;
      const payerWallet =
        typeof req.query.payerWallet === "string" ? req.query.payerWallet : undefined;

      const subscription = await newsletterService.getStatus({ email, payerWallet });
      if (!subscription) {
        res.status(404).json({ error: "Newsletter subscription not found" });
        return;
      }

      res.json(toNewsletterSubscriptionResponse(subscription));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /subscribers/newsletter/cancel
   * Body: { email? | payerWallet?, atPeriodEnd? }
   */
  router.post("/subscribers/newsletter/cancel", async (req, res, next) => {
    try {
      if (!newsletterService) {
        res.status(503).json({ error: "Newsletter subscription service is not configured" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const subscription = await newsletterService.cancel({
        email: typeof body.email === "string" ? body.email : undefined,
        payerWallet: typeof body.payerWallet === "string" ? body.payerWallet : undefined,
        atPeriodEnd: body.atPeriodEnd === undefined ? true : Boolean(body.atPeriodEnd),
      });

      res.json(toNewsletterSubscriptionResponse(subscription));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
