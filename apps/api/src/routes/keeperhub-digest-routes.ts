// KeeperHub digest run route: POST /keeperhub/digests/run
// Accepts signed digest trigger payloads from KeeperHub scheduled workflows

import type { DigestRunPayload } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";
import { badRequest, conflict } from "../errors.ts";
import type { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";

export function createKeeperhubDigestRoutes(handler: DigestRunHandler): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/digests/run
   *
   * Trigger a daily digest generation for a specific reporting window.
   * The request must include a valid X-ChronicleAI-Signature header.
   * Idempotent: if a digest already exists for the window, returns 202 (duplicate).
   *
   * Request body:
   *   periodStart: ISO string - Start of the reporting window
   *   periodEnd: ISO string - End of the reporting window
   *
   * Responses:
   *   201 - Digest generated and published
   *   202 - Digest already exists for this window (duplicate)
   *   400 - Invalid payload (missing or malformed fields)
   *   401 - Missing or invalid webhook signature
   */
  router.post("/keeperhub/digests/run", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;

      if (!body || typeof body !== "object") {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const errors = validateDigestRunPayload(body);
      if (errors.length > 0) {
        next(badRequest(`Invalid digest run payload: ${errors.join("; ")}`));
        return;
      }

      const payload: DigestRunPayload = {
        periodStart: String(body.periodStart),
        periodEnd: String(body.periodEnd),
      };

      const result = await handler.runDigest(payload);

      if (result.statusCode === 400) {
        next(badRequest(result.message));
        return;
      }

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        ...(result.digestId ? { digestId: result.digestId } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function validateDigestRunPayload(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!payload.periodStart || typeof payload.periodStart !== "string") {
    errors.push("periodStart is required and must be an ISO date string");
  }

  if (!payload.periodEnd || typeof payload.periodEnd !== "string") {
    errors.push("periodEnd is required and must be an ISO date string");
  }

  return errors;
}
