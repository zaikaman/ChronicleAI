// KeeperHub block route: POST /keeperhub/blocks
// Accepts signed block-trigger payloads from KeeperHub Block Dispatcher workflows

import type { BlockIngestionPayload } from "@chronicleai/schemas";
import { Router, type Router as RouterType } from "express";
import { badRequest } from "../errors.ts";
import type { BlockIngestionHandler } from "../keeperhub/block-ingestion-handler.ts";

export function createKeeperhubBlockRoutes(handler: BlockIngestionHandler): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/blocks
   *
   * Analyze a block from a KeeperHub Block Dispatcher trigger.
   * Chronicle fetches the block over RPC and may emit gas_spike,
   * volume_anomaly, and contract_deployment events into the alert pipeline.
   *
   * Responses:
   *   202 - Block accepted (events may or may not have been emitted)
   *   400 - Invalid payload
   *   401 - Missing or invalid webhook signature
   *   502 - RPC / block fetch failure
   */
  router.post("/keeperhub/blocks", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== "object") {
        next(badRequest("Request body must be a JSON object"));
        return;
      }

      const errors = validateBlockPayload(body);
      if (errors.length > 0) {
        next(badRequest(`Invalid block payload: ${errors.join("; ")}`));
        return;
      }

      // Support both flat workflow expansion and nested triggerData shapes
      const triggerData =
        body.triggerData && typeof body.triggerData === "object"
          ? (body.triggerData as Record<string, unknown>)
          : body;

      const chainId = Number(body.chainId ?? triggerData.chainId);
      const blockNumber = Number(body.blockNumber ?? triggerData.blockNumber);

      const payload: BlockIngestionPayload = {
        chainId,
        blockNumber,
        ...(typeof body.sourceEventId === "string"
          ? { sourceEventId: body.sourceEventId }
          : typeof body.executionId === "string"
            ? { sourceEventId: `exec-${body.executionId}-block-${blockNumber}` }
            : {}),
        ...(typeof (body.blockHash ?? triggerData.blockHash) === "string"
          ? { blockHash: String(body.blockHash ?? triggerData.blockHash) }
          : {}),
        ...(body.timestamp !== undefined || triggerData.timestamp !== undefined
          ? { timestamp: (body.timestamp ?? triggerData.timestamp) as number | string }
          : {}),
        ...(typeof body.capturedAt === "string" ? { capturedAt: body.capturedAt } : {}),
        rawPayload: body,
      };

      const result = await handler.ingest(payload);

      res.status(result.statusCode).json({
        accepted: result.accepted,
        message: result.message,
        blockNumber: result.blockNumber,
        chainId: result.chainId,
        baseFeeGwei: result.baseFeeGwei,
        transactionCount: result.transactionCount,
        volumeZScore: result.volumeZScore,
        emitted: result.emitted.map((e) => ({
          eventType: e.eventType,
          sourceEventId: e.sourceEventId,
          accepted: e.result.accepted,
          alertId: e.result.alertId,
          message: e.result.message,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function validateBlockPayload(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const triggerData =
    body.triggerData && typeof body.triggerData === "object"
      ? (body.triggerData as Record<string, unknown>)
      : body;

  const chainId = body.chainId ?? triggerData.chainId;
  const blockNumber = body.blockNumber ?? triggerData.blockNumber;

  if (chainId === undefined || chainId === null || Number.isNaN(Number(chainId))) {
    errors.push("chainId is required and must be a number");
  }
  if (
    blockNumber === undefined ||
    blockNumber === null ||
    Number.isNaN(Number(blockNumber)) ||
    Number(blockNumber) < 0
  ) {
    errors.push("blockNumber is required and must be a non-negative number");
  }

  return errors;
}
