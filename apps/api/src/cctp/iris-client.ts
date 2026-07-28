/**
 * Circle Iris v2 attestation client (sandbox / prod host switch).
 *
 * Endpoints:
 * - GET /v2/messages/{sourceDomainId}?transactionHash={burnTxHash}
 * - GET /v2/burn/USDC/fees/{srcDomain}/{dstDomain}[?forward=true]
 *
 * Rate limit: ~35 rps; honor 429 with longer sleep. Never log full attestation
 * blobs at info level.
 */

import type {
  IrisFeeQuote,
  IrisMessage,
  IrisMessagesResponse,
} from "./types.ts";

export interface IrisClientConfig {
  baseUrl: string;
  /** Default poll sleep when caller uses pollUntilComplete. */
  pollIntervalMs?: number;
  /** Default overall timeout for pollUntilComplete. */
  pollTimeoutMs?: number;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Injected sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock for tests. */
  nowMs?: () => number;
}

export interface IrisClient {
  getMessages(
    sourceDomainId: number,
    transactionHash: string,
  ): Promise<IrisMessagesResponse>;
  getBurnFees(
    sourceDomainId: number,
    destDomainId: number,
    options?: { forward?: boolean },
  ): Promise<IrisFeeQuote | null>;
  /**
   * Poll until a message is complete (and optionally has forwardTxHash),
   * or timeout. Does not throw on empty/pending; returns last snapshot.
   */
  pollUntilComplete(args: {
    sourceDomainId: number;
    transactionHash: string;
    requireForwardTxHash?: boolean;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    onPoll?: (msg: IrisMessage | null, attempt: number) => void;
  }): Promise<{
    complete: boolean;
    timedOut: boolean;
    message: IrisMessage | null;
    response: IrisMessagesResponse | null;
  }>;
}

export class IrisHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "IrisHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const TX_HASH_RE = /^0[xX][a-fA-F0-9]{64}$/;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) {
    // Retry-After as seconds
    return Math.min(300_000, asInt * 1000);
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.min(300_000, asDate - Date.now()));
  }
  return null;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

export function normalizeIrisMessage(raw: unknown): IrisMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return {
    status: pickString(obj, "status"),
    message: pickString(obj, "message"),
    attestation: pickString(obj, "attestation"),
    messageHash: pickString(obj, "messageHash", "message_hash"),
    eventNonce: pickString(obj, "eventNonce", "event_nonce", "nonce"),
    forwardTxHash: pickString(obj, "forwardTxHash", "forward_tx_hash"),
    txHash: pickString(obj, "txHash", "transactionHash", "transaction_hash"),
    sourceDomain: pickNumber(obj, "sourceDomain", "source_domain"),
    destinationDomain: pickNumber(obj, "destinationDomain", "destination_domain"),
    decodedMessage: obj.decodedMessage ?? obj.decoded_message ?? null,
    raw: obj,
  };
}

export function isIrisMessageComplete(msg: IrisMessage | null): boolean {
  if (!msg) return false;
  const status = (msg.status ?? "").toLowerCase();
  if (status === "complete" || status === "completed") {
    return Boolean(msg.message && msg.attestation);
  }
  // Some Iris responses omit status once attestation is present.
  return Boolean(msg.message && msg.attestation);
}

export function createIrisClient(config: IrisClientConfig): IrisClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? defaultSleep;
  const nowMs = config.nowMs ?? (() => Date.now());
  const defaultPollInterval = config.pollIntervalMs ?? 5_000;
  const defaultPollTimeout = config.pollTimeoutMs ?? 1_800_000;

  async function requestJson(path: string): Promise<{
    status: number;
    body: unknown;
    retryAfterMs: number | null;
  }> {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < 4) {
      attempt += 1;
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));

        if (res.status === 429) {
          const wait = retryAfterMs ?? Math.min(300_000, 5_000 * 2 ** attempt);
          if (attempt >= 4) {
            throw new IrisHttpError(429, `Iris rate limited: ${url}`, wait);
          }
          await sleep(wait);
          continue;
        }

        if (res.status >= 500) {
          if (attempt >= 4) {
            const text = await res.text().catch(() => "");
            throw new IrisHttpError(
              res.status,
              `Iris ${res.status}: ${text.slice(0, 200)}`,
            );
          }
          await sleep(Math.min(30_000, 1_000 * 2 ** attempt));
          continue;
        }

        if (res.status === 404) {
          return { status: 404, body: { messages: [] }, retryAfterMs: null };
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new IrisHttpError(
            res.status,
            `Iris ${res.status}: ${text.slice(0, 200)}`,
          );
        }

        const body = (await res.json()) as unknown;
        return { status: res.status, body, retryAfterMs: null };
      } catch (error) {
        lastError = error;
        if (error instanceof IrisHttpError) throw error;
        if (attempt >= 4) break;
        await sleep(Math.min(15_000, 500 * 2 ** attempt));
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Iris request failed after retries: ${message}`);
  }

  return {
    async getMessages(sourceDomainId, transactionHash) {
      if (!Number.isInteger(sourceDomainId) || sourceDomainId < 0) {
        throw new Error(`Invalid sourceDomainId: ${sourceDomainId}`);
      }
      const hash = transactionHash.trim();
      if (!TX_HASH_RE.test(hash)) {
        throw new Error(`Invalid burn transactionHash: ${transactionHash}`);
      }
      const path = `/v2/messages/${sourceDomainId}?transactionHash=${encodeURIComponent(hash.toLowerCase())}`;
      const { body } = await requestJson(path);

      let messagesRaw: unknown[] = [];
      if (body && typeof body === "object") {
        const obj = body as Record<string, unknown>;
        if (Array.isArray(obj.messages)) {
          messagesRaw = obj.messages;
        } else if (Array.isArray(body)) {
          messagesRaw = body as unknown[];
        }
      }

      const messages = messagesRaw
        .map((m) => normalizeIrisMessage(m))
        .filter((m): m is IrisMessage => m != null);

      return { messages, raw: body };
    },

    async getBurnFees(sourceDomainId, destDomainId, options) {
      if (!Number.isInteger(sourceDomainId) || sourceDomainId < 0) {
        throw new Error(`Invalid sourceDomainId: ${sourceDomainId}`);
      }
      if (!Number.isInteger(destDomainId) || destDomainId < 0) {
        throw new Error(`Invalid destDomainId: ${destDomainId}`);
      }
      const forward = options?.forward === true;
      const path = `/v2/burn/USDC/fees/${sourceDomainId}/${destDomainId}${
        forward ? "?forward=true" : ""
      }`;

      try {
        const { body, status } = await requestJson(path);
        if (status === 404 || body == null) return null;

        // Response shapes vary: array of fee tiers or single object.
        const candidates: unknown[] = Array.isArray(body)
          ? body
          : body && typeof body === "object"
            ? Array.isArray((body as Record<string, unknown>).fees)
              ? ((body as Record<string, unknown>).fees as unknown[])
              : [body]
            : [];

        let best: IrisFeeQuote | null = null;
        for (const c of candidates) {
          if (!c || typeof c !== "object") continue;
          const obj = c as Record<string, unknown>;
          const minimumFee =
            pickNumber(obj, "minimumFee", "minimum_fee", "fee", "finalityFee") ??
            0;
          const finalityThreshold =
            pickNumber(
              obj,
              "finalityThreshold",
              "finality_threshold",
              "minFinalityThreshold",
            ) ?? 1000;
          // Prefer the Fast tier (threshold <= 1000) when available.
          const quote: IrisFeeQuote = {
            minimumFee,
            finalityThreshold,
            raw: c,
          };
          if (!best) {
            best = quote;
            continue;
          }
          if (
            finalityThreshold <= 1000 &&
            best.finalityThreshold > 1000
          ) {
            best = quote;
          }
        }
        return best;
      } catch (error) {
        // Fee quote is optional; callers fall back to direct mode.
        if (error instanceof IrisHttpError && error.status === 404) {
          return null;
        }
        // Network / 5xx after retries — treat as unavailable for mode selection.
        return null;
      }
    },

    async pollUntilComplete(args) {
      const interval = args.pollIntervalMs ?? defaultPollInterval;
      const timeout = args.pollTimeoutMs ?? defaultPollTimeout;
      const start = nowMs();
      let attempt = 0;
      let lastResponse: IrisMessagesResponse | null = null;
      let lastMessage: IrisMessage | null = null;

      while (nowMs() - start < timeout) {
        attempt += 1;
        try {
          lastResponse = await this.getMessages(
            args.sourceDomainId,
            args.transactionHash,
          );
          lastMessage = lastResponse.messages[0] ?? null;
          args.onPoll?.(lastMessage, attempt);

          if (isIrisMessageComplete(lastMessage)) {
            if (args.requireForwardTxHash && !lastMessage?.forwardTxHash) {
              // Attestation ready but forwarding not done yet.
            } else {
              return {
                complete: true,
                timedOut: false,
                message: lastMessage,
                response: lastResponse,
              };
            }
          }
        } catch (error) {
          if (error instanceof IrisHttpError && error.status === 429) {
            await sleep(error.retryAfterMs ?? Math.min(300_000, interval * 4));
            continue;
          }
          // Transient errors: keep polling until timeout.
          args.onPoll?.(null, attempt);
        }

        const remaining = timeout - (nowMs() - start);
        if (remaining <= 0) break;
        await sleep(Math.min(interval, remaining));
      }

      return {
        complete: false,
        timedOut: true,
        message: lastMessage,
        response: lastResponse,
      };
    },
  };
}
