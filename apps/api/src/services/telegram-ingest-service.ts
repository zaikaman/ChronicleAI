// Telegram bridge ingest: parse KeeperHub→Telegram messages into Chronicle events/blocks/digests.
// Free-plan alternative to webhook/send-webhook (Pro-gated on KeeperHub).
//
// Envelope (message text, plain parse mode):
//   CHRONICLE_INGEST v1
//   {"kind":"event"|"block"|"digest_run"|"desk_read"|"watch_request","payload":{...}}
//
// desk_read → desk signal ingest (Phase 9 monitoring polls / quality bar).
//
// Setup (two bots required — bots never receive their own messages):
//   1. Ingest bot (TELEGRAM_INGEST_BOT_TOKEN or legacy TELEGRAM_BOT_TOKEN)
//      — webhook points at POST /telegram/webhook; /setprivacy Disable
//   2. Send bot (TELEGRAM_SEND_BOT_TOKEN)
//      — KeeperHub Telegram Connection + Chronicle alert broadcasts
//   3. Both bots in the same private supergroup
//   4. TELEGRAM_INGEST_CHAT_ID (or TELEGRAM_CHAT_ID) = group chat id

export const CHRONICLE_INGEST_MARKER = "CHRONICLE_INGEST v1";

export type TelegramIngestKind =
  | "event"
  | "block"
  | "digest_run"
  | "desk_read"
  | "watch_request";

export type TelegramIngestEnvelope = {
  kind: TelegramIngestKind;
  payload: Record<string, unknown>;
};

export type TelegramMessageLike = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number | string; type?: string };
  from?: { id?: number; is_bot?: boolean; username?: string };
};

export type TelegramUpdateLike = {
  update_id?: number;
  message?: TelegramMessageLike;
  channel_post?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
  edited_channel_post?: TelegramMessageLike;
};

export type ParseIngestResult =
  | { ok: true; envelope: TelegramIngestEnvelope; chatId: string; messageId: number | undefined }
  | { ok: false; reason: "ignored" | "invalid"; detail: string };

/**
 * Build the exact message body KeeperHub Telegram actions should send.
 */
export function formatChronicleIngestMessage(
  kind: TelegramIngestKind,
  payload: Record<string, unknown>,
): string {
  return `${CHRONICLE_INGEST_MARKER}\n${JSON.stringify({ kind, payload })}`;
}

/**
 * Extract JSON object from message text after the ingest marker.
 * Accepts optional ``` fences (Telegram clients sometimes rewrap).
 */
export function parseChronicleIngestText(raw: string): ParseIngestResult {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) {
    return { ok: false, reason: "ignored", detail: "empty message" };
  }

  const markerIdx = text.indexOf(CHRONICLE_INGEST_MARKER);
  if (markerIdx < 0) {
    return {
      ok: false,
      reason: "ignored",
      detail: `missing ${CHRONICLE_INGEST_MARKER} marker`,
    };
  }

  let body = text.slice(markerIdx + CHRONICLE_INGEST_MARKER.length).trim();
  // Strip optional markdown fences around the JSON body
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      detail: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid", detail: "envelope must be a JSON object" };
  }

  const record = parsed as Record<string, unknown>;
  const kind = record.kind;
  if (
    kind !== "event" &&
    kind !== "block" &&
    kind !== "digest_run" &&
    kind !== "desk_read" &&
    kind !== "watch_request"
  ) {
    return {
      ok: false,
      reason: "invalid",
      detail:
        'envelope.kind must be "event", "block", "digest_run", "desk_read", or "watch_request"',
    };
  }

  // digest_run may omit payload (defaults to previous_utc_day window)
  const payload = record.payload;
  if (payload === undefined || payload === null) {
    if (kind === "digest_run") {
      return {
        ok: true,
        envelope: { kind, payload: {} },
        chatId: "",
        messageId: undefined,
      };
    }
    return {
      ok: false,
      reason: "invalid",
      detail: "envelope.payload must be a JSON object",
    };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      reason: "invalid",
      detail: "envelope.payload must be a JSON object",
    };
  }

  return {
    ok: true,
    envelope: {
      kind,
      payload: payload as Record<string, unknown>,
    },
    chatId: "",
    messageId: undefined,
  };
}

/**
 * Pull the primary text-bearing message from a Telegram Update.
 */
export function extractTelegramMessage(
  update: TelegramUpdateLike,
): TelegramMessageLike | null {
  return (
    update.message ??
    update.channel_post ??
    update.edited_message ??
    update.edited_channel_post ??
    null
  );
}

/**
 * Parse a full Telegram Update into a Chronicle ingest envelope.
 * When `allowedChatId` is set, only that chat is accepted (string compare).
 */
export function parseTelegramUpdateForIngest(
  update: TelegramUpdateLike,
  options?: { allowedChatId?: string | undefined },
): ParseIngestResult {
  const message = extractTelegramMessage(update);
  if (!message) {
    return { ok: false, reason: "ignored", detail: "update has no message" };
  }

  const chatIdRaw = message.chat?.id;
  if (chatIdRaw === undefined || chatIdRaw === null) {
    return { ok: false, reason: "invalid", detail: "message missing chat.id" };
  }
  const chatId = String(chatIdRaw);

  if (options?.allowedChatId) {
    const allowed = normalizeChatId(options.allowedChatId);
    if (normalizeChatId(chatId) !== allowed) {
      return {
        ok: false,
        reason: "ignored",
        detail: `chat ${chatId} not in allowlist`,
      };
    }
  }

  const text = message.text ?? message.caption ?? "";
  const parsed = parseChronicleIngestText(text);
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    envelope: parsed.envelope,
    chatId,
    messageId:
      typeof message.message_id === "number" ? message.message_id : undefined,
  };
}

function normalizeChatId(id: string): string {
  return id.trim();
}

export type TelegramIngestHandlers = {
  onEvent: (payload: Record<string, unknown>) => Promise<{
    statusCode: number;
    accepted: boolean;
    message: string;
    alertId?: string;
    eventType?: string;
    sourceEventId?: string;
  }>;
  onBlock: (payload: Record<string, unknown>) => Promise<{
    statusCode: number;
    accepted: boolean;
    message: string;
    blockNumber?: number;
    chainId?: number;
    emitted?: Array<{ eventType: string; sourceEventId: string; accepted: boolean }>;
  }>;
  onDigestRun?: (payload: Record<string, unknown>) => Promise<{
    statusCode: number;
    accepted: boolean;
    message: string;
    digestId?: string;
    periodStart?: string;
    periodEnd?: string;
  }>;
  /** Desk poll / read features → signal engine quality bar (Phase 9). */
  onDeskRead?:
    | ((payload: Record<string, unknown>) => Promise<{
        statusCode: number;
        accepted: boolean;
        message: string;
        signalId?: string | undefined;
        signalType?: string | undefined;
        policyVerdict?: string | undefined;
        deduped?: boolean | undefined;
      }>)
    | undefined;
  /** Marketplace Watch registration delivered through the free Telegram bridge. */
  onWatchRequest?:
    | ((payload: Record<string, unknown>, transportChatId: string) => Promise<{
        statusCode: number;
        accepted: boolean;
        message: string;
        watchId?: string | undefined;
        onChainWatchId?: number | undefined;
        createTxHash?: string | undefined;
        duplicate?: boolean | undefined;
      }>)
    | undefined;
};

export type TelegramIngestProcessResult =
  | {
      handled: true;
      kind: TelegramIngestKind;
      statusCode: number;
      body: Record<string, unknown>;
    }
  | {
      handled: true;
      kind: "binding";
      statusCode: number;
      body: Record<string, unknown>;
    }
  | { handled: false; reason: "ignored" | "invalid"; detail: string };

export type TelegramBindingHandler = {
  /**
   * Handle a private-chat DM that is not a CHRONICLE_INGEST envelope.
   * Returns null when the message should be ignored.
   */
  handleDirectMessage(params: {
    chatId: string;
    text: string;
    username?: string | undefined;
    messageId?: number | undefined;
  }): Promise<{
    replyText: string;
    code?: string;
    linked?: boolean;
  } | null>;
};

const BIND_CODE_RE = /\bCHRONICLE_BIND\s+([A-Za-z0-9]{4,16})\b/i;

/**
 * Detect private-chat DMs used for Watch Telegram binding (/start or CHRONICLE_BIND).
 * Group/channel traffic is left to the ingest allowlist path.
 */
export function extractPrivateDirectMessage(
  update: TelegramUpdateLike,
): {
  chatId: string;
  text: string;
  username?: string;
  messageId?: number;
} | null {
  const message = extractTelegramMessage(update);
  if (!message) return null;
  const chatType = message.chat?.type;
  // Only private chats — group messages stay on the KeeperHub ingest path.
  if (chatType && chatType !== "private") return null;
  const chatIdRaw = message.chat?.id;
  if (chatIdRaw === undefined || chatIdRaw === null) return null;
  const text = (message.text ?? message.caption ?? "").trim();
  if (!text) return null;
  // Never treat ingest envelopes as binding DMs.
  if (text.includes(CHRONICLE_INGEST_MARKER)) return null;
  return {
    chatId: String(chatIdRaw),
    text,
    ...(typeof message.from?.username === "string"
      ? { username: message.from.username }
      : {}),
    ...(typeof message.message_id === "number" ? { messageId: message.message_id } : {}),
  };
}

export function isTelegramStartCommand(text: string): boolean {
  const t = text.trim();
  return /^\/start(?:@\w+)?(?:\s|$)/i.test(t) || t === "/start";
}

export function extractChronicleBindCode(text: string): string | null {
  const match = text.match(BIND_CODE_RE);
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * Parse update and dispatch to event/block handlers.
 * When `bindingHandler` is set and the update is a private DM without an
 * ingest envelope, the binding flow runs instead of returning ignored.
 */
export async function processTelegramIngestUpdate(
  update: TelegramUpdateLike,
  handlers: TelegramIngestHandlers,
  options?: {
    allowedChatId?: string | undefined;
    bindingHandler?: TelegramBindingHandler | null | undefined;
  },
): Promise<TelegramIngestProcessResult> {
  const parsed = parseTelegramUpdateForIngest(update, options);
  if (!parsed.ok) {
    // Non-ingest private DMs → Watch Telegram connect flow.
    if (options?.bindingHandler && parsed.reason === "ignored") {
      const dm = extractPrivateDirectMessage(update);
      if (dm) {
        const result = await options.bindingHandler.handleDirectMessage(dm);
        if (result) {
          return {
            handled: true,
            kind: "binding",
            statusCode: 200,
            body: {
              bridge: "telegram",
              kind: "binding",
              accepted: true,
              message: result.replyText,
              chatId: dm.chatId,
              messageId: dm.messageId,
              ...(result.code ? { bindingCode: result.code } : {}),
              ...(result.linked !== undefined ? { linked: result.linked } : {}),
              replyText: result.replyText,
            },
          };
        }
      }
    }
    return { handled: false, reason: parsed.reason, detail: parsed.detail };
  }

  if (parsed.envelope.kind === "event") {
    const result = await handlers.onEvent(parsed.envelope.payload);
    return {
      handled: true,
      kind: "event",
      statusCode: result.statusCode,
      body: {
        bridge: "telegram",
        kind: "event",
        accepted: result.accepted,
        message: result.message,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        ...(result.alertId ? { alertId: result.alertId } : {}),
        ...(result.eventType ? { eventType: result.eventType } : {}),
        ...(result.sourceEventId ? { sourceEventId: result.sourceEventId } : {}),
      },
    };
  }

  if (parsed.envelope.kind === "digest_run") {
    if (!handlers.onDigestRun) {
      return {
        handled: false,
        reason: "invalid",
        detail: "digest_run handler not registered",
      };
    }
    const result = await handlers.onDigestRun(parsed.envelope.payload);
    return {
      handled: true,
      kind: "digest_run",
      statusCode: result.statusCode,
      body: {
        bridge: "telegram",
        kind: "digest_run",
        accepted: result.accepted,
        message: result.message,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        ...(result.digestId ? { digestId: result.digestId } : {}),
        ...(result.periodStart ? { periodStart: result.periodStart } : {}),
        ...(result.periodEnd ? { periodEnd: result.periodEnd } : {}),
      },
    };
  }

  if (parsed.envelope.kind === "desk_read") {
    if (!handlers.onDeskRead) {
      return {
        handled: false,
        reason: "invalid",
        detail: "desk_read handler not registered",
      };
    }
    const result = await handlers.onDeskRead(parsed.envelope.payload);
    return {
      handled: true,
      kind: "desk_read",
      statusCode: result.statusCode,
      body: {
        bridge: "telegram",
        kind: "desk_read",
        accepted: result.accepted,
        message: result.message,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        ...(result.signalId ? { signalId: result.signalId } : {}),
        ...(result.signalType ? { signalType: result.signalType } : {}),
        ...(result.policyVerdict ? { policyVerdict: result.policyVerdict } : {}),
        ...(result.deduped !== undefined ? { deduped: result.deduped } : {}),
      },
    };
  }

  if (parsed.envelope.kind === "watch_request") {
    if (!handlers.onWatchRequest) {
      return {
        handled: false,
        reason: "invalid",
        detail: "watch_request handler not registered",
      };
    }
    const result = await handlers.onWatchRequest(parsed.envelope.payload, parsed.chatId);
    return {
      handled: true,
      kind: "watch_request",
      statusCode: result.statusCode,
      body: {
        bridge: "telegram",
        kind: "watch_request",
        accepted: result.accepted,
        message: result.message,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        ...(result.watchId ? { watchId: result.watchId } : {}),
        ...(result.onChainWatchId !== undefined
          ? { onChainWatchId: result.onChainWatchId }
          : {}),
        ...(result.createTxHash ? { createTxHash: result.createTxHash } : {}),
        ...(result.duplicate !== undefined ? { duplicate: result.duplicate } : {}),
      },
    };
  }

  const result = await handlers.onBlock(parsed.envelope.payload);
  return {
    handled: true,
    kind: "block",
    statusCode: result.statusCode,
    body: {
      bridge: "telegram",
      kind: "block",
      accepted: result.accepted,
      message: result.message,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      ...(result.blockNumber !== undefined ? { blockNumber: result.blockNumber } : {}),
      ...(result.chainId !== undefined ? { chainId: result.chainId } : {}),
      ...(result.emitted ? { emitted: result.emitted } : {}),
    },
  };
}
