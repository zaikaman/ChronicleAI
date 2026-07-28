import { describe, expect, it, vi } from "vitest";
import {
  createIrisClient,
  isIrisMessageComplete,
  IrisHttpError,
  normalizeIrisMessage,
} from "../cctp/iris-client.ts";

describe("normalizeIrisMessage / isIrisMessageComplete", () => {
  it("parses complete message", () => {
    const msg = normalizeIrisMessage({
      status: "complete",
      message: "0xabcd",
      attestation: "0xatt",
      messageHash: "0xhash",
      forwardTxHash: "0xfwd",
    });
    expect(msg).not.toBeNull();
    expect(isIrisMessageComplete(msg)).toBe(true);
    expect(msg?.forwardTxHash).toBe("0xfwd");
  });

  it("accepts snake_case fields", () => {
    const msg = normalizeIrisMessage({
      status: "complete",
      message: "0xmsg",
      attestation: "0xatt",
      message_hash: "0xhash",
      forward_tx_hash: "0xforward",
    });
    expect(msg?.messageHash).toBe("0xhash");
    expect(msg?.forwardTxHash).toBe("0xforward");
  });

  it("incomplete without attestation", () => {
    const msg = normalizeIrisMessage({
      status: "pending",
      message: "0xmsg",
    });
    expect(isIrisMessageComplete(msg)).toBe(false);
  });

  it("returns null for garbage", () => {
    expect(normalizeIrisMessage(null)).toBeNull();
    expect(normalizeIrisMessage("x")).toBeNull();
  });
});

describe("createIrisClient", () => {
  const BURN =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

  it("returns empty messages on 404", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("not found", { status: 404 });
    });
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.getMessages(6, BURN);
    expect(res.messages).toEqual([]);
  });

  it("parses messages array", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          messages: [
            {
              status: "complete",
              message: "0xmsg",
              attestation: "0xatt",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.getMessages(6, BURN);
    expect(res.messages).toHaveLength(1);
    expect(isIrisMessageComplete(res.messages[0]!)).toBe(true);
  });

  it("throws IrisHttpError on 429 after retries", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    });
    const sleep = vi.fn(async () => {});
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    await expect(client.getMessages(6, BURN)).rejects.toBeInstanceOf(
      IrisHttpError,
    );
  });

  it("retries 5xx then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n < 3) {
        return new Response("oops", { status: 503 });
      }
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const sleep = vi.fn(async () => {});
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const res = await client.getMessages(6, BURN);
    expect(res.messages).toEqual([]);
    expect(n).toBe(3);
  });

  it("getBurnFees returns null on failure", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("nope", { status: 500 });
    });
    const sleep = vi.fn(async () => {});
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });
    const quote = await client.getBurnFees(6, 0, { forward: true });
    expect(quote).toBeNull();
  });

  it("getBurnFees parses fee tier", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          { minimumFee: 1, finalityThreshold: 2000 },
          { minimumFee: 5, finalityThreshold: 1000 },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const quote = await client.getBurnFees(6, 0);
    expect(quote).not.toBeNull();
    expect(quote?.finalityThreshold).toBe(1000);
  });

  it("pollUntilComplete times out", async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      pollIntervalMs: 10,
      pollTimeoutMs: 25,
    });
    const result = await client.pollUntilComplete({
      sourceDomainId: 6,
      transactionHash: BURN,
      pollIntervalMs: 10,
      pollTimeoutMs: 25,
    });
    expect(result.timedOut).toBe(true);
    expect(result.complete).toBe(false);
  });

  it("pollUntilComplete succeeds when complete", async () => {
    let clock = 0;
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          messages: [
            { status: "complete", message: "0xmsg", attestation: "0xatt" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const result = await client.pollUntilComplete({
      sourceDomainId: 6,
      transactionHash: BURN,
      pollIntervalMs: 5,
      pollTimeoutMs: 100,
    });
    expect(result.complete).toBe(true);
    expect(result.message?.attestation).toBe("0xatt");
  });

  it("rejects invalid tx hash", async () => {
    const client = createIrisClient({
      baseUrl: "https://iris-api-sandbox.circle.com",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(client.getMessages(6, "0xdead")).rejects.toThrow(/Invalid/);
  });
});
