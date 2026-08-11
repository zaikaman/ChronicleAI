import { describe, expect, it } from "vitest";
import { fallbackCampaignOutcome } from "./SponsoredWatchDetailPage.tsx";

describe("fallbackCampaignOutcome", () => {
  it("keeps active monitoring copy honest when the report summary is not ready", () => {
    expect(fallbackCampaignOutcome("monitoring", false)).toBe("Monitoring campaign in progress.");
  });

  it("uses completed copy for a completed campaign", () => {
    expect(fallbackCampaignOutcome("completed", false)).toBe("Monitoring campaign completed.");
  });

  it("uses completed copy when both audit transactions are available", () => {
    expect(fallbackCampaignOutcome("monitoring", true)).toBe("Monitoring campaign completed.");
  });
});
