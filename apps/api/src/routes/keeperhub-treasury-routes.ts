// KeeperHub treasury check route: POST /keeperhub/treasury/check
// Accepts signed treasury check payloads from KeeperHub scheduled workflows (Loop 3)

import { Router, type Router as RouterType } from "express";
import { badRequest } from "../errors.ts";
import type { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";

export function createKeeperhubTreasuryRoutes(handler: TreasuryCheckHandler): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/treasury/check
   *
   * Trigger a treasury health check. Records a treasury snapshot and
   * emits low-balance warnings if the available balance is below the safety buffer.
 * The request must include valid X-ChronicleAI timestamp, nonce, and signature headers.
   *
   * Request body:
   *   capturedAt: ISO string - When the balance was measured
   *   availableBalance: number - Current available operating funds
   *   currency: string - Treasury currency (e.g., "ETH", "USDC")
   *   safetyBuffer?: number - Optional; server uses TREASURY_SAFETY_BUFFER (default 0.01)
   *
   * Responses:
   *   201 - Treasury snapshot recorded
   *   400 - Invalid payload
   *   401 - Missing or invalid webhook signature
   */
  router.post("/keeperhub/treasury/check", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;

      if (!body || typeof body !== "object") {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const errors = validateTreasuryCheckPayload(body);
      if (errors.length > 0) {
        next(badRequest(`Invalid treasury check payload: ${errors.join("; ")}`));
        return;
      }

      const payload = {
        capturedAt: String(body.capturedAt),
        availableBalance: Number(body.availableBalance),
        currency: String(body.currency),
        // Handler replaces this with TREASURY_SAFETY_BUFFER when configured.
        safetyBuffer:
          body.safetyBuffer === undefined || body.safetyBuffer === null
            ? 0.01
            : Number(body.safetyBuffer),
      };

      const result = await handler.check(payload);

      if (result.statusCode >= 400) {
        res.status(result.statusCode).json({
          accepted: result.accepted,
          message: result.message,
        });
        return;
      }

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        ...(result.snapshotId ? { snapshotId: result.snapshotId } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  return router;
}

function validateTreasuryCheckPayload(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!payload.capturedAt || typeof payload.capturedAt !== "string") {
    errors.push("capturedAt is required and must be an ISO date string");
  }

  if (payload.availableBalance === undefined || typeof payload.availableBalance !== "number") {
    errors.push("availableBalance is required and must be a number");
  }

  if (!payload.currency || typeof payload.currency !== "string") {
    errors.push("currency is required and must be a string");
  }

  if (
    payload.safetyBuffer !== undefined &&
    payload.safetyBuffer !== null &&
    typeof payload.safetyBuffer !== "number"
  ) {
    errors.push("safetyBuffer must be a number when provided");
  }

  return errors;
}
