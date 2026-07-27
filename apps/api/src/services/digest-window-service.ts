// Digest window service: validates reporting windows and checks for existing digests

import { DIGEST_REPORTING_WINDOW_HOURS } from "@chronicleai/config";
import type { DailyDigestRepository } from "@chronicleai/db";

export interface WindowValidationResult {
  valid: boolean;
  reason?: string;
  existingDigestId?: string;
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
  }): Promise<WindowValidationResult>;
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

    async checkDuplicate({ periodStart, periodEnd }) {
      const existing = await digestRepo.findByWindow(periodStart, periodEnd);

      if (existing) {
        return {
          valid: false,
          reason: `Digest already exists for this window (ID: ${existing.id}, status: ${existing.publication_status})`,
          existingDigestId: existing.id,
        };
      }

      return { valid: true };
    },
  };
}
