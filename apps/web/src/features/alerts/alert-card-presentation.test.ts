import type { PublicAlertResponse } from "@chronicleai/schemas";
import { describe, expect, it } from "vitest";
import {
  alertActionStepLabel,
  alertHasSignalStep,
  alertKindBadgeLabel,
  alertSourceOriginLabel,
  isDeskTriggerAlert,
} from "./alert-card-presentation.ts";

function baseAlert(overrides: Partial<PublicAlertResponse> = {}): PublicAlertResponse {
  return {
    id: "alert-1",
    title: "Test alert",
    summary: "Summary text",
    sourceReferences: [],
    deliveryStatus: "published",
    publishedAt: "2026-08-01T00:00:00.000Z",
    alertKind: "market_event",
    chainId: 1,
    publicationChainId: 11_155_111,
    ...overrides,
  };
}

describe("alert-card-presentation", () => {
  it("labels Market event vs Desk trigger badges", () => {
    expect(alertKindBadgeLabel(baseAlert({ alertKind: "market_event" }))).toBe("Market event");
    expect(alertKindBadgeLabel(baseAlert({ alertKind: "desk_trigger" }))).toBe("Desk trigger");
    expect(isDeskTriggerAlert(baseAlert({ alertKind: "desk_trigger" }))).toBe(true);
  });

  it("shows Chronicle Desk source with typed trigger label", () => {
    expect(
      alertSourceOriginLabel(
        baseAlert({
          alertKind: "desk_trigger",
          sourceTriggerLabel: "Health factor",
        }),
      ),
    ).toBe("Chronicle Desk · Health factor");
    expect(alertSourceOriginLabel(baseAlert({ alertKind: "market_event" }))).toBeNull();
  });

  it("omits Signal step for direct capital decisions", () => {
    expect(
      alertHasSignalStep(
        baseAlert({
          alertKind: "desk_trigger",
          signalType: "capital_tick",
          signalStatus: "not_eligible",
          policyVerdict: "trade",
          actionStatus: "pending",
        }),
      ),
    ).toBe(false);
  });

  it("keeps Signal step when a desk signal was created", () => {
    expect(
      alertHasSignalStep(
        baseAlert({
          alertKind: "desk_trigger",
          signalType: "oracle_basis",
          signalStatus: "created",
          policyVerdict: "trade",
        }),
      ),
    ).toBe(true);
  });

  it("labels deferred actions honestly", () => {
    expect(
      alertActionStepLabel(
        baseAlert({
          policyVerdict: "defer",
          actionStatus: "deferred",
        }),
      ),
    ).toBe("Action · Deferred");
  });

  it("distinguishes filled, failed, and submitted action labels", () => {
    expect(alertActionStepLabel(baseAlert({ actionStatus: "filled" }))).toBe("Action · Filled");
    expect(alertActionStepLabel(baseAlert({ actionStatus: "failed" }))).toBe("Action · Failed");
    expect(alertActionStepLabel(baseAlert({ actionStatus: "submitted" }))).toBe(
      "Action · Submitted",
    );
  });
});
