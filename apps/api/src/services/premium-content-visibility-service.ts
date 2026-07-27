// Premium Content Visibility Service
// Ensures premium-only content never leaks through public API responses.

import type { PremiumIntelligenceItemRow } from "@chronicleai/db";

/**
 * Teaser response (public-safe fields only).
 */
export interface PremiumItemTeaser {
  id: string;
  slug: string;
  title: string;
  summaryPublic: string;
  contentType: string;
  priceAmount: number;
  priceCurrency: string;
  paymentRoutes: string[];
  status: string;
  createdAt: string;
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
   */
  toTeaser(row: PremiumIntelligenceItemRow): PremiumItemTeaser {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summaryPublic: row.summary_public,
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
   */
  toTeaserList(rows: PremiumIntelligenceItemRow[]): PremiumItemTeaser[] {
    return rows.map((row) => this.toTeaser(row));
  }
}
