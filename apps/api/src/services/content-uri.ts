/**
 * HTTPS content URIs for on-chain registry proofs.
 *
 * On-chain `ipfsUri` / `reportUri` fields must resolve to real content, not
 * custom schemes like `chronicleai://`. With a Vercel-hosted SPA, we point at
 * stable public pages under FRONTEND_ORIGIN.
 */

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
