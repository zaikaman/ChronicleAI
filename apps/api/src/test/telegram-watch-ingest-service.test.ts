import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { deriveWatchSpecHash } from "../services/watch-spec-hash.ts";
import { createTelegramWatchRequestHandler } from "../services/telegram-watch-ingest-service.ts";

describe("telegram-watch-ingest-service", () => {
  it("derives internal request fields from the six Marketplace inputs", async () => {
    const bindingRepo = {
      findValidByCode: vi.fn().mockResolvedValue({
        ok: true,
        value: { id: "binding-1", chat_id: "777", used_at: null },
      }),
      markUsed: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    const watchRepo = {
      findByMarketplaceRequestId: vi.fn().mockResolvedValue({ ok: true, value: null }),
    };
    const watchService = {
      createSponsoredWatch: vi.fn().mockResolvedValue({
        id: "watch-1",
        on_chain_watch_id: 12,
        create_tx_hash: `0x${"a".repeat(64)}`,
      }),
    };
    const handler = createTelegramWatchRequestHandler({
      bindingRepo: bindingRepo as never,
      watchRepo: watchRepo as never,
      watchService: watchService as never,
      marketplaceSlug: "chronicle-paid-onchain-watch",
      minDurationHours: 1,
      maxDurationHours: 2160,
    });

    const before = Math.floor(Date.now() / 1000);
    const result = await handler(
      {
        marketplaceSlug: "chronicle-paid-onchain-watch",
        targetContract: "0x1234567890abcdef1234567890abcdef12345678",
        targetKind: "contract",
        focusKey: "transfers",
        durationHours: 1,
        visibility: "private",
        telegramBindingCode: "abc123",
      },
      "-1004373075093",
      44,
    );
    const after = Math.floor(Date.now() / 1000);

    expect(result.accepted).toBe(true);
    expect(watchService.createSponsoredWatch).toHaveBeenCalledTimes(1);
    const call = watchService.createSponsoredWatch.mock.calls[0]![0] as {
      startsAt: string;
      endsAt: string;
      watchSpecHash: string;
      marketplaceRequestId: string;
      executionSource: string;
      telegramChatId: string;
    };
    const startsAtUnix = Math.floor(new Date(call.startsAt).getTime() / 1000);
    const endsAtUnix = Math.floor(new Date(call.endsAt).getTime() / 1000);
    expect(startsAtUnix).toBeGreaterThanOrEqual(before);
    expect(startsAtUnix).toBeLessThanOrEqual(after);
    expect(endsAtUnix - startsAtUnix).toBe(3600);
    expect(call.watchSpecHash).toBe(
      deriveWatchSpecHash({
        targetContract: getAddress("0x1234567890abcdef1234567890abcdef12345678"),
        targetKind: "contract",
        focusKey: "transfers",
        startsAt: call.startsAt,
        endsAt: call.endsAt,
      }),
    );
    expect(call.executionSource).toBe("keeperhub_marketplace");
    expect(call.telegramChatId).toBe("777");
    expect(call.marketplaceRequestId).toMatch(/^tg-[a-f0-9]{64}$/);
    expect(bindingRepo.markUsed).toHaveBeenCalledWith("binding-1");
  });
});
