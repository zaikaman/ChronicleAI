// Unit tests: Discord + Telegram community channel fan-out

import type { ExecutionLogRepository } from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import {
  buildDiscordAlertPayload,
  buildNotificationDestinations,
  buildTelegramAlertText,
  createNotificationService,
  isValidDiscordWebhookUrl,
} from "../services/notification-service.ts";

function mockExecLog(): ExecutionLogRepository {
  return {
    append: vi.fn().mockResolvedValue({ ok: true as const, value: {} }),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
  };
}

describe("isValidDiscordWebhookUrl", () => {
  it("accepts official Discord webhook hosts over https", () => {
    expect(
      isValidDiscordWebhookUrl("https://discord.com/api/webhooks/123/abc"),
    ).toBe(true);
    expect(
      isValidDiscordWebhookUrl("https://discordapp.com/api/webhooks/123/abc"),
    ).toBe(true);
  });

  it("rejects non-https, off-host, and non-webhook paths", () => {
    expect(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/1/a")).toBe(
      false,
    );
    expect(
      isValidDiscordWebhookUrl("https://evil.com/discord.com/api/webhooks/1/a"),
    ).toBe(false);
    expect(isValidDiscordWebhookUrl("https://discord.com/api/channels/1")).toBe(
      false,
    );
    expect(isValidDiscordWebhookUrl("not-a-url")).toBe(false);
  });
});

describe("buildNotificationDestinations", () => {
  it("always includes log and adds configured community channels", () => {
    const dests = buildNotificationDestinations({
      discordWebhookUrl: "https://discord.com/api/webhooks/1/token",
      telegramBotToken: "bot-token",
      telegramChatId: "-100123",
    });
    expect(dests.map((d) => d.type)).toEqual(["log", "discord", "telegram"]);
  });

  it("skips invalid discord URLs and incomplete telegram config", () => {
    const dests = buildNotificationDestinations({
      discordWebhookUrl: "https://evil.example/hook",
      telegramBotToken: "bot-token",
      // missing chat id
    });
    expect(dests.map((d) => d.type)).toEqual(["log"]);
  });
});

describe("message formatters", () => {
  it("includes registry tx hash in Discord embed fields", () => {
    const payload = buildDiscordAlertPayload({
      alertId: "a1",
      title: "Large Swap Detected",
      summary: "Whale moved 250k USDC",
      eventType: "swap",
      registryTxHash: "0xabc123",
      explorerUrl: "https://sepolia.basescan.org/tx/0xabc123",
      contentUri: "https://app.example/alerts/a1",
    });

    const embeds = payload.embeds as Array<Record<string, unknown>>;
    const embed = embeds[0]!;
    expect(embed.title).toContain("Large Swap Detected");
    const fields = embed.fields as Array<{ name: string; value: string }>;
    expect(fields.some((f) => f.value.includes("0xabc123"))).toBe(true);
    expect(fields.some((f) => f.name === "Registry Tx (KeeperHub)")).toBe(true);
  });

  it("includes registry tx hash in Telegram HTML body", () => {
    const text = buildTelegramAlertText({
      alertId: "a1",
      title: "Alert <script>",
      summary: "Summary & more",
      registryTxHash: "0xdeadbeef",
    });
    expect(text).toContain("<code>0xdeadbeef</code>");
    expect(text).toContain("Alert &lt;script&gt;");
    expect(text).toContain("Summary &amp; more");
    expect(text).toContain("On-chain proof (KeeperHub)");
  });
});

describe("createNotificationService alert broadcast", () => {
  it("delivers to Discord and Telegram when configured", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("discord.com")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(body.embeds[0].fields.some((f: { value: string }) => f.value.includes("0xreg"))).toBe(
          true,
        );
        return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
      }
      if (url.includes("api.telegram.org")) {
        expect(url).toContain("botTEST_TOKEN");
        expect(String(init?.body)).toContain("chat_id=-1001");
        expect(String(init?.body)).toContain("0xreg");
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 42 } }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const service = createNotificationService(execLog, {
      community: {
        discordWebhookUrl: "https://discord.com/api/webhooks/99/secret",
        telegramBotToken: "TEST_TOKEN",
        telegramChatId: "-1001",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(service.getConfiguredChannels()).toEqual({
      discord: true,
      telegram: true,
    });

    const result = await service.sendAlertBroadcast({
      alertId: "alert-1",
      title: "Breaking: Liquidation",
      summary: "Large Aave liquidation on Base",
      eventType: "liquidation",
      registryTxHash: "0xreg",
      explorerUrl: "https://sepolia.basescan.org/tx/0xreg",
      contentUri: "https://app.example/alerts/alert-1",
    });

    expect(result.delivered).toBe(true);
    expect(result.destinations).toContain("log");
    expect(result.destinations).toContain("discord");
    expect(result.destinations).toContain("telegram");
    expect(result.failures).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(execLog.append).toHaveBeenCalled();
  });

  it("logs only when community channels are not configured", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn();
    const service = createNotificationService(execLog, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await service.sendAlertBroadcast({
      alertId: "alert-2",
      title: "Title",
      summary: "Summary",
      registryTxHash: "0x1",
    });

    expect(result.destinations).toEqual(["log"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.getConfiguredChannels()).toEqual({
      discord: false,
      telegram: false,
    });
  });

  it("soft-fails a channel without aborting others", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("discord.com")) {
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
        });
      }
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 7 } }),
        { status: 200 },
      );
    });

    const service = createNotificationService(execLog, {
      community: {
        discordWebhookUrl: "https://discord.com/api/webhooks/1/t",
        telegramBotToken: "tok",
        telegramChatId: "1",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await service.sendAlertBroadcast({
      alertId: "a",
      title: "T",
      summary: "S",
      registryTxHash: "0xhash",
    });

    expect(result.destinations).toContain("telegram");
    expect(result.destinations).toContain("log");
    expect(result.destinations).not.toContain("discord");
    expect(result.failures.some((f) => f.startsWith("discord:"))).toBe(true);
  });

  it("broadcasts digests with registry tx hash", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "d1" }), { status: 200 });
    });

    const service = createNotificationService(execLog, {
      community: {
        discordWebhookUrl: "https://discord.com/api/webhooks/1/t",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await service.sendDigestBroadcast({
      digestId: "d1",
      title: "Daily Digest",
      summary: "Markets moved",
      reportDate: "2026-07-28",
      registryTxHash: "0xdigest",
    });

    expect(result.destinations).toContain("discord");
    const firstCall = fetchImpl.mock.calls[0] as [string, RequestInit] | undefined;
    const body = JSON.parse(String(firstCall?.[1]?.body));
    expect(
      body.embeds[0].fields.some((f: { value: string }) => f.value.includes("0xdigest")),
    ).toBe(true);
  });
});
