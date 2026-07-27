// Contract test utilities for validating API response shape against shared schemas

import { describe, expect } from "vitest";

// ── Required Field Check ───────────────────────────────
export function assertHasRequiredFields(
  obj: Record<string, unknown>,
  requiredFields: string[],
  path = "response",
): void {
  for (const field of requiredFields) {
    expect(obj, `${path} should have required field: ${field}`).toHaveProperty(field);
  }
}

// ── Status Enum Check ──────────────────────────────────
export function assertValidEnumValue<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  fieldName: string,
): asserts value is T {
  expect(allowedValues, `${fieldName} should be one of: ${allowedValues.join(", ")}`).toContain(
    value,
  );
}

// ── Response Shape Assertions ──────────────────────────
export function assertItemsResponse(
  body: Record<string, unknown>,
): asserts body is { items: unknown[] } {
  expect(body).toHaveProperty("items");
  expect(Array.isArray(body.items)).toBe(true);
}

export function assertPublicAlertShape(alert: Record<string, unknown>): void {
  assertHasRequiredFields(alert, [
    "id",
    "title",
    "summary",
    "sourceReferences",
    "deliveryStatus",
    "publishedAt",
  ]);
}

export function assertDailyDigestShape(digest: Record<string, unknown>): void {
  assertHasRequiredFields(digest, [
    "id",
    "reportDate",
    "title",
    "summary",
    "highlights",
    "publicationStatus",
  ]);
}

export function assertPremiumItemTeaserShape(teaser: Record<string, unknown>): void {
  assertHasRequiredFields(teaser, [
    "id",
    "title",
    "summaryPublic",
    "priceAmount",
    "priceCurrency",
    "paymentRoutes",
  ]);
}

export function assertPaymentChallengeShape(challenge: Record<string, unknown>): void {
  assertHasRequiredFields(challenge, [
    "challengeReference",
    "premiumItemId",
    "paymentRoute",
    "amountRequested",
    "currency",
    "expiresAt",
  ]);
}

export function assertPaymentRecordShape(record: Record<string, unknown>): void {
  assertHasRequiredFields(record, ["id", "premiumItemId", "paymentRoute", "status"]);
}

export function assertAgentActivityShape(activity: Record<string, unknown>): void {
  assertHasRequiredFields(activity, [
    "alerts",
    "digests",
    "payments",
    "treasury",
    "executionLogs",
  ]);
}

// ── HTTP Status Assertions ─────────────────────────────
export function expectStatus(response: { status: number }, expected: number): void {
  expect(response.status).toBe(expected);
}

export function expectSuccess(response: { status: number }): void {
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
}

// ── Test Suite Builder ─────────────────────────────────
export function describeContract(name: string, fn: () => void): void {
  describe(`Contract: ${name}`, () => {
    fn();
  });
}
