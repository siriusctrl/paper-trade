import { describe, expect, it } from "vitest";

import {
  describeFundingDirection,
  formatAnnualizedFundingRate,
  formatFundingCadence,
  formatFundingRate,
  formatFundingTime,
} from "./funding";

describe("funding helpers", () => {
  it("formats funding rates as signed percentages", () => {
    expect(formatFundingRate(0.0001)).toBe("+0.0100%");
    expect(formatFundingRate(-0.00025)).toBe("-0.0250%");
    expect(formatFundingRate(undefined)).toBe("N/A");
  });

  it("formats annualized funding rates as signed percentages", () => {
    expect(formatAnnualizedFundingRate(0.876)).toBe("+87.60%");
    expect(formatAnnualizedFundingRate(-0.152706)).toBe("-15.27%");
    expect(formatAnnualizedFundingRate(undefined)).toBe("N/A");
  });

  it("describes payment direction using direction when present and rate as fallback", () => {
    expect(describeFundingDirection("long_pays_short", -0.1)).toBe("Longs pay shorts");
    expect(describeFundingDirection("short_pays_long", 0.1)).toBe("Shorts pay longs");
    expect(describeFundingDirection(undefined, 0.001)).toBe("Longs pay shorts");
    expect(describeFundingDirection(undefined, 0)).toBe("No funding transfer");
  });

  it("formats funding timestamps into a readable UTC label", () => {
    expect(formatFundingTime("2026-03-16T12:30:00.000Z")).toContain("UTC");
    expect(formatFundingTime("not-a-date")).toBe("unknown");
  });

  it("formats funding cadence labels", () => {
    expect(formatFundingCadence(1)).toBe("1h");
    expect(formatFundingCadence(0.25)).toBe("15m");
    expect(formatFundingCadence(undefined)).toBe("unknown cadence");
  });
});
