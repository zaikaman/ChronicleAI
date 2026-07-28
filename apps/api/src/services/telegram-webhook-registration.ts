// Idempotent Telegram Bot API setWebhook on process boot.
// Telegram stores the webhook URL server-side — deploys do not clear it.
// We still re-assert on boot so URL/secret changes self-heal without a manual script.

const TELEGRAM_API = "https://api.telegram.org";

export type EnsureTelegramWebhookOptions = {
  botToken: string;
  /** Shared secret for X-Telegram-Bot-Api-Secret-Token */
  secretToken: string;
  /**
   * Public HTTPS origin of this API with no trailing slash,
   * e.g. https://chronicleai-xxx.herokuapp.com
   */
  publicApiBaseUrl: string;
  fetchImpl?: typeof fetch;
};

export type EnsureTelegramWebhookResult =
  | { status: "skipped"; reason: string }
  | { status: "already_configured"; url: string }
  | { status: "updated"; url: string }
  | { status: "failed"; error: string };

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function buildWebhookUrl(publicApiBaseUrl: string): string {
  return `${normalizeBaseUrl(publicApiBaseUrl)}/telegram/webhook`;
}

function isValidPublicHttpsBase(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(parsed.host) && parsed.pathname === "/";
  } catch {
    return false;
  }
}

/**
 * Ensures Telegram delivers updates to POST {PUBLIC_API_BASE_URL}/telegram/webhook
 * with the configured secret_token. No-ops when already correct.
 */
export async function ensureTelegramWebhook(
  options: EnsureTelegramWebhookOptions,
): Promise<EnsureTelegramWebhookResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const base = normalizeBaseUrl(options.publicApiBaseUrl);

  if (!options.botToken.trim()) {
    return { status: "skipped", reason: "missing bot token" };
  }
  if (!options.secretToken.trim()) {
    return { status: "skipped", reason: "missing webhook secret" };
  }
  if (!/^https:\/\//i.test(base)) {
    return {
      status: "skipped",
      reason: "PUBLIC_API_BASE_URL must be https (Telegram rejects http webhooks)",
    };
  }
  // Accept origin with or without path-only "/"
  let originForCheck = base;
  try {
    const u = new URL(base);
    originForCheck = `${u.protocol}//${u.host}`;
  } catch {
    return { status: "skipped", reason: "PUBLIC_API_BASE_URL is not a valid URL" };
  }
  if (!isValidPublicHttpsBase(`${originForCheck}/`)) {
    return { status: "skipped", reason: "PUBLIC_API_BASE_URL must be a public https origin" };
  }

  const desiredUrl = buildWebhookUrl(originForCheck);
  const apiBase = `${TELEGRAM_API}/bot${options.botToken}`;

  try {
    const infoRes = await fetchFn(`${apiBase}/getWebhookInfo`);
    const infoJson = (await infoRes.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { url?: string; has_custom_certificate?: boolean };
    };

    if (!infoRes.ok || !infoJson.ok) {
      return {
        status: "failed",
        error: infoJson.description ?? `getWebhookInfo HTTP ${infoRes.status}`,
      };
    }

    const currentUrl = infoJson.result?.url ?? "";
    // Telegram does not echo secret_token back; if URL matches we leave it alone
    // unless URL is empty. Secret changes require setWebhook again — operators
    // should bump PUBLIC or secret and redeploy (this path always setWebhook when URL differs).
    if (currentUrl === desiredUrl) {
      return { status: "already_configured", url: desiredUrl };
    }

    const setRes = await fetchFn(`${apiBase}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: desiredUrl,
        secret_token: options.secretToken,
        allowed_updates: [
          "message",
          "channel_post",
          "edited_message",
          "edited_channel_post",
        ],
        drop_pending_updates: false,
      }),
    });
    const setJson = (await setRes.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };

    if (!setRes.ok || !setJson.ok) {
      return {
        status: "failed",
        error: setJson.description ?? `setWebhook HTTP ${setRes.status}`,
      };
    }

    return { status: "updated", url: desiredUrl };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolve public API base for webhook registration from env-like fields.
 * Prefer explicit PUBLIC_API_BASE_URL; fall back to Heroku app name when present.
 */
export function resolvePublicApiBaseUrl(env: {
  publicApiBaseUrl?: string | undefined;
}): string | undefined {
  const explicit = env.publicApiBaseUrl?.trim();
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  const herokuApp = process.env["HEROKU_APP_NAME"]?.trim();
  if (herokuApp) {
    // Default app hostname. Review apps / custom domains should set PUBLIC_API_BASE_URL.
    return `https://${herokuApp}.herokuapp.com`;
  }

  return undefined;
}
