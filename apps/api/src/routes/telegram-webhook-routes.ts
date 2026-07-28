// Telegram Bot API webhook: free-plan bridge for KeeperHub Event/Block monitors.
// POST /telegram/webhook
// Auth: X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET
//
// Soft deadline: Heroku kills requests at 30s (H12). We race ingest against a
// soft deadline and always ack Telegram early; work continues in-process.

import type { BlockIngestionPayload } from "@chronicleai/schemas";
import { timingSafeEqual } from "node:crypto";
import { Router, type Router as RouterType } from "express";
import type { DeskSignalIngestService } from "../desk/signal-ingest-service.ts";
import type { BlockIngestionHandler } from "../keeperhub/block-ingestion-handler.ts";
import type { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import type { EventNormalizer } from "../monitoring/event-normalizer.ts";
import { getDigestRunHandler } from "../services/digest-run-bridge.ts";
import { resolveDigestRunWindow } from "../services/digest-schedule-service.ts";
import {
  processTelegramIngestUpdate,
  type TelegramIngestProcessResult,
  type TelegramUpdateLike,
} from "../services/telegram-ingest-service.ts";

/**
 * Respond before Heroku's 30s hard limit. Leave headroom for auth + JSON.
 * Heavy event/block paths (RPC + LLM + registry) often exceed this and continue
 * deferred after the ack so Telegram does not H12-retry.
 */
const TELEGRAM_SOFT_DEADLINE_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logIngestResult(result: Extract<TelegramIngestProcessResult, { handled: true }>): void {
  console.info(
    `[telegram-ingest] ${result.kind} status=${result.statusCode} accepted=${String(result.body["accepted"])}`,
  );
}

export type TelegramWebhookRouteDeps = {
  eventHandler: EventIngestionHandler;
  eventNormalizer: EventNormalizer;
  blockHandler: BlockIngestionHandler;
  /** Shared secret configured in setWebhook secret_token */
  webhookSecret: string;
  /** Only accept ingest envelopes from this chat (group/channel id). */
  allowedChatId: string | undefined;
  /** Optional: Phase 9 desk_read poll bridge → signal engine quality bar. */
  deskSignalIngest?: DeskSignalIngestService | null | undefined;
};

function secretsEqual(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function validateBlockPayload(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const triggerData =
    body.triggerData && typeof body.triggerData === "object"
      ? (body.triggerData as Record<string, unknown>)
      : body;
  const chainId = Number(body.chainId ?? triggerData.chainId);
  const blockNumber = Number(body.blockNumber ?? triggerData.blockNumber);
  if (!Number.isFinite(chainId)) {
    errors.push("chainId must be a number");
  }
  if (!Number.isFinite(blockNumber)) {
    errors.push("blockNumber must be a number");
  }
  return errors;
}

export function createTelegramWebhookRoutes(deps: TelegramWebhookRouteDeps): RouterType {
  const router: RouterType = Router();

  /**
   * POST /telegram/webhook
   *
   * Receives Telegram Bot API updates. Messages containing a CHRONICLE_INGEST v1
   * envelope are routed into the same event/block pipeline as KeeperHub webhooks.
   *
   * Always returns 200 for ignored non-ingest updates so Telegram does not retry.
   */
  router.post("/telegram/webhook", async (req, res, next) => {
    try {
      const header = req.headers["x-telegram-bot-api-secret-token"];
      const provided = typeof header === "string" ? header : "";
      if (!provided || !secretsEqual(provided, deps.webhookSecret)) {
        res.status(401).json({ error: "Invalid Telegram webhook secret token" });
        return;
      }

      const update = req.body as TelegramUpdateLike;
      if (!update || typeof update !== "object") {
        res.status(400).json({ error: "Body must be a Telegram Update object" });
        return;
      }

      const handlers: import("../services/telegram-ingest-service.ts").TelegramIngestHandlers =
        {
          onEvent: async (payload) => {
            const normalized = await deps.eventNormalizer.normalize(payload);
            if (!normalized.ok) {
              return {
                statusCode: 400,
                accepted: false,
                message: `Invalid event payload: ${normalized.error}`,
              };
            }
            const ingest = await deps.eventHandler.ingest(normalized.payload);
            return {
              statusCode: ingest.statusCode,
              accepted: ingest.accepted,
              message: ingest.message,
              ...(ingest.alertId ? { alertId: ingest.alertId } : {}),
              eventType: normalized.payload.eventType,
              sourceEventId: normalized.payload.sourceEventId,
            };
          },
          onBlock: async (body) => {
            const errors = validateBlockPayload(body);
            if (errors.length > 0) {
              return {
                statusCode: 400,
                accepted: false,
                message: `Invalid block payload: ${errors.join("; ")}`,
              };
            }

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

            const ingest = await deps.blockHandler.ingest(payload);
            return {
              statusCode: ingest.statusCode,
              accepted: ingest.accepted,
              message: ingest.message,
              ...(ingest.blockNumber !== undefined
                ? { blockNumber: ingest.blockNumber }
                : {}),
              ...(ingest.chainId !== undefined ? { chainId: ingest.chainId } : {}),
              emitted: ingest.emitted.map((e) => ({
                eventType: e.eventType,
                sourceEventId: e.sourceEventId,
                accepted: e.result.accepted,
              })),
            };
          },
          onDigestRun: async (body) => {
            const digestHandler = getDigestRunHandler();
            if (!digestHandler) {
              return {
                statusCode: 503,
                accepted: false,
                message: "Digest run handler not ready",
              };
            }
            const resolved = resolveDigestRunWindow(body);
            if (!resolved.ok) {
              return {
                statusCode: 400,
                accepted: false,
                message: resolved.error,
              };
            }
            const result = await digestHandler.runDigest(
              {
                periodStart: resolved.window.periodStart,
                periodEnd: resolved.window.periodEnd,
              },
              "telegram",
            );
            return {
              statusCode: result.statusCode,
              accepted: result.accepted,
              message: result.message,
              ...(result.digestId ? { digestId: result.digestId } : {}),
              periodStart: resolved.window.periodStart,
              periodEnd: resolved.window.periodEnd,
            };
          },
        };

      if (deps.deskSignalIngest) {
        const deskIngest = deps.deskSignalIngest;
        handlers.onDeskRead = async (body) => {
          const ingest = await deskIngest.ingest(body);
          return {
            statusCode: ingest.statusCode,
            accepted: ingest.accepted,
            message: ingest.message,
            ...(ingest.signal?.id ? { signalId: ingest.signal.id } : {}),
            ...(ingest.signal
              ? {
                  signalType: ingest.signal.signalType,
                  policyVerdict: ingest.signal.policyVerdict,
                }
              : {}),
            ...(ingest.deduped !== undefined ? { deduped: ingest.deduped } : {}),
          };
        };
      }

      const work = processTelegramIngestUpdate(update, handlers, {
        allowedChatId: deps.allowedChatId,
      });

      const raced = await Promise.race([
        work.then((result) => ({ tag: "done" as const, result })),
        sleep(TELEGRAM_SOFT_DEADLINE_MS).then(() => ({ tag: "timeout" as const })),
      ]);

      if (raced.tag === "done") {
        const result = raced.result;
        if (!result.handled) {
          // Non-ingest traffic (human chat, alert fan-out, stickers): acknowledge.
          if (result.reason === "invalid") {
            console.warn(`[telegram-ingest] invalid envelope: ${result.detail}`);
            res.status(200).json({
              ok: false,
              ignored: false,
              error: result.detail,
            });
            return;
          }
          res.status(200).json({ ok: true, ignored: true, detail: result.detail });
          return;
        }

        // Use 200 for Telegram so retries are not aggressive; surface Chronicle status in body.
        logIngestResult(result);
        res.status(200).json({
          ok: result.statusCode >= 200 && result.statusCode < 300,
          chronicleStatus: result.statusCode,
          deferred: false,
          ...result.body,
        });
        return;
      }

      // Soft deadline hit: ack Telegram now, finish work in-process (no H12).
      // Prefer accepted:true so Telegram does not redeliver while we continue.
      console.info(
        `[telegram-ingest] deferred after ${TELEGRAM_SOFT_DEADLINE_MS}ms (continuing in background)`,
      );
      res.status(200).json({
        ok: true,
        accepted: true,
        deferred: true,
        bridge: "telegram",
        message: `Ingest continuing server-side after ${TELEGRAM_SOFT_DEADLINE_MS}ms soft deadline`,
      });

      void work
        .then((result) => {
          if (!result.handled) {
            console.warn(
              `[telegram-ingest] deferred finished unhandled: ${result.reason} ${result.detail}`,
            );
            return;
          }
          logIngestResult(result);
          if (!result.body["accepted"]) {
            console.warn(
              `[telegram-ingest] deferred rejected kind=${result.kind} status=${result.statusCode} message=${String(result.body["message"] ?? "")}`,
            );
          }
        })
        .catch((error: unknown) => {
          console.error(
            "[telegram-ingest] deferred work failed:",
            error instanceof Error ? error.message : error,
          );
        });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
