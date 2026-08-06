// Telegram Watch binding: /start issues a one-time code; CHRONICLE_BIND links it.
// Reuses the existing ingest/send bot — no new @BotFather bot.

import type { TelegramBindingRepository } from "@chronicleai/db";
import { generateBindingCode } from "@chronicleai/db";
import {
  extractChronicleBindCode,
  isTelegramStartCommand,
  type TelegramBindingHandler,
} from "./telegram-ingest-service.ts";

export type TelegramReplyFn = (params: {
  chatId: string;
  text: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export function createTelegramBindingHandler(deps: {
  bindingRepo: TelegramBindingRepository;
  /** Reply via Bot API (ingest or send bot token). */
  reply: TelegramReplyFn;
  /** Binding TTL in minutes (default 30). */
  ttlMinutes?: number;
}): TelegramBindingHandler {
  const ttlMs = Math.max(5, deps.ttlMinutes ?? 30) * 60_000;

  return {
    async handleDirectMessage({ chatId, text, username }) {
      const bindCode = extractChronicleBindCode(text);
      if (bindCode) {
        const found = await deps.bindingRepo.findValidByCode(bindCode);
        if (!found.ok || !found.value) {
          const replyText =
            "That binding code is invalid or expired. Send /start for a new code.";
          await deps.reply({ chatId, text: replyText });
          return { replyText, linked: false };
        }
        const binding = found.value;
        if (binding.chat_id !== chatId) {
          const replyText =
            "That binding code belongs to a different Telegram chat. Send /start in this chat.";
          await deps.reply({ chatId, text: replyText });
          return { replyText, linked: false };
        }
        if (!binding.used_at) {
          await deps.bindingRepo.markUsed(binding.id);
        }
        const replyText = "Linked ✓ Your ChronicleAI Watch alerts can reach this chat.";
        await deps.reply({ chatId, text: replyText });
        return { replyText, linked: true, code: bindCode };
      }

      // /start → issue a fresh one-time code. Other freeform messages are
      // ignored so stray chatter does not spam codes. Telegram only allows
      // DMs after the user messages the bot first.
      if (!isTelegramStartCommand(text)) {
        return null;
      }

      const code = generateBindingCode(6);
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const created = await deps.bindingRepo.create({
        code,
        chat_id: chatId,
        username: username ?? null,
        source: "watch",
        expires_at: expiresAt,
      });
      if (!created.ok) {
        const replyText =
          "Could not create a binding code right now. Try /start again in a minute.";
        await deps.reply({ chatId, text: replyText });
        return { replyText };
      }

      const replyText = `Your ChronicleAI binding code is \`${code}\`. Paste it in the Watch form.`;
      await deps.reply({ chatId, text: replyText });
      return { replyText, code };
    },
  };
}

/** Send a Telegram message via Bot API (shared by binding replies). */
export async function sendTelegramBotMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const apiUrl = `https://api.telegram.org/bot${params.botToken}/sendMessage`;
  try {
    const response = await fetchFn(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        chat_id: params.chatId,
        text: params.text,
        // Codes use `backticks` — Markdown is fine for short binding replies.
        parse_mode: "Markdown",
        disable_web_page_preview: "true",
      }).toString(),
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!response.ok || !data.ok) {
      return {
        ok: false,
        error: data.description ?? `HTTP ${response.status}`,
      };
    }
    return { ok: true, messageId: data.result?.message_id ?? 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Telegram request failed",
    };
  }
}
