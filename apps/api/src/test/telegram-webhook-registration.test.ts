import { describe, expect, it, vi } from "vitest";
import {
  ensureTelegramWebhook,
  resolvePublicApiBaseUrl,
} from "../services/telegram-webhook-registration.ts";

describe("telegram-webhook-registration", () => {
  it("resolves explicit PUBLIC_API_BASE_URL", () => {
    expect(
      resolvePublicApiBaseUrl({
        publicApiBaseUrl: "https://api.example.com/",
      }),
    ).toBe("https://api.example.com");
  });

  it("skips setWebhook when URL already matches", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("getWebhookInfo")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { url: "https://api.example.com/telegram/webhook" },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await ensureTelegramWebhook({
      botToken: "token",
      secretToken: "secret_token_value",
      publicApiBaseUrl: "https://api.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      status: "already_configured",
      url: "https://api.example.com/telegram/webhook",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("calls setWebhook when URL differs", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("getWebhookInfo")) {
        return new Response(
          JSON.stringify({ ok: true, result: { url: "" } }),
          { status: 200 },
        );
      }
      if (url.includes("setWebhook")) {
        const body = JSON.parse(String(init?.body)) as {
          url: string;
          secret_token: string;
        };
        expect(body.url).toBe("https://api.example.com/telegram/webhook");
        expect(body.secret_token).toBe("secret_token_value");
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await ensureTelegramWebhook({
      botToken: "token",
      secretToken: "secret_token_value",
      publicApiBaseUrl: "https://api.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      status: "updated",
      url: "https://api.example.com/telegram/webhook",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips non-https public base", async () => {
    const result = await ensureTelegramWebhook({
      botToken: "token",
      secretToken: "secret",
      publicApiBaseUrl: "http://localhost:4000",
    });
    expect(result.status).toBe("skipped");
  });
});
