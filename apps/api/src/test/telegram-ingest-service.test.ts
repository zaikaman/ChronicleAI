import { describe, expect, it } from "vitest";
import {
  CHRONICLE_INGEST_MARKER,
  formatChronicleIngestMessage,
  parseChronicleIngestText,
  parseTelegramUpdateForIngest,
  processTelegramIngestUpdate,
} from "../services/telegram-ingest-service.ts";

describe("telegram-ingest-service", () => {
  it("formats and parses event envelopes", () => {
    const message = formatChronicleIngestMessage("event", {
      eventName: "LiquidationCall",
      chainId: 1,
    });
    expect(message.startsWith(CHRONICLE_INGEST_MARKER)).toBe(true);

    const parsed = parseChronicleIngestText(message);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.envelope.kind).toBe("event");
    expect(parsed.envelope.payload).toEqual({
      eventName: "LiquidationCall",
      chainId: 1,
    });
  });

  it("ignores messages without the ingest marker", () => {
    const parsed = parseChronicleIngestText("hello from a human");
    expect(parsed).toEqual({
      ok: false,
      reason: "ignored",
      detail: `missing ${CHRONICLE_INGEST_MARKER} marker`,
    });
  });

  it("rejects invalid kind", () => {
    const text = `${CHRONICLE_INGEST_MARKER}\n${JSON.stringify({ kind: "nope", payload: {} })}`;
    const parsed = parseChronicleIngestText(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.reason).toBe("invalid");
  });

  it("parses desk_read envelopes for Phase 9 polls", () => {
    const message = formatChronicleIngestMessage("desk_read", {
      signalType: "health_factor",
      chainId: 11155111,
      features: { hf: 1.4 },
      sources: { pollKind: "desk-health-poll" },
    });
    const parsed = parseChronicleIngestText(message);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.kind).toBe("desk_read");
    expect(parsed.envelope.payload.signalType).toBe("health_factor");
  });

  it("filters by allowed chat id", () => {
    const text = formatChronicleIngestMessage("block", {
      chainId: 1,
      blockNumber: 99,
    });
    const update = {
      message: {
        message_id: 7,
        text,
        chat: { id: -100123 },
      },
    };

    const allowed = parseTelegramUpdateForIngest(update, {
      allowedChatId: "-100123",
    });
    expect(allowed.ok).toBe(true);

    const denied = parseTelegramUpdateForIngest(update, {
      allowedChatId: "-100999",
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) {
      return;
    }
    expect(denied.reason).toBe("ignored");
  });

  it("dispatches desk_read to onDeskRead handler", async () => {
    const deskMsg = formatChronicleIngestMessage("desk_read", {
      signalType: "capital_tick",
      chainId: 11155111,
    });
    const result = await processTelegramIngestUpdate(
      {
        message: {
          message_id: 9,
          text: deskMsg,
          chat: { id: -1 },
        },
      },
      {
        onEvent: async () => ({
          statusCode: 202,
          accepted: true,
          message: "event",
        }),
        onBlock: async () => ({
          statusCode: 202,
          accepted: true,
          message: "block",
        }),
        onDeskRead: async (payload) => ({
          statusCode: 202,
          accepted: true,
          message: "desk ok",
          signalType: String(payload.signalType),
          policyVerdict: "ignore",
        }),
      },
    );
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.kind).toBe("desk_read");
    expect(result.body["signalType"]).toBe("capital_tick");
    expect(result.body["policyVerdict"]).toBe("ignore");
  });

  it("dispatches event and block handlers", async () => {
    const eventMsg = formatChronicleIngestMessage("event", {
      eventName: "Swap",
      chainId: 1,
    });
    const eventResult = await processTelegramIngestUpdate(
      {
        message: {
          message_id: 1,
          text: eventMsg,
          chat: { id: -1 },
        },
      },
      {
        onEvent: async (payload) => ({
          statusCode: 202,
          accepted: true,
          message: "ok",
          eventType: "large_swap",
          sourceEventId: "src-1",
          alertId: "alert-1",
          ...payload,
        }),
        onBlock: async () => ({
          statusCode: 500,
          accepted: false,
          message: "should not run",
        }),
      },
    );
    expect(eventResult.handled).toBe(true);
    if (!eventResult.handled) {
      return;
    }
    expect(eventResult.kind).toBe("event");
    expect(eventResult.statusCode).toBe(202);
    expect(eventResult.body["alertId"]).toBe("alert-1");

    const blockMsg = formatChronicleIngestMessage("block", {
      chainId: 1,
      blockNumber: 42,
    });
    const blockResult = await processTelegramIngestUpdate(
      {
        channel_post: {
          message_id: 2,
          text: blockMsg,
          chat: { id: -1 },
        },
      },
      {
        onEvent: async () => ({
          statusCode: 500,
          accepted: false,
          message: "should not run",
        }),
        onBlock: async (payload) => ({
          statusCode: 202,
          accepted: true,
          message: "block ok",
          blockNumber: Number(payload.blockNumber),
          chainId: Number(payload.chainId),
          emitted: [],
        }),
      },
    );
    expect(blockResult.handled).toBe(true);
    if (!blockResult.handled) {
      return;
    }
    expect(blockResult.kind).toBe("block");
    expect(blockResult.body["blockNumber"]).toBe(42);
  });

  it("dispatches digest_run handler", async () => {
    const msg = formatChronicleIngestMessage("digest_run", {
      window: "previous_utc_day",
    });
    const result = await processTelegramIngestUpdate(
      {
        message: {
          message_id: 3,
          text: msg,
          chat: { id: -1 },
        },
      },
      {
        onEvent: async () => ({
          statusCode: 500,
          accepted: false,
          message: "should not run",
        }),
        onBlock: async () => ({
          statusCode: 500,
          accepted: false,
          message: "should not run",
        }),
        onDigestRun: async (payload) => ({
          statusCode: 201,
          accepted: true,
          message: "generated",
          digestId: "d-1",
          periodStart: "2026-07-28T00:00:00.000Z",
          periodEnd: "2026-07-28T00:00:00.000Z",
          ...payload,
        }),
      },
    );
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.kind).toBe("digest_run");
    expect(result.body["digestId"]).toBe("d-1");
  });
});
