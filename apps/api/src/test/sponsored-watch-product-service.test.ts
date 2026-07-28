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
    expect(prepared.challenge.challengeReference).toBe("ch-1");
    expect(premiumRepo.create).toHaveBeenCalled();
    expect(challengeService.createChallenge).toHaveBeenCalled();
  });
});
