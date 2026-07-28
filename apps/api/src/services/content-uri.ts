/**
 * HTTPS content URIs for on-chain registry proofs.
 *
 * On-chain `ipfsUri` / `reportUri` fields must resolve to real content, not
 * custom schemes like `chronicleai://`. With a Vercel-hosted SPA, we point at
 * stable public pages under FRONTEND_ORIGIN.
 */

const LOCALHOST_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Content origin must be a non-empty absolute URL");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Content origin must be an absolute http(s) URL, got: ${origin}`);
  }
  return trimmed;
}

/**
 * Production publish path: require HTTPS and non-localhost FRONTEND_ORIGIN so
 * on-chain contentUri never points at developer machines.
 */
export function assertProductionContentOrigin(origin: string): string {
  const normalized = normalizeOrigin(origin);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`FRONTEND_ORIGIN is not a valid absolute URL: ${origin}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Production FRONTEND_ORIGIN must use https (got ${parsed.protocol}//${parsed.host})`,
    );
  }
  if (LOCALHOST_HOST_RE.test(parsed.hostname)) {
    throw new Error(
      `Production FRONTEND_ORIGIN must not be localhost (got ${parsed.host}) — set a public SPA origin`,
    );
  }
  return normalized;
}

/** True when origin is usable for public on-chain content URIs in production. */
export function isProductionReadyOrigin(origin: string): boolean {
  try {
    assertProductionContentOrigin(origin);
    return true;
  } catch {
    return false;
  }
}

/** Public alert page for a specific published alert. */
export function buildAlertContentUri(frontendOrigin: string, alertId: string): string {
  const origin = normalizeOrigin(frontendOrigin);
  const id = encodeURIComponent(alertId);
  return `${origin}/alerts/${id}`;
}

/**
 * Public digest page for a specific digest.
 * Prefer per-id path so the URI remains valid after newer digests publish.
 */
export function buildDigestContentUri(frontendOrigin: string, digestId: string): string {
  const origin = normalizeOrigin(frontendOrigin);
  const id = encodeURIComponent(digestId);
  return `${origin}/digests/${id}`;
}

/** Public sponsored-watch report page. */
export function buildSponsoredReportContentUri(
  frontendOrigin: string,
  watchId: string,
): string {
  const origin = normalizeOrigin(frontendOrigin);
  const id = encodeURIComponent(watchId);
  return `${origin}/premium/watches/${id}`;
}

/** Public desk trade-ticket page (on-chain contentUri for publishTradeTicket). */
export function buildDeskTicketContentUri(
  frontendOrigin: string,
  ticketId: string,
): string {
  const origin = normalizeOrigin(frontendOrigin);
  const id = encodeURIComponent(ticketId);
  return `${origin}/desk/tickets/${id}`;
}

/**
 * Public premium surface for on-chain publishPremiumReceipt contentUri.
 * Deep-links the premium catalog with the item id for UI resolution.
 */
export function buildPremiumReceiptContentUri(
  frontendOrigin: string,
  premiumItemId: string,
): string {
  const origin = normalizeOrigin(frontendOrigin);
  const id = encodeURIComponent(premiumItemId);
  return `${origin}/premium?item=${id}`;
}
