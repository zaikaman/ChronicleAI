// Shared API base + fetch helpers for React Query queryFns (abort-aware).
// P2-7: single API_BASE + ApiClient with timeout/retry; no per-feature base URLs.

import { ApiClient, ApiClientError } from "./api-client.ts";

export const API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.VITE_API_BASE_URL === "string" &&
    import.meta.env.VITE_API_BASE_URL.trim()) ||
  "http://localhost:4000";

/** Maximum time a browser request may wait on an API response. */
export const API_REQUEST_TIMEOUT_MS = 15_000;

/** Shared typed client (timeout + retry). Prefer over raw fetch. */
export const apiClient = new ApiClient({
  baseUrl: API_BASE,
  timeoutMs: API_REQUEST_TIMEOUT_MS,
  retryCount: 1,
});

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }

    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}

/**
 * Raw-fetch escape hatch for requests that need cookies or custom headers.
 * It keeps the caller's cancellation signal and adds a bounded timeout.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    Math.max(1, timeoutMs),
  );
  const signal = init.signal
    ? combineSignals(init.signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    return await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export class ApiHttpError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 404;
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err.trim();
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

function toHttpError(error: unknown): never {
  if (error instanceof ApiClientError) {
    throw new ApiHttpError(
      error.statusCode,
      messageFromBody(error.body, error.message),
      error.body,
    );
  }
  if (error instanceof Error) {
    throw new ApiHttpError(0, error.message);
  }
  throw new ApiHttpError(0, "Network error");
}

/**
 * GET JSON from the ChronicleAI API. Respects AbortSignal (React Query cancel).
 * Uses shared ApiClient (timeout + retry) under the hood (P2-7).
 */
export async function apiGetJson<T>(
  path: string,
  options?: {
    signal?: AbortSignal;
    params?: Record<string, string | number | boolean | undefined | null>;
  },
): Promise<T> {
  const params: Record<string, string | number | undefined> | undefined =
    options?.params
      ? Object.fromEntries(
          Object.entries(options.params)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, v as string | number]),
        )
      : undefined;

  try {
    return await apiClient.get<T>(path, {
      params,
      signal: options?.signal,
    });
  } catch (error) {
    return toHttpError(error);
  }
}

/**
 * POST JSON to the ChronicleAI API.
 * Note: credentials: "include" uses a raw fetch path (cookies) so ApiClient
 * stays simple; still shares API_BASE.
 */
export async function apiPostJson<T>(
  path: string,
  body?: unknown,
  options?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  },
): Promise<T> {
  // Cookie / custom-header posts go through fetch so credentials are honored.
  if (options?.credentials || options?.headers) {
    const url = path.startsWith("http")
      ? path
      : `${API_BASE.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
      credentials: options?.credentials,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiHttpError(
        response.status,
        messageFromBody(errBody, `Request failed (${response.status})`),
        errBody,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  try {
    return await apiClient.post<T>(path, body, { signal: options?.signal });
  } catch (error) {
    return toHttpError(error);
  }
}

/** Absolute URL helper for rare raw-fetch call sites (wallet settle, etc.). */
export function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Human-readable error message for hook surfaces. */
export function toErrorMessage(error: unknown, fallback = "Request failed"): string {
  if (error instanceof ApiHttpError) return error.message;
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export { ApiClient, ApiClientError } from "./api-client.ts";
