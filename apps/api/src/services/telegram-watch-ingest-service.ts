// Free-tier KeeperHub Watch registration through the Telegram ingest bridge.

import type {
  SponsoredWatchRepository,
  TelegramBindingRepository,
} from "@chronicleai/db";
import { getAddress, isAddress } from "viem";
import type { SponsoredWatchService } from "./sponsored-watch-service.ts";
import { deriveWatchSpecHash } from "./watch-spec-hash.ts";

const MARKETPLACE_REQUEST_ID_RE = /^[A-Za-z0-9._~-]{8,128}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const EXPLORER_HOST_SUFFIXES = ["etherscan.io", "sepolia.etherscan.io"];

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
) => Promise<TelegramWatchRequestResult>;

export type CreateTelegramWatchRequestHandlerParams = {
  bindingRepo: TelegramBindingRepository;
  watchRepo: SponsoredWatchRepository;
  watchService: SponsoredWatchService;
  marketplaceSlug: string;
  minDurationHours: number;
  maxDurationHours: number;
  resolveWatchIdFromTransaction: (txHash: string) => Promise<number | undefined>;
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

function resolveExplorerUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("createExplorerUrl must be a URL when provided");
  const parsed = new URL(value);
  const allowedHost = EXPLORER_HOST_SUFFIXES.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
  if (parsed.protocol !== "https:" || !allowedHost) {
    throw new Error("createExplorerUrl must be an HTTPS Etherscan URL");
  }
  return parsed.toString();
}

function validateTimestampPair(body: Record<string, unknown>, durationHours: number): {
  startsAtUnix: number;
  endsAtUnix: number;
  startsAt: string;
  endsAt: string;
} {
  const startsAtUnix = requiredInteger(body, "startsAtUnix");
  const endsAtUnix = requiredInteger(body, "endsAtUnix");
  if (startsAtUnix < 0 || endsAtUnix <= startsAtUnix) {
    throw new Error("startsAtUnix and endsAtUnix must be valid timestamps with startsAtUnix < endsAtUnix");
  }
  if (endsAtUnix - startsAtUnix !== durationHours * 60 * 60) {
    throw new Error("endsAtUnix must equal startsAtUnix plus durationHours");
  }
  return {
    startsAtUnix,
    endsAtUnix,
    startsAt: new Date(startsAtUnix * 1000).toISOString(),
    endsAt: new Date(endsAtUnix * 1000).toISOString(),
  };
}

export function createTelegramWatchRequestHandler(
  params: CreateTelegramWatchRequestHandlerParams,
): TelegramWatchRequestHandler {
  return async (payload, _transportChatId) => {
    try {
      const marketplaceSlug = requiredString(payload, "marketplaceSlug", 128);
      if (marketplaceSlug !== params.marketplaceSlug) {
        throw new Error("Unknown marketplaceSlug");
      }

      const requestId = requiredString(payload, "requestId", 128);
      if (!MARKETPLACE_REQUEST_ID_RE.test(requestId)) throw new Error("Invalid requestId");

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

      const focusKey = requiredString(payload, "focusKey", 200);
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

      const timestamps = validateTimestampPair(payload, durationHours);
      const watchSpecHash = requiredString(payload, "watchSpecHash", 66).toLowerCase();
      if (!BYTES32_RE.test(watchSpecHash)) throw new Error("Invalid watchSpecHash");
      const expectedWatchSpecHash = deriveWatchSpecHash({
        targetContract,
        targetKind,
        focusKey,
        startsAt: timestamps.startsAt,
        endsAt: timestamps.endsAt,
      });
      if (watchSpecHash !== expectedWatchSpecHash) {
        throw new Error("watchSpecHash does not match the Watch request");
      }

      const createTxHash = requiredString(payload, "createTxHash", 66);
      if (!TX_HASH_RE.test(createTxHash)) throw new Error("Invalid createTxHash");
      const createExplorerUrl = resolveExplorerUrl(payload.createExplorerUrl);

      // Telegram retries and KeeperHub retries must return the same registration.
      const existing = await params.watchRepo.findByMarketplaceRequestId(requestId);
      if (!existing.ok) throw new Error(existing.error.message);
      if (existing.value) {
        return {
          statusCode: 200,
          accepted: true,
          message: "Watch registration already accepted",
          watchId: existing.value.id,
          ...(existing.value.on_chain_watch_id !== null
            ? { onChainWatchId: existing.value.on_chain_watch_id }
            : {}),
          ...(existing.value.create_tx_hash ? { createTxHash: existing.value.create_tx_hash } : {}),
          duplicate: true,
        };
      }

      const telegramBindingCode = requiredString(payload, "telegramBindingCode", 16).toUpperCase();
      const bindingResult = await params.bindingRepo.findValidByCode(telegramBindingCode);
      if (!bindingResult.ok) throw new Error(bindingResult.error.message);
      if (!bindingResult.value) {
        throw new Error("Telegram binding is invalid, expired, or already used");
      }

      const onChainWatchId = await params.resolveWatchIdFromTransaction(createTxHash);
      if (onChainWatchId === undefined || onChainWatchId < 0) {
        throw new Error("Could not decode on-chain watch id from the successful create transaction");
      }

      const watch = await params.watchService.registerMarketplaceWatch({
        requestId,
        marketplaceSlug,
        targetContract,
        watchSpecHash,
        startsAt: timestamps.startsAt,
        endsAt: timestamps.endsAt,
        targetKind,
        visibility,
        // The transport group is only the bridge; alerts go to the private chat
        // that owns the one-time binding code.
        telegramChatId: bindingResult.value.chat_id,
        onChainWatchId,
        createTxHash,
        createExplorerUrl,
      });

      const marked = await params.bindingRepo.markUsed(bindingResult.value.id);
      if (!marked.ok && !bindingResult.value.used_at) {
        throw new Error(`Watch registered but Telegram binding could not be consumed: ${marked.error.message}`);
      }

      return {
        statusCode: 200,
        accepted: true,
        message: "Watch registered; ChronicleAI monitoring will continue asynchronously",
        watchId: watch.id,
        onChainWatchId: watch.on_chain_watch_id ?? onChainWatchId,
        createTxHash: watch.create_tx_hash ?? createTxHash,
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

