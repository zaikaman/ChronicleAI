// Unit tests for email subscriber validation helpers

import { describe, expect, it } from "vitest";
import {
  isValidSubscriberEmail,
  normalizeSubscriberEmail,
} from "@chronicleai/db";

describe("email subscriber validation", () => {
  it("normalizes emails to trimmed lowercase", () => {
    expect(normalizeSubscriberEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("accepts practical email addresses", () => {
    expect(isValidSubscriberEmail("user@example.com")).toBe(true);
    expect(isValidSubscriberEmail("first.last+tag@mail.example.org")).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(isValidSubscriberEmail("")).toBe(false);
    expect(isValidSubscriberEmail("not-an-email")).toBe(false);
    expect(isValidSubscriberEmail("@missing-local.com")).toBe(false);
    expect(isValidSubscriberEmail("missing-domain@")).toBe(false);
  });
});
