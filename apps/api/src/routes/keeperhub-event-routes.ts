// KeeperHub event ingestion route: POST /keeperhub/events
// Accepts signed event payloads from KeeperHub workflows

import { Router, type Router as RouterType } from "express";
import type { EventIngestionPayload } from "@chronicleai/schemas";
import { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import { badRequest, conflict } from "../errors.ts";

const SUPPORTED_EVENT_TYPES = [
  "large_swap",
  "liquidation",
  "gas_spike",
  "volume_anomaly",
  "contract_deployment",
] as const;

export function createKeeperhubEventRoutes(
  handler: EventIngestionHandler,
): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/events
   *
   * Ingest a monitored on-chain event from KeeperHub.
   * The request must include a valid X-ChronicleAI-Signature header.
   *
   * Responses:
   *   202 - Event accepted for processing
   *   400 - Invalid event payload (missing required fields)
   *   401 - Missing or invalid webhook signature
   *   409 - Duplicate sourceEventId already processed
   */
  router.post("/keeperhub/events", async (req, res, next) => {
    try {
      const payload = req.body as Record<string, unknown>;

      // Validate required fields
      if (!payload || typeof payload !== "object") {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const errors = validateEventPayload(payload);
      if (errors.length > 0) {
        next(badRequest(`Invalid event payload: ${errors.join("; ")}`));
        return;
      }

      // Build payload with conditional spread for optional fields
      // to satisfy exactOptionalPropertyTypes
      const typedPayload: EventIngestionPayload = {
        sourceEventId: String(payload.sourceEventId),
        eventType: payload.eventType as EventIngestionPayload["eventType"],
        chainId: Number(payload.chainId),
        capturedAt: String(payload.capturedAt),
        rawPayload: (payload.rawPayload ?? payload) as Record<string, unknown>,
        ...(payload.protocol ? { protocol: String(payload.protocol) } : {}),
        ...(payload.transactionHash ? { transactionHash: String(payload.transactionHash) } : {}),
        ...(payload.assetSymbols ? { assetSymbols: payload.assetSymbols as string[] } : {}),
        ...(payload.magnitude ? { magnitude: payload.magnitude as { value: number; unit: string } } : {}),
      };

      const result = await handler.ingest(typedPayload);

      if (result.statusCode === 409) {
        next(conflict(result.message));
        return;
      }

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        ...(result.alertId ? { alertId: result.alertId } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function validateEventPayload(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!payload.sourceEventId || typeof payload.sourceEventId !== "string") {
    errors.push("sourceEventId is required and must be a string");
  }

  if (!payload.eventType || !SUPPORTED_EVENT_TYPES.includes(payload.eventType as typeof SUPPORTED_EVENT_TYPES[number])) {
    errors.push(`eventType must be one of: ${SUPPORTED_EVENT_TYPES.join(", ")}`);
  }

  if (payload.chainId === undefined || payload.chainId === null || typeof Number(payload.chainId) !== "number" || Number.isNaN(Number(payload.chainId))) {
    errors.push("chainId is required and must be a number");
  }

  if (!payload.capturedAt || typeof payload.capturedAt !== "string") {
    errors.push("capturedAt is required and must be a string");
  }

  return errors;
}
