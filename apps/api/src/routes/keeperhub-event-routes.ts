// KeeperHub event ingestion route: POST /keeperhub/events
// Accepts signed event payloads from KeeperHub workflows
// Supports both classified Chronicle events and raw Event Tracker payloads

import { Router, type Router as RouterType } from "express";
import { badRequest, conflict } from "../errors.ts";
import type { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import type { EventNormalizer } from "../monitoring/event-normalizer.ts";

export function createKeeperhubEventRoutes(
  handler: EventIngestionHandler,
  normalizer: EventNormalizer,
): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/events
   *
   * Ingest a monitored on-chain event from KeeperHub.
   * Accepts:
   *   - Classified payloads: eventType + magnitude (existing contract)
   *   - Raw Event Tracker payloads: eventName + address + args (normalized server-side)
   *
   * The request must include a valid X-ChronicleAI-Signature header.
   *
   * Responses:
   *   202 - Event accepted for processing
   *   400 - Invalid event payload (missing required fields / unmappable)
   *   401 - Missing or invalid webhook signature
   *   409 - Duplicate sourceEventId already processed
   */
  router.post("/keeperhub/events", async (req, res, next) => {
    try {
      const payload = req.body as Record<string, unknown>;

      if (!payload || typeof payload !== "object") {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const normalized = await normalizer.normalize(payload);
      if (!normalized.ok) {
        next(badRequest(`Invalid event payload: ${normalized.error}`));
        return;
      }

      const result = await handler.ingest(normalized.payload);

      if (result.statusCode === 409) {
        next(conflict(result.message));
        return;
      }

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        eventType: normalized.payload.eventType,
        sourceEventId: normalized.payload.sourceEventId,
        ...(normalized.payload.magnitude ? { magnitude: normalized.payload.magnitude } : {}),
        ...(result.alertId ? { alertId: result.alertId } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
