// KeeperHub digest run route: POST /keeperhub/digests/run
// Accepts signed digest trigger payloads from KeeperHub scheduled workflows
// (or empty body / { window: "previous_utc_day" } for schedule-friendly triggers).

import type { DigestRunPayload } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";
import { badRequest } from "../errors.ts";
import type { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";
import { resolveDigestRunWindow } from "../services/digest-schedule-service.ts";

export function createKeeperhubDigestRoutes(handler: DigestRunHandler): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/digests/run
   *
   * Trigger a daily digest generation for a reporting window.
 * The request must include valid X-ChronicleAI timestamp, nonce, and signature headers.
   * Idempotent: if a digest already exists for the window, returns 202 (duplicate).
   *
   * Request body (either form):
   *   { periodStart, periodEnd } — explicit ISO bounds
   *   { window: "previous_utc_day" } or {} — previous completed UTC day
   *
   * Responses:
   *   201 - Digest generated and published
   *   202 - Digest already exists for this window (duplicate)
   *   400 - Invalid payload (missing or malformed fields)
   *   401 - Missing or invalid webhook signature
   */
  router.post("/keeperhub/digests/run", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (typeof body !== "object" || Array.isArray(body)) {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const resolved = resolveDigestRunWindow(body);
      if (!resolved.ok) {
        next(badRequest(`Invalid digest run payload: ${resolved.error}`));
        return;
      }

      const payload: DigestRunPayload = {
        periodStart: resolved.window.periodStart,
        periodEnd: resolved.window.periodEnd,
      };

      const result = await handler.runDigest(payload);

      if (result.statusCode === 400) {
        next(badRequest(result.message));
        return;
      }

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        window: resolved.window,
        windowSource: resolved.source,
        ...(result.digestId ? { digestId: result.digestId } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
