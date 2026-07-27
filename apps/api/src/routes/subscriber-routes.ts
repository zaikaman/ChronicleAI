// Public email subscription routes: opt-in / opt-out for digests and alerts

import type { EmailSubscriberRepository } from "@chronicleai/db";
import type { EmailSubscriberSource } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";

const ALLOWED_SOURCES = new Set<EmailSubscriberSource>(["web", "api", "premium", "import"]);

export function createSubscriberRoutes(
  subscriberRepo: EmailSubscriberRepository,
): RouterType {
  const router: RouterType = Router();

  /**
   * POST /subscribers
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
        if (typeof body.source !== "string" || !ALLOWED_SOURCES.has(body.source as EmailSubscriberSource)) {
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

  return router;
}
