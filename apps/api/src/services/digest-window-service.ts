// Digest window service: validates reporting windows and checks for existing digests

import { DIGEST_REPORTING_WINDOW_HOURS } from "@chronicleai/config";
import type { DailyDigestRepository, DailyDigestRow } from "@chronicleai/db";

/** Digests still awaiting a successful publish pass — safe to resume. */
export const RESUMABLE_DIGEST_STATUSES = new Set(["draft", "queued", "failed"]);

export interface ExistingDigestSummary {
  id: string;
  title: string;
  summary: string;
  highlights: string[];
  analysis: string | null;
  reportDate: string;
  sourceEventIds: string[];
  publicationStatus: string;
  sourceEventRoot: string | null;
  periodStart: string;
  periodEnd: string;
}

export interface WindowValidationResult {
  valid: boolean;
  reason?: string;
  existingDigestId?: string;
  existingPublicationStatus?: string;
  /** Full summary when a digest already exists for this window. */
  existingDigest?: ExistingDigestSummary;
}

export interface DigestWindowService {
  /** Validate a reporting window. */
  validateWindow(params: {
    periodStart: string;
    periodEnd: string;
  }): WindowValidationResult;

  /** Check if a digest already exists for this window. */
  checkDuplicate(params: {
    periodStart: string;
    periodEnd: string;
    digestKind?: "market" | "desk";
  }): Promise<WindowValidationResult>;
}

function toExistingDigestSummary(row: DailyDigestRow): ExistingDigestSummary {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    highlights: row.highlights ?? [],
    analysis: row.analysis ?? null,
    reportDate: row.report_date,
    sourceEventIds: row.source_event_ids ?? [],
    publicationStatus: row.publication_status,
    sourceEventRoot: row.source_event_root ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

export function createDigestWindowService(digestRepo: DailyDigestRepository): DigestWindowService {
  return {
    validateWindow({ periodStart, periodEnd }) {
      const start = new Date(periodStart);
      const end = new Date(periodEnd);

      if (!periodStart || !periodEnd) {
        return { valid: false, reason: "periodStart and periodEnd are required" };
      }

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { valid: false, reason: "periodStart and periodEnd must be valid ISO date strings" };
      }

      if (start >= end) {
        return { valid: false, reason: "periodStart must be before periodEnd" };
      }

      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

      if (durationHours > DIGEST_REPORTING_WINDOW_HOURS * 2) {
        return {
          valid: false,
          reason: `Reporting window exceeds maximum duration of ${DIGEST_REPORTING_WINDOW_HOURS * 2} hours`,
        };
      }

      // Future windows are not valid
      if (end.getTime() > Date.now() + 3600_000) {
        return { valid: false, reason: "Reporting window cannot be in the future" };
      }

      return { valid: true };
    },

    async checkDuplicate({ periodStart, periodEnd, digestKind }) {
      const existing = await digestRepo.findByWindow(periodStart, periodEnd, digestKind);

      if (existing) {
        const summary = toExistingDigestSummary(existing);
        return {
          valid: false,
          reason: `Digest already exists for this window (ID: ${existing.id}, status: ${existing.publication_status})`,
          existingDigestId: existing.id,
          existingPublicationStatus: existing.publication_status,
          existingDigest: summary,
        };
      }

      return { valid: true };
    },
  };
}
