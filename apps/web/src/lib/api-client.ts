// Typed API client for frontend requests

export interface ApiClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  retryCount?: number;
  headers?: Record<string, string>;
}

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly body: unknown;

  constructor(statusCode: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class ApiClient {
  private readonly config: Required<ApiClientConfig>;

  constructor(config: ApiClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      timeoutMs: config.timeoutMs ?? 15_000,
      retryCount: config.retryCount ?? 2,
      headers: config.headers ?? {},
    };
  }

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    let url = `${this.config.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    return url;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      params?: Record<string, string | number | undefined>;
      signal?: AbortSignal;
    },
    attempt = 0,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    // Merge external signal with timeout
    const signal = options?.signal
      ? combineSignals(options.signal, controller.signal)
      : controller.signal;

    try {
      const requestBody: string | null | undefined = options?.body ? JSON.stringify(options.body) : null;

      const response = await fetch(this.buildUrl(path, options?.params), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        ...(requestBody !== null ? { body: requestBody } : {}),
        signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        throw new ApiClientError(response.status, body.error ?? response.statusText, body);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiClientError) {
        throw error;
      }

      // Retry on network errors
      if (attempt < this.config.retryCount && !isAbortError(error)) {
        const delay = Math.min(1000 * 2 ** attempt, 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.request<T>(method, path, options, attempt + 1);
      }

      if (isAbortError(error)) {
        throw new ApiClientError(408, "Request timeout or cancelled");
      }

      throw new ApiClientError(0, "Network error");
    }
  }

  async get<T>(
    path: string,
    options?: { params?: Record<string, string | number | undefined>; signal?: AbortSignal },
  ): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return this.request<T>("POST", path, { body, ...options });
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return this.request<T>("PUT", path, { body, ...options });
  }

  async del<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }
}

// ── Helpers ─────────────────────────────────────────────
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

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}
