// Digest test fixtures

import type { DigestRunPayload } from "@chronicleai/schemas";

export function createValidDigestRunPayload(
  overrides?: Partial<DigestRunPayload>,
): DigestRunPayload {
  const now = Date.now();
  const periodEnd = new Date(now).toISOString();
  const periodStart = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  return {
    periodStart,
    periodEnd,
    ...overrides,
  };
}

export function createPopulatedWindowPayload(): DigestRunPayload {
  const now = Date.now();
  return {
    periodStart: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    periodEnd: new Date(now).toISOString(),
  };
}

export function createEmptyWindowPayload(): DigestRunPayload {
  const now = Date.now();
  return {
    periodStart: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    periodEnd: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
  };
}

export function createInvalidWindowPayload(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    // Missing required field: periodEnd
    periodStart: new Date().toISOString(),
    ...overrides,
  };
}

export function createDuplicateWindowPayload(base: DigestRunPayload): DigestRunPayload {
  return {
    periodStart: base.periodStart,
    periodEnd: base.periodEnd,
  };
}

export function createInvalidDateWindowPayload(): Record<string, unknown> {
  return {
    periodStart: "not-a-date",
    periodEnd: "also-not-a-date",
  };
}

export function createReversedWindowPayload(): DigestRunPayload {
  const now = Date.now();
  return {
    periodStart: new Date(now).toISOString(),
    periodEnd: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function createFutureWindowPayload(): DigestRunPayload {
  const now = Date.now();
  return {
    periodStart: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    periodEnd: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
  };
}

export function createGeneratedDigestContent(
  overrides?: Partial<{
    title: string;
    summary: string;
    highlights: string[];
    analysis: string;
    sourceEventIds: string[];
  }>,
) {
  return {
    title: "ChronicleAI Daily Digest — Monday, July 27, 2026",
    summary: "Over the reporting period, ChronicleAI monitored 3 qualifying on-chain events.",
    highlights: [
      "1. large swap on Uniswap (ETH/USDC) $2,500,000 USD (significance: 75%)",
      "2. liquidation on Aave (ETH) $1,200,000 USD (significance: 68%)",
      "3. gas spike (850 gwei) (significance: 60%)",
    ],
    analysis:
      "During this reporting period, ChronicleAI detected and qualified 3 noteworthy on-chain events across 1 chain(s). Event type distribution: large swap, liquidation, gas spike.",
    sourceEventIds: ["evt-001", "evt-002", "evt-003"],
    ...overrides,
  };
}

export function createNoMajorEventsDigestContent() {
  return {
    title: "ChronicleAI Daily Digest — Monday, July 27, 2026",
    summary: "No significant on-chain events were detected during the reporting period.",
    highlights: ["No major events detected during this reporting period."],
    analysis:
      "The absence of significant on-chain activity during this period suggests normal market conditions.",
    sourceEventIds: [],
  };
}
