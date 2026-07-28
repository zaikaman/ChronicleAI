import { describe, expect, it } from "vitest";
import {
  assertProductionContentOrigin,
  buildAlertContentUri,
  buildDeskTicketContentUri,
  buildDigestContentUri,
  buildPremiumReceiptContentUri,
  buildSponsoredReportContentUri,
  isProductionReadyOrigin,
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

  it("builds premium receipt and desk ticket content URIs", () => {
    expect(buildPremiumReceiptContentUri("https://app.example.com", "item-1")).toBe(
      "https://app.example.com/premium?item=item-1",
    );
    expect(buildDeskTicketContentUri("https://app.example.com/", "ticket-9")).toBe(
      "https://app.example.com/desk/tickets/ticket-9",
    );
  });

  it("rejects localhost FRONTEND_ORIGIN for production contentUri", () => {
    expect(() => assertProductionContentOrigin("http://localhost:5173")).toThrow(/https/i);
    expect(() => assertProductionContentOrigin("https://localhost:5173")).toThrow(/localhost/i);
    expect(isProductionReadyOrigin("https://chronicle.example")).toBe(true);
    expect(isProductionReadyOrigin("http://localhost:5173")).toBe(false);
  });
});
