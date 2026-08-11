// Free-tier KeeperHub Watch execution through the Telegram ingest bridge.
//
// The Marketplace workflow intentionally exposes only the six caller-facing
// Watch inputs. ChronicleAI derives the idempotency key, campaign window, and
// canonical spec hash here, then uses the existing createSponsoredWatch
// workflow to submit the Ethereum Sepolia registry transaction.

import type {
  SponsoredWatchRepository,
  TelegramBindingRepository,
} from "@chronicleai/db";
import { isPersistentBindingToken } from "@chronicleai/db";
import { createHash } from "node:crypto";
import { getAddress, isAddress } from "viem";
import type { SponsoredWatchService } from "./sponsored-watch-service.ts";
import { deriveWatchSpecHash } from "./watch-spec-hash.ts";

const MARKETPLACE_REQUEST_ID_RE = /^tg-[a-f0-9]{64}$/;
const FOCUS_KEYS = new Set([
  "none",
  "transfers",
  "swaps",
  "liquidations",
  "deposits",
  "stablecoin",
  "cex",
]);

export type TelegramWatchRequestResult = {
  statusCode: number;
  accepted: boolean;
  message: string;
  watchId?: string;
  onChainWatchId?: number;
  createTxHash?: string;
  duplicate?: boolean;
};

export type TelegramWatchRequestHandler = (
  payload: Record<string, unknown>,
  transportChatId: string,
  messageId?: number,
) => Promise<TelegramWatchRequestResult>;

export type CreateTelegramWatchRequestHandlerParams = {
  bindingRepo: TelegramBindingRepository;
  watchRepo: SponsoredWatchRepository;
  watchService: SponsoredWatchService;
  marketplaceSlug: string;
  minDurationHours: number;
  maxDurationHours: number;
};

function requiredString(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${key} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function requiredInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe integer`);
  }
  return value;
}

function deriveMarketplaceRequestId(params: {
  marketplaceSlug: string;
  transportChatId: string;
  messageId?: number;
  targetContract: string;
  targetKind: string;
  focusKey: string;
  durationHours: number;
  visibility: string;
  telegramBindingCode: string;
}): string {
  const source = [
    params.marketplaceSlug,
    params.transportChatId,
    params.messageId === undefined ? "no-message-id" : String(params.messageId),
    params.targetContract,
    params.targetKind,
    params.focusKey,
    String(params.durationHours),
    params.visibility,
    params.telegramBindingCode,
  ].join(":");
  const requestId = `tg-${createHash("sha256").update(source).digest("hex")}`;
  if (!MARKETPLACE_REQUEST_ID_RE.test(requestId)) {
    throw new Error("Could not derive a valid Marketplace request id");
  }
  return requestId;
}

export function createTelegramWatchRequestHandler(
  params: CreateTelegramWatchRequestHandlerParams,
): TelegramWatchRequestHandler {
  return async (payload, transportChatId, messageId) => {
    try {
      const marketplaceSlug = requiredString(payload, "marketplaceSlug", 128);
      if (marketplaceSlug !== params.marketplaceSlug) {
        throw new Error("Unknown marketplaceSlug");
      }

      const targetContractRaw = requiredString(payload, "targetContract", 42);
      if (!isAddress(targetContractRaw, { strict: false })) {
        throw new Error("targetContract must be a valid Ethereum address");
      }
      const targetContract = getAddress(targetContractRaw);
      const targetKind =
        payload.targetKind === "wallet"
          ? "wallet"
          : payload.targetKind === "contract"
            ? "contract"
            : null;
      if (!targetKind) throw new Error("targetKind must be contract or wallet");

      const focusKey = requiredString(payload, "focusKey", 32).toLowerCase();
      if (!FOCUS_KEYS.has(focusKey)) {
        throw new Error("focusKey must be one of none, transfers, swaps, liquidations, deposits, stablecoin, or cex");
      }

      const durationHours = requiredInteger(payload, "durationHours");
      if (
        durationHours < params.minDurationHours ||
        durationHours > params.maxDurationHours
      ) {
        throw new Error(
          `durationHours must be between ${params.minDurationHours} and ${params.maxDurationHours}`,
        );
      }

      const visibility =
        payload.visibility === "private"
          ? "private"
          : payload.visibility === "public"
            ? "public"
            : null;
      if (!visibility) throw new Error("visibility must be public or private");

      const telegramBindingCode = requiredString(payload, "telegramBindingCode", 256);
      const requestId = deriveMarketplaceRequestId({
        marketplaceSlug,
        transportChatId,
        messageId,
        targetContract,
        targetKind,
        focusKey,
        durationHours,
        visibility,
        telegramBindingCode,
      });

      // Telegram retries and KeeperHub retries return the same registration.
      const existing = await params.watchRepo.findByMarketplaceRequestId(requestId);
      if (!existing.ok) throw new Error(existing.error.message);
      if (existing.value) {
        return {
          statusCode: 200,
          accepted: true,
          message: "Watch already accepted",
          watchId: existing.value.id,
          ...(existing.value.on_chain_watch_id !== null
            ? { onChainWatchId: existing.value.on_chain_watch_id }
            : {}),
          ...(existing.value.create_tx_hash
            ? { createTxHash: existing.value.create_tx_hash }
            : {}),
          duplicate: true,
        };
      }

      const bindingResult = await params.bindingRepo.findValidByCode(telegramBindingCode);
      if (!bindingResult.ok) throw new Error(bindingResult.error.message);
      if (!bindingResult.value) {
        throw new Error("Telegram binding is invalid, expired, or already used");
      }

      const startsAtUnix = Math.floor(Date.now() / 1000);
      const endsAtUnix = startsAtUnix + durationHours * 60 * 60;
      const startsAt = new Date(startsAtUnix * 1000).toISOString();
      const endsAt = new Date(endsAtUnix * 1000).toISOString();
      const watchSpecHash = deriveWatchSpecHash({
        targetContract,
        targetKind,
        focusKey,
        startsAt,
        endsAt,
      });

      const watch = await params.watchService.createSponsoredWatch({
        targetContract,
        watchSpecHash,
        startsAt,
        endsAt,
        targetKind,
        visibility,
        // The transport group is only the bridge; alerts go to the private
        // chat that owns the one-time binding code.
        telegramChatId: bindingResult.value.chat_id,
        executionSource: "keeperhub_marketplace",
        marketplaceSlug,
        marketplaceRequestId: requestId,
      });

      if (!isPersistentBindingToken(telegramBindingCode)) {
        const marked = await params.bindingRepo.markUsed(bindingResult.value.id);
        if (!marked.ok && !bindingResult.value.used_at) {
          throw new Error(
            `Watch registered but Telegram binding could not be consumed: ${marked.error.message}`,
          );
        }
      }

      return {
        statusCode: 200,
        accepted: true,
        message: "Watch accepted; ChronicleAI monitoring will continue asynchronously",
        watchId: watch.id,
        ...(watch.on_chain_watch_id !== null
          ? { onChainWatchId: watch.on_chain_watch_id }
          : {}),
        ...(watch.create_tx_hash ? { createTxHash: watch.create_tx_hash } : {}),
      };
    } catch (error) {
      return {
        statusCode: 400,
        accepted: false,
        message: error instanceof Error ? error.message : "Invalid Watch request",
      };
    }
  };
}
