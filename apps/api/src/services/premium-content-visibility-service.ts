// Premium Content Visibility Service
// Ensures premium-only content never leaks through public API responses.

import type {
  PremiumIntelligenceItemRow,
  PremiumIntelligenceTeaserRow,
} from "@chronicleai/db";
import { MONTHLY_NEWSLETTER_SLUG } from "@chronicleai/schemas";

/**
 * Teaser response (public-safe fields only).
 */
export interface PremiumItemTeaser {
  id: string;
  slug: string;
  title: string;
  summaryPublic: string;
  sourceChainId?: number;
  contentType: string;
  priceAmount: number;
  priceCurrency: string;
  paymentRoutes: string[];
  status: string;
  createdAt: string;
}

/** Public columns needed to build a teaser (no content_private). */
export type PremiumTeaserSource = Pick<
  PremiumIntelligenceTeaserRow,
  | "id"
  | "slug"
  | "title"
  | "summary_public"
  | "source_chain_id"
  | "content_type"
  | "price_amount"
  | "price_currency"
  | "payment_routes"
  | "status"
  | "created_at"
>;

/**
 * Recurring newsletter is a catalog FK + footer subscribe product, not a
 * one-shot /premium teaser. Keep the row for payment_records; hide from lists.
 */
export function isCatalogOnlyPremiumItem(
  row: Pick<PremiumIntelligenceItemRow, "content_type" | "slug">,
): boolean {
  return (
    row.content_type === "monthly_newsletter" ||
    row.slug === MONTHLY_NEWSLETTER_SLUG
  );
}

/** Items safe to list on GET /premium/items and similar public teaser surfaces. */
export function isPublicPremiumTeaser(
  row: Pick<PremiumIntelligenceItemRow, "content_type" | "slug">,
): boolean {
  return !isCatalogOnlyPremiumItem(row);
}

/**
 * Full premium item response (includes private content, only after payment).
 */
export interface PremiumItemFull extends PremiumItemTeaser {
  contentPrivate: unknown;
  sourceEventIds: string[];
}

/**
 * Strips private content from premium items for public responses.
 * Ensures premium-only analysis never leaks into public routes.
 */
export class PremiumContentVisibilityService {
  /**
   * Convert a database row to a public teaser (no private content).
   * Accepts teaser projections that omit content_private (P2-1).
   */
  toTeaser(row: PremiumTeaserSource): PremiumItemTeaser {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summaryPublic: row.summary_public,
      ...(row.source_chain_id !== undefined ? { sourceChainId: row.source_chain_id } : {}),
      contentType: row.content_type,
      priceAmount: row.price_amount,
      priceCurrency: row.price_currency,
      paymentRoutes: row.payment_routes,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  /**
   * Convert a database row to a full premium item (includes private content).
   * Only call this after payment verification.
   */
  toFullWithPrivateContent(row: PremiumIntelligenceItemRow): PremiumItemFull {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summaryPublic: row.summary_public,
      ...(row.source_chain_id !== undefined ? { sourceChainId: row.source_chain_id } : {}),
      contentType: row.content_type,
      priceAmount: row.price_amount,
      priceCurrency: row.price_currency,
      paymentRoutes: row.payment_routes,
      status: row.status,
      createdAt: row.created_at,
      contentPrivate: row.content_private,
      sourceEventIds: row.source_event_ids,
    };
  }

  /**
   * Convert a list of database rows to public teasers.
   * Excludes catalog-only products (e.g. monthly newsletter — sold via footer).
   */
  toTeaserList(rows: PremiumTeaserSource[]): PremiumItemTeaser[] {
    return rows.filter(isPublicPremiumTeaser).map((row) => this.toTeaser(row));
  }
}
