// Unit tests for Watch Telegram connect (/start + CHRONICLE_BIND)

import { describe, expect, it, vi } from "vitest";
import {
  createTelegramBindingHandler,
} from "../services/telegram-binding-service.ts";
import {
  extractChronicleBindCode,
  extractPrivateDirectMessage,
  isTelegramStartCommand,
  processTelegramIngestUpdate,
} from "../services/telegram-ingest-service.ts";

describe("telegram binding helpers", () => {
  it("detects /start commands", () => {
    expect(isTelegramStartCommand("/start")).toBe(true);
    expect(isTelegramStartCommand("/start@ChronicleAIBot")).toBe(true);
    expect(isTelegramStartCommand("hello")).toBe(false);
  });

  it("extracts CHRONICLE_BIND codes", () => {
    expect(extractChronicleBindCode("CHRONICLE_BIND ABCD12")).toBe("ABCD12");
    expect(extractChronicleBindCode("please CHRONICLE_BIND xy9k2m now")).toBe("XY9K2M");
    expect(extractChronicleBindCode("no code here")).toBeNull();
  });

  it("extracts private DMs only", () => {
    const dm = extractPrivateDirectMessage({
      message: {
        message_id: 1,
        text: "/start",
        chat: { id: 42, type: "private" },
        from: { username: "alice" },
      },
    });
    expect(dm?.chatId).toBe("42");
    expect(dm?.text).toBe("/start");

    const group = extractPrivateDirectMessage({
      message: {
        text: "/start",
        chat: { id: -100, type: "supergroup" },
      },
    });
    expect(group).toBeNull();
  });
});

describe("createTelegramBindingHandler", () => {
  it("issues a code on /start", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true as const,
      value: {
        id: "b1",
        code: "ABCD12",
        chat_id: "99",
        username: "alice",
        wallet_address: null,
        source: "watch",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
      },
    });
    const reply = vi.fn().mockResolvedValue({ ok: true as const });

    const handler = createTelegramBindingHandler({
      bindingRepo: {
        create,
        findByCode: vi.fn(),
        findValidByCode: vi.fn(),
        findByChatId: vi.fn(),
        markUsed: vi.fn(),
        update: vi.fn(),
      } as never,
      reply,
    });

    const result = await handler.handleDirectMessage({
      chatId: "99",
      text: "/start",
      username: "alice",
    });

    expect(result?.code).toBeTruthy();
    expect(result?.replyText).toMatch(/binding code/i);
    expect(create).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "99" }),
    );
  });

  it("links on CHRONICLE_BIND", async () => {
    const markUsed = vi.fn().mockResolvedValue({
      ok: true as const,
      value: { id: "b1", used_at: new Date().toISOString() },
    });
    const reply = vi.fn().mockResolvedValue({ ok: true as const });
    const handler = createTelegramBindingHandler({
      bindingRepo: {
        create: vi.fn(),
        findByCode: vi.fn(),
        findValidByCode: vi.fn().mockResolvedValue({
          ok: true as const,
          value: {
            id: "b1",
            code: "ABCD12",
            chat_id: "99",
            used_at: null,
          },
        }),
        findByChatId: vi.fn(),
        markUsed,
        update: vi.fn(),
      } as never,
      reply,
    });

    const result = await handler.handleDirectMessage({
      chatId: "99",
      text: "CHRONICLE_BIND ABCD12",
    });

    expect(result?.linked).toBe(true);
    expect(result?.replyText).toMatch(/Linked/);
    expect(markUsed).toHaveBeenCalledWith("b1");
  });
});

describe("processTelegramIngestUpdate binding path", () => {
  it("routes private /start through bindingHandler", async () => {
    const bindingHandler = {
      handleDirectMessage: vi.fn().mockResolvedValue({
        replyText: "Your ChronicleAI binding code is `ZZZZ99`.",
        code: "ZZZZ99",
      }),
    };

    const result = await processTelegramIngestUpdate(
      {
        message: {
          message_id: 7,
          text: "/start",
          chat: { id: 55, type: "private" },
        },
      },
      {
        onEvent: vi.fn(),
        onBlock: vi.fn(),
      },
      { bindingHandler },
    );

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.kind).toBe("binding");
      expect(result.body.bindingCode).toBe("ZZZZ99");
    }
  });
});
