// Unit tests: Telegram community channel fan-out

import type { ExecutionLogRepository } from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import {
  buildNotificationDestinations,
  buildTelegramAlertText,
  createNotificationService,
} from "../services/notification-service.ts";

function mockExecLog(): ExecutionLogRepository {
  return {
    append: vi.fn().mockResolvedValue({ ok: true as const, value: {} }),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
    listPage: vi.fn(),
  };
}

describe("buildNotificationDestinations", () => {
  it("always includes log and adds Telegram when configured", () => {
    const dests = buildNotificationDestinations({
      telegramBotToken: "bot-token",
      telegramChatId: "-100123",
    });
    expect(dests.map((d) => d.type)).toEqual(["log", "telegram"]);
  });

  it("skips incomplete telegram config", () => {
    const dests = buildNotificationDestinations({
      telegramBotToken: "bot-token",
      // missing chat id
    });
    expect(dests.map((d) => d.type)).toEqual(["log"]);
  });
});

describe("message formatters", () => {
  it("includes bare registry tx hash only when explorer URL is missing", () => {
    const text = buildTelegramAlertText({
      alertId: "a1",
      title: "Alert <script>",
      summary: "Summary & more",
      registryTxHash: "0xdeadbeef",
    });
    expect(text).toContain("<code>0xdeadbeef</code>");
    expect(text).toContain("Alert &lt;script&gt;");
    expect(text).toContain("Summary &amp; more");
    expect(text).toContain("On-chain proof (KeeperHub registry)");
  });

  it("omits bare registry hash when explorer URL is present", () => {
    const text = buildTelegramAlertText({
      alertId: "a1",
      title: "New Uniswap V3 Contract Deployed on Ethereum",
      summary: "A deployment on Ethereum mainnet.",
      eventType: "contract_deployment",
      sourceChainLabel: "Ethereum Mainnet",
      sourceExplorerUrl: "https://etherscan.io/tx/0xsource",
      registryTxHash: "0xreg",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xreg",
    });

    expect(text).toContain("Source network: Ethereum Mainnet");
    expect(text).toContain("Source event explorer: https://etherscan.io/tx/0xsource");
    expect(text).toContain("Registry proof explorer (Ethereum Sepolia): https://sepolia.etherscan.io/tx/0xreg");
    expect(text).not.toContain("On-chain proof (KeeperHub registry)");
    expect(text).not.toContain("<code>0xreg</code>");
    expect(text).not.toMatch(/^Explorer:/m);
  });
});

describe("createNotificationService alert broadcast", () => {
  it("delivers to Telegram when configured", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
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
        telegramBotToken: "TEST_TOKEN",
        telegramChatId: "-1001",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(service.getConfiguredChannels()).toEqual({
      telegram: true,
    });

    const result = await service.sendAlertBroadcast({
      alertId: "alert-1",
      title: "Breaking: Liquidation",
      summary: "Large Aave liquidation on Base",
      eventType: "liquidation",
      registryTxHash: "0xreg",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xreg",
      contentUri: "https://app.example/alerts/alert-1",
    });

    expect(result.delivered).toBe(true);
    expect(result.destinations).toContain("log");
    expect(result.destinations).toContain("telegram");
    expect(result.failures).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
      telegram: false,
    });
  });

  it("soft-fails Telegram without aborting log destination", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ ok: false, description: "rate limited" }),
        { status: 429 },
      );
    });

    const service = createNotificationService(execLog, {
      community: {
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

    expect(result.destinations).toContain("log");
    expect(result.destinations).not.toContain("telegram");
    expect(result.failures.some((f) => f.startsWith("telegram:"))).toBe(true);
  });

  it("broadcasts digests with registry tx hash", async () => {
    const execLog = mockExecLog();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain("0xdigest");
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 99 } }),
        { status: 200 },
      );
    });

    const service = createNotificationService(execLog, {
      community: {
        telegramBotToken: "tok",
        telegramChatId: "1",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await service.sendDigestBroadcast({
      digestId: "d1",
      title: "Daily Digest",
      summary: "Markets moved",
      reportDate: "2026-07-09",
      registryTxHash: "0xdigest",
    });

    expect(result.destinations).toContain("telegram");
    expect(result.destinations).toContain("log");
    expect(result.failures).toEqual([]);
  });
});
