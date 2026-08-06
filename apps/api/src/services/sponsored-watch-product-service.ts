// Loop 4 product factory: create a real sponsored_monitor premium item from
// a buyer-submitted target contract + campaign window, then open a payment challenge.

import { randomUUID } from "node:crypto";
import type {
  PremiumIntelligenceItemRow,
  PremiumIntelligenceRepository,
  TelegramBindingRepository,
} from "@chronicleai/db";
import { getAddress, isAddress } from "viem";
import type { PaymentRoute } from "@chronicleai/schemas";
import type { PaymentChallengeService } from "./payment-challenge-service.ts";
import {
  deriveWatchSpecHash,
  type SponsoredMonitorContentPrivate,
} from "./watch-spec-hash.ts";

export type WatchTargetKind = "contract" | "wallet";
export type WatchVisibility = "public" | "private";

export interface SponsoredWatchCampaignRequest {
  targetContract: string;
  /** Optional event signature / topic the buyer wants monitored. */
  eventSignature?: string;
  description?: string;
  /** ISO start; defaults to now at settle time if omitted at prepare. */
  startsAt?: string;
  /** ISO end; mutually exclusive with durationDays/durationHours when both omitted uses default days. */
  endsAt?: string;
  /** Campaign length in whole days when endsAt/durationHours are omitted. */
  durationDays?: number;
  /**
   * Campaign length in hours (hackathon short demo, e.g. 1).
   * Takes precedence over durationDays when both are set.
   */
  durationHours?: number;
  /** contract (default) or wallet — wallet watches match ERC-20 Transfer from/to. */
  targetKind?: WatchTargetKind;
  /** One-time Telegram binding code from /start (required when visibility=private). */
  telegramBindingCode?: string;
  /** public (default) = registry alert; private = owner Telegram only. */
  visibility?: WatchVisibility;
  paymentRoute: PaymentRoute;
  payerReference?: string;
  referralAddress?: string;
}

export interface SponsoredWatchProductConfig {
  priceUsdc: number;
  defaultDurationDays: number;
  maxDurationDays: number;
  /** Minimum campaign length in hours (default 1). */
  minDurationHours?: number;
}

export interface PreparedSponsoredWatch {
  premiumItem: PremiumIntelligenceItemRow;
  challenge: {
    challengeReference: string;
    paymentRoute: PaymentRoute;
    amountRequested: number;
    currency: string;
    expiresAt: string;
    challengeData: Record<string, unknown>;
  };
  paymentRecordId: string;
  campaign: {
    targetContract: string;
    watchSpecHash: string;
    startsAt: string;
    endsAt: string;
    durationDays: number;
    /** Exact hour span when a short demo campaign was requested. */
    durationHours?: number;
    targetKind: WatchTargetKind;
    visibility: WatchVisibility;
    /** Present when a binding code was validated at prepare. */
    telegramBindingCode?: string;
  };
}

export interface SponsoredWatchProductService {
  prepareCampaign(request: SponsoredWatchCampaignRequest): Promise<PreparedSponsoredWatch>;
}

function resolveCampaignWindow(params: {
  startsAt?: string;
  endsAt?: string;
  durationDays?: number;
  durationHours?: number;
  defaultDurationDays: number;
  maxDurationDays: number;
  minDurationHours: number;
  now?: Date;
}): {
  startsAt: string;
  endsAt: string;
  durationDays: number;
  durationHours: number;
} {
  const now = params.now ?? new Date();
  const startsAtDate = params.startsAt ? new Date(params.startsAt) : now;
  if (Number.isNaN(startsAtDate.getTime())) {
    throw new Error("startsAt must be a valid ISO timestamp");
  }

  const minHours = Math.max(1, Math.floor(params.minDurationHours));
  const maxMs = params.maxDurationDays * 24 * 60 * 60 * 1000;
  const minMs = minHours * 60 * 60 * 1000;

  let endsAtDate: Date;
  let durationHours: number;
  let durationDays: number;

  if (params.endsAt) {
    endsAtDate = new Date(params.endsAt);
    if (Number.isNaN(endsAtDate.getTime())) {
      throw new Error("endsAt must be a valid ISO timestamp");
    }
    const spanMs = endsAtDate.getTime() - startsAtDate.getTime();
    durationHours = Math.max(minHours, Math.ceil(spanMs / (60 * 60 * 1000)));
    durationDays = Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)));
  } else if (
    params.durationHours !== undefined &&
    Number.isFinite(params.durationHours)
  ) {
    durationHours = Math.floor(params.durationHours);
    if (durationHours < minHours) {
      throw new Error(`durationHours must be at least ${minHours}`);
    }
    endsAtDate = new Date(startsAtDate.getTime() + durationHours * 60 * 60 * 1000);
    durationDays = Math.max(1, Math.ceil(durationHours / 24));
  } else {
    durationDays =
      params.durationDays !== undefined && Number.isFinite(params.durationDays)
        ? Math.floor(params.durationDays)
        : params.defaultDurationDays;
    if (durationDays < 1) {
      throw new Error("durationDays must be at least 1");
    }
    endsAtDate = new Date(startsAtDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    durationHours = durationDays * 24;
  }

  if (endsAtDate.getTime() <= startsAtDate.getTime()) {
    throw new Error("Campaign window requires startsAt < endsAt");
  }

  const spanMs = endsAtDate.getTime() - startsAtDate.getTime();
  if (spanMs < minMs) {
    throw new Error(
      `Campaign duration must be at least ${minHours} hour(s) (got ${Math.round(spanMs / 3_600_000)}h)`,
    );
  }
  if (spanMs > maxMs) {
    throw new Error(
      `Campaign duration exceeds maximum of ${params.maxDurationDays} days`,
    );
  }

  return {
    startsAt: startsAtDate.toISOString(),
    endsAt: endsAtDate.toISOString(),
    durationDays,
    durationHours,
  };
}

export function createSponsoredWatchProductService(deps: {
  premiumRepo: PremiumIntelligenceRepository;
  challengeService: PaymentChallengeService;
  config: SponsoredWatchProductConfig;
  /** Required to validate private-visibility Telegram binding codes. */
  telegramBindingRepo?: TelegramBindingRepository | null;
}): SponsoredWatchProductService {
  return {
    async prepareCampaign(request) {
      if (!isAddress(request.targetContract, { strict: false })) {
        throw new Error(
          `targetContract is not a valid Ethereum address: ${request.targetContract}`,
        );
      }
      const targetContract = getAddress(request.targetContract);

      const targetKind: WatchTargetKind =
        request.targetKind === "wallet" ? "wallet" : "contract";
      const visibility: WatchVisibility =
        request.visibility === "private" ? "private" : "public";

      let telegramBindingCode: string | undefined;
      if (visibility === "private") {
        const rawCode = request.telegramBindingCode?.trim();
        if (!rawCode) {
          throw new Error(
            "Private watches require a Telegram binding code. Send /start to the bot, then paste the code it replies with.",
          );
        }
        if (!deps.telegramBindingRepo) {
          throw new Error("Telegram binding is not configured on this server");
        }
        const bindingResult = await deps.telegramBindingRepo.findValidByCode(rawCode);
        if (!bindingResult.ok) {
          throw new Error(`Failed to validate Telegram binding: ${bindingResult.error.message}`);
        }
        if (!bindingResult.value) {
          throw new Error(
            "Telegram binding code is invalid, expired, or already used. Send /start to the bot for a new code.",
          );
        }
        if (!bindingResult.value.chat_id?.trim()) {
          throw new Error("Telegram binding is missing a chat id — send /start to the bot again");
        }
        telegramBindingCode = rawCode.toUpperCase();
      } else if (request.telegramBindingCode?.trim()) {
        // Optional public-mode bind: still fold the code into the committed spec
        // so settle can attach chat_id for dual delivery when provided.
        if (deps.telegramBindingRepo) {
          const bindingResult = await deps.telegramBindingRepo.findValidByCode(
            request.telegramBindingCode.trim(),
          );
          if (bindingResult.ok && bindingResult.value) {
            telegramBindingCode = request.telegramBindingCode.trim().toUpperCase();
          }
        }
      }

      const window = resolveCampaignWindow({
        ...(request.startsAt ? { startsAt: request.startsAt } : {}),
        ...(request.endsAt ? { endsAt: request.endsAt } : {}),
        ...(request.durationDays !== undefined ? { durationDays: request.durationDays } : {}),
        ...(request.durationHours !== undefined
          ? { durationHours: request.durationHours }
          : {}),
        defaultDurationDays: deps.config.defaultDurationDays,
        maxDurationDays: deps.config.maxDurationDays,
        minDurationHours: deps.config.minDurationHours ?? 1,
      });

      const watchSpec: Record<string, unknown> = {
        targetContract,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        durationDays: window.durationDays,
        durationHours: window.durationHours,
        targetKind,
        visibility,
      };
      if (request.eventSignature?.trim()) {
        watchSpec.eventSignature = request.eventSignature.trim();
      }
      if (request.description?.trim()) {
        watchSpec.description = request.description.trim();
      }
      if (telegramBindingCode) {
        // Commit the binding code (not the chat_id) so the registry proves the
        // exact private-delivery intent without publishing the Telegram chat id.
        watchSpec.telegramBindingCode = telegramBindingCode;
      }

      const watchSpecHash = deriveWatchSpecHash(watchSpec);
      const contentPrivate: SponsoredMonitorContentPrivate & {
        startsAt: string;
        endsAt: string;
        durationDays: number;
        durationHours: number;
        targetKind: WatchTargetKind;
        visibility: WatchVisibility;
        telegramBindingCode?: string;
      } = {
        targetContract,
        watchSpecHash,
        watchSpec,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        durationDays: window.durationDays,
        durationHours: window.durationHours,
        targetKind,
        visibility,
        ...(telegramBindingCode ? { telegramBindingCode } : {}),
      };

      const slug = `sponsored-watch-${targetContract.slice(2, 10).toLowerCase()}-${randomUUID().slice(0, 8)}`;
      const short = `${targetContract.slice(0, 8)}…${targetContract.slice(-6)}`;
      const kindLabel = targetKind === "wallet" ? "Wallet" : "Contract";
      const title = `Sponsored Watch — ${kindLabel} ${short}`;
      const isShortDemo = window.durationHours < 24;
      const summaryPublic = request.description?.trim()
        ? request.description.trim()
        : isShortDemo
          ? `Pay to monitor ${targetKind} ${targetContract} for ${window.durationHours}h (short demo). On-chain create + report receipts form the dual audit trail.`
          : `Pay to monitor ${targetKind} ${targetContract} from ${window.startsAt.slice(0, 10)} to ${window.endsAt.slice(0, 10)}. On-chain create + report receipts form the dual audit trail.`;

      const createResult = await deps.premiumRepo.create({
        slug,
        title,
        content_type: "sponsored_monitor",
        summary_public: summaryPublic,
        content_private: contentPrivate,
        source_event_ids: [],
        price_amount: deps.config.priceUsdc,
        price_currency: "USDC",
        payment_routes: ["x402", "mpp"],
        status: "available",
      });

      if (!createResult.ok) {
        throw new Error(`Failed to create sponsored monitor product: ${createResult.error.message}`);
      }

      const premiumItem = createResult.value;
      const challengeResult = await deps.challengeService.createChallenge({
        premiumItem,
        paymentRoute: request.paymentRoute,
        payerReference: request.payerReference,
        referralAddress: request.referralAddress,
      });

      return {
        premiumItem,
        paymentRecordId: challengeResult.paymentRecordId,
        challenge: {
          challengeReference: challengeResult.challenge.challengeReference,
          paymentRoute: challengeResult.challenge.paymentRoute,
          amountRequested: challengeResult.challenge.amountRequested,
          currency: challengeResult.challenge.currency,
          expiresAt: challengeResult.challenge.expiresAt,
          challengeData: challengeResult.challenge.challengeData as Record<string, unknown>,
        },
        campaign: {
          targetContract,
          watchSpecHash,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          durationDays: window.durationDays,
          durationHours: window.durationHours,
          targetKind,
          visibility,
          ...(telegramBindingCode ? { telegramBindingCode } : {}),
        },
      };
    },
  };
}

export { resolveCampaignWindow };
