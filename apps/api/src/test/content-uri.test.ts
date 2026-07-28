import { describe, expect, it } from "vitest";
import {
  buildAlertContentUri,
  buildDigestContentUri,
  buildSponsoredReportContentUri,
  normalizeOrigin,
} from "../services/content-uri.ts";

describe("content-uri", () => {
  it("normalizes trailing slashes on origin", () => {
    expect(normalizeOrigin("https://app.example.com/")).toBe("https://app.example.com");
  });

  it("rejects non-absolute origins", () => {
    expect(() => normalizeOrigin("app.example.com")).toThrow(/absolute/i);
  });

  it("builds stable HTTPS alert URIs", () => {
    expect(buildAlertContentUri("https://app.example.com", "alert-1")).toBe(
      "https://app.example.com/alerts/alert-1",
    );
  });

  it("builds stable HTTPS digest URIs (per-id, not /latest)", () => {
    expect(buildDigestContentUri("https://app.example.com/", "digest-99")).toBe(
      "https://app.example.com/digests/digest-99",
    );
  });

  it("builds sponsored report URIs under premium watches", () => {
    expect(buildSponsoredReportContentUri("https://app.example.com", "watch-1")).toBe(
      "https://app.example.com/premium/watches/watch-1",
    );
  });
});
