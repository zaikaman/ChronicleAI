// KeeperHub sponsored-watch campaign cycle route
// POST /keeperhub/sponsored-watches/run
//
// Loop 4 automation trigger: activate due watches, monitor in-window campaigns,
// and complete ended campaigns with report generation + publishSponsoredReport.

import { Router, type Router as RouterType } from "express";
import { getAddress, isAddress } from "viem";
import type { SponsoredWatchService } from "../services/sponsored-watch-service.ts";
import {
  deriveWatchSpecHash,
  resolveCampaignWindowFromContent,
} from "../services/watch-spec-hash.ts";

const MARKETPLACE_REQUEST_ID_RE = /^[A-Za-z0-9._~-]{8,128}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const EXPLORER_HOST_SUFFIXES = ["etherscan.io", "sepolia.etherscan.io"];

export interface KeeperhubMarketplaceWatchRouteDeps {
  bindingRepo: import("@chronicleai/db").TelegramBindingRepository;
  /** Public Marketplace listing slug used in provenance and discovery. */
  marketplaceSlug: string;
  defaultDurationDays: number;
  minDurationHours: number;
  maxDurationHours: number;
  resolveWatchIdFromTransaction?: (txHash: string) => Promise<number | undefined>;
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength = 256): string {
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
  if (typeof value !== "string") throw new Error("explorerUrl must be a URL when provided");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !EXPLORER_HOST_SUFFIXES.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    throw new Error("explorerUrl must be an HTTPS Etherscan URL");
  }
  return parsed.toString();
}

function resolvePrepareInput(body: Record<string, unknown>, deps: KeeperhubMarketplaceWatchRouteDeps) {
  const targetContractRaw = requiredString(body, "targetContract", 42);
  if (!isAddress(targetContractRaw, { strict: false })) {
    throw new Error("targetContract must be a valid Ethereum address");
  }
  const targetContract = getAddress(targetContractRaw);
  const targetKind = body.targetKind === "wallet" ? "wallet" : body.targetKind === "contract" ? "contract" : null;
  if (!targetKind) throw new Error("targetKind must be contract or wallet");
  const focusKey = requiredString(body, "focusKey", 200);
  const durationHours = requiredInteger(body, "durationHours");
  if (durationHours < deps.minDurationHours || durationHours > deps.maxDurationHours) {
    throw new Error(`durationHours must be between ${deps.minDurationHours} and ${deps.maxDurationHours}`);
  }
  const visibility = body.visibility === "private" ? "private" : body.visibility === "public" ? "public" : null;
  if (!visibility) throw new Error("visibility must be public or private");
  const telegramBindingCode = requiredString(body, "telegramBindingCode", 16).toUpperCase();
  const requestId = requiredString(body, "requestId", 128);
  if (!MARKETPLACE_REQUEST_ID_RE.test(requestId)) {
    throw new Error("requestId must contain 8-128 URL-safe characters");
  }

  const window = resolveCampaignWindowFromContent(
    { durationHours },
    { defaultDurationDays: deps.defaultDurationDays },
  );
  const watchSpec = {
    targetContract,
    targetKind,
    focusKey,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
  };

  return {
    requestId,
    targetContract,
    targetKind,
    focusKey,
    durationHours,
    visibility,
    telegramBindingCode,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    watchSpecHash: deriveWatchSpecHash(watchSpec),
  } as const;
}

export function createKeeperhubSponsoredWatchRoutes(
  watchService: SponsoredWatchService,
  marketplace?: KeeperhubMarketplaceWatchRouteDeps,
): RouterType {
  const router: RouterType = Router();

  /**
   * POST /keeperhub/sponsored-watches/run
   *
   * Run one sponsored-watch campaign cycle (activate / monitor / complete).
 * Requires valid X-ChronicleAI timestamp, nonce, and signature headers (KeeperHub webhook secret).
   *
   * Optional body:
   *   now?: ISO timestamp override (for deterministic tests / backfill)
   *
   * Responses:
   *   200 - Cycle completed (includes counters)
   *   401 - Missing or invalid webhook signature
   */
  router.post("/keeperhub/sponsored-watches/run", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { now?: string };
      let now: Date | undefined;
      if (body.now !== undefined) {
        if (typeof body.now !== "string" || Number.isNaN(Date.parse(body.now))) {
          res.status(400).json({ error: "now must be a valid ISO timestamp when provided" });
          return;
        }
        now = new Date(body.now);
      }

      const result = await watchService.processCampaignCycle(now);

      res.status(200).json({
        accepted: true,
        message: "Sponsored watch campaign cycle completed",
        activated: result.activated,
        monitored: result.monitored,
        completed: result.completed,
        repaired: result.repaired,
        failed: result.failed,
        errors: result.errors,
      });
    } catch (error) {
      next(error);
    }
  });

  if (marketplace) {
    router.post("/keeperhub/marketplace/watch/prepare", async (req, res, _next) => {
      try {
        const input = resolvePrepareInput(bodyObject(req.body), marketplace);
        const bindingResult = await marketplace.bindingRepo.findByCode(input.telegramBindingCode);
        if (!bindingResult.ok) {
          res.status(500).json({ error: bindingResult.error.message });
          return;
        }
        if (!bindingResult.value) {
          res.status(400).json({
            error: "Telegram binding code is invalid, expired, or already used. Send /start to @chronicleai_bot for a new code.",
          });
          return;
        }

        res.status(200).json({
          accepted: true,
          marketplaceSlug: marketplace.marketplaceSlug,
          requestId: input.requestId,
          targetContract: input.targetContract,
          targetKind: input.targetKind,
          focusKey: input.focusKey,
          durationHours: input.durationHours,
          visibility: input.visibility,
          telegramBindingCode: input.telegramBindingCode,
          telegramChatId: bindingResult.value.chat_id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          startsAtUnix: Math.floor(Date.parse(input.startsAt) / 1000),
          endsAtUnix: Math.floor(Date.parse(input.endsAt) / 1000),
          watchSpecHash: input.watchSpecHash,
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Watch input" });
      }
    });

    router.post("/keeperhub/marketplace/watch/register", async (req, res, next) => {
      try {
        const body = bodyObject(req.body);
        const requestId = requiredString(body, "requestId", 128);
        if (!MARKETPLACE_REQUEST_ID_RE.test(requestId)) throw new Error("Invalid requestId");
        const marketplaceSlug = requiredString(body, "marketplaceSlug", 128);
        if (marketplaceSlug !== marketplace.marketplaceSlug) throw new Error("Unknown marketplaceSlug");
        const targetContractRaw = requiredString(body, "targetContract", 42);
        if (!isAddress(targetContractRaw, { strict: false })) throw new Error("Invalid targetContract");
        const targetContract = getAddress(targetContractRaw);
        const watchSpecHash = requiredString(body, "watchSpecHash", 66);
        if (!/^0x[0-9a-fA-F]{64}$/.test(watchSpecHash)) throw new Error("Invalid watchSpecHash");
        const startsAt = requiredString(body, "startsAt", 64);
        const endsAt = requiredString(body, "endsAt", 64);
        if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(startsAt) >= Date.parse(endsAt)) {
          throw new Error("startsAt and endsAt must be valid ISO timestamps with startsAt < endsAt");
        }
        const targetKind = body.targetKind === "wallet" ? "wallet" : body.targetKind === "contract" ? "contract" : null;
        if (!targetKind) throw new Error("Invalid targetKind");
        const visibility = body.visibility === "private" ? "private" : body.visibility === "public" ? "public" : null;
        if (!visibility) throw new Error("Invalid visibility");
        const telegramChatId = requiredString(body, "telegramChatId", 128);
        const createTxHash = requiredString(body, "createTxHash", 66);
        if (!TX_HASH_RE.test(createTxHash)) throw new Error("Invalid createTxHash");
        const onChainWatchId =
          body.onChainWatchId === undefined
            ? await marketplace.resolveWatchIdFromTransaction?.(createTxHash)
            : requiredInteger(body, "onChainWatchId");
        if (onChainWatchId === undefined || onChainWatchId < 0) {
          throw new Error("Could not decode on-chain watch id from the successful create transaction");
        }
        const createKeeperHubRunId = body.createKeeperHubRunId == null ? null : requiredString(body, "createKeeperHubRunId", 256);
        const createExplorerUrl = resolveExplorerUrl(body.createExplorerUrl);

        const bindingCode = requiredString(body, "telegramBindingCode", 16).toUpperCase();
        const bindingResult = await marketplace.bindingRepo.findValidByCode(bindingCode);
        if (!bindingResult.ok) throw new Error(bindingResult.error.message);
        if (!bindingResult.value || bindingResult.value.chat_id !== telegramChatId) {
          throw new Error("Telegram binding is invalid, expired, already used, or does not match the prepared Watch");
        }

        const watch = await watchService.registerMarketplaceWatch({
          requestId,
          marketplaceSlug,
          targetContract,
          watchSpecHash: watchSpecHash.toLowerCase(),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          targetKind,
          visibility,
          telegramChatId,
          onChainWatchId,
          createTxHash,
          createKeeperHubRunId,
          createExplorerUrl,
        });

        const marked = await marketplace.bindingRepo.markUsed(bindingResult.value.id);
        if (!marked.ok && !bindingResult.value.used_at) {
          throw new Error(`Watch registered but Telegram binding could not be consumed: ${marked.error.message}`);
        }

        res.status(200).json({
          accepted: true,
          watchId: watch.id,
          status: watch.status,
          targetContract: watch.target_contract,
          onChainWatchId: watch.on_chain_watch_id,
          createTxHash: watch.create_tx_hash,
          createKeeperHubRunId: watch.create_keeper_hub_run_id,
          createExplorerUrl: watch.create_explorer_url,
          startsAt: watch.starts_at,
          endsAt: watch.ends_at,
        });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
