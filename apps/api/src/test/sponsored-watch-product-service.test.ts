import { describe, expect, it, vi } from "vitest";
import type { PremiumIntelligenceRepository } from "@chronicleai/db";
import type { PaymentChallengeService } from "../services/payment-challenge-service.ts";
import {
  createSponsoredWatchProductService,
  resolveCampaignWindow,
} from "../services/sponsored-watch-product-service.ts";

const TARGET = "0x1234567890abcdef1234567890abcdef12345678";

describe("resolveCampaignWindow", () => {
  it("uses durationDays when endsAt is omitted", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const window = resolveCampaignWindow({
      durationDays: 3,
      defaultDurationDays: 7,
      maxDurationDays: 90,
      minDurationHours: 1,
      now,
    });
    expect(window.startsAt).toBe("2026-07-01T00:00:00.000Z");
    expect(window.endsAt).toBe("2026-07-04T00:00:00.000Z");
    expect(window.durationDays).toBe(3);
    expect(window.durationHours).toBe(72);
  });

  it("supports short demo durationHours (1h)", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const window = resolveCampaignWindow({
      durationHours: 1,
      defaultDurationDays: 7,
      maxDurationDays: 90,
      minDurationHours: 1,
      now,
    });
    expect(window.startsAt).toBe("2026-07-01T00:00:00.000Z");
    expect(window.endsAt).toBe("2026-07-01T01:00:00.000Z");
    expect(window.durationHours).toBe(1);
    expect(window.durationDays).toBe(1);
  });

  it("rejects duration above max", () => {
    expect(() =>
      resolveCampaignWindow({
        durationDays: 120,
        defaultDurationDays: 7,
        maxDurationDays: 90,
        minDurationHours: 1,
      }),
    ).toThrow(/exceeds maximum/);
  });

  it("rejects durationHours below min", () => {
    expect(() =>
      resolveCampaignWindow({
        durationHours: 0,
        defaultDurationDays: 7,
        maxDurationDays: 90,
        minDurationHours: 1,
      }),
    ).toThrow(/at least 1/);
  });
});

describe("sponsored-watch-product-service", () => {
  it("creates a premium item with real watchSpecHash and issues a challenge", async () => {
    const premiumRepo = {
      create: vi.fn().mockImplementation(async (item) => ({
        ok: true as const,
        value: {
          id: "item-1",
          ...item,
          status: "available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })),
    } as unknown as PremiumIntelligenceRepository;

    const challengeService = {
      createChallenge: vi.fn().mockResolvedValue({
        paymentRecordId: "pay-1",
        challenge: {
          challengeReference: "ch-1",
          paymentRoute: "x402",
          amountRequested: 1,
          currency: "USDC",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          challengeData: { domain: {}, types: {}, message: {} },
        },
      }),
    } as unknown as PaymentChallengeService;

    const service = createSponsoredWatchProductService({
      premiumRepo,
      challengeService,
      config: { priceUsdc: 1, defaultDurationDays: 7, maxDurationDays: 90 },
    });

    const prepared = await service.prepareCampaign({
      targetContract: TARGET,
      durationDays: 5,
      paymentRoute: "x402",
      description: "Watch large swaps",
    });

    expect(prepared.premiumItem.content_type).toBe("sponsored_monitor");
    expect(prepared.campaign.targetContract.toLowerCase()).toBe(TARGET.toLowerCase());
    expect(prepared.campaign.watchSpecHash.startsWith("0x")).toBe(true);
    expect(prepared.campaign.watchSpecHash.length).toBe(66);
    expect(prepared.campaign.durationDays).toBe(5);
    expect(prepared.campaign.targetKind).toBe("contract");
    expect(prepared.campaign.visibility).toBe("public");
    expect(prepared.challenge.challengeReference).toBe("ch-1");
    expect(premiumRepo.create).toHaveBeenCalled();
    expect(challengeService.createChallenge).toHaveBeenCalled();
  });

  it("folds wallet + visibility fields into watchSpec hash", async () => {
    const premiumRepo = {
      create: vi.fn().mockImplementation(async (item) => ({
        ok: true as const,
        value: {
          id: "item-2",
          ...item,
          status: "available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })),
    } as unknown as PremiumIntelligenceRepository;

    const challengeService = {
      createChallenge: vi.fn().mockResolvedValue({
        paymentRecordId: "pay-2",
        challenge: {
          challengeReference: "ch-2",
          paymentRoute: "x402",
          amountRequested: 1,
          currency: "USDC",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          challengeData: {},
        },
      }),
    } as unknown as PaymentChallengeService;

    const telegramBindingRepo = {
      findValidByCode: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          id: "bind-1",
          code: "ABCD12",
          chat_id: "12345",
          username: "demo",
          wallet_address: null,
          source: "watch",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          used_at: null,
        },
      }),
    };

    const service = createSponsoredWatchProductService({
      premiumRepo,
      challengeService,
      config: { priceUsdc: 1, defaultDurationDays: 7, maxDurationDays: 90 },
      telegramBindingRepo: telegramBindingRepo as never,
    });

    const prepared = await service.prepareCampaign({
      targetContract: TARGET,
      durationHours: 1,
      paymentRoute: "x402",
      targetKind: "wallet",
      visibility: "private",
      telegramBindingCode: "abcd12",
    });

    expect(prepared.campaign.targetKind).toBe("wallet");
    expect(prepared.campaign.visibility).toBe("private");
    expect(prepared.campaign.telegramBindingCode).toBe("ABCD12");
    const content = prepared.premiumItem.content_private as Record<string, unknown>;
    const watchSpec = content.watchSpec as Record<string, unknown>;
    expect(watchSpec.targetKind).toBe("wallet");
    expect(watchSpec.visibility).toBe("private");
    expect(watchSpec.telegramBindingCode).toBe("ABCD12");
  });

  it("rejects private visibility without a binding code", async () => {
    const premiumRepo = {
      create: vi.fn(),
    } as unknown as PremiumIntelligenceRepository;
    const challengeService = {
      createChallenge: vi.fn(),
    } as unknown as PaymentChallengeService;

    const service = createSponsoredWatchProductService({
      premiumRepo,
      challengeService,
      config: { priceUsdc: 1, defaultDurationDays: 7, maxDurationDays: 90 },
      telegramBindingRepo: {
        findValidByCode: vi.fn(),
      } as never,
    });

    await expect(
      service.prepareCampaign({
        targetContract: TARGET,
        durationHours: 1,
        paymentRoute: "x402",
        visibility: "private",
      }),
    ).rejects.toThrow(/Telegram binding code/);
    expect(premiumRepo.create).not.toHaveBeenCalled();
  });

  it("reuses an open challenge for the same campaign intent (no second charge)", async () => {
    const itemId = "item-1";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600_000).toISOString();
    const existingItem = {
      id: itemId,
      slug: "sponsored-watch-12345678-aaaa0000",
      title: "Sponsored Watch",
      content_type: "sponsored_monitor",
      summary_public: "Pay to monitor",
      content_private: {
        targetContract: TARGET,
        watchSpecHash: "0x" + "ab".repeat(32),
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        durationDays: 1,
        durationHours: 1,
        targetKind: "contract",
        visibility: "public",
        intentKey: `${TARGET.toLowerCase()}|contract|public|||Watch large swaps|1`,
      },
      source_event_ids: [],
      price_amount: 1,
      price_currency: "USDC",
      payment_routes: ["x402", "mpp"],
      status: "available",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const premiumRepo = {
      create: vi.fn(),
      findSponsoredMonitorsByIntentKey: vi.fn().mockResolvedValue({
        ok: true as const,
        value: [existingItem],
      }),
    } as unknown as PremiumIntelligenceRepository;

    const paymentRecordRepo = {
      listByPremiumItem: vi.fn().mockResolvedValue({
        ok: true as const,
        value: [
          {
            id: "pay-1",
            premium_item_id: itemId,
            payment_route: "x402",
            payer_reference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
            referral_address: null,
            amount_requested: 1,
            amount_settled: null,
            currency: "USDC",
            status: "challenge_issued",
            challenge_reference: "ch-1",
            settlement_reference: null,
            requested_at: now.toISOString(),
            expires_at: expiresAt,
            settled_at: null,
            registry_tx_hash: null,
            keeper_hub_run_id: null,
            explorer_url: null,
            content_uri: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
        ],
      }),
    };

    const challengeService = {
      createChallenge: vi.fn(),
      rebuildChallengeForRecord: vi.fn().mockResolvedValue({
        paymentRecordId: "pay-1",
        challenge: {
          challengeReference: "ch-1",
          paymentRoute: "x402",
          amountRequested: 1,
          currency: "USDC",
          expiresAt,
          challengeData: { domain: {}, types: {}, message: {} },
        },
      }),
    } as unknown as PaymentChallengeService;

    const service = createSponsoredWatchProductService({
      premiumRepo,
      challengeService,
      paymentRecordRepo: paymentRecordRepo as never,
      config: { priceUsdc: 1, defaultDurationDays: 7, maxDurationDays: 90 },
    });

    const prepared = await service.prepareCampaign({
      targetContract: TARGET,
      durationHours: 1,
      paymentRoute: "x402",
      description: "Watch large swaps",
      payerReference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
    });

    expect(prepared.reused).toBe(true);
    expect(prepared.alreadySettled).toBeUndefined();
    expect(prepared.paymentRecordId).toBe("pay-1");
    expect(prepared.challenge.challengeReference).toBe("ch-1");
    expect(premiumRepo.create).not.toHaveBeenCalled();
    expect(challengeService.createChallenge).not.toHaveBeenCalled();
    expect(challengeService.rebuildChallengeForRecord).toHaveBeenCalledTimes(1);
  });

  it("flags alreadySettled when the same intent was settled recently", async () => {
    const itemId = "item-1";
    const now = new Date();
    const existingItem = {
      id: itemId,
      slug: "sponsored-watch-12345678-aaaa0000",
      title: "Sponsored Watch",
      content_type: "sponsored_monitor",
      summary_public: "Pay to monitor",
      content_private: {
        targetContract: TARGET,
        watchSpecHash: "0x" + "ab".repeat(32),
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        durationDays: 1,
        durationHours: 1,
        targetKind: "contract",
        visibility: "public",
        intentKey: `${TARGET.toLowerCase()}|contract|public|||Watch large swaps|1`,
      },
      source_event_ids: [],
      price_amount: 1,
      price_currency: "USDC",
      payment_routes: ["x402", "mpp"],
      status: "available",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const premiumRepo = {
      create: vi.fn(),
      findSponsoredMonitorsByIntentKey: vi.fn().mockResolvedValue({
        ok: true as const,
        value: [existingItem],
      }),
    } as unknown as PremiumIntelligenceRepository;

    const paymentRecordRepo = {
      listByPremiumItem: vi.fn().mockResolvedValue({
        ok: true as const,
        value: [
          {
            id: "pay-1",
            premium_item_id: itemId,
            payment_route: "x402",
            payer_reference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
            referral_address: null,
            amount_requested: 1,
            amount_settled: 1,
            currency: "USDC",
            status: "settled",
            challenge_reference: "ch-1",
            settlement_reference: "settle-1",
            requested_at: now.toISOString(),
            expires_at: now.toISOString(),
            settled_at: new Date(now.getTime() - 60_000).toISOString(),
            registry_tx_hash: null,
            keeper_hub_run_id: null,
            explorer_url: null,
            content_uri: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
        ],
      }),
    };

    const challengeService = {
      createChallenge: vi.fn(),
      rebuildChallengeForRecord: vi.fn().mockResolvedValue({
        paymentRecordId: "pay-1",
        challenge: {
          challengeReference: "ch-1",
          paymentRoute: "x402",
          amountRequested: 1,
          currency: "USDC",
          expiresAt: now.toISOString(),
          challengeData: {},
        },
      }),
    } as unknown as PaymentChallengeService;

    const service = createSponsoredWatchProductService({
      premiumRepo,
      challengeService,
      paymentRecordRepo: paymentRecordRepo as never,
      config: { priceUsdc: 1, defaultDurationDays: 7, maxDurationDays: 90 },
    });

    const prepared = await service.prepareCampaign({
      targetContract: TARGET,
      durationHours: 1,
      paymentRoute: "x402",
      description: "Watch large swaps",
      payerReference: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
    });

    expect(prepared.reused).toBe(true);
    expect(prepared.alreadySettled).toBe(true);
    expect(premiumRepo.create).not.toHaveBeenCalled();
    expect(challengeService.createChallenge).not.toHaveBeenCalled();
  });

  it("creates a fresh challenge when the campaign intent differs", async () => {
    const itemId = "item-1";
    const now = new Date();
    const otherContract = "0xffffffffffffffffffffffffffffffffffffffff";
    const existingItem = {
      id: itemId,
      slug: "sponsored-watch-ffffffff-aaaa0000",
      title: "Sponsored Watch",
      content_type: "sponsored_monitor",
      summary_public: "Pay to monitor",
      content_private: {
        targetContract: otherContract,
        watchSpecHash: "0x" + "cd".repeat(32),
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        durationDays: 1,
        durationHours: 1,
        targetKind: "contract",
        visibility: "public",
        intentKey: `${otherContract}|contract|public|||Watch large swaps|1`,
      },
      source_event_ids: [],
      price_amount: 1,
      price_currency: "USDC",
      payment_routes: ["x402", "mpp"],
      status: "available",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const premiumRepo = {
      create: vi.fn().mockImplementation(async (item) => ({
        ok: true as const,
        value: {
          id: "item-new",
          ...item,
          status: "available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })),
      findSponsoredMonitorsByIntentKey: vi.fn().mockResolvedValue({
        ok: true as const,
        value: [existingItem],
      }),
    } as unknown as PremiumIntelligenceRepository;

    const paymentRecordRepo = {
      listByPremiumItem: vi.fn().mockResolvedValue({
        ok: true as const,
        value: [],
      }),
    };

    const challengeService = {
      createChallenge: vi.fn().mockResolvedValue({
        paymentRecordId: "pay-new",
        challenge: {
          challengeReference: "ch-new",
          paymentRoute: "x402",
          amountRequested: 1,
          currency: "USDC",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          challengeData: {},
        },
      }),
      rebuildChallengeForRecord: vi.fn(),
    } as unknown as PaymentChallengeService;

    const service = createSponsoredWatchProductService({
      premiumRepo,
      challengeService,
      paymentRecordRepo: paymentRecordRepo as never,
      config: { priceUsdc: 1, defaultDurationDays: 7, maxDurationDays: 90 },
    });

    const prepared = await service.prepareCampaign({
      targetContract: TARGET,
      durationHours: 1,
      paymentRoute: "x402",
      description: "Watch large swaps",
    });

    expect(prepared.reused).toBeUndefined();
    expect(prepared.paymentRecordId).toBe("pay-new");
    expect(premiumRepo.create).toHaveBeenCalledTimes(1);
    expect(challengeService.createChallenge).toHaveBeenCalledTimes(1);
    expect(challengeService.rebuildChallengeForRecord).not.toHaveBeenCalled();
  });
});
