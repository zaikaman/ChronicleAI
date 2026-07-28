// Telegram bridge ingest: parse KeeperHub→Telegram messages into Chronicle events/blocks/digests.
// Free-plan alternative to webhook/send-webhook (Pro-gated on KeeperHub).
//
// Envelope (message text, plain parse mode):
//   CHRONICLE_INGEST v1
//   {"kind":"event"|"block"|"digest_run"|"desk_read","payload":{...}}
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

export type TelegramIngestKind = "event" | "block" | "digest_run" | "desk_read";

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
    kind !== "desk_read"
  ) {
    return {
      ok: false,
      reason: "invalid",
      detail:
        'envelope.kind must be "event", "block", "digest_run", or "desk_read"',
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
};

export type TelegramIngestProcessResult =
  | {
      handled: true;
      kind: TelegramIngestKind;
      statusCode: number;
      body: Record<string, unknown>;
    }
  | { handled: false; reason: "ignored" | "invalid"; detail: string };

/**
 * Parse update and dispatch to event/block handlers.
 */
export async function processTelegramIngestUpdate(
  update: TelegramUpdateLike,
  handlers: TelegramIngestHandlers,
  options?: { allowedChatId?: string | undefined },
): Promise<TelegramIngestProcessResult> {
  const parsed = parseTelegramUpdateForIngest(update, options);
  if (!parsed.ok) {
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
