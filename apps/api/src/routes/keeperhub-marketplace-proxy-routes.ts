import type { ServerEnv } from "@chronicleai/config";
import { Router, type Router as RouterType } from "express";

const MARKETPLACE_SLUG = "chronicleai-paid-onchain-watch-v2";
const FORWARDED_HEADERS = [
  "payment-required",
  "x-payment-requirements",
  "www-authenticate",
  "payment-receipt",
] as const;

/**
 * Browser-safe gateway for the public Watch listing.
 *
 * The KeeperHub organization key remains server-side for the browser x402
 * path. Agent callers may instead send an MPP `Authorization: Payment ...`
 * credential; that credential must pass through unchanged so KeeperHub can
 * verify it and return its Payment-Receipt.
 */
export function createKeeperhubMarketplaceProxyRoutes(env: ServerEnv): RouterType {
  const router: RouterType = Router();

  router.post("/keeperhub/marketplace/watch/call", async (req, res, next) => {
    try {
      const baseUrl = env.keeperhubApiBaseUrl?.replace(/\/$/, "");
      const apiKey = env.keeperhubWatchApiKey?.trim() || env.keeperhubApiKey?.trim();
      if (!baseUrl || !apiKey) {
        res.status(503).json({ error: "KeeperHub Marketplace proxy is not configured" });
        return;
      }
      if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Marketplace input must be a JSON object" });
        return;
      }

      const headers: Record<string, string> = {
        // KeeperHub's marketplace call route is anonymous apart from payment.
        // Prefer the Watch-scoped key for browser/x402 calls, but never
        // overwrite an MPP credential supplied by an agent. Keep the generic
        // fallback for legacy deployments without the new env var.
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      const paymentSignature = req.header("PAYMENT-SIGNATURE");
      if (paymentSignature) headers["PAYMENT-SIGNATURE"] = paymentSignature;
      const paymentAuthorization = req.header("Authorization");
      if (paymentAuthorization?.startsWith("Payment ")) {
        headers.Authorization = paymentAuthorization;
      }

      const upstream = await fetch(`${baseUrl}/api/mcp/workflows/${MARKETPLACE_SLUG}/call`, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body),
      });

      for (const header of FORWARDED_HEADERS) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.status(upstream.status).send(await upstream.text());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
